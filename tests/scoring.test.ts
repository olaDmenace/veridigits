import { describe, it, expect } from "vitest";
import {
  MIN_SAMPLE_SIZE,
  expectedDelivery,
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
    published_success_rate: number | null;
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
    published_success_rate: null,
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

describe("expectedDelivery", () => {
  it("uses our own stats once we have enough sample", () => {
    expect(
      expectedDelivery({
        recent_received_count: 6,
        recent_total_count: 10,
        published_success_rate: 99,
      }),
    ).toBeCloseTo(0.6); // internal beats published once sampled
  });

  it("falls back to the published rate (0-100 -> 0-1) before we have sample", () => {
    expect(
      expectedDelivery({
        recent_received_count: 0,
        recent_total_count: 0,
        published_success_rate: 62,
      }),
    ).toBeCloseTo(0.62);
  });

  it("is null when there is no signal at all", () => {
    expect(
      expectedDelivery({
        recent_received_count: 0,
        recent_total_count: 0,
        published_success_rate: null,
      }),
    ).toBeNull();
  });
});

describe("pickBestCandidate", () => {
  it("returns null on empty input", () => {
    expect(pickBestCandidate([])).toBeNull();
  });

  it("uses the published rate to pick a reliable operator over the cheaper dud", () => {
    // The exact POF/Discord shape: cheapest operator is published-0%, a dearer
    // one is published-62%. We must pick the one that actually delivers.
    const cheapDud = make({
      wholesale_price_cents: 19,
      published_success_rate: 0,
      upstream_operator: "virtual8",
    });
    const dearerGood = make({
      wholesale_price_cents: 22,
      published_success_rate: 62,
      upstream_operator: "virtual63",
    });
    expect(
      pickBestCandidate([cheapDud, dearerGood])?.upstream_operator,
    ).toBe("virtual63");
  });

  it("when nothing clears the floor, picks the highest published rate (not cheapest)", () => {
    const cheapWorst = make({
      wholesale_price_cents: 10,
      published_success_rate: 4,
      upstream_operator: "v8",
    });
    const dearerBest = make({
      wholesale_price_cents: 30,
      published_success_rate: 15,
      upstream_operator: "v63",
    });
    expect(
      pickBestCandidate([cheapWorst, dearerBest])?.upstream_operator,
    ).toBe("v63");
  });

  it("an unmeasured route does not outrank a measured-but-low one (Telegram/USA)", () => {
    // The exact incident: SMSPool telegram/USA is cheapest but we have NO
    // delivery signal for it (null published, 0 sample) — in reality it
    // delivers ~0%. 5SIM's operators publish honest-but-low rates. The
    // unmeasured SMSPool row must NOT win on its optimistic prior; route to the
    // best measured operator instead.
    const smspoolUnknown = make({
      provider_slug: "smspool",
      wholesale_price_cents: 60,
      published_success_rate: null,
      recent_total_count: 0,
      preference_rank: 0,
      upstream_operator: "default",
    });
    const fivesimBest = make({
      provider_slug: "5sim",
      wholesale_price_cents: 74,
      published_success_rate: 25.81,
      upstream_operator: "virtual63",
    });
    const fivesimWeak = make({
      provider_slug: "5sim",
      wholesale_price_cents: 77,
      published_success_rate: 11.11,
      upstream_operator: "virtual8",
    });
    const picked = pickBestCandidate([
      smspoolUnknown,
      fivesimBest,
      fivesimWeak,
    ]);
    expect(picked?.provider_slug).toBe("5sim");
    expect(picked?.upstream_operator).toBe("virtual63");
  });

  it("still offers a number when every option is a low/0%-rated dud (open everything)", () => {
    // We sell whatever 5SIM has in stock — the rate is just an estimate, and a
    // miss never charges. Cheapest among equal duds wins.
    const a = make({ wholesale_price_cents: 14, published_success_rate: 0, upstream_operator: "v8" });
    const b = make({ wholesale_price_cents: 6, published_success_rate: 0, upstream_operator: "v51" });
    const c = make({ wholesale_price_cents: 6, published_success_rate: 0, upstream_operator: "v63" });
    expect(pickBestCandidate([a, b, c])?.upstream_operator).toBe("v51");
  });

  it("never refuses an unknown-quality candidate (gives new providers a chance)", () => {
    const unknown = make({
      provider_slug: "textverified",
      published_success_rate: null,
      recent_total_count: 0,
      upstream_operator: "tv",
    });
    expect(pickBestCandidate([unknown])?.upstream_operator).toBe("tv");
  });

  it("falls back to cheapest among equally-unknown candidates", () => {
    const cheap = make({ wholesale_price_cents: 50, upstream_operator: "cheap" });
    const mid = make({ wholesale_price_cents: 80, upstream_operator: "mid" });
    const dear = make({ wholesale_price_cents: 200, upstream_operator: "dear" });
    expect(pickBestCandidate([dear, cheap, mid])?.upstream_operator).toBe(
      "cheap",
    );
  });

  it("prefers a proven-reliable candidate over a cheaper unproven one", () => {
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

  it("our own sample overrides a rosy published rate", () => {
    // Published says 90% but we've measured 10% over a real sample — trust us.
    const burned = make({
      wholesale_price_cents: 40,
      recent_received_count: 1,
      recent_total_count: MIN_SAMPLE_SIZE * 2,
      published_success_rate: 90,
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

  it("soft preference: a preferred provider wins when the alternatives are unreliable", () => {
    const tv = make({
      provider_slug: "textverified",
      wholesale_price_cents: 150,
      preference_rank: 10, // real numbers, no data yet -> high prior
      upstream_operator: "tv",
    });
    const dud8 = make({
      provider_slug: "5sim",
      wholesale_price_cents: 20,
      published_success_rate: 0,
      upstream_operator: "virtual8",
    });
    const weak = make({
      provider_slug: "5sim",
      wholesale_price_cents: 30,
      published_success_rate: 9,
      upstream_operator: "virtual63",
    });
    expect(pickBestCandidate([dud8, weak, tv])?.upstream_operator).toBe("tv");
  });

  it("among reliable options, the designated lane (preference_rank) wins over a cheaper one", () => {
    // POF/UK shape: SMSPool is the designated lane (rank 10) and reliable; 5SIM
    // also clears the bar and is cheaper, but we honor the preference because
    // SMSPool is the quality lane for these services.
    const preferred = make({
      provider_slug: "smspool",
      wholesale_price_cents: 18,
      published_success_rate: 73,
      preference_rank: 10,
      upstream_operator: "smspool",
    });
    const cheaper5sim = make({
      provider_slug: "5sim",
      wholesale_price_cents: 6,
      published_success_rate: 54,
      upstream_operator: "virtual59",
    });
    expect(
      pickBestCandidate([preferred, cheaper5sim])?.upstream_operator,
    ).toBe("smspool");
  });

  it("an unpreferred unknown does NOT undercut a preferred provider", () => {
    // SMSPool (unknown, cheapest) must not steal a strict US service from
    // TextVerified just because it's cheap.
    const tv = make({
      provider_slug: "textverified",
      wholesale_price_cents: 150,
      preference_rank: 10,
      upstream_operator: "tv",
    });
    const cheapUnknown = make({
      provider_slug: "smspool",
      wholesale_price_cents: 5,
      published_success_rate: null,
      preference_rank: 0,
      upstream_operator: "smspool",
    });
    expect(pickBestCandidate([cheapUnknown, tv])?.upstream_operator).toBe("tv");
  });

  it("falls back to the lower tier when the preferred provider has no stock", () => {
    const a = make({
      provider_slug: "5sim",
      wholesale_price_cents: 50,
      published_success_rate: 70,
      preference_rank: 0,
      upstream_operator: "5sim-a",
    });
    const b = make({
      provider_slug: "smspool",
      wholesale_price_cents: 40,
      published_success_rate: 70,
      preference_rank: 0,
      upstream_operator: "smspool-b",
    });
    expect(pickBestCandidate([a, b])?.upstream_operator).toBe("smspool-b");
  });
});
