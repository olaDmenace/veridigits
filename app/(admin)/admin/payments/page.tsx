import { getAdminClient } from "@/lib/supabase/admin";
import { formatUsdCents } from "@/lib/utils/money";

export const metadata = { title: "Payments · Admin" };
export const dynamic = "force-dynamic";

const PER_RAIL = 100;

const FIAT_SYMBOL: Record<string, string> = { NGN: "₦", GHS: "₵" };

interface UnifiedPayment {
  id: string;
  kind: "crypto" | "fiat";
  rail: string;
  userId: string;
  email: string | null;
  amountUsdCents: number;
  amountDisplay: string;
  badgeLabel: string;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
  externalId: string;
}

export default async function AdminPaymentsPage() {
  const admin = getAdminClient();

  const [cryptoRes, fiatRes, authList] = await Promise.all([
    admin
      .from("crypto_payments")
      .select(
        "id, user_id, provider, external_id, amount_usd_cents, crypto_currency, status, created_at, confirmed_at",
      )
      .order("created_at", { ascending: false })
      .limit(PER_RAIL),
    admin
      .from("fiat_payments")
      .select(
        "id, user_id, reference, korapay_reference, currency, amount_local, amount_usd_cents_credited, fx_rate_local_per_usd, status, created_at, confirmed_at",
      )
      .order("created_at", { ascending: false })
      .limit(PER_RAIL),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const emailById = new Map<string, string | null>();
  for (const u of authList.data?.users ?? []) {
    emailById.set(u.id, u.email ?? null);
  }

  const unified: UnifiedPayment[] = [
    ...(cryptoRes.data ?? []).map((c) => ({
      id: c.id,
      kind: "crypto" as const,
      rail: c.provider,
      userId: c.user_id,
      email: emailById.get(c.user_id) ?? null,
      amountUsdCents: c.amount_usd_cents,
      amountDisplay:
        formatUsdCents(c.amount_usd_cents) +
        (c.crypto_currency ? ` (${c.crypto_currency.toUpperCase()})` : ""),
      badgeLabel: "Crypto",
      status: c.status,
      createdAt: c.created_at,
      confirmedAt: c.confirmed_at,
      externalId: c.external_id,
    })),
    ...(fiatRes.data ?? []).map((n) => {
      const sym = FIAT_SYMBOL[n.currency] ?? "";
      return {
        id: n.id,
        kind: "fiat" as const,
        rail: "korapay",
        userId: n.user_id,
        email: emailById.get(n.user_id) ?? null,
        amountUsdCents: n.amount_usd_cents_credited,
        amountDisplay: `${sym}${Number(n.amount_local).toLocaleString()} → ${formatUsdCents(n.amount_usd_cents_credited)} @ ${Number(n.fx_rate_local_per_usd).toLocaleString()}/USD`,
        badgeLabel: n.currency,
        status: n.status,
        createdAt: n.created_at,
        confirmedAt: n.confirmed_at,
        externalId: n.reference,
      };
    }),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const totals = computeTotals(unified);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Payments
        </h1>
        <p className="body" style={{ marginTop: 14, maxWidth: 640 }}>
          Top-ups across both rails. The USD-cents amount shown is what was
          credited (or will be credited) to the user&apos;s wallet. Processor
          fees come out of the rail before settlement and are not displayed.
        </p>
      </div>

      <div className="how-grid">
        <div className="card flex flex-col gap-2">
          <div className="eyebrow">Confirmed (USD credited)</div>
          <div className="h2 mono">
            {formatUsdCents(totals.confirmedCredited)}
          </div>
          <div className="caption">
            {totals.confirmedCount} confirmed across both rails
          </div>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="eyebrow">Pending</div>
          <div className="h2 mono">{formatUsdCents(totals.pendingValue)}</div>
          <div className="caption">{totals.pendingCount} pending</div>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="eyebrow">Failed / expired</div>
          <div className="h2 mono">{String(totals.failedCount)}</div>
          <div className="caption">last {PER_RAIL} per rail</div>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="eyebrow">Crypto vs Fiat</div>
          <div className="h2 mono">
            {totals.byKind.crypto} / {totals.byKind.fiat}
          </div>
          <div className="caption">crypto / fiat (NGN+GHS) top-ups in view</div>
        </div>
      </div>

      {unified.length === 0 ? (
        <div
          className="card flex flex-col items-center gap-3 text-center"
          style={{ padding: 48 }}
        >
          <div className="eyebrow">No payments yet</div>
        </div>
      ) : (
        <div className="card-flat" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>User</th>
                  <th>Rail</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Reference</th>
                  <th>Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {unified.map((p) => (
                  <tr key={`${p.kind}-${p.id}`}>
                    <td>
                      <div className="mono caption">
                        {new Date(p.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.email ?? "—"}</div>
                      <div className="caption mono" style={{ marginTop: 4 }}>
                        {p.userId.slice(0, 8)}…
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-info">{p.badgeLabel}</span>
                      <div className="caption mono" style={{ marginTop: 4 }}>
                        {p.rail}
                      </div>
                    </td>
                    <td className="mono num">{p.amountDisplay}</td>
                    <td>
                      <PaymentStatusBadge status={p.status} />
                    </td>
                    <td className="mono caption">{p.externalId}</td>
                    <td>
                      <span className="mono caption">
                        {p.confirmedAt
                          ? new Date(p.confirmedAt).toLocaleString()
                          : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentStatusBadge({ status }: { status: string }) {
  // crypto: waiting | confirming | confirmed | failed | expired
  // ngn:    pending | success    | failed    | expired
  const variant =
    status === "confirmed" || status === "success"
      ? "badge-success"
      : status === "confirming" || status === "waiting" || status === "pending"
        ? "badge-warn"
        : "badge-danger";
  return <span className={`badge ${variant}`}>{status}</span>;
}

function computeTotals(payments: UnifiedPayment[]) {
  const totals = {
    confirmedCredited: 0,
    confirmedCount: 0,
    pendingValue: 0,
    pendingCount: 0,
    failedCount: 0,
    byKind: { crypto: 0, fiat: 0 },
  };
  for (const p of payments) {
    totals.byKind[p.kind]++;
    if (p.status === "confirmed" || p.status === "success") {
      totals.confirmedCredited += p.amountUsdCents;
      totals.confirmedCount++;
    } else if (
      p.status === "waiting" ||
      p.status === "confirming" ||
      p.status === "pending"
    ) {
      totals.pendingValue += p.amountUsdCents;
      totals.pendingCount++;
    } else {
      totals.failedCount++;
    }
  }
  return totals;
}
