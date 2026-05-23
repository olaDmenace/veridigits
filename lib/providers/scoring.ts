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
 *   1. Sort by wholesale_price_cents ASC.
 *   2. If any candidate has enough sample to be trusted AND a success rate
 *      above the floor, take the CHEAPEST such candidate.
 *   3. Otherwise fall back to the absolute cheapest (the system has no data
 *      yet, no point being precious).
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

  const byPrice = [...candidates].sort(
    (a, b) =>
      (a.wholesale_price_cents ?? Number.MAX_SAFE_INTEGER) -
      (b.wholesale_price_cents ?? Number.MAX_SAFE_INTEGER),
  );

  const reliable = byPrice.filter(isReliable);
  if (reliable.length > 0) return reliable[0];

  return byPrice[0];
}
