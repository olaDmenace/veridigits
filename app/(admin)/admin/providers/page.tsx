import { getAdminClient } from "@/lib/supabase/admin";
import { formatUsdCents } from "@/lib/utils/money";
import { SyncButton } from "./sync-button";

export const metadata = { title: "Providers · Admin" };

interface ProviderRow {
  slug: string;
  enabledRows: number;
  totalRows: number;
  lastSyncedAt: string | null;
  cheapestCents: number | null;
  received7d: number;
  total7d: number;
}

export default async function AdminProvidersPage() {
  const admin = getAdminClient();

  const { data: psRows } = await admin
    .from("provider_services")
    .select(
      "provider_slug, is_enabled, last_synced_at, wholesale_price_cents, recent_received_count, recent_total_count",
    );

  const grouped = new Map<string, ProviderRow>();
  for (const r of psRows ?? []) {
    const slug = r.provider_slug;
    let row = grouped.get(slug);
    if (!row) {
      row = {
        slug,
        enabledRows: 0,
        totalRows: 0,
        lastSyncedAt: null,
        cheapestCents: null,
        received7d: 0,
        total7d: 0,
      };
      grouped.set(slug, row);
    }
    row.totalRows++;
    if (r.is_enabled) row.enabledRows++;
    row.received7d += r.recent_received_count;
    row.total7d += r.recent_total_count;
    if (
      r.last_synced_at &&
      (!row.lastSyncedAt || r.last_synced_at > row.lastSyncedAt)
    ) {
      row.lastSyncedAt = r.last_synced_at;
    }
    if (
      typeof r.wholesale_price_cents === "number" &&
      (row.cheapestCents == null || r.wholesale_price_cents < row.cheapestCents)
    ) {
      row.cheapestCents = r.wholesale_price_cents;
    }
  }

  const rows = [...grouped.values()].sort((a, b) => a.slug.localeCompare(b.slug));

  return (
    <div className="flex flex-col gap-8">
      <div className="section-head">
        <div className="left">
          <div className="eyebrow">Admin</div>
          <h1 className="h2" style={{ marginTop: 8 }}>
            Providers
          </h1>
          <p className="body" style={{ marginTop: 14 }}>
            Catalog freshness per upstream. Trigger a sync if the data is stale.
          </p>
        </div>
        <SyncButton />
      </div>

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 text-center" style={{ padding: 48 }}>
          <div className="eyebrow">No catalog yet</div>
          <p className="caption" style={{ maxWidth: 400 }}>
            No <span className="mono">provider_services</span> rows exist.
            Trigger the first sync above.
          </p>
        </div>
      ) : (
        <div className="card-flat" style={{ padding: 0 }}>
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Enabled / total</th>
                <th>Cheapest</th>
                <th>7d success</th>
                <th>Last synced</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rate =
                  r.total7d > 0
                    ? `${((r.received7d / r.total7d) * 100).toFixed(0)}% (${r.received7d}/${r.total7d})`
                    : "—";
                return (
                  <tr key={r.slug}>
                    <td style={{ fontWeight: 500 }}>{r.slug}</td>
                    <td className="num">
                      {r.enabledRows} / {r.totalRows}
                    </td>
                    <td className="num">
                      {r.cheapestCents != null
                        ? formatUsdCents(r.cheapestCents)
                        : "—"}
                    </td>
                    <td className="num">{rate}</td>
                    <td>
                      {r.lastSyncedAt
                        ? new Date(r.lastSyncedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      <SyncButton providerSlug={r.slug} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
