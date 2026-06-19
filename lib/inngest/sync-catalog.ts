import { inngest } from "./client";
import { getProvider } from "@/lib/providers";
import { getAdminClient } from "@/lib/supabase/admin";
import { preferenceRankFor } from "@/lib/providers/preference";

const ENABLED_PROVIDERS = ["5sim", "smspool", "textverified"] as const;
const UPSERT_BATCH_SIZE = 1000;
// Keep `.in(...)` lists small enough to stay under both the URL length limit
// and PostgREST's 1000-row response cap when resolving ids for a large catalog.
const ID_LOOKUP_CHUNK = 300;

/**
 * Pulls the upstream catalog from each enabled provider and reconciles
 * services / countries / provider_services with what we hold in Supabase.
 *
 * Triggers:
 *   - cron: every 6 hours
 *   - event: app/provider.sync.requested  (manual / admin-initiated)
 *
 * Strategy (intentionally simple for v1):
 *   1. Fetch the full upstream catalog.
 *   2. Upsert services and countries by their upstream slug (slug is used
 *      as `iso_code` for countries and `slug` for services, which is
 *      good-enough until we add a proper country mapping table).
 *   3. Look up the resulting service_id and country_id maps.
 *   4. Build provider_services rows and upsert in batches.
 *   5. Disable provider_services rows we did not see this run.
 *
 * Failure mode: if a provider throws, that provider's results are skipped
 * for this run; other providers still sync. The function retries the whole
 * sync up to 2 times before giving up.
 */
export const syncCatalogFn = inngest.createFunction(
  {
    id: "sync-catalog",
    retries: 2,
    concurrency: { limit: 1 }, // never run two simultaneously
    triggers: [
      { cron: "0 */6 * * *" },
      { event: "app/provider.sync.requested" },
    ],
  },
  async ({ step, event, logger }) => {
    const requestedSlug =
      "data" in event && event.data && typeof event.data === "object"
        ? (event.data as { providerSlug?: string }).providerSlug
        : undefined;

    const providersToSync = requestedSlug
      ? ENABLED_PROVIDERS.filter((s) => s === requestedSlug)
      : [...ENABLED_PROVIDERS];

    if (providersToSync.length === 0) {
      logger.warn("no providers to sync", { requestedSlug });
      return { synced: 0 };
    }

    let totalEntries = 0;
    const failed: Array<{ slug: string; error: string }> = [];

    for (const slug of providersToSync) {
      // reconcileProvider never throws — it returns an `error` field instead, so
      // one provider's failure is isolated and the rest still sync. The error
      // (which carries the upstream HTTP status + response snippet) surfaces in
      // the run output + logs for diagnosis.
      const result = await step.run(`sync-${slug}`, async () => {
        return reconcileProvider(slug);
      });
      totalEntries += result.entriesProcessed;
      if (result.error) {
        failed.push({ slug, error: result.error });
        logger.error(`catalog sync failed for ${slug}`, { error: result.error });
      }
      // Persist the per-provider outcome so failures are diagnosable from the DB.
      await step.run(`record-${slug}`, async () => {
        await getAdminClient()
          .from("provider_sync_runs")
          .insert({
            provider_slug: slug,
            entries_processed: result.entriesProcessed,
            ok: !result.error,
            error: result.error ?? null,
          });
        return { recorded: true };
      });
    }

    return {
      synced: providersToSync.length - failed.length,
      attempted: providersToSync.length,
      totalEntries,
      failed,
    };
  },
);

export async function reconcileProvider(
  providerSlug: string,
): Promise<{ entriesProcessed: number; disabledStale: number; error?: string }> {
  try {
    return await reconcileProviderInner(providerSlug);
  } catch (err) {
    return {
      entriesProcessed: 0,
      disabledStale: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function reconcileProviderInner(
  providerSlug: string,
): Promise<{ entriesProcessed: number; disabledStale: number }> {
  const provider = getProvider(providerSlug);
  const supabase = getAdminClient();

  const entries = await provider.syncCatalog();

  if (entries.length === 0) {
    return { entriesProcessed: 0, disabledStale: 0 };
  }

  // Canonical key helpers — fall back to the upstream code (5SIM behavior).
  const svcSlugOf = (e: (typeof entries)[number]) =>
    e.serviceSlug ?? e.upstreamServiceCode;
  const ctyIsoOf = (e: (typeof entries)[number]) =>
    e.countryIso ?? e.upstreamCountryCode;

  // 1. Unique canonical service slugs + country isos in this catalog.
  const serviceSlugs = new Set<string>();
  const serviceNames = new Map<string, string>();
  const countrySlugs = new Set<string>();
  const countryNames = new Map<string, string>();
  for (const e of entries) {
    const svcSlug = svcSlugOf(e);
    const ctyIso = ctyIsoOf(e);
    serviceSlugs.add(svcSlug);
    if (!serviceNames.has(svcSlug)) {
      serviceNames.set(svcSlug, e.upstreamServiceName);
    }
    countrySlugs.add(ctyIso);
    if (!countryNames.has(ctyIso)) {
      countryNames.set(ctyIso, e.countryName ?? titleCase(ctyIso));
    }
  }

  // 2. Upsert services (canonical slug-based). Batched: SMSPool's full catalog
  // pushes this into the thousands, past a single-statement comfort zone.
  const servicesPayload = [...serviceSlugs].map((slug) => ({
    slug,
    name: serviceNames.get(slug) ?? slug,
  }));
  for (let i = 0; i < servicesPayload.length; i += UPSERT_BATCH_SIZE) {
    const batch = servicesPayload.slice(i, i + UPSERT_BATCH_SIZE);
    const { error: servicesErr } = await supabase
      .from("services")
      .upsert(batch, { onConflict: "slug", ignoreDuplicates: false });
    if (servicesErr) {
      throw new Error(`upsert services failed: ${servicesErr.message}`);
    }
  }

  // 3. Upsert countries (canonical iso_code).
  const countriesPayload = [...countrySlugs].map((slug) => ({
    iso_code: slug,
    name: countryNames.get(slug) ?? titleCase(slug),
  }));
  const { error: countriesErr } = await supabase
    .from("countries")
    .upsert(countriesPayload, {
      onConflict: "iso_code",
      ignoreDuplicates: false,
    });
  if (countriesErr) {
    throw new Error(`upsert countries failed: ${countriesErr.message}`);
  }

  // 4. Fetch id maps for FK lookup. Chunked: a single `.in()` over the full
  // SMSPool catalog would both overflow the URL length and hit PostgREST's
  // 1000-row response cap, silently dropping services past the first 1000.
  const [serviceIdBySlug, countryIdByIso] = await Promise.all([
    fetchIdMap(supabase, "services", "slug", [...serviceSlugs]),
    fetchIdMap(supabase, "countries", "iso_code", [...countrySlugs]),
  ]);

  // 5. Build provider_services rows.
  const now = new Date().toISOString();
  const psRows: Array<{
    provider_slug: string;
    service_id: string;
    country_id: string;
    upstream_service_code: string;
    upstream_country_code: string;
    upstream_operator: string;
    wholesale_price_cents: number;
    available_count: number;
    preference_rank: number;
    published_success_rate: number | null;
    last_synced_at: string;
    is_enabled: boolean;
  }> = [];

  for (const e of entries) {
    const svcSlug = svcSlugOf(e);
    const serviceId = serviceIdBySlug.get(svcSlug);
    const countryId = countryIdByIso.get(ctyIsoOf(e));
    if (!serviceId || !countryId) continue;

    psRows.push({
      provider_slug: providerSlug,
      service_id: serviceId,
      country_id: countryId,
      upstream_service_code: e.upstreamServiceCode,
      upstream_country_code: e.upstreamCountryCode,
      upstream_operator: e.upstreamOperator,
      wholesale_price_cents: e.priceCents,
      available_count: e.availableCount,
      // Config-driven routing preference (TextVerified-primary for US strict
      // services, SMSPool-primary for UK). Applied every sync so the rule stays
      // the source of truth.
      preference_rank: preferenceRankFor(providerSlug, svcSlug, ctyIsoOf(e)),
      // Upstream-published delivery quality (5SIM's per-operator rate); null
      // for providers that don't publish one.
      published_success_rate:
        e.publishedSuccessRate == null ? null : e.publishedSuccessRate,
      last_synced_at: now,
      is_enabled: true,
    });
  }

  // 5b. De-duplicate by the upsert conflict key. Two catalog entries can
  // resolve to the same (provider, service, country, operator) — e.g. two
  // upstream service names that slugify to the same canonical service — and
  // Postgres ON CONFLICT can't update the same row twice in one statement.
  const seenKeys = new Set<string>();
  const dedupedRows = psRows.filter((r) => {
    const k = `${r.provider_slug}|${r.service_id}|${r.country_id}|${r.upstream_operator}`;
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });

  // 6. Batch upsert provider_services.
  for (let i = 0; i < dedupedRows.length; i += UPSERT_BATCH_SIZE) {
    const batch = dedupedRows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error: psErr } = await supabase
      .from("provider_services")
      .upsert(batch, {
        onConflict:
          "provider_slug,service_id,country_id,upstream_operator",
        ignoreDuplicates: false,
      });
    if (psErr) {
      throw new Error(
        `upsert provider_services batch ${i / UPSERT_BATCH_SIZE} failed: ${psErr.message}`,
      );
    }
  }

  // 7. Disable rows for this provider that didn't appear this run.
  // last_synced_at < now means the row was last synced before this run.
  const { count: disabledCount, error: staleErr } = await supabase
    .from("provider_services")
    .update({ is_enabled: false }, { count: "exact" })
    .eq("provider_slug", providerSlug)
    .lt("last_synced_at", now)
    .eq("is_enabled", true);

  if (staleErr) {
    // Disabling stale rows is best-effort — a failure here doesn't poison
    // the rest of the sync.
    return { entriesProcessed: dedupedRows.length, disabledStale: 0 };
  }

  return {
    entriesProcessed: dedupedRows.length,
    disabledStale: disabledCount ?? 0,
  };
}

/**
 * Resolve a column → id map for a set of values, chunked so neither the URL
 * length nor PostgREST's 1000-row cap can silently truncate the result. Used to
 * map canonical service slugs / country isos to their row ids.
 */
async function fetchIdMap(
  supabase: ReturnType<typeof getAdminClient>,
  table: "services" | "countries",
  column: "slug" | "iso_code",
  values: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < values.length; i += ID_LOOKUP_CHUNK) {
    const chunk = values.slice(i, i + ID_LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from(table)
      .select(`id, ${column}`)
      .in(column, chunk);
    if (error) {
      throw new Error(`id lookup on ${table}.${column} failed: ${error.message}`);
    }
    for (const row of (data ?? []) as unknown as Array<Record<string, string>>) {
      map.set(row[column], row.id);
    }
  }
  return map;
}

function titleCase(slug: string): string {
  return slug
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
