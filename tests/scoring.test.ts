import { describe, it, expect } from "vitest";
import {
  MIN_SAMPLE_SIZE,
  RELIABILITY_FLOOR,
  isReliable,
  pickBestCandidate,
  successRate,
} from "@/lib/providers/scoring";

function make(
  overrides: Partial<{
    provider_slug: string;
    upstream_service_code: string;
    upstream_country_code: string;
    upstream_operator: string | null;
    wholesale_price_cents: number | null;
    recent_received_count: number;
    recent_total_count: number;
    preference_rank: number | null;
  }>,
) {
  return {
    provider_slug: "5sim",
    upstream_service_code: "wa",
    upstream_country_code: "us",
    upstream_operator: "any",
    wholesale_price_cents: 100,
    recent_received_count: 0,
    recent_total_count: 0,
    preference_rank: 0,
    ...overrides,
  };
}

describe("successRate", () => {
  it("returns 0 when there are no observations", () => {
    expect(successRate({ recent_received_count: 0, recent_total_count: 0 })).toBe(
      0,
    );
  });

  it("computes received/total", () => {
    expect(
      successRate({ recent_received_count: 7, recent_total_count: 10 }),
    ).toBeCloseTo(0.7);
  });
});

describe("isReliable", () => {
  it("rejects below the sample-size floor", () => {
    expect(
      isReliable({
        recent_received_count: MIN_SAMPLE_SIZE - 1,
        recent_total_count: MIN_SAMPLE_SIZE - 1,
      }),
    ).toBe(false);
  });

  it("rejects below the rate floor even with enough sample", () => {
    expect(
      isReliable({
        recent_received_count: 2,
        recent_total_count: MIN_SAMPLE_SIZE * 2,
      }),
    ).toBe(false);
  });

  it("accepts when both thresholds are met", () => {
    expect(
      isReliable({
        recent_received_count: Math.ceil(MIN_SAMPLE_SIZE * RELIABILITY_FLOOR) + 1,
        recent_total_count: MIN_SAMPLE_SIZE,
      }),
    ).toBe(true);
  });
});

describe("pickBestCandidate", () => {
  it("returns null on empty input", () => {
    expect(pickBestCandidate([])).toBeNull();
  });

  it("falls back to cheapest when no candidate is reliable", () => {
    const cheap = make({ wholesale_price_cents: 50, upstream_operator: "cheap" });
    const mid = make({ wholesale_price_cents: 80, upstream_operator: "mid" });
    const dear = make({ wholesale_price_cents: 200, upstream_operator: "dear" });
    expect(pickBestCandidate([dear, cheap, mid])?.upstream_operator).toBe(
      "cheap",
    );
  });

  it("prefers a slightly-more-expensive reliable candidate over a cheaper unproven one", () => {
    const unproven = make({
      wholesale_price_cents: 50,
      recent_received_count: 0,
      recent_total_count: 0,
      upstream_operator: "unproven",
    });
    const reliable = make({
      wholesale_price_cents: 80,
      recent_received_count: 8,
      recent_total_count: 10,
      upstream_operator: "reliable",
    });
    expect(pickBestCandidate([unproven, reliable])?.upstream_operator).toBe(
      "reliable",
    );
  });

  it("among reliable candidates, picks the cheapest", () => {
    const reliableCheaper = make({
      wholesale_price_cents: 60,
      recent_received_count: 7,
      recent_total_count: 10,
      upstream_operator: "cheaper",
    });
    const reliableDearer = make({
      wholesale_price_cents: 90,
      recent_received_count: 9,
      recent_total_count: 10,
      upstream_operator: "dearer",
    });
    expect(
      pickBestCandidate([reliableDearer, reliableCheaper])?.upstream_operator,
    ).toBe("cheaper");
  });

  it("rejects a known-bad operator with meaningful sample even if it's cheapest", () => {
    const burned = make({
      wholesale_price_cents: 40,
      recent_received_count: 1,
      recent_total_count: 20, // 5% success — burned
      upstream_operator: "burned",
    });
    const okay = make({
      wholesale_price_cents: 70,
      recent_received_count: 6,
      recent_total_count: 10,
      upstream_operator: "okay",
    });
    expect(pickBestCandidate([burned, okay])?.upstream_operator).toBe("okay");
  });

  it("hard preference: picks a higher-tier provider even when a lower tier is cheaper", () => {
    const cheap5sim = make({
      provider_slug: "5sim",
      wholesale_price_cents: 30,
      preference_rank: 0,
      upstream_operator: "5sim-cheap",
    });
    const preferred = make({
      provider_slug: "textverified",
      wholesale_price_cents: 90,
      preference_rank: 10,
      upstream_operator: "tv-preferred",
    });
    expect(
      pickBestCandidate([cheap5sim, preferred])?.upstream_operator,
    ).toBe("tv-preferred");
  });

  it("within the preferred tier, still applies reliability then price", () => {
    const preferredUnproven = make({
      provider_slug: "textverified",
      wholesale_price_cents: 60,
      preference_rank: 10,
      upstream_operator: "tv-unproven",
    });
    const preferredReliable = make({
      provider_slug: "textverified",
      wholesale_price_cents: 80,
      preference_rank: 10,
      recent_received_count: 9,
      recent_total_count: 10,
      upstream_operator: "tv-reliable",
    });
    const cheap5sim = make({
      provider_slug: "5sim",
      wholesale_price_cents: 20,
      preference_rank: 0,
      upstream_operator: "5sim",
    });
    expect(
      pickBestCandidate([cheap5sim, preferredUnproven, preferredReliable])
        ?.upstream_operator,
    ).toBe("tv-reliable");
  });

  it("falls back to the lower tier when the preferred provider has no stock", () => {
    // Preferred provider absent (filtered out upstream as out-of-stock) — only
    // tier-0 candidates remain, so we route among them normally.
    const a = make({
      provider_slug: "5sim",
      wholesale_price_cents: 50,
      preference_rank: 0,
      upstream_operator: "5sim-a",
    });
    const b = make({
      provider_slug: "smspool",
      wholesale_price_cents: 40,
      preference_rank: 0,
      upstream_operator: "smspool-b",
    });
    expect(pickBestCandidate([a, b])?.upstream_operator).toBe("smspool-b");
  });
});
