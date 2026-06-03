/**
 * Provider candidate scoring.
 *
 * Pick the candidate that's most likely to deliver an SMS the user can use,
 * not just the cheapest one. The Inngest recompute-operator-success-rates job
 * keeps `recent_received_count` / `recent_total_count` fresh on a 7-day
 * rolling window per (provider, service, country, operator). We use those
 * counts here to prefer reliable operators over burned ones at the same price
 * tier.
 *
 * Selection rule:
 *   0. HARD PREFERENCE first: only consider candidates in the highest
 *      preference tier that currently has stock. This is what lets us route
 *      e.g. WhatsApp to a preferred provider while everything else stays
 *      cheapest-reliable. Candidates are already filtered to in-stock upstream
 *      rows by the caller, so an out-of-stock preferred provider simply isn't
 *      present and the next tier is used — that's the fallback.
 *   1. Within that tier, sort by wholesale_price_cents ASC.
 *   2. If any has enough sample to be trusted AND a success rate above the
 *      floor, take the CHEAPEST such candidate.
 *   3. Otherwise fall back to the absolute cheapest in the tier (no data yet,
 *      no point being precious).
 *
 * Thresholds are conservative; we'd rather lose a little price advantage than
 * route a user to a known-bad operator. Tune as data accumulates.
 */
export interface ScorableCandidate {
  provider_slug: string;
  upstream_service_code: string;
  upstream_country_code: string;
  upstream_operator: string | null;
  wholesale_price_cents: number | null;
  recent_received_count: number;
  recent_total_count: number;
  /**
   * Routing tier; higher wins. Defaults to 0 (no preference). Set per
   * (service[,country]) to make a provider primary — a tier-10 candidate is
   * chosen over a cheaper tier-0 one as long as it has stock.
   */
  preference_rank?: number | null;
}

/** Below this sample size the success rate is too noisy to trust. */
export const MIN_SAMPLE_SIZE = 8;

/** Below this success rate we'd rather try someone else (if they exist). */
export const RELIABILITY_FLOOR = 0.4;

export function successRate(c: {
  recent_received_count: number;
  recent_total_count: number;
}): number {
  if (c.recent_total_count <= 0) return 0;
  return c.recent_received_count / c.recent_total_count;
}

export function isReliable(c: {
  recent_received_count: number;
  recent_total_count: number;
}): boolean {
  return (
    c.recent_total_count >= MIN_SAMPLE_SIZE &&
    successRate(c) >= RELIABILITY_FLOOR
  );
}

/**
 * Pick the candidate to actually buy from. Input may be in any order. Returns
 * null if the list is empty.
 */
export function pickBestCandidate<T extends ScorableCandidate>(
  candidates: T[],
): T | null {
  if (candidates.length === 0) return null;

  // Hard preference: restrict to the highest preference tier present. The
  // caller only passes in-stock candidates, so a preferred provider that's
  // out of stock just won't appear here and the next tier is used.
  const maxRank = candidates.reduce(
    (m, c) => Math.max(m, c.preference_rank ?? 0),
    Number.NEGATIVE_INFINITY,
  );
  const topTier = candidates.filter((c) => (c.preference_rank ?? 0) === maxRank);

  const byPrice = [...topTier].sort(
    (a, b) =>
      (a.wholesale_price_cents ?? Number.MAX_SAFE_INTEGER) -
      (b.wholesale_price_cents ?? Number.MAX_SAFE_INTEGER),
  );

  const reliable = byPrice.filter(isReliable);
  if (reliable.length > 0) return reliable[0];

  return byPrice[0];
}
