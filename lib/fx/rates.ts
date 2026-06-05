/**
 * Local-currency / USD exchange-rate helper (NGN, GHS, …).
 *
 * Public free source: https://open.er-api.com/v6/latest/USD (no API key,
 * updated daily, returns every currency). Cached in-memory per currency for
 * ten minutes so a burst of top-ups doesn't hammer the upstream.
 *
 * Slippage protection: we apply a configurable buffer (per currency, default
 * 300 bps = 3%) when converting local paid → USD credited. The customer pays
 * N local units, we credit slightly less than the spot equivalent, absorbing
 * FX drift between quote-time and the webhook landing. The buffer also covers
 * Korapay's transaction fee.
 *
 * Iron law: never re-fetch the rate at webhook time — credit the amount
 * locked on the fiat_payments row at quote time.
 */

export type FiatCurrency = "NGN" | "GHS";

const SOURCE = "https://open.er-api.com/v6/latest/USD";
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Sane floor per currency if upstream is down and we have no cache yet. */
const FALLBACK_RATE: Record<FiatCurrency, number> = {
  NGN: 1600,
  GHS: 15,
};

/** Slippage + fee buffer (basis points), overridable per currency via env. */
function bufferBps(currency: FiatCurrency): number {
  const raw =
    currency === "NGN"
      ? process.env.NGN_FX_BUFFER_BPS
      : process.env.GHS_FX_BUFFER_BPS;
  const n = Number(raw ?? 300);
  return Number.isFinite(n) && n >= 0 ? n : 300;
}

interface CacheEntry {
  rate: number;
  fetchedAt: number;
}

const cache: Partial<Record<FiatCurrency, CacheEntry>> = {};

interface ExchangeRateResponse {
  result?: string;
  rates?: Record<string, number>;
}

/**
 * Returns the current local-units-per-USD rate for a currency. Falls back to
 * the cached value if the upstream call fails; if there's no cache, returns
 * the currency's FALLBACK_RATE. Number, not string — don't assume integer.
 */
export async function getRatePerUsd(currency: FiatCurrency): Promise<number> {
  const now = Date.now();
  const entry = cache[currency];
  if (entry && now - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.rate;
  }

  try {
    const res = await fetch(SOURCE, { cache: "no-store" });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = (await res.json()) as ExchangeRateResponse;
    const rate = data.rates?.[currency];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`rate missing from response for ${currency}`);
    }
    cache[currency] = { rate, fetchedAt: now };
    return rate;
  } catch {
    // Stale cache is better than no answer.
    if (cache[currency]) return cache[currency]!.rate;
    return FALLBACK_RATE[currency];
  }
}

export interface ConversionQuote {
  currency: FiatCurrency;
  localAmount: number;
  usdCents: number;
  ratePerUsd: number;
  bufferBps: number;
}

/**
 * Converts a local-currency amount into the USD-cents we'll credit, applying
 * the slippage buffer. localAmount must be a positive integer (whole local
 * units — naira / cedis, no decimals).
 */
export async function quoteFiatTopUp(
  currency: FiatCurrency,
  localAmount: number,
): Promise<ConversionQuote> {
  if (!Number.isInteger(localAmount) || localAmount <= 0) {
    throw new Error("localAmount must be a positive integer");
  }
  const rate = await getRatePerUsd(currency);
  const buffer = bufferBps(currency);
  // usd = local / rate; usdCents = round(usd * 100); then haircut by buffer.
  const usdCentsBeforeBuffer = Math.floor((localAmount * 100) / rate);
  const usdCents = Math.floor(
    (usdCentsBeforeBuffer * (10_000 - buffer)) / 10_000,
  );
  return {
    currency,
    localAmount,
    usdCents: Math.max(usdCents, 0),
    ratePerUsd: rate,
    bufferBps: buffer,
  };
}

/** Local amount needed to land at a given USD-cents target. */
export async function fiatForUsdCents(
  currency: FiatCurrency,
  usdCents: number,
): Promise<number> {
  if (!Number.isInteger(usdCents) || usdCents <= 0) {
    throw new Error("usdCents must be a positive integer");
  }
  const rate = await getRatePerUsd(currency);
  const buffer = bufferBps(currency);
  const baseLocal = (usdCents * rate) / 100;
  // +1% headroom so the converted-back USD still meets the target.
  const localWithBuffer = (baseLocal * 10_000) / (10_000 - buffer - 100);
  return Math.ceil(localWithBuffer);
}

// ── Backwards-compatible NGN helpers (existing callers + tests) ────────────

export async function getNgnPerUsd(): Promise<number> {
  return getRatePerUsd("NGN");
}

export async function quoteNgnTopUp(ngnAmount: number): Promise<{
  ngnAmount: number;
  usdCents: number;
  rateNgnPerUsd: number;
  bufferBps: number;
}> {
  const q = await quoteFiatTopUp("NGN", ngnAmount);
  return {
    ngnAmount: q.localAmount,
    usdCents: q.usdCents,
    rateNgnPerUsd: q.ratePerUsd,
    bufferBps: q.bufferBps,
  };
}

export async function ngnForUsdCents(usdCents: number): Promise<number> {
  return fiatForUsdCents("NGN", usdCents);
}

/** Test-only: reset the in-memory cache. */
export function _resetFxCache(): void {
  for (const k of Object.keys(cache) as FiatCurrency[]) delete cache[k];
}
