import { describe, it, expect } from "vitest";
import { decideReroll, REROLL_MAX_PER_WINDOW } from "@/lib/orders/reroll";

const base = {
  hasSms: false,
  recentCount: 0,
  maxPerWindow: REROLL_MAX_PER_WINDOW,
  cancelEligible: false,
  status: "expired",
};

describe("decideReroll", () => {
  it("buys a fresh number when the previous one expired with no code", () => {
    expect(decideReroll(base)).toEqual({ action: "buy" });
  });

  it("buys after a cancelled/refunded miss too", () => {
    expect(decideReroll({ ...base, status: "cancelled" }).action).toBe("buy");
    expect(decideReroll({ ...base, status: "refunded" }).action).toBe("buy");
  });

  it("cancels the live number first when it's still cancelable", () => {
    expect(
      decideReroll({ ...base, status: "active", cancelEligible: true }),
    ).toEqual({ action: "cancel_then_buy" });
  });

  it("refuses (too_early) for a live number still inside the cancel floor", () => {
    expect(
      decideReroll({ ...base, status: "active", cancelEligible: false }),
    ).toEqual({ action: "refuse", code: "too_early" });
  });

  it("never re-rolls a number that already received a code", () => {
    expect(
      decideReroll({ ...base, hasSms: true, status: "received" }),
    ).toEqual({ action: "refuse", code: "already_received" });
  });

  it("caps runaway attempts", () => {
    expect(
      decideReroll({ ...base, recentCount: REROLL_MAX_PER_WINDOW }),
    ).toEqual({ action: "refuse", code: "too_many" });
  });

  it("already-received beats the attempt cap (no false 'too many')", () => {
    expect(
      decideReroll({
        ...base,
        hasSms: true,
        recentCount: REROLL_MAX_PER_WINDOW + 5,
      }),
    ).toEqual({ action: "refuse", code: "already_received" });
  });
});
