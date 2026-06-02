import { describe, expect, it } from "vitest";
import {
  canCancelOrder,
  MIN_CANCEL_AGE_MS,
} from "@/lib/orders/cancel-eligibility";

const base = {
  status: "active" as string,
  createdAtMs: 0,
  expiresAtMs: 20 * 60 * 1000,
  hasSms: false,
  nowMs: 3 * 60 * 1000, // 3 min in — past the 2-min floor
};

describe("canCancelOrder", () => {
  it("allows cancel after the 2-minute upstream floor with no SMS", () => {
    expect(canCancelOrder(base)).toEqual({ ok: true });
  });

  it("blocks cancel before the 2-minute floor (5SIM would reject)", () => {
    const r = canCancelOrder({ ...base, nowMs: 60 * 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_early");
  });

  it("blocks cancel once an SMS has arrived", () => {
    const r = canCancelOrder({ ...base, hasSms: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("already_received");
  });

  it("blocks cancel past expiry", () => {
    const r = canCancelOrder({ ...base, nowMs: 25 * 60 * 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("blocks cancel for a terminal status", () => {
    const r = canCancelOrder({ ...base, status: "received" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_status");
  });

  it("exposes the 2-minute floor as a constant", () => {
    expect(MIN_CANCEL_AGE_MS).toBe(2 * 60 * 1000);
  });
});
