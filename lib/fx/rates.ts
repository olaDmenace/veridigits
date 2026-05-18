/**
 * NGN/USD exchange-rate helper.
 *
 * Public free source: https://open.er-api.com/v6/latest/USD (no API key,
 * no rate limit advertised, updated daily). Cached in-memory for ten
 * minutes so a burst of top-ups doesn't hammer the upstream.
 *
 * Slippage protection: we apply a configurable buffer (`FX_BUFFER_BPS`,
 * defaults to 300 = 3%) when converting NGN paid → USD credited. The
 * customer pays N naira, we credit slightly less than the spot equivalent,
 * absorbing FX drift between quote-time and the webhook landing. The buffer
 * also covers Korapay's transaction fee.
 *
 * Iron law: never re-fetch the rate at webhook time — credit the amount
 * locked on the ngn_payments row at quote time.
 */

const SOURCE = "https://open.er-api.com/v6/latest/USD";
const CACHE_TTL_MS = 10 * 60 * 1000;
const FALLBACK_RATE = 1600; // sane floor if upstream is down at quote time
const FX_BUFFER_BPS = Number(process.env.NGN_FX_BUFFER_BPS ?? 300);

interface CacheEntry {
  rate: number;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

interface ExchangeRateResponse {
  result?: string;
  rates?: Record<string, number>;
}

/**
 * Returns the current NGN-per-USD rate. Falls back to the cached value if
 * the upstream call fails. If there's no cache, returns FALLBACK_RATE.
 *
 * Number, not string. Callers should not assume integer.
 */
export async function getNgnPerUsd(): Promise<number> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rate;
  }

  try {
    const res = await fetch(SOURCE, { cache: "no-store" });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = (await res.json()) as ExchangeRateResponse;
    const rate = data.rates?.NGN;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("rate missing from response");
    }
    cache = { rate, fetchedAt: now };
    return rate;
  } catch {
    // Stale cache is better than no answer.
    if (cache) return cache.rate;
    return FALLBACK_RATE;
  }
}

export interface ConversionQuote {
  ngnAmount: number;
  usdCents: number;
  rateNgnPerUsd: number;
  bufferBps: number;
}

/**
 * Converts a NGN-naira amount into the USD-cents we'll credit, applying
 * the slippage buffer. NGN must be a positive integer (naira whole units).
 */
export async function quoteNgnTopUp(ngnAmount: number): Promise<ConversionQuote> {
  if (!Number.isInteger(ngnAmount) || ngnAmount <= 0) {
    throw new Error("ngnAmount must be a positive integer");
  }
  const rate = await getNgnPerUsd();
  // usd = ngn / rate; usdCents = round(usd * 100); then haircut by buffer.
  const usdCentsBeforeBuffer = Math.floor((ngnAmount * 100) / rate);
  const usdCents = Math.floor(
    (usdCentsBeforeBuffer * (10_000 - FX_BUFFER_BPS)) / 10_000,
  );
  return {
    ngnAmount,
    usdCents: Math.max(usdCents, 0),
    rateNgnPerUsd: rate,
    bufferBps: FX_BUFFER_BPS,
  };
}

/** Returns NGN amount needed to land at a given USD-cents target. */
export async function ngnForUsdCents(usdCents: number): Promise<number> {
  if (!Number.isInteger(usdCents) || usdCents <= 0) {
    throw new Error("usdCents must be a positive integer");
  }
  const rate = await getNgnPerUsd();
  // Solve usdCents = floor(floor(ngn * 100 / rate) * (10_000 - buffer) / 10_000).
  // We add an extra 1% headroom so the converted-back USD still meets the target.
  const baseNgn = (usdCents * rate) / 100;
  const ngnWithBuffer =
    (baseNgn * 10_000) / (10_000 - FX_BUFFER_BPS - 100);
  return Math.ceil(ngnWithBuffer);
}

/** Test-only: reset the in-memory cache. */
export function _resetFxCache(): void {
  cache = null;
}
