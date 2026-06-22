"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getProvider } from "@/lib/providers";
import {
  ProviderApiError,
  ProviderOutOfStockError,
} from "@/lib/providers/types";
import { pickBestCandidate, type ScorableCandidate } from "@/lib/providers/scoring";
import { isProviderRoutable } from "@/lib/providers/preference";
import { sanitizeProviderError } from "@/lib/providers/sanitize-error";
import { SmsPoolProvider, smspoolRentalFor } from "@/lib/providers/smspool";
import {
  calculateRetailPrice,
  type PricingRule,
} from "@/lib/pricing/calculate";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";
import {
  signHoldToken,
  verifyHoldToken,
  HoldTokenError,
  type HoldTokenPayload,
} from "@/lib/utils/hold-token";
import type { OrderMode } from "./constants";
// Don't re-export OrderMode from here. `"use server"` files in Next 16 +
// Turbopack only allow async-function exports — even `export type` gets
// emitted as a runtime reference and crashes at module evaluation with
// "OrderMode is not defined". Import the type directly from ./constants.

// Defer-debit guardrail: cap simultaneously-held unpaid numbers per user.
// 0 disables the cap. Tune to taste; small is safer.
const MAX_CONCURRENT_ACTIVE = 3;

export interface CountryOption {
  countryId: string;
  isoCode: string;
  name: string;
  flagEmoji: string | null;
  retailCents: number;
  availableCount: number;
}

export type CountriesResult =
  | { ok: true; countries: CountryOption[] }
  | { ok: false; error: string; where: string };

export interface ServicePriceOption {
  serviceId: string;
  slug: string;
  name: string;
  retailCents: number;
  availableCount: number;
}

export type ServicesResult =
  | { ok: true; services: ServicePriceOption[] }
  | { ok: false; error: string; where: string };

/**
 * Returns the countries where this service has cached stock, with the
 * cheapest cached retail price per country. Used to populate the country
 * picker on /buy. Prices shown here are stale-by-minutes — the live
 * re-quote happens in getQuote when the user actually selects.
 *
 * Returns a discriminated union so errors surface in the client UI with
 * a useful `where` label rather than turning into a generic 500.
 */
export async function getCountriesForService(
  serviceId: string,
): Promise<CountriesResult> {
  try {
    const supabase = await createClient();
    // pricing_rules is admin-only at the RLS level, but it's global config
    // not user data. The server-side pricing computation needs the rules
    // to resolve a retail price; the rules themselves never go to the
    // client. Read via the service-role admin client.
    let admin;
    try {
      admin = getAdminClient();
    } catch (err) {
      return {
        ok: false,
        where: "admin-client",
        error: err instanceof Error ? err.message : "admin client init failed",
      };
    }

    const [psResult, rulesResult, countriesResult] = await Promise.all([
      supabase
        .from("provider_services")
        .select("country_id, wholesale_price_cents, available_count")
        .eq("service_id", serviceId)
        .eq("is_enabled", true)
        .gt("available_count", 0)
        .not("wholesale_price_cents", "is", null),
      admin
        .from("pricing_rules")
        .select(
          "id, service_id, country_id, markup_percent, flat_fee_cents, min_retail_cents, priority, is_active",
        )
        .eq("is_active", true),
      supabase
        .from("countries")
        .select("id, iso_code, name, flag_emoji")
        .eq("is_enabled", true),
    ]);

    if (psResult.error) {
      return {
        ok: false,
        where: "provider_services",
        error: psResult.error.message,
      };
    }
    if (rulesResult.error) {
      return {
        ok: false,
        where: "pricing_rules",
        error: rulesResult.error.message,
      };
    }
    if (countriesResult.error) {
      return {
        ok: false,
        where: "countries",
        error: countriesResult.error.message,
      };
    }

    const psRows = psResult.data;
    const rulesData = rulesResult.data;
    const countryRows = countriesResult.data;

    if (!psRows || psRows.length === 0) return { ok: true, countries: [] };

    // Reduce to cheapest per country.
    const cheapestPerCountry = new Map<
      string,
      { wholesaleCents: number; availableCount: number }
    >();
    for (const r of psRows) {
      if (r.wholesale_price_cents == null || !r.country_id) continue;
      const existing = cheapestPerCountry.get(r.country_id);
      if (!existing || r.wholesale_price_cents < existing.wholesaleCents) {
        cheapestPerCountry.set(r.country_id, {
          wholesaleCents: r.wholesale_price_cents,
          availableCount: r.available_count ?? 0,
        });
      }
    }

    const rules: PricingRule[] = (rulesData ?? []).map((r) => ({
      ...r,
      markup_percent: Number(r.markup_percent),
    }));

    if (rules.length === 0) {
      return {
        ok: false,
        where: "pricing_rules",
        error:
          "No active pricing rules found. The global default rule (service_id NULL, country_id NULL) must exist.",
      };
    }

    const countryById = new Map(
      (countryRows ?? []).map((c) => [c.id, c] as const),
    );

    const out: CountryOption[] = [];
    for (const [countryId, info] of cheapestPerCountry) {
      const country = countryById.get(countryId);
      if (!country) continue;
      try {
        const { retailCents } = calculateRetailPrice({
          serviceId,
          countryId,
          wholesaleCents: info.wholesaleCents,
          rules,
        });
        out.push({
          countryId,
          isoCode: country.iso_code,
          name: country.name,
          flagEmoji: country.flag_emoji,
          retailCents,
          availableCount: info.availableCount,
        });
      } catch (err) {
        // Skip individual countries that the pricing engine rejects, don't
        // poison the whole list.
        console.error(
          `pricing failed for service=${serviceId} country=${countryId}:`,
          err,
        );
      }
    }

    out.sort((a, b) => a.retailCents - b.retailCents);
    return { ok: true, countries: out };
  } catch (err) {
    // Surface to Vercel logs so we don't have to guess at digests later.
    console.error("getCountriesForService failed:", {
      serviceId,
      err,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return {
      ok: false,
      where: "unexpected",
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

/**
 * Returns the services that have in-stock listings for this country, each
 * with the cheapest cached retail price. The user picks a country first
 * on /buy, then this populates the service list. Prices are cached and
 * re-quoted live during getQuote when the user actually selects a row.
 */
export async function getServicesForCountry(
  countryId: string,
): Promise<ServicesResult> {
  try {
    const supabase = await createClient();
    let admin;
    try {
      admin = getAdminClient();
    } catch (err) {
      return {
        ok: false,
        where: "admin-client",
        error: err instanceof Error ? err.message : "admin client init failed",
      };
    }

    const rulesResult = await admin
      .from("pricing_rules")
      .select(
        "id, service_id, country_id, markup_percent, flat_fee_cents, min_retail_cents, priority, is_active",
      )
      .eq("is_active", true);
    if (rulesResult.error) {
      return { ok: false, where: "pricing_rules", error: rulesResult.error.message };
    }

    // provider_services for this country — paginated. SMSPool's full catalog can
    // put well over 1000 rows on a single busy country (the US alone is ~1,200
    // services); the default PostgREST cap would silently truncate the list.
    type PsRow = {
      service_id: string | null;
      provider_slug: string;
      upstream_service_code: string;
      upstream_country_code: string;
      upstream_operator: string | null;
      wholesale_price_cents: number | null;
      available_count: number | null;
      recent_received_count: number | null;
      recent_total_count: number | null;
      published_success_rate: number | null;
      preference_rank: number | null;
    };
    const PROVIDER_SERVICES_PAGE = 1000;
    const psRows: PsRow[] = [];
    for (let from = 0; ; from += PROVIDER_SERVICES_PAGE) {
      const { data, error } = await supabase
        .from("provider_services")
        .select(
          "service_id, provider_slug, upstream_service_code, upstream_country_code, upstream_operator, wholesale_price_cents, available_count, recent_received_count, recent_total_count, published_success_rate, preference_rank",
        )
        .eq("country_id", countryId)
        .eq("is_enabled", true)
        .gt("available_count", 0)
        .not("wholesale_price_cents", "is", null)
        .range(from, from + PROVIDER_SERVICES_PAGE - 1);
      if (error) {
        return { ok: false, where: "provider_services", error: error.message };
      }
      psRows.push(...((data ?? []) as unknown as PsRow[]));
      if (!data || data.length < PROVIDER_SERVICES_PAGE) break;
    }
    if (psRows.length === 0) return { ok: true, services: [] };

    // Group routable candidates per service, then price the SAME operator the
    // quote will route to (pickBestCandidate) — not the absolute cheapest — so
    // the list "from" price matches the live quote. A service whose only
    // options get refused (e.g. 0%-delivery duds like POF) drops off the list,
    // exactly as getQuote would refuse it.
    type ListCandidate = ScorableCandidate & { available_count: number };
    const candidatesByService = new Map<string, ListCandidate[]>();
    for (const r of psRows) {
      if (!r.service_id || r.wholesale_price_cents == null) continue;
      if (!isProviderRoutable(r.provider_slug)) continue;
      const arr = candidatesByService.get(r.service_id) ?? [];
      arr.push({
        provider_slug: r.provider_slug,
        upstream_service_code: r.upstream_service_code,
        upstream_country_code: r.upstream_country_code,
        upstream_operator: r.upstream_operator,
        wholesale_price_cents: r.wholesale_price_cents,
        recent_received_count: r.recent_received_count ?? 0,
        recent_total_count: r.recent_total_count ?? 0,
        published_success_rate: r.published_success_rate,
        preference_rank: r.preference_rank,
        available_count: r.available_count ?? 0,
      });
      candidatesByService.set(r.service_id, arr);
    }

    const rules: PricingRule[] = (rulesResult.data ?? []).map((r) => ({
      ...r,
      markup_percent: Number(r.markup_percent),
    }));
    if (rules.length === 0) {
      return {
        ok: false,
        where: "pricing_rules",
        error:
          "No active pricing rules found. The global default rule must exist.",
      };
    }

    // Fetch only the services we actually have candidates for, chunked so the
    // `.in()` list stays under the URL length + 1000-row cap.
    const serviceById = new Map<string, { id: string; slug: string; name: string }>();
    const serviceIds = [...candidatesByService.keys()];
    const SERVICE_LOOKUP_CHUNK = 300;
    for (let i = 0; i < serviceIds.length; i += SERVICE_LOOKUP_CHUNK) {
      const chunk = serviceIds.slice(i, i + SERVICE_LOOKUP_CHUNK);
      const { data, error } = await supabase
        .from("services")
        .select("id, slug, name")
        .eq("is_enabled", true)
        .in("id", chunk);
      if (error) {
        return { ok: false, where: "services", error: error.message };
      }
      for (const s of data ?? []) serviceById.set(s.id, s);
    }

    const out: ServicePriceOption[] = [];
    for (const [serviceId, candidates] of candidatesByService) {
      const service = serviceById.get(serviceId);
      if (!service) continue;
      // Same selection as getQuote. Null = every option refused (e.g. all
      // known-bad) — hide the service rather than show a price we won't honor.
      const best = pickBestCandidate(candidates);
      if (!best || best.wholesale_price_cents == null) continue;
      try {
        const { retailCents } = calculateRetailPrice({
          serviceId,
          countryId,
          wholesaleCents: best.wholesale_price_cents,
          rules,
        });
        out.push({
          serviceId,
          slug: service.slug,
          name: service.name,
          retailCents,
          availableCount: best.available_count,
        });
      } catch (err) {
        console.error(
          `pricing failed for service=${serviceId} country=${countryId}:`,
          err,
        );
      }
    }

    out.sort((a, b) => a.retailCents - b.retailCents);
    return { ok: true, services: out };
  } catch (err) {
    console.error("getServicesForCountry failed:", {
      countryId,
      err,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return {
      ok: false,
      where: "unexpected",
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

export interface QuoteResult {
  ok: true;
  providerSlug: string;
  retailCents: number;
  availableCount: number;
  holdToken: string;
  mode: OrderMode;
  /** Only set on rental; signals price is an estimate. */
  estimated?: boolean;
}

export type QuoteError =
  | { ok: false; code: "no_provider"; message: string }
  | { ok: false; code: "out_of_stock"; message: string }
  | { ok: false; code: "internal"; message: string };

const REQUOTE_DEVIATION_LIMIT = 0.1; // activation: 10% tolerance
const RENTAL_DEVIATION_LIMIT = 0.2; // rental: 20% (upfront price is an estimate)

/**
 * Resolves a price for (service, country) by:
 *   1. Looking up the cheapest enabled provider_services row.
 *   2. Calling that provider for a live wholesale re-quote (caches in
 *      provider_services go stale within minutes — never trust them at
 *      decision time).
 *   3. Running the wholesale through the pricing engine.
 *   4. Signing a 30s hold token so the user can confirm.
 */
export async function getQuote(
  serviceId: string,
  countryId: string,
  mode: OrderMode = "activation",
  durationHours?: number,
): Promise<QuoteResult | QuoteError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: "internal", message: "not signed in" };
  }

  // Rentals are a separate SMSPool product (own catalog, fixed day-tiers) and
  // only exist for a few countries — they don't come from the activation
  // provider_services candidates, so branch out before that lookup.
  if (mode === "rental") {
    return getRentalQuote(user.id, serviceId, countryId, durationHours);
  }

  // Pull all enabled, in-stock provider_services rows for this (service, country).
  // We pick from these using pickBestCandidate, which prefers reliable operators
  // (good 7-day success rate, enough sample) over the absolute cheapest when both
  // are available.
  const { data: candidates, error: candErr } = await supabase
    .from("provider_services")
    .select(
      "provider_slug, upstream_service_code, upstream_country_code, upstream_operator, wholesale_price_cents, recent_received_count, recent_total_count, published_success_rate, preference_rank",
    )
    .eq("service_id", serviceId)
    .eq("country_id", countryId)
    .eq("is_enabled", true)
    .gt("available_count", 0)
    .not("wholesale_price_cents", "is", null)
    // Keep the strongest candidates within the limit: preferred providers
    // first, then highest published delivery rate, then cheapest. pickBestCandidate
    // makes the final call across them.
    .order("preference_rank", { ascending: false })
    .order("published_success_rate", { ascending: false, nullsFirst: false })
    .order("wholesale_price_cents", { ascending: true })
    .limit(12);

  if (candErr) {
    return { ok: false, code: "internal", message: candErr.message };
  }

  // Drop providers that can't currently fulfill (e.g. unfunded balance). The
  // purchase flow has no provider fallback, so routing to one of these would
  // just hard-fail — better to fall through to the next provider here.
  const routable = (candidates ?? []).filter((c) =>
    isProviderRoutable(c.provider_slug),
  );

  if (routable.length === 0) {
    return {
      ok: false,
      code: "no_provider",
      message: "No upstream offers this service in this country.",
    };
  }

  const top = pickBestCandidate(routable);
  if (!top) {
    return {
      ok: false,
      code: "no_provider",
      message: "No upstream offers this service in this country.",
    };
  }

  let liveQuote;
  try {
    const provider = getProvider(top.provider_slug);
    liveQuote = await provider.getPriceAndAvailability({
      upstreamServiceCode: top.upstream_service_code,
      upstreamCountryCode: top.upstream_country_code,
      upstreamOperator: top.upstream_operator ?? undefined,
    });
  } catch (err) {
    return { ok: false, ...sanitizeProviderError(err, "getQuote") };
  }

  if (liveQuote.availableCount <= 0 || liveQuote.priceCents <= 0) {
    return {
      ok: false,
      code: "out_of_stock",
      message: "Out of stock right now. Try a different country.",
    };
  }

  // Same RLS workaround as getCountriesForService — pricing_rules is
  // admin-only at the DB level; server-side computation reads via the
  // admin client.
  const { data: rulesData } = await getAdminClient()
    .from("pricing_rules")
    .select(
      "id, service_id, country_id, markup_percent, flat_fee_cents, min_retail_cents, priority, is_active",
    )
    .eq("is_active", true);

  const rules: PricingRule[] = (rulesData ?? []).map((r) => ({
    ...r,
    markup_percent: Number(r.markup_percent),
  }));

  // Past the rental branch above, mode is always activation here.
  const wholesaleForQuote = liveQuote.priceCents;

  const { retailCents } = calculateRetailPrice({
    serviceId,
    countryId,
    wholesaleCents: wholesaleForQuote,
    rules,
  });

  const holdToken = signHoldToken({
    userId: user.id,
    serviceId,
    countryId,
    providerSlug: top.provider_slug,
    upstreamServiceCode: top.upstream_service_code,
    upstreamCountryCode: top.upstream_country_code,
    upstreamOperator: top.upstream_operator ?? "any",
    wholesaleCents: wholesaleForQuote,
    retailCents,
    mode: "activation",
    durationHours: undefined,
  });

  return {
    ok: true,
    providerSlug: top.provider_slug,
    retailCents,
    availableCount: liveQuote.availableCount,
    holdToken,
    mode: "activation",
    estimated: false,
  };
}

/**
 * Rental quote. SMSPool rentals are keyed by a country rentalID + a fixed
 * day-tier (not activation candidates), so we map the canonical country iso ->
 * SMSPool rental, fetch the LIVE wholesale price for the chosen tier, run it
 * through the same pricing engine, and sign a rental hold token routed to
 * SMSPool. Available only for the few countries SMSPool offers rentals in.
 */
async function getRentalQuote(
  userId: string,
  serviceId: string,
  countryId: string,
  durationHours?: number,
): Promise<QuoteResult | QuoteError> {
  if (!durationHours) {
    return { ok: false, code: "internal", message: "missing rental duration" };
  }
  const supabase = await createClient();
  const { data: country } = await supabase
    .from("countries")
    .select("iso_code")
    .eq("id", countryId)
    .single();
  if (!country) {
    return { ok: false, code: "no_provider", message: "Unknown country." };
  }
  const rental = smspoolRentalFor(country.iso_code);
  if (!rental) {
    return {
      ok: false,
      code: "no_provider",
      message: "Rentals aren't available for this country.",
    };
  }
  const days = Math.round(durationHours / 24);
  if (!rental.days.includes(days)) {
    return {
      ok: false,
      code: "no_provider",
      message: "That rental length isn't available for this country.",
    };
  }

  const provider = getProvider("smspool");
  if (!(provider instanceof SmsPoolProvider)) {
    return { ok: false, code: "internal", message: "rental provider unavailable" };
  }

  let wholesaleCents: number;
  try {
    wholesaleCents = await provider.getRentalPriceCents(rental.rentalID, days);
  } catch (err) {
    return { ok: false, ...sanitizeProviderError(err, "getRentalQuote") };
  }
  if (wholesaleCents <= 0) {
    return {
      ok: false,
      code: "out_of_stock",
      message: "Rentals are temporarily unavailable for this country.",
    };
  }

  const { data: rulesData } = await getAdminClient()
    .from("pricing_rules")
    .select(
      "id, service_id, country_id, markup_percent, flat_fee_cents, min_retail_cents, priority, is_active",
    )
    .eq("is_active", true);
  const rules: PricingRule[] = (rulesData ?? []).map((r) => ({
    ...r,
    markup_percent: Number(r.markup_percent),
  }));

  const { retailCents } = calculateRetailPrice({
    serviceId,
    countryId,
    wholesaleCents,
    rules,
  });

  const holdToken = signHoldToken({
    userId,
    serviceId,
    countryId,
    providerSlug: "smspool",
    upstreamServiceCode: "", // MVP rentals buy the unlocked line (no service_id)
    upstreamCountryCode: String(rental.rentalID),
    upstreamOperator: "any",
    wholesaleCents,
    retailCents,
    mode: "rental",
    durationHours,
  });

  return {
    ok: true,
    providerSlug: "smspool",
    retailCents,
    availableCount: 1,
    holdToken,
    mode: "rental",
    estimated: false,
  };
}

export interface PurchaseResult {
  ok: true;
  orderId: string;
}

export type PurchaseError =
  | { ok: false; code: "expired"; message: string }
  | { ok: false; code: "price_moved"; message: string }
  | { ok: false; code: "insufficient_balance"; message: string }
  | { ok: false; code: "out_of_stock"; message: string }
  | { ok: false; code: "internal"; message: string };

/** Max operator/provider attempts in one activation buy (incl. the primary). */
const MAX_PROVIDER_FALLBACK = 4;

interface BuyCandidate {
  provider_slug: string;
  upstream_service_code: string;
  upstream_country_code: string;
  upstream_operator: string | null;
}

/**
 * The routable, in-stock candidates for a (service, country), ordered the way
 * the router prefers them — used as the purchase-time fallback chain so a
 * single operator/provider being out of stock (or whitelist-blocked) doesn't
 * sink the buy when another option can fulfill.
 */
async function rankedActivationCandidates(
  serviceId: string,
  countryId: string,
): Promise<BuyCandidate[]> {
  const { data } = await getAdminClient()
    .from("provider_services")
    .select(
      "provider_slug, upstream_service_code, upstream_country_code, upstream_operator, wholesale_price_cents, recent_received_count, recent_total_count, published_success_rate, preference_rank",
    )
    .eq("service_id", serviceId)
    .eq("country_id", countryId)
    .eq("is_enabled", true)
    .gt("available_count", 0)
    .not("wholesale_price_cents", "is", null);

  let pool = (data ?? []).filter((c) => isProviderRoutable(c.provider_slug));
  const ordered: BuyCandidate[] = [];
  // Greedily peel the best candidate off the pool to build the full ranking.
  while (pool.length > 0 && ordered.length < MAX_PROVIDER_FALLBACK) {
    const best = pickBestCandidate(pool as ScorableCandidate[]);
    if (!best) break;
    ordered.push({
      provider_slug: best.provider_slug,
      upstream_service_code: best.upstream_service_code,
      upstream_country_code: best.upstream_country_code,
      upstream_operator: best.upstream_operator,
    });
    pool = pool.filter(
      (c) =>
        !(
          c.provider_slug === best.provider_slug &&
          (c.upstream_operator ?? null) === (best.upstream_operator ?? null)
        ),
    );
  }
  return ordered;
}

/**
 * Executes a purchase against a signed hold token.
 *
 * Order of operations matters here. We can't span a single DB transaction
 * across the upstream HTTP call (~1-3s), so we use a compensating-cancel
 * pattern: succeed at upstream first, then settle locally; if the local
 * settlement fails, we explicitly cancel upstream to refund.
 */
export async function purchase(
  holdToken: string,
): Promise<PurchaseResult | PurchaseError> {
  let payload: HoldTokenPayload;
  try {
    payload = verifyHoldToken(holdToken);
  } catch (err) {
    if (err instanceof HoldTokenError) {
      return { ok: false, code: "expired", message: err.message };
    }
    throw err;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== payload.userId) {
    return { ok: false, code: "expired", message: "session mismatch" };
  }

  // Pre-check balance — gives a clean error before we hit the upstream API.
  const { data: profile } = await supabase
    .from("profiles")
    .select("wallet_balance_cents, is_banned")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return { ok: false, code: "internal", message: "profile missing" };
  }
  if (profile.is_banned) {
    return { ok: false, code: "internal", message: "account suspended" };
  }
  if (profile.wallet_balance_cents < payload.retailCents) {
    return {
      ok: false,
      code: "insufficient_balance",
      message: "Top up your wallet to cover this purchase.",
    };
  }

  if (MAX_CONCURRENT_ACTIVE > 0) {
    const { count: activeCount } = await getAdminClient()
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["pending", "active"]);
    if ((activeCount ?? 0) >= MAX_CONCURRENT_ACTIVE) {
      return {
        ok: false,
        code: "internal",
        message: `You can hold up to ${MAX_CONCURRENT_ACTIVE} active numbers at once. Wait for one to receive a code or expire.`,
      };
    }
  }

  const mode = payload.mode ?? "activation";
  const provider = getProvider(payload.providerSlug);

  // Activation has a cheap pre-check via /guest/prices. Rental's upfront
  // estimate is intentionally rough, so we skip the pre-check and let the
  // upstream buy call surface the actual price.
  if (mode === "activation") {
    let liveQuote;
    try {
      liveQuote = await provider.getPriceAndAvailability({
        upstreamServiceCode: payload.upstreamServiceCode,
        upstreamCountryCode: payload.upstreamCountryCode,
        upstreamOperator: payload.upstreamOperator,
      });
    } catch (err) {
      return { ok: false, ...sanitizeProviderError(err, "purchase-requote") };
    }

    if (liveQuote.availableCount <= 0) {
      return {
        ok: false,
        code: "out_of_stock",
        message: "Out of stock — try a different country.",
      };
    }

    const deviation =
      Math.abs(liveQuote.priceCents - payload.wholesaleCents) /
      Math.max(payload.wholesaleCents, 1);
    if (deviation > REQUOTE_DEVIATION_LIMIT) {
      return {
        ok: false,
        code: "price_moved",
        message: "Wholesale price changed by more than 10%. Please re-quote.",
      };
    }
  }

  // Hit upstream. Branch on mode. usedProviderSlug tracks who actually
  // fulfilled (may differ from the quoted one when activation falls back).
  let buyResult;
  let usedProviderSlug = payload.providerSlug;
  try {
    if (mode === "rental") {
      buyResult = await provider.rentNumber({
        upstreamServiceCode: payload.upstreamServiceCode,
        upstreamCountryCode: payload.upstreamCountryCode,
        durationHours: payload.durationHours ?? 24,
      });

      // For rental, the upstream price is authoritative. Verify it's within
      // 20% of our estimate; refuse otherwise so we don't surprise the user.
      const deviation =
        Math.abs(buyResult.wholesaleCents - payload.wholesaleCents) /
        Math.max(payload.wholesaleCents, 1);
      if (deviation > RENTAL_DEVIATION_LIMIT) {
        await safeCancelOrder(payload.providerSlug, buyResult.upstreamOrderId);
        return {
          ok: false,
          code: "price_moved",
          message: `Upstream rental price differed from our estimate by >${Math.round(RENTAL_DEVIATION_LIMIT * 100)}%. We cancelled and refunded — try again.`,
        };
      }
    } else {
      // Activation with purchase-time fallback: try the quoted operator first,
      // then the next routable, in-stock candidates (other operators / other
      // providers like SMSPool->5SIM) so a single out-of-stock or whitelist
      // failure doesn't sink the buy when stock exists elsewhere.
      const fallback = await rankedActivationCandidates(
        payload.serviceId,
        payload.countryId,
      );
      const chain = [
        {
          provider_slug: payload.providerSlug,
          upstream_service_code: payload.upstreamServiceCode,
          upstream_country_code: payload.upstreamCountryCode,
          upstream_operator: payload.upstreamOperator as string | null,
        },
        ...fallback.filter(
          (c) =>
            !(
              c.provider_slug === payload.providerSlug &&
              (c.upstream_operator ?? null) ===
                (payload.upstreamOperator ?? null)
            ),
        ),
      ].slice(0, MAX_PROVIDER_FALLBACK);

      let lastErr: unknown = null;
      for (const cand of chain) {
        try {
          buyResult = await getProvider(cand.provider_slug).buyActivation({
            upstreamServiceCode: cand.upstream_service_code,
            upstreamCountryCode: cand.upstream_country_code,
            upstreamOperator: cand.upstream_operator ?? undefined,
          });
          usedProviderSlug = cand.provider_slug;
          break;
        } catch (err) {
          lastErr = err;
          // Out-of-stock / API error (incl. SMSPool whitelist) -> next candidate.
          if (
            err instanceof ProviderOutOfStockError ||
            err instanceof ProviderApiError
          ) {
            continue;
          }
          throw err;
        }
      }
      if (!buyResult) {
        return { ok: false, ...sanitizeProviderError(lastErr, "purchase-buy") };
      }
    }
  } catch (err) {
    return { ok: false, ...sanitizeProviderError(err, "purchase-buy") };
  }

  // Insert local order row (admin client — bypasses RLS for inserts).
  const admin = getAdminClient();
  const { data: orderRow, error: insertErr } = await admin
    .from("orders")
    .insert({
      user_id: user.id,
      service_id: payload.serviceId,
      country_id: payload.countryId,
      provider_slug: usedProviderSlug,
      upstream_order_id: buyResult.upstreamOrderId,
      // The actual operator the upstream assigned (may differ from the quoted
      // one when we fell back to "any"), so stats attribute to what delivered.
      upstream_operator: buyResult.operator ?? payload.upstreamOperator ?? null,
      phone_number: buyResult.phoneNumber,
      wholesale_paid_cents: buyResult.wholesaleCents || payload.wholesaleCents,
      retail_charged_cents: payload.retailCents,
      mode,
      status: "active",
      expires_at: buyResult.expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (insertErr || !orderRow) {
    // Couldn't write the local order — cancel upstream so the wholesale
    // is refunded, even though the user paid nothing yet.
    await safeCancelOrder(usedProviderSlug, buyResult.upstreamOrderId);
    return {
      ok: false,
      code: "internal",
      message: insertErr?.message ?? "could not record order",
    };
  }

  // Defer-debit: we do NOT charge here. The wallet is debited when the first
  // valid SMS lands (see lib/inngest/poll-orders.ts). The balance pre-check
  // above is a friendly gate only; nothing is reserved, so the eventual
  // capture can still fail if the user spends the balance elsewhere first.

  // Kick off the per-order polling loop. Errors here are non-fatal —
  // the user still owns the number, expire-orders will handle the worst case.
  try {
    await inngest.send({
      name: "app/order.poll-started",
      data: { orderId: orderRow.id },
    });
  } catch {
    /* poll dispatch failure: expire-orders is the backstop */
  }

  revalidatePath("/dashboard");
  revalidatePath("/orders");
  return { ok: true, orderId: orderRow.id };
}

async function safeCancelOrder(
  providerSlug: string,
  upstreamOrderId: string,
): Promise<void> {
  try {
    await getProvider(providerSlug).cancelOrder(upstreamOrderId);
  } catch {
    // We already failed the user-facing path; an upstream cancel failure
    // here just means the wholesale stays committed. Surface in logs only;
    // the wallet-reconciliation job (Phase 1 #14) will catch it.
  }
}

/**
 * Convenience used by the buy form: redirects to /orders/[id] when the
 * purchase succeeds, returns an error state otherwise.
 */
export async function purchaseAndRedirect(
  _prev: PurchaseError | undefined,
  formData: FormData,
): Promise<PurchaseError | undefined> {
  const holdToken = String(formData.get("holdToken") ?? "");
  if (!holdToken) {
    return { ok: false, code: "expired", message: "missing token" };
  }
  const result = await purchase(holdToken);
  if (result.ok) {
    redirect(`/orders/${result.orderId}`);
  }
  return result;
}
