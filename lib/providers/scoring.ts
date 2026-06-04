/**
 * Provider candidate scoring.
 *
 * Pick the candidate most likely to actually DELIVER an SMS the user can use,
 * balancing delivery against price. Delivery signals, in order of trust:
 *
 *   1. Our own 7-day rolling stats (`recent_received_count` /
 *      `recent_total_count`) once we have enough sample — measured truth.
 *   2. The upstream's published per-operator rate (`published_success_rate`,
 *      0-100, e.g. 5SIM's `rate`) — a cold-start signal so we avoid known-bad
 *      operators (5SIM's cheapest "virtual" operators are often ~0%).
 *   3. A cold-start PRIOR by preference: real-number / preferred providers
 *      (`preference_rank > 0`, e.g. TextVerified, SMSPool-for-UK) are assumed
 *      reliable until measured; everyone else gets a below-floor neutral prior.
 *
 * This is a SOFT preference, not a hard tier: a preferred provider wins
 * wherever the alternatives are mediocre, but a 5SIM operator that is BOTH
 * proven-reliable AND cheaper still wins (e.g. Tinder/Discord on 5SIM
 * virtual63 at ~$0.20 / 57-71% beats paying $1.50 for a real number). Once we
 * measure a preferred provider's real rate, that replaces the prior.
 *
 * Selection rule (no hard tiers):
 *   1. Sort by wholesale_price_cents ASC.
 *   2. If any candidate clears the reliability floor, take the CHEAPEST such.
 *   3. Otherwise take the candidate with the HIGHEST effective delivery.
 *
 * We OFFER every in-stock operator — even a low/0% published rate. The rate is
 * 5SIM's estimate, defer-debit means a miss never charges, and re-roll covers
 * it, so refusing the sale (and hiding the service) is worse than offering the
 * best available number. Returns null only when the candidate list is empty.
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
   * Routing preference; > 0 marks a provider we trust for this (service,
   * country) — gives it a high cold-start prior so it's preferred while the
   * alternatives are unproven. A soft thumb on the scale, not a hard override.
   */
  preference_rank?: number | null;
}

/** Below this sample size our own success rate is too noisy to trust. */
export const MIN_SAMPLE_SIZE = 8;

/** At/above this effective delivery we treat an operator as reliable. */
export const RELIABILITY_FLOOR = 0.5;

/**
 * Cold-start prior for a PREFERRED provider (preference_rank > 0) we have no
 * data for yet — high enough to clear the floor so real-number providers win
 * until a cheaper alternative proves itself reliable.
 */
export const PREFERRED_PRIOR = 0.85;

/**
 * Cold-start prior for an unpreferred provider we have no signal for — below
 * the floor, so an unproven cheap operator does NOT undercut a proven or
 * preferred one. It can still be chosen when nothing better exists.
 */
export const NEUTRAL_PRIOR = 0.45;

type QualityInput = Pick<
  ScorableCandidate,
  | "recent_received_count"
  | "recent_total_count"
  | "published_success_rate"
  | "preference_rank"
>;

export function successRate(c: {
  recent_received_count: number;
  recent_total_count: number;
}): number {
  if (c.recent_total_count <= 0) return 0;
  return c.recent_received_count / c.recent_total_count;
}

/**
 * Delivery probability (0-1) from a HARD signal — our own sample if we have
 * enough, else the upstream-published rate. Null when we have neither (only a
 * prior is available). Used both for ranking and for the no-dud refusal, which
 * must never fire on a mere prior.
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

/** The cold-start prior for a candidate with no hard signal. */
function priorFor(c: QualityInput): number {
  return (c.preference_rank ?? 0) > 0 ? PREFERRED_PRIOR : NEUTRAL_PRIOR;
}

/** Hard signal if we have one, else the preference-based prior. Always 0-1. */
export function effectiveDelivery(c: QualityInput): number {
  return expectedDelivery(c) ?? priorFor(c);
}

/**
 * Pick the candidate to actually buy from. Input may be in any order. Returns
 * null ONLY when the list is empty — we offer every in-stock operator (even a
 * low published rate), picking the best one. The rate is just 5SIM's estimate;
 * defer-debit means a miss never charges, and re-roll covers it, so refusing a
 * sale is worse than offering the best available number.
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

  // Among operators that deliver (clear the reliability bar), prefer the
  // designated lane (highest preference_rank — e.g. SMSPool for the dating
  // services, real numbers for strict ones), then the cheapest. byPrice order
  // breaks ties toward cheaper since reduce keeps the incumbent on equality.
  const reliable = byPrice.filter((c) => effectiveDelivery(c) >= RELIABILITY_FLOOR);
  if (reliable.length > 0) {
    return reliable.reduce(
      (best, c) => ((c.preference_rank ?? 0) > (best.preference_rank ?? 0) ? c : best),
      reliable[0],
    );
  }

  // ...otherwise the highest effective delivery (byPrice order breaks ties
  // toward cheaper, since reduce keeps the incumbent on equality).
  return byPrice.reduce(
    (best, c) => (effectiveDelivery(c) > effectiveDelivery(best) ? c : best),
    byPrice[0],
  );
}
