/**
 * Provider candidate scoring.
 *
 * Pick the candidate most likely to actually DELIVER an SMS the user can use,
 * not just the cheapest one. Two delivery signals, in order of trust:
 *
 *   1. Our own 7-day rolling stats (`recent_received_count` /
 *      `recent_total_count`), kept fresh by the recompute job — trusted once we
 *      have enough sample.
 *   2. The upstream's published per-operator rate (`published_success_rate`,
 *      0-100, e.g. 5SIM's `rate`) — a cold-start prior so we avoid known-bad
 *      operators (5SIM's cheapest "virtual" operators are often ~0%) before
 *      we've gathered our own data.
 *
 * Selection rule (within the highest preference tier that has stock):
 *   1. Sort by wholesale_price_cents ASC.
 *   2. If any candidate clears the reliability floor, take the CHEAPEST such.
 *   3. Otherwise take the candidate with the HIGHEST expected delivery (not the
 *      cheapest — cheapest is usually the worst operator).
 *   4. No guaranteed-fail sales: if the best we can do is a *known* dud (below
 *      MIN_VIABLE_RATE), return null so the caller shows out-of-stock instead
 *      of charging for a number that will never receive.
 *
 * Unknown-quality candidates (no sample, no published rate — e.g. TextVerified
 * real numbers) get a neutral prior: ranked above known-bad operators, and
 * never refused, so we still route to them and learn their real rate.
 */
export interface ScorableCandidate {
  provider_slug: string;
  upstream_service_code: string;
  upstream_country_code: string;
  upstream_operator: string | null;
  wholesale_price_cents: number | null;
  recent_received_count: number;
  recent_total_count: number;
  /** Upstream-published operator success rate, 0-100. Null if unpublished. */
  published_success_rate?: number | null;
  /**
   * Routing tier; higher wins. Defaults to 0 (no preference). Set per
   * (service[,country]) to make a provider primary — a tier-10 candidate is
   * chosen over a cheaper tier-0 one as long as it has stock.
   */
  preference_rank?: number | null;
}

/** Below this sample size our own success rate is too noisy to trust. */
export const MIN_SAMPLE_SIZE = 8;

/** At/above this expected delivery we treat an operator as reliable. */
export const RELIABILITY_FLOOR = 0.4;

/**
 * Prior for candidates we have no delivery signal for at all (no sample, no
 * published rate). Ranks them above known-bad operators but below proven-good
 * ones, and they're never refused — so a new/unrated provider still gets tried.
 */
export const NEUTRAL_PRIOR = 0.5;

/**
 * Below this KNOWN expected delivery we refuse to sell — better to show
 * out-of-stock than charge for a number that will never receive (e.g. POF/USA,
 * 0% on every 5SIM operator).
 */
export const MIN_VIABLE_RATE = 0.05;

type QualityInput = Pick<
  ScorableCandidate,
  "recent_received_count" | "recent_total_count" | "published_success_rate"
>;

export function successRate(c: {
  recent_received_count: number;
  recent_total_count: number;
}): number {
  if (c.recent_total_count <= 0) return 0;
  return c.recent_received_count / c.recent_total_count;
}

/**
 * Expected delivery probability (0-1) from the best signal we have, or null
 * when we have no signal at all (no sample, no published rate).
 */
export function expectedDelivery(c: QualityInput): number | null {
  if (c.recent_total_count >= MIN_SAMPLE_SIZE) {
    return successRate(c);
  }
  if (c.published_success_rate != null) {
    const clamped = Math.max(0, Math.min(100, c.published_success_rate));
    return clamped / 100;
  }
  return null;
}

/** Expected delivery with the neutral prior substituted for "no signal". */
function effectiveDelivery(c: QualityInput): number {
  const d = expectedDelivery(c);
  return d == null ? NEUTRAL_PRIOR : d;
}

/**
 * Pick the candidate to actually buy from. Input may be in any order. Returns
 * null if the list is empty or the only options are known duds.
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

  // Cheapest operator with a KNOWN delivery signal clearing the floor. Unknowns
  // (no sample, no published rate) are NOT auto-reliable — a proven-good
  // operator should beat a cheaper unproven one.
  const reliable = byPrice.filter((c) => {
    const d = expectedDelivery(c);
    return d != null && d >= RELIABILITY_FLOOR;
  });
  let chosen: T;
  if (reliable.length > 0) {
    chosen = reliable[0];
  } else {
    // ...otherwise the highest expected delivery (byPrice order breaks ties
    // toward cheaper, since reduce keeps the incumbent on equality).
    chosen = byPrice.reduce(
      (best, c) => (effectiveDelivery(c) > effectiveDelivery(best) ? c : best),
      byPrice[0],
    );
  }

  // No guaranteed-fail sales: refuse a pick whose KNOWN delivery is hopeless.
  const known = expectedDelivery(chosen);
  if (known != null && known < MIN_VIABLE_RATE) return null;

  return chosen;
}
