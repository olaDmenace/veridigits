import Link from "next/link";
import { getAdminClient } from "@/lib/supabase/admin";
import { formatUsdCents } from "@/lib/utils/money";

export const metadata = { title: "Admin · Veridigits" };
export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const REVENUE_STATUSES = new Set(["active", "received", "completed"]);

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

interface PeriodTotals {
  revenue: number;
  cogs: number;
  margin: number;
  margin_pct: number;
  topups: number;
  orderCount: number;
}

export default async function AdminOverview() {
  const admin = getAdminClient();
  const sevenDaysAgoIso = isoDaysAgo(7);
  const thirtyDaysAgoIso = isoDaysAgo(30);

  // 30d window pulled once and bucketed in TS. Cheaper than 9 separate
  // SUM aggregates and small enough at current volume.
  const [
    ordersRes,
    cryptoRes,
    ngnRes,
    { count: userCount },
    { count: orderCount },
    { count: providerServiceCount },
    { count: abuseCount },
  ] = await Promise.all([
    admin
      .from("orders")
      .select("created_at, status, wholesale_paid_cents, retail_charged_cents")
      .gte("created_at", thirtyDaysAgoIso),
    admin
      .from("crypto_payments")
      .select("created_at, status, amount_usd_cents")
      .gte("created_at", thirtyDaysAgoIso),
    admin
      .from("fiat_payments")
      .select("created_at, status, amount_usd_cents_credited")
      .gte("created_at", thirtyDaysAgoIso),
    admin.from("profiles").select("*", { count: "exact", head: true }),
    admin.from("orders").select("*", { count: "exact", head: true }),
    admin
      .from("provider_services")
      .select("*", { count: "exact", head: true })
      .eq("is_enabled", true),
    admin
      .from("abuse_events")
      .select("*", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgoIso),
  ]);

  const period = {
    day: buildPeriodTotals(ordersRes.data, cryptoRes.data, ngnRes.data, 1),
    week: buildPeriodTotals(ordersRes.data, cryptoRes.data, ngnRes.data, 7),
    month: buildPeriodTotals(ordersRes.data, cryptoRes.data, ngnRes.data, 30),
  };

  // Pull confirmed top-ups count for the secondary counters card.
  const { count: confirmedTopupCount } = await admin
    .from("crypto_payments")
    .select("*", { count: "exact", head: true })
    .eq("status", "confirmed");

  return (
    <div className="flex flex-col gap-10">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Operations overview
        </h1>
        <p className="body" style={{ marginTop: 14, maxWidth: 640 }}>
          Revenue, COGS, and gross margin are net of refunded, cancelled, and
          expired orders. Top-ups are USD-cents we credited to wallets.
        </p>
      </div>

      <FinancialsSection period={period} />

      <div>
        <h2 className="h3" style={{ marginBottom: 16 }}>
          Counters
        </h2>
        <div className="how-grid">
          <CounterCard
            label="Users"
            value={String(userCount ?? 0)}
            href="/admin/users"
          />
          <CounterCard
            label="Orders (all-time)"
            value={String(orderCount ?? 0)}
            href="/admin/orders"
          />
          <CounterCard
            label="Confirmed crypto top-ups"
            value={String(confirmedTopupCount ?? 0)}
            href="/admin/payments"
          />
          <CounterCard
            label="Provider listings"
            value={String(providerServiceCount ?? 0)}
            href="/admin/providers"
          />
          <CounterCard
            label="Abuse events (7d)"
            value={String(abuseCount ?? 0)}
          />
        </div>
      </div>
    </div>
  );
}

function FinancialsSection({
  period,
}: {
  period: { day: PeriodTotals; week: PeriodTotals; month: PeriodTotals };
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="h3" style={{ margin: 0 }}>
          Financials
        </h2>
        <Link
          href="/admin/orders"
          className="btn btn-secondary btn-sm"
          style={{ textDecoration: "none" }}
        >
          View all orders →
        </Link>
      </div>

      <div className="how-grid">
        <FinancialCard label="Net revenue (30d)" period={period.month} field="revenue" />
        <FinancialCard label="COGS (30d)" period={period.month} field="cogs" />
        <FinancialCard
          label="Gross margin (30d)"
          period={period.month}
          field="margin"
          showMarginPct
        />
        <FinancialCard label="Top-ups credited (30d)" period={period.month} field="topups" />
      </div>

      <div className="card-flat" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Window</th>
                <th className="num">Net revenue</th>
                <th className="num">COGS</th>
                <th className="num">Margin</th>
                <th className="num">Margin %</th>
                <th className="num">Top-ups</th>
                <th className="num">Orders</th>
              </tr>
            </thead>
            <tbody>
              <PeriodRow label="Last 24h" totals={period.day} />
              <PeriodRow label="Last 7 days" totals={period.week} />
              <PeriodRow label="Last 30 days" totals={period.month} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FinancialCard({
  label,
  period,
  field,
  showMarginPct,
}: {
  label: string;
  period: PeriodTotals;
  field: "revenue" | "cogs" | "margin" | "topups";
  showMarginPct?: boolean;
}) {
  const value = period[field];
  return (
    <div className="card flex flex-col gap-2">
      <div className="eyebrow">{label}</div>
      <div className="h2 mono">{formatUsdCents(value)}</div>
      {showMarginPct ? (
        <div className="caption mono">
          {period.margin_pct.toFixed(1)}% on {period.orderCount} orders
        </div>
      ) : null}
    </div>
  );
}

function PeriodRow({
  label,
  totals,
}: {
  label: string;
  totals: PeriodTotals;
}) {
  return (
    <tr>
      <td style={{ fontWeight: 500 }}>{label}</td>
      <td className="num">{formatUsdCents(totals.revenue)}</td>
      <td className="num">{formatUsdCents(totals.cogs)}</td>
      <td className="num">{formatUsdCents(totals.margin)}</td>
      <td className="num">{totals.margin_pct.toFixed(1)}%</td>
      <td className="num">{formatUsdCents(totals.topups)}</td>
      <td className="num">{totals.orderCount}</td>
    </tr>
  );
}

function CounterCard({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const card = (
    <div className="card flex flex-col gap-2">
      <div className="eyebrow">{label}</div>
      <div className="h2 mono">{value}</div>
    </div>
  );
  return href ? (
    <Link href={href} style={{ textDecoration: "none" }}>
      {card}
    </Link>
  ) : (
    <div>{card}</div>
  );
}

function buildPeriodTotals(
  orders:
    | Array<{
        created_at: string;
        status: string;
        wholesale_paid_cents: number;
        retail_charged_cents: number;
      }>
    | null,
  cryptos:
    | Array<{ created_at: string; status: string; amount_usd_cents: number }>
    | null,
  ngns:
    | Array<{
        created_at: string;
        status: string;
        amount_usd_cents_credited: number;
      }>
    | null,
  windowDays: number,
): PeriodTotals {
  const cutoff = Date.now() - windowDays * DAY_MS;

  let revenue = 0;
  let cogs = 0;
  let topups = 0;
  let orderCount = 0;

  for (const o of orders ?? []) {
    if (new Date(o.created_at).getTime() < cutoff) continue;
    if (!REVENUE_STATUSES.has(o.status)) continue;
    revenue += o.retail_charged_cents;
    cogs += o.wholesale_paid_cents;
    orderCount++;
  }

  for (const c of cryptos ?? []) {
    if (new Date(c.created_at).getTime() < cutoff) continue;
    if (c.status !== "confirmed") continue;
    topups += c.amount_usd_cents;
  }

  for (const n of ngns ?? []) {
    if (new Date(n.created_at).getTime() < cutoff) continue;
    if (n.status !== "success") continue;
    topups += n.amount_usd_cents_credited;
  }

  const margin = revenue - cogs;
  const margin_pct = cogs > 0 ? (margin / cogs) * 100 : 0;

  return { revenue, cogs, margin, margin_pct, topups, orderCount };
}
