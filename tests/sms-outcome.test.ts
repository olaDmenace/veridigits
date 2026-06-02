import { describe, expect, it } from "vitest";
import { decideSmsOutcome } from "@/lib/orders/sms-outcome";

describe("decideSmsOutcome", () => {
  it("captures when upstream received a matching code", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "active",
        anyMatch: true,
        anyMismatch: false,
      }),
    ).toBe("capture");
  });

  it("treats no-evidence (neither match nor mismatch) as a normal capture", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "active",
        anyMatch: false,
        anyMismatch: false,
      }),
    ).toBe("capture");
  });

  it("flags cross-service when there's a mismatch and no match", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "active",
        anyMatch: false,
        anyMismatch: true,
      }),
    ).toBe("cross_service");
  });

  it("captures when a real match coexists with an incidental mismatch", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "active",
        anyMatch: true,
        anyMismatch: true,
      }),
    ).toBe("capture");
  });

  it("does nothing if already received (idempotent re-poll)", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "received",
        anyMatch: true,
        anyMismatch: false,
      }),
    ).toBe("noop");
  });

  it("reports upstream cancellation", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "cancelled",
        currentStatus: "active",
        anyMatch: false,
        anyMismatch: false,
      }),
    ).toBe("upstream_cancelled");
  });

  it("waits while still pending upstream", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "pending",
        currentStatus: "active",
        anyMatch: false,
        anyMismatch: false,
      }),
    ).toBe("wait");
  });
});
