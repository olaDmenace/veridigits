import { inngest } from "./client";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

const PROFILE_BATCH = 200;

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
    let lastCreatedAt: string | null = null;

    for (let page = 0; page < 200; page++) {
      const batch = await step.run(`page-${page}`, () =>
        scanPage(lastCreatedAt),
      );
      if (batch.length === 0) break;

      totalChecked += batch.length;
      const drifting = batch.filter((b) => b.driftCents !== 0);
      totalDrift += drifting.length;

      if (drifting.length > 0) {
        await step.run(`alert-${page}`, () => recordDrift(drifting));
      }

      lastCreatedAt = batch[batch.length - 1].createdAt;
      if (batch.length < PROFILE_BATCH) break;
    }

    logger.info("wallet reconciliation complete", {
      checked: totalChecked,
      drifting: totalDrift,
    });
    return { checked: totalChecked, drifting: totalDrift };
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
