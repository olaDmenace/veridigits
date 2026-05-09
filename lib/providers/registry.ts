import {
  ProviderApiError,
  ProviderOutOfStockError,
  type ActivationBuyParams,
  type OtpProvider,
  type ProviderBuyResult,
} from "./types";

export interface ProviderCandidate {
  provider: OtpProvider;
  upstreamServiceCode: string;
  upstreamCountryCode: string;
  upstreamOperator?: string;
  /** Cached wholesale price from provider_services. Used for ranking only. */
  cachedWholesaleCents: number;
}

const MAX_FALLBACK_TRIES = 3;

/**
 * Try candidates cheapest-first, calling buyActivation on each. The cached
 * wholesale price is only a ranking signal — the provider re-quotes as part
 * of buyActivation, and the actual wholesale charged is whatever the upstream
 * returned.
 *
 * Throws the last error if every candidate fails. Throws ProviderOutOfStockError
 * if every candidate is out of stock.
 */
export async function buyCheapestActivation(
  candidates: ProviderCandidate[],
): Promise<{ result: ProviderBuyResult; provider: OtpProvider }> {
  if (candidates.length === 0) {
    throw new ProviderOutOfStockError("none", "no candidates available");
  }

  const ranked = [...candidates].sort(
    (a, b) => a.cachedWholesaleCents - b.cachedWholesaleCents,
  );

  let lastError: unknown = null;
  let outOfStockCount = 0;
  const tries = Math.min(MAX_FALLBACK_TRIES, ranked.length);

  for (let i = 0; i < tries; i++) {
    const candidate = ranked[i];
    const params: ActivationBuyParams = {
      upstreamServiceCode: candidate.upstreamServiceCode,
      upstreamCountryCode: candidate.upstreamCountryCode,
      upstreamOperator: candidate.upstreamOperator,
    };

    try {
      const result = await candidate.provider.buyActivation(params);
      return { result, provider: candidate.provider };
    } catch (err) {
      lastError = err;
      if (err instanceof ProviderOutOfStockError) {
        outOfStockCount++;
        continue;
      }
      if (err instanceof ProviderApiError) {
        continue;
      }
      throw err;
    }
  }

  if (outOfStockCount === tries) {
    throw new ProviderOutOfStockError(
      ranked.map((c) => c.provider.slug).join(","),
      "all upstream providers out of stock",
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("all upstream providers failed");
}
