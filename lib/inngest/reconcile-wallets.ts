import { inngest } from "./client";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { sendEmail, getAdminRecipients } from "@/lib/email/resend";
import { formatUsdCents } from "@/lib/utils/money";

const PROFILE_BATCH = 200;
const TOP_DRIFT_IN_EMAIL = 10;

/**
 * Nightly wallet reconciliation.
 *
 * Iron law: `profiles.wallet_balance_cents` must equal the SUM of
 * `wallet_transactions.amount_cents` for that user. If those drift, we have
 * a bug — wallet_apply is the single point of truth and any drift means
 * someone wrote directly to one of the tables. We catch and alert.
 *
 * Action: insert an abuse_events row per drifting profile, action_taken='none'.
 * Admin reviews from /admin/users + the abuse_events table.
 *
 * For v1 we walk profiles in pages and aggregate in JS. At low scale this
 * is fine; once profiles > 50k we should push the SUM into Postgres via an
 * RPC + UNNEST diff.
 */
export const reconcileWalletsFn = inngest.createFunction(
  {
    id: "reconcile-wallets",
    triggers: [{ cron: "0 4 * * *" }],
  },
  async ({ step, logger }) => {
    let totalChecked = 0;
    let totalDrift = 0;
    let totalAbsDriftCents = 0;
    const topDrift: ProfileCheck[] = [];
    let lastCreatedAt: string | null = null;

    for (let page = 0; page < 200; page++) {
      const batch = await step.run(`page-${page}`, () =>
        scanPage(lastCreatedAt),
      );
      if (batch.length === 0) break;

      totalChecked += batch.length;
      const drifting = batch.filter((b) => b.driftCents !== 0);
      totalDrift += drifting.length;
      for (const d of drifting) {
        totalAbsDriftCents += Math.abs(d.driftCents);
      }

      // Keep the top N by absolute drift across all pages, for the email body.
      for (const d of drifting) {
        topDrift.push(d);
      }
      topDrift.sort((a, b) => Math.abs(b.driftCents) - Math.abs(a.driftCents));
      if (topDrift.length > TOP_DRIFT_IN_EMAIL) {
        topDrift.length = TOP_DRIFT_IN_EMAIL;
      }

      if (drifting.length > 0) {
        await step.run(`alert-${page}`, () => recordDrift(drifting));
      }

      lastCreatedAt = batch[batch.length - 1].createdAt;
      if (batch.length < PROFILE_BATCH) break;
    }

    if (totalDrift > 0) {
      const result = await step.run("send-drift-email", () =>
        sendDriftEmail({
          checked: totalChecked,
          drifting: totalDrift,
          totalAbsDriftCents,
          top: topDrift,
        }),
      );
      logger.info("wallet drift alert", result);
    }

    logger.info("wallet reconciliation complete", {
      checked: totalChecked,
      drifting: totalDrift,
    });
    return {
      checked: totalChecked,
      drifting: totalDrift,
      totalAbsDriftCents,
    };
  },
);

interface ProfileCheck {
  userId: string;
  createdAt: string;
  reportedCents: number;
  ledgerCents: number;
  driftCents: number;
}

async function scanPage(after: string | null): Promise<ProfileCheck[]> {
  const admin = getAdminClient();

  let q = admin
    .from("profiles")
    .select("id, wallet_balance_cents, created_at")
    .order("created_at", { ascending: true })
    .limit(PROFILE_BATCH);

  if (after) q = q.gt("created_at", after);

  const { data: profiles, error } = await q;
  if (error || !profiles) return [];

  if (profiles.length === 0) return [];

  // Sum ledger amounts per user in one shot for this batch.
  const userIds = profiles.map((p) => p.id);
  const { data: txRows } = await admin
    .from("wallet_transactions")
    .select("user_id, amount_cents")
    .in("user_id", userIds);

  const ledgerByUser = new Map<string, number>();
  for (const row of txRows ?? []) {
    ledgerByUser.set(
      row.user_id,
      (ledgerByUser.get(row.user_id) ?? 0) + row.amount_cents,
    );
  }

  return profiles.map((p) => {
    const ledger = ledgerByUser.get(p.id) ?? 0;
    return {
      userId: p.id,
      createdAt: p.created_at,
      reportedCents: p.wallet_balance_cents,
      ledgerCents: ledger,
      driftCents: p.wallet_balance_cents - ledger,
    };
  });
}

async function recordDrift(drifting: ProfileCheck[]): Promise<void> {
  const admin = getAdminClient();
  const rows = drifting.map((d) => ({
    user_id: d.userId,
    event_type: "suspicious_pattern" as const,
    details: {
      kind: "wallet_drift",
      reported_cents: d.reportedCents,
      ledger_cents: d.ledgerCents,
      drift_cents: d.driftCents,
    } as Json,
    action_taken: "none" as const,
  }));

  await admin.from("abuse_events").insert(rows);
}

interface DriftSummary {
  checked: number;
  drifting: number;
  totalAbsDriftCents: number;
  top: ProfileCheck[];
}

async function sendDriftEmail(summary: DriftSummary): Promise<{
  sent: boolean;
  reason?: string;
}> {
  const recipients = getAdminRecipients();
  if (recipients.length === 0) {
    return { sent: false, reason: "ADMIN_EMAILS not configured" };
  }

  const rows = summary.top
    .map((d) => {
      const shortId = d.userId.slice(0, 8);
      const direction = d.driftCents > 0 ? "+" : "";
      return `<tr>
        <td style="padding:6px 12px;font-family:monospace;font-size:12px">${shortId}</td>
        <td style="padding:6px 12px;text-align:right">${formatUsdCents(d.reportedCents)}</td>
        <td style="padding:6px 12px;text-align:right">${formatUsdCents(d.ledgerCents)}</td>
        <td style="padding:6px 12px;text-align:right;color:${d.driftCents > 0 ? "#b45309" : "#b91c1c"}"><b>${direction}${formatUsdCents(d.driftCents)}</b></td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#0a0a0a;background:#f4f4f5;padding:24px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e4e4e7">
    <h1 style="margin:0 0 8px;font-size:20px;color:#b91c1c">Wallet drift detected</h1>
    <p style="margin:0 0 24px;color:#52525b">
      The nightly reconciliation job found a mismatch between
      <code>profiles.wallet_balance_cents</code> and the
      <code>wallet_transactions</code> ledger sum.
    </p>

    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px;background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;padding:12px">
        <div style="font-size:11px;text-transform:uppercase;color:#71717a;letter-spacing:.05em">Profiles checked</div>
        <div style="font-size:22px;font-weight:600;margin-top:4px">${summary.checked}</div>
      </div>
      <div style="flex:1;min-width:140px;background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;padding:12px">
        <div style="font-size:11px;text-transform:uppercase;color:#71717a;letter-spacing:.05em">Drifting</div>
        <div style="font-size:22px;font-weight:600;margin-top:4px;color:#b91c1c">${summary.drifting}</div>
      </div>
      <div style="flex:1;min-width:140px;background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;padding:12px">
        <div style="font-size:11px;text-transform:uppercase;color:#71717a;letter-spacing:.05em">Total |drift|</div>
        <div style="font-size:22px;font-weight:600;margin-top:4px">${formatUsdCents(summary.totalAbsDriftCents)}</div>
      </div>
    </div>

    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#52525b;margin:0 0 12px">Top ${summary.top.length} by absolute drift</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden">
      <thead>
        <tr style="background:#fafafa">
          <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#71717a">User</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#71717a">Reported</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#71717a">Ledger</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#71717a">Drift</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#52525b;margin:24px 0 8px">Action items</h2>
    <ol style="margin:0;padding-left:20px;color:#27272a;font-size:14px;line-height:1.6">
      <li>Open /admin/users and review the abuse_events rows tagged <code>wallet_drift</code>.</li>
      <li>Check wallet_transactions for the affected users for the past 24h.</li>
      <li>If drift is real money, refund/correct via wallet_apply — never raw UPDATE.</li>
      <li>Find the writer that bypassed wallet_apply and patch the call site.</li>
    </ol>
  </div>
</body></html>`;

  const text = [
    `Wallet drift detected.`,
    ``,
    `Profiles checked: ${summary.checked}`,
    `Drifting: ${summary.drifting}`,
    `Total absolute drift: ${formatUsdCents(summary.totalAbsDriftCents)}`,
    ``,
    `Top ${summary.top.length}:`,
    ...summary.top.map(
      (d) =>
        `  ${d.userId.slice(0, 8)}  reported=${formatUsdCents(d.reportedCents)}  ledger=${formatUsdCents(d.ledgerCents)}  drift=${d.driftCents > 0 ? "+" : ""}${formatUsdCents(d.driftCents)}`,
    ),
  ].join("\n");

  const result = await sendEmail({
    to: recipients,
    subject: `[Veridigits] Wallet drift: ${summary.drifting} account${summary.drifting === 1 ? "" : "s"} (${formatUsdCents(summary.totalAbsDriftCents)})`,
    html,
    text,
    tags: { kind: "wallet_drift_alert" },
  });

  return result.ok
    ? { sent: true }
    : { sent: false, reason: result.error ?? "unknown" };
}
