import { describe, expect, it } from "vitest";
import {
  calculateRetailPrice,
  pickPricingRule,
  type PricingRule,
} from "@/lib/pricing/calculate";

const SVC_TG = "00000000-0000-0000-0000-000000000001";
const SVC_WA = "00000000-0000-0000-0000-000000000002";
const CTY_US = "00000000-0000-0000-0000-0000000000aa";
const CTY_NG = "00000000-0000-0000-0000-0000000000bb";

function rule(overrides: Partial<PricingRule>): PricingRule {
  return {
    id: crypto.randomUUID(),
    service_id: null,
    country_id: null,
    markup_percent: 30,
    flat_fee_cents: 1,
    min_retail_cents: 5,
    priority: 0,
    is_active: true,
    ...overrides,
  };
}

describe("pickPricingRule", () => {
  it("picks service+country over service-only", () => {
    const rules = [
      rule({}),
      rule({ service_id: SVC_TG }),
      rule({ service_id: SVC_TG, country_id: CTY_US, markup_percent: 12 }),
    ];
    const picked = pickPricingRule(rules, SVC_TG, CTY_US);
    expect(picked.markup_percent).toBe(12);
  });

  it("picks service-only over country-only", () => {
    const rules = [
      rule({ service_id: SVC_TG, markup_percent: 20 }),
      rule({ country_id: CTY_US, markup_percent: 99 }),
    ];
    const picked = pickPricingRule(rules, SVC_TG, CTY_US);
    expect(picked.markup_percent).toBe(20);
  });

  it("falls back to global default when no specific rule matches", () => {
    const rules = [
      rule({ markup_percent: 25 }),
      rule({ service_id: SVC_WA, markup_percent: 99 }),
    ];
    const picked = pickPricingRule(rules, SVC_TG, CTY_US);
    expect(picked.markup_percent).toBe(25);
  });

  it("breaks specificity ties by priority desc", () => {
    const rules = [
      rule({ service_id: SVC_TG, priority: 0, markup_percent: 30 }),
      rule({ service_id: SVC_TG, priority: 10, markup_percent: 5 }),
      rule({ service_id: SVC_TG, priority: 100, markup_percent: 2 }),
    ];
    const picked = pickPricingRule(rules, SVC_TG, CTY_NG);
    expect(picked.markup_percent).toBe(2);
  });

  it("ignores inactive rules", () => {
    const rules = [
      rule({ markup_percent: 50 }),
      rule({
        service_id: SVC_TG,
        country_id: CTY_US,
        markup_percent: 1,
        is_active: false,
      }),
    ];
    const picked = pickPricingRule(rules, SVC_TG, CTY_US);
    expect(picked.markup_percent).toBe(50);
  });

  it("throws when no rule matches at all", () => {
    expect(() => pickPricingRule([], SVC_TG, CTY_US)).toThrow(
      /no applicable pricing rule/i,
    );
  });
});

describe("calculateRetailPrice", () => {
  const defaults: PricingRule[] = [rule({})]; // 30% + 1c + 5c floor

  it("applies markup percentage", () => {
    const { retailCents } = calculateRetailPrice({
      serviceId: SVC_TG,
      countryId: CTY_US,
      wholesaleCents: 100,
      rules: defaults,
    });
    // 100 * 1.30 = 130, ceil() -> 130, + 1 flat = 131, max(131,5) = 131
    expect(retailCents).toBe(131);
  });

  it("ceil()s fractional markup so we never round down against the house", () => {
    const { retailCents } = calculateRetailPrice({
      serviceId: SVC_TG,
      countryId: CTY_US,
      wholesaleCents: 3, // 3 * 1.30 = 3.9 -> ceil 4 -> + 1 = 5
      rules: defaults,
    });
    expect(retailCents).toBe(5);
  });

  it("enforces the minimum retail floor", () => {
    const { retailCents } = calculateRetailPrice({
      serviceId: SVC_TG,
      countryId: CTY_US,
      wholesaleCents: 1, // would yield ceil(1.3) + 1 = 3, floor pushes to 5
      rules: [rule({ markup_percent: 30, flat_fee_cents: 1, min_retail_cents: 5 })],
    });
    expect(retailCents).toBe(5);
  });

  it("uses the cheapest applicable rule's specificity", () => {
    const rules: PricingRule[] = [
      rule({ markup_percent: 30 }),
      rule({ service_id: SVC_TG, markup_percent: 50 }),
      rule({
        service_id: SVC_TG,
        country_id: CTY_US,
        markup_percent: 10,
        flat_fee_cents: 0,
        min_retail_cents: 0,
      }),
    ];
    const { retailCents, appliedRule } = calculateRetailPrice({
      serviceId: SVC_TG,
      countryId: CTY_US,
      wholesaleCents: 100,
      rules,
    });
    expect(appliedRule.markup_percent).toBe(10);
    expect(retailCents).toBe(110); // ceil(100 * 1.10) + 0 = 110
  });

  it("rejects negative wholesale", () => {
    expect(() =>
      calculateRetailPrice({
        serviceId: SVC_TG,
        countryId: CTY_US,
        wholesaleCents: -5,
        rules: defaults,
      }),
    ).toThrow(/non-negative/i);
  });
});
