/**
 * Retail pricing engine.
 *
 * The wholesale price comes from the upstream provider in real time. We never
 * trust the cached wholesale at charge time — re-quote the provider, then run
 * the wholesale through this function to compute what the user pays.
 *
 * Markup rule resolution: most-specific match wins, then by priority desc.
 *   service_id + country_id  ─►  highest specificity
 *   service_id only          ─►
 *   country_id only          ─►
 *   global default (both null) ─► lowest specificity, must always exist
 *
 * Within a specificity tier, the row with the highest `priority` wins.
 */

export interface PricingRule {
  id: string;
  service_id: string | null;
  country_id: string | null;
  markup_percent: number;
  flat_fee_cents: number;
  min_retail_cents: number;
  priority: number;
  is_active: boolean;
}

export interface CalculatePriceParams {
  serviceId: string;
  countryId: string;
  wholesaleCents: number;
  rules: PricingRule[];
}

export interface CalculatedPrice {
  retailCents: number;
  appliedRule: PricingRule;
}

function specificityScore(rule: PricingRule): number {
  let score = 0;
  if (rule.service_id !== null) score += 2;
  if (rule.country_id !== null) score += 1;
  return score;
}

export function pickPricingRule(
  rules: PricingRule[],
  serviceId: string,
  countryId: string,
): PricingRule {
  const eligible = rules.filter(
    (r) =>
      r.is_active &&
      (r.service_id === null || r.service_id === serviceId) &&
      (r.country_id === null || r.country_id === countryId),
  );

  if (eligible.length === 0) {
    throw new Error(
      "no applicable pricing rule — global default rule is missing",
    );
  }

  eligible.sort((a, b) => {
    const sd = specificityScore(b) - specificityScore(a);
    if (sd !== 0) return sd;
    return b.priority - a.priority;
  });

  return eligible[0];
}

export function calculateRetailPrice(
  params: CalculatePriceParams,
): CalculatedPrice {
  const { serviceId, countryId, wholesaleCents, rules } = params;

  if (wholesaleCents < 0) {
    throw new Error("wholesaleCents must be non-negative");
  }

  const rule = pickPricingRule(rules, serviceId, countryId);

  // Exact integer arithmetic. markup_percent is numeric(5,2) in the DB —
  // at most 2 decimal places — so scaling by 100 gives an integer "basis
  // points × 100". Doing the math as `wholesale * (10000 + markup_bp_x100)
  // / 10000` keeps every intermediate value an integer (modulo rounding)
  // and avoids the 100 * 1.1 = 110.00000000000001 trap that bites
  // Math.ceil.
  const markupBpX100 = Math.round(rule.markup_percent * 100);
  const numerator = wholesaleCents * (10_000 + markupBpX100);
  const markedUp = Math.ceil(numerator / 10_000);

  const withFee = markedUp + rule.flat_fee_cents;
  const retailCents = Math.max(withFee, rule.min_retail_cents);

  return { retailCents, appliedRule: rule };
}
