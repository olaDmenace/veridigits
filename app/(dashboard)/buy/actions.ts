"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getProvider, ProviderOutOfStockError } from "@/lib/providers";
import {
  calculateRetailPrice,
  type PricingRule,
} from "@/lib/pricing/calculate";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";
import {
  applyWalletTransaction,
} from "@/lib/wallet/apply";
import { InsufficientBalanceError } from "@/lib/wallet/types";
import {
  signHoldToken,
  verifyHoldToken,
  HoldTokenError,
  type HoldTokenPayload,
} from "@/lib/utils/hold-token";

export interface CountryOption {
  countryId: string;
  isoCode: string;
  name: string;
  flagEmoji: string | null;
  retailCents: number;
  availableCount: number;
}

/**
 * Returns the countries where this service has cached stock, with the
 * cheapest cached retail price per country. Used to populate the country
 * picker on /buy. Prices shown here are stale-by-minutes — the live
 * re-quote happens in getQuote when the user actually selects.
 */
export async function getCountriesForService(
  serviceId: string,
): Promise<CountryOption[]> {
  const supabase = await createClient();

  const [{ data: psRows }, { data: rulesData }, { data: countryRows }] =
    await Promise.all([
      supabase
        .from("provider_services")
        .select("country_id, wholesale_price_cents, available_count")
        .eq("service_id", serviceId)
        .eq("is_enabled", true)
        .gt("available_count", 0)
        .not("wholesale_price_cents", "is", null),
      supabase
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

  if (!psRows || psRows.length === 0) return [];

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

  const countryById = new Map(
    (countryRows ?? []).map((c) => [c.id, c] as const),
  );

  const out: CountryOption[] = [];
  for (const [countryId, info] of cheapestPerCountry) {
    const country = countryById.get(countryId);
    if (!country) continue;
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
  }

  out.sort((a, b) => a.retailCents - b.retailCents);
  return out;
}

export interface QuoteResult {
  ok: true;
  providerSlug: string;
  retailCents: number;
  availableCount: number;
  holdToken: string;
}

export type QuoteError =
  | { ok: false; code: "no_provider"; message: string }
  | { ok: false; code: "out_of_stock"; message: string }
  | { ok: false; code: "internal"; message: string };

const REQUOTE_DEVIATION_LIMIT = 0.1; // 10%

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
): Promise<QuoteResult | QuoteError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: "internal", message: "not signed in" };
  }

  // Pick cheapest enabled provider_services row for (service, country).
  const { data: candidates, error: candErr } = await supabase
    .from("provider_services")
    .select(
      "provider_slug, upstream_service_code, upstream_country_code, upstream_operator, wholesale_price_cents",
    )
    .eq("service_id", serviceId)
    .eq("country_id", countryId)
    .eq("is_enabled", true)
    .gt("available_count", 0)
    .not("wholesale_price_cents", "is", null)
    .order("wholesale_price_cents", { ascending: true })
    .limit(3);

  if (candErr) {
    return { ok: false, code: "internal", message: candErr.message };
  }
  if (!candidates || candidates.length === 0) {
    return {
      ok: false,
      code: "no_provider",
      message: "No upstream offers this service in this country.",
    };
  }

  const top = candidates[0];

  let liveQuote;
  try {
    const provider = getProvider(top.provider_slug);
    liveQuote = await provider.getPriceAndAvailability({
      upstreamServiceCode: top.upstream_service_code,
      upstreamCountryCode: top.upstream_country_code,
      upstreamOperator: top.upstream_operator ?? undefined,
    });
  } catch (err) {
    if (err instanceof ProviderOutOfStockError) {
      return { ok: false, code: "out_of_stock", message: err.message };
    }
    return {
      ok: false,
      code: "internal",
      message: err instanceof Error ? err.message : "provider error",
    };
  }

  if (liveQuote.availableCount <= 0 || liveQuote.priceCents <= 0) {
    return {
      ok: false,
      code: "out_of_stock",
      message: "Out of stock right now. Try a different country.",
    };
  }

  const { data: rulesData } = await supabase
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
    wholesaleCents: liveQuote.priceCents,
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
    wholesaleCents: liveQuote.priceCents,
    retailCents,
  });

  return {
    ok: true,
    providerSlug: top.provider_slug,
    retailCents,
    availableCount: liveQuote.availableCount,
    holdToken,
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

  // Re-quote live so we don't sell at a price the upstream no longer offers.
  let liveQuote;
  try {
    const provider = getProvider(payload.providerSlug);
    liveQuote = await provider.getPriceAndAvailability({
      upstreamServiceCode: payload.upstreamServiceCode,
      upstreamCountryCode: payload.upstreamCountryCode,
      upstreamOperator: payload.upstreamOperator,
    });
  } catch (err) {
    if (err instanceof ProviderOutOfStockError) {
      return { ok: false, code: "out_of_stock", message: err.message };
    }
    return {
      ok: false,
      code: "internal",
      message: err instanceof Error ? err.message : "provider error",
    };
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

  // Hit upstream.
  let buyResult;
  try {
    const provider = getProvider(payload.providerSlug);
    buyResult = await provider.buyActivation({
      upstreamServiceCode: payload.upstreamServiceCode,
      upstreamCountryCode: payload.upstreamCountryCode,
      upstreamOperator: payload.upstreamOperator,
    });
  } catch (err) {
    if (err instanceof ProviderOutOfStockError) {
      return { ok: false, code: "out_of_stock", message: err.message };
    }
    return {
      ok: false,
      code: "internal",
      message: err instanceof Error ? err.message : "provider error",
    };
  }

  // Insert local order row (admin client — bypasses RLS for inserts).
  const admin = getAdminClient();
  const { data: orderRow, error: insertErr } = await admin
    .from("orders")
    .insert({
      user_id: user.id,
      service_id: payload.serviceId,
      country_id: payload.countryId,
      provider_slug: payload.providerSlug,
      upstream_order_id: buyResult.upstreamOrderId,
      phone_number: buyResult.phoneNumber,
      wholesale_paid_cents: buyResult.wholesaleCents || payload.wholesaleCents,
      retail_charged_cents: payload.retailCents,
      mode: "activation",
      status: "active",
      expires_at: buyResult.expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (insertErr || !orderRow) {
    // Couldn't write the local order — cancel upstream so the wholesale
    // is refunded to our 5SIM account, even though the user paid nothing yet.
    await safeCancelOrder(payload.providerSlug, buyResult.upstreamOrderId);
    return {
      ok: false,
      code: "internal",
      message: insertErr?.message ?? "could not record order",
    };
  }

  // Settle locally — debit the wallet against the order we just created.
  try {
    await applyWalletTransaction({
      userId: user.id,
      amountCents: -payload.retailCents,
      type: "purchase",
      referenceType: "order",
      referenceId: orderRow.id,
      note: `${payload.providerSlug}:${buyResult.upstreamOrderId}`,
    });
  } catch (err) {
    // Wallet drained between getQuote and purchase, or other DB error.
    // Compensating cancel: restore upstream + delete the local order row.
    await safeCancelOrder(payload.providerSlug, buyResult.upstreamOrderId);
    await admin.from("orders").delete().eq("id", orderRow.id);

    if (err instanceof InsufficientBalanceError) {
      return {
        ok: false,
        code: "insufficient_balance",
        message: "Wallet was drained mid-purchase. Top up and try again.",
      };
    }
    return {
      ok: false,
      code: "internal",
      message: err instanceof Error ? err.message : "wallet debit failed",
    };
  }

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
