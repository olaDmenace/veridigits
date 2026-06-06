import { getAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/providers";
import { formatUsdCents } from "@/lib/utils/money";
import { SyncButton } from "./sync-button";

/** Below this upstream balance (USD) we flag the provider — it's running dry. */
const LOW_BALANCE_USD = 5;

export const metadata = { title: "Providers · Admin" };
// Always render live — the catalog sync runs async after the Sync button's
// revalidate, so a cached snapshot would miss freshly-synced provider rows.
export const dynamic = "force-dynamic";

interface ProviderRow {
  slug: string;
  enabledRows: number;
  totalRows: number;
  lastSyncedAt: string | null;
  cheapestCents: number | null;
  received7d: number;
  total7d: number;
}

interface RoutingProvider {
  slug: string;
  rank: number;
  available: number;
  enabled: boolean;
  priceCents: number | null;
}
interface RoutingGroup {
  serviceSlug: string;
  countryIso: string;
  providers: RoutingProvider[];
}

/**
 * Builds the "which provider is primary, and is there a fallback" view for
 * every (service, country) that has a configured preference. Internal admin
 * only — real upstream names are fine here (never shown to end users).
 */
async function loadRouting(
  admin: ReturnType<typeof getAdminClient>,
): Promise<RoutingGroup[]> {
  const key = (s: string | null, c: string | null) => `${s}|${c}`;

  const { data: prefPairs } = await admin
    .from("provider_services")
    .select("service_id, country_id")
    .gt("preference_rank", 0);

  const preferred = new Set((prefPairs ?? []).map((p) => key(p.service_id, p.country_id)));
  if (preferred.size === 0) return [];

  const serviceIds = [
    ...new Set((prefPairs ?? []).map((p) => p.service_id).filter(Boolean)),
  ] as string[];
  const countryIds = [
    ...new Set((prefPairs ?? []).map((p) => p.country_id).filter(Boolean)),
  ] as string[];

  const { data: rrows } = await admin
    .from("provider_services")
    .select(
      "provider_slug, preference_rank, available_count, is_enabled, wholesale_price_cents, service_id, country_id, services(slug), countries(iso_code)",
    )
    .in("service_id", serviceIds)
    .in("country_id", countryIds);

  const groups = new Map<string, RoutingGroup>();
  for (const r of rrows ?? []) {
    const k = key(r.service_id, r.country_id);
    if (!preferred.has(k)) continue; // only true preferred pairs (avoid cross-product)
    let g = groups.get(k);
    if (!g) {
      g = {
        serviceSlug: (r.services as { slug: string } | null)?.slug ?? "?",
        countryIso: (r.countries as { iso_code: string } | null)?.iso_code ?? "?",
        providers: [],
      };
      groups.set(k, g);
    }
    g.providers.push({
      slug: r.provider_slug,
      rank: r.preference_rank,
      available: r.available_count ?? 0,
      enabled: r.is_enabled,
      priceCents: r.wholesale_price_cents,
    });
  }

  for (const g of groups.values()) {
    // Collapse to one lane PER PROVIDER. A provider has many operator rows for
    // the same (service, country) — without this, 5SIM appears N times (a
    // duplicate React key, and misleading chips). Keep the strongest signal per
    // provider: best rank, pooled stock, enabled if any operator is, cheapest.
    const byProvider = new Map<string, RoutingGroup["providers"][number]>();
    for (const p of g.providers) {
      const ex = byProvider.get(p.slug);
      if (!ex) {
        byProvider.set(p.slug, { ...p });
        continue;
      }
      ex.rank = Math.max(ex.rank, p.rank);
      ex.available += p.available;
      ex.enabled = ex.enabled || p.enabled;
      ex.priceCents =
        ex.priceCents == null
          ? p.priceCents
          : p.priceCents == null
            ? ex.priceCents
            : Math.min(ex.priceCents, p.priceCents);
    }
    g.providers = [...byProvider.values()].sort(
      (a, b) =>
        b.rank - a.rank ||
        (a.priceCents ?? Number.MAX_SAFE_INTEGER) -
          (b.priceCents ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return [...groups.values()].sort((a, b) =>
    a.serviceSlug.localeCompare(b.serviceSlug),
  );
}

export default async function AdminProvidersPage() {
  const admin = getAdminClient();

  // Aggregate in the DB — provider_services has 120k+ rows and the API caps a
  // plain select at 1000, which used to drop providers (SMSPool/TextVerified)
  // whose rows fell outside that window.
  const { data: summaryRows } = await admin
    .from("provider_summary")
    .select(
      "provider_slug, total_rows, enabled_rows, last_synced_at, cheapest_cents, received_7d, total_7d",
    );

  const rows: ProviderRow[] = (summaryRows ?? [])
    .filter((r) => r.provider_slug)
    .map((r) => ({
      slug: r.provider_slug as string,
      enabledRows: r.enabled_rows ?? 0,
      totalRows: r.total_rows ?? 0,
      lastSyncedAt: r.last_synced_at,
      cheapestCents: r.cheapest_cents,
      received7d: r.received_7d ?? 0,
      total7d: r.total_7d ?? 0,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const routing = await loadRouting(admin);

  // Live upstream balances — a depleted account fails every purchase, so this
  // is the early-warning signal. Best-effort + parallel; a provider that
  // doesn't expose a balance (or errors) shows "—".
  const balances = new Map<string, number | null>();
  await Promise.all(
    rows.map(async (r) => {
      try {
        const provider = getProvider(r.slug);
        balances.set(r.slug, provider.getBalance ? await provider.getBalance() : null);
      } catch {
        balances.set(r.slug, null);
      }
    }),
  );

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
                <th>Balance</th>
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
                    <td className="num">
                      {(() => {
                        const bal = balances.get(r.slug);
                        if (bal == null) return "—";
                        const low = bal < LOW_BALANCE_USD;
                        return (
                          <span
                            title={low ? "Low — top up the upstream account" : undefined}
                            style={
                              low
                                ? { color: "var(--color-danger)", fontWeight: 600 }
                                : undefined
                            }
                          >
                            ${bal.toFixed(2)}
                            {low ? " ⚠" : ""}
                          </span>
                        );
                      })()}
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

      {/* Routing preferences — which provider is primary per service, and
          whether a fallback exists. Only services with a configured preference
          appear here. */}
      <div className="flex flex-col gap-4">
        <div>
          <div className="eyebrow">Routing</div>
          <h2 className="h3" style={{ marginTop: 8 }}>
            Provider preferences
          </h2>
          <p className="caption" style={{ marginTop: 8, maxWidth: 560 }}>
            Services with a configured primary. The first chip is the primary
            (highest tier); the rest are automatic fallbacks. A single chip means
            no fallback supply exists yet for that service/country.
          </p>
        </div>

        {routing.length === 0 ? (
          <div className="card" style={{ padding: 24 }}>
            <p className="caption">
              No routing preferences configured yet. Once a sync runs (or seeds
              land), preferred services appear here.
            </p>
          </div>
        ) : (
          <div className="card-flat" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Country</th>
                    <th>Routing (primary → fallback)</th>
                  </tr>
                </thead>
                <tbody>
                  {routing.map((g) => {
                    const noFallback = g.providers.length < 2;
                    return (
                      <tr key={`${g.serviceSlug}-${g.countryIso}`}>
                        <td style={{ fontWeight: 500 }}>{g.serviceSlug}</td>
                        <td className="mono" style={{ textTransform: "uppercase" }}>
                          {g.countryIso}
                        </td>
                        <td>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                              alignItems: "center",
                            }}
                          >
                            {g.providers.map((p, i) => {
                              const dead = !p.enabled || p.available <= 0;
                              return (
                                <span
                                  key={p.slug}
                                  className={`badge ${i === 0 ? "badge-success" : ""}`}
                                  style={
                                    dead
                                      ? { opacity: 0.5, textDecoration: "line-through" }
                                      : undefined
                                  }
                                  title={`rank ${p.rank} · ${p.available} in stock${p.enabled ? "" : " · disabled"}`}
                                >
                                  {i === 0 ? "★ " : ""}
                                  {p.slug}
                                  {p.rank > 0 ? ` ·${p.rank}` : ""}
                                </span>
                              );
                            })}
                            {noFallback ? (
                              <span className="badge badge-warn">no fallback</span>
                            ) : null}
                          </div>
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
    </div>
  );
}
