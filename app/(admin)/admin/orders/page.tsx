import Link from "next/link";
import { getAdminClient } from "@/lib/supabase/admin";
import { formatUsdCents } from "@/lib/utils/money";
import { OrderFilters } from "./filters";

export const metadata = { title: "Orders · Admin" };
export const dynamic = "force-dynamic";

const PER_PAGE = 50;
const VALID_STATUSES = new Set([
  "active",
  "received",
  "completed",
  "cancelled",
  "refunded",
  "expired",
  "pending",
]);
const REVENUE_STATUSES = new Set(["active", "received", "completed"]);

interface RawSearchParams {
  status?: string;
  mode?: string;
  q?: string;
  page?: string;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const status = VALID_STATUSES.has(sp.status ?? "") ? sp.status! : "all";
  const mode =
    sp.mode === "rental" || sp.mode === "activation" ? sp.mode : "all";
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const admin = getAdminClient();

  let query = admin
    .from("orders")
    .select(
      `id, created_at, user_id, phone_number, provider_slug, upstream_order_id,
       wholesale_paid_cents, retail_charged_cents, mode, status, expires_at,
       services(slug,name),
       countries(iso_code,name,flag_emoji)`,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + PER_PAGE - 1);

  if (status !== "all") query = query.eq("status", status);
  if (mode !== "all") query = query.eq("mode", mode);
  if (q) {
    // Use plain ILIKE per-column so we can mix uuid prefix matches with
    // text matches. PostgREST `.or()` requires the values to be safe — we
    // escape commas and parens defensively even though uuids/digits won't
    // contain them.
    const safe = q.replace(/[(),]/g, "");
    query = query.or(
      [
        `phone_number.ilike.%${safe}%`,
        `upstream_order_id.ilike.%${safe}%`,
        `id.ilike.${safe}%`,
        `user_id.ilike.${safe}%`,
      ].join(","),
    );
  }

  const { data: orderRows, count: totalCount, error } = await query;
  if (error) {
    return (
      <div className="card">
        <div className="eyebrow" style={{ color: "var(--color-danger)" }}>
          Query failed
        </div>
        <pre className="mono caption" style={{ marginTop: 8 }}>
          {error.message}
        </pre>
      </div>
    );
  }

  const userIds = Array.from(
    new Set((orderRows ?? []).map((r) => r.user_id)),
  );
  const emailById = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: authList } = await admin.auth.admin.listUsers({
      perPage: 1000,
    });
    for (const u of authList?.users ?? []) {
      emailById.set(u.id, u.email ?? null);
    }
  }

  type ServiceJoin = { slug: string; name: string } | null;
  type CountryJoin = {
    iso_code: string;
    name: string;
    flag_emoji: string | null;
  } | null;

  const rows = (orderRows ?? []).map((r) => {
    const service = r.services as unknown as ServiceJoin;
    const country = r.countries as unknown as CountryJoin;
    const wholesale = r.wholesale_paid_cents;
    const retail = r.retail_charged_cents;
    const margin = retail - wholesale;
    const effectiveMarkup = wholesale > 0 ? (margin / wholesale) * 100 : 0;
    return {
      id: r.id,
      createdAt: r.created_at,
      userId: r.user_id,
      email: emailById.get(r.user_id) ?? null,
      phone: r.phone_number,
      provider: r.provider_slug,
      upstreamId: r.upstream_order_id,
      service: service?.name ?? service?.slug ?? "—",
      country: country?.name ?? country?.iso_code ?? "—",
      flag: country?.flag_emoji ?? "",
      mode: r.mode,
      status: r.status,
      wholesale,
      retail,
      margin,
      effectiveMarkup,
      countsAsRevenue: REVENUE_STATUSES.has(r.status),
    };
  });

  const total = totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const filterQs = buildFilterQs({ status, mode, q });

  // Aggregate over the FILTERED set (not just current page) so the header
  // numbers reflect what the user actually filtered to. Selecting only the
  // money columns keeps the payload small even at thousands of rows.
  let aggQuery = admin
    .from("orders")
    .select("wholesale_paid_cents, retail_charged_cents, status");
  if (status !== "all") aggQuery = aggQuery.eq("status", status);
  if (mode !== "all") aggQuery = aggQuery.eq("mode", mode);
  if (q) {
    const safe = q.replace(/[(),]/g, "");
    aggQuery = aggQuery.or(
      [
        `phone_number.ilike.%${safe}%`,
        `upstream_order_id.ilike.%${safe}%`,
        `id.ilike.${safe}%`,
        `user_id.ilike.${safe}%`,
      ].join(","),
    );
  }
  const { data: aggRows } = await aggQuery;
  let filteredRevenue = 0;
  let filteredCogs = 0;
  let filteredRefundedRetail = 0;
  for (const r of aggRows ?? []) {
    if (REVENUE_STATUSES.has(r.status)) {
      filteredRevenue += r.retail_charged_cents;
      filteredCogs += r.wholesale_paid_cents;
    } else {
      filteredRefundedRetail += r.retail_charged_cents;
    }
  }
  const filteredMargin = filteredRevenue - filteredCogs;
  const filteredMarkup =
    filteredCogs > 0 ? (filteredMargin / filteredCogs) * 100 : 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Orders
        </h1>
        <p className="body" style={{ marginTop: 14, maxWidth: 640 }}>
          Per-order wholesale, retail, and gross margin. Refunded, cancelled,
          and expired orders are excluded from revenue totals.
        </p>
      </div>

      <div className="how-grid">
        <div className="card flex flex-col gap-2">
          <div className="eyebrow">Net revenue (filtered)</div>
          <div className="h2 mono">{formatUsdCents(filteredRevenue)}</div>
          <div className="caption">From {countLabel(aggRows, REVENUE_STATUSES)} orders</div>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="eyebrow">COGS (filtered)</div>
          <div className="h2 mono">{formatUsdCents(filteredCogs)}</div>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="eyebrow">Gross margin</div>
          <div className="h2 mono">{formatUsdCents(filteredMargin)}</div>
          <div className="caption mono">{filteredMarkup.toFixed(1)}%</div>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="eyebrow">Refunded retail (skipped)</div>
          <div className="h2 mono">
            {formatUsdCents(filteredRefundedRetail)}
          </div>
        </div>
      </div>

      <div className="card-flat flex flex-col gap-4" style={{ padding: 16 }}>
        <OrderFilters />
        <div className="caption mono">
          {total.toLocaleString()} {total === 1 ? "order" : "orders"} match
          {q || status !== "all" || mode !== "all" ? " filter" : ""}
        </div>
      </div>

      {rows.length === 0 ? (
        <div
          className="card flex flex-col items-center gap-3 text-center"
          style={{ padding: 48 }}
        >
          <div className="eyebrow">No orders</div>
          <p className="caption" style={{ maxWidth: 400 }}>
            No orders match the current filter. Clear filters or wait for new
            purchases.
          </p>
        </div>
      ) : (
        <div className="card-flat" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>User</th>
                  <th>Service / country</th>
                  <th>Phone</th>
                  <th>Provider</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th className="num">Wholesale</th>
                  <th className="num">Retail</th>
                  <th className="num">Margin</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="mono caption">
                        {new Date(r.createdAt).toLocaleString()}
                      </div>
                      <div className="caption mono" style={{ marginTop: 4 }}>
                        <Link
                          href={`/orders/${r.id}`}
                          style={{ color: "var(--color-ink-muted)" }}
                        >
                          {r.id.slice(0, 8)}…
                        </Link>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.email ?? "—"}</div>
                      <div className="caption mono" style={{ marginTop: 4 }}>
                        {r.userId.slice(0, 8)}…
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.service}</div>
                      <div className="caption" style={{ marginTop: 4 }}>
                        {r.flag} {r.country}
                      </div>
                    </td>
                    <td className="mono">{r.phone}</td>
                    <td>
                      <span className="mono caption">{r.provider}</span>
                      <div className="caption mono" style={{ marginTop: 4 }}>
                        {r.upstreamId}
                      </div>
                    </td>
                    <td className="caption">{r.mode}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="num">{formatUsdCents(r.wholesale)}</td>
                    <td className="num">{formatUsdCents(r.retail)}</td>
                    <td
                      className="num"
                      style={{
                        color: r.countsAsRevenue
                          ? undefined
                          : "var(--color-ink-muted)",
                      }}
                    >
                      {r.countsAsRevenue ? formatUsdCents(r.margin) : "—"}
                    </td>
                    <td
                      className="num"
                      style={{
                        color: r.countsAsRevenue
                          ? undefined
                          : "var(--color-ink-muted)",
                      }}
                    >
                      {r.countsAsRevenue
                        ? `${r.effectiveMarkup.toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <div className="caption mono">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <PageLink
              page={page - 1}
              disabled={page <= 1}
              filterQs={filterQs}
              label="← Prev"
            />
            <PageLink
              page={page + 1}
              disabled={page >= totalPages}
              filterQs={filterQs}
              label="Next →"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildFilterQs(opts: {
  status: string;
  mode: string;
  q: string;
}): string {
  const p = new URLSearchParams();
  if (opts.status !== "all") p.set("status", opts.status);
  if (opts.mode !== "all") p.set("mode", opts.mode);
  if (opts.q) p.set("q", opts.q);
  return p.toString();
}

function PageLink({
  page,
  disabled,
  filterQs,
  label,
}: {
  page: number;
  disabled: boolean;
  filterQs: string;
  label: string;
}) {
  if (disabled) {
    return (
      <span
        className="btn btn-secondary btn-sm"
        style={{ opacity: 0.4, pointerEvents: "none" }}
      >
        {label}
      </span>
    );
  }
  const qs = new URLSearchParams(filterQs);
  if (page > 1) qs.set("page", String(page));
  const url = qs.toString()
    ? `/admin/orders?${qs.toString()}`
    : "/admin/orders";
  return (
    <Link href={url} className="btn btn-secondary btn-sm">
      {label}
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  // Pick badge variant per status. Active is mid-flow (info), received and
  // completed are positive (success), the three refund-like statuses are
  // negative (danger), pending is neutral.
  const variant =
    status === "active" || status === "received"
      ? "badge-info"
      : status === "completed"
        ? "badge-success"
        : status === "cancelled" ||
            status === "refunded" ||
            status === "expired"
          ? "badge-danger"
          : "badge-warn";
  return <span className={`badge ${variant}`}>{status}</span>;
}

function countLabel(
  rows: Array<{ status: string }> | null,
  inSet: Set<string>,
): number {
  if (!rows) return 0;
  let n = 0;
  for (const r of rows) if (inSet.has(r.status)) n++;
  return n;
}
