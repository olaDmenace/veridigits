import { describe, expect, it } from "vitest";
import { decideSmsOutcome } from "@/lib/orders/sms-outcome";

describe("decideSmsOutcome", () => {
  it("captures when upstream received a matching code", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "active",
        anyMessage: true,
        anyMatch: true,
        anyMismatch: false,
      }),
    ).toBe("capture");
  });

  // Regression: 5SIM's RECEIVED status means "waiting for SMS", not "SMS
  // arrived". It flips ~2s after purchase with an empty sms[] array. Capturing
  // on status alone (no message) charged the wallet and blocked Cancel with no
  // code ever delivered. With no message present we must keep waiting.
  it("waits (does NOT capture) when status is received but no SMS exists", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "active",
        anyMessage: false,
        anyMatch: false,
        anyMismatch: false,
      }),
    ).toBe("wait");
  });

  it("captures a message from an unrecognized sender (present but no match/mismatch)", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "active",
        anyMessage: true,
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
        anyMessage: true,
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
        anyMessage: true,
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
        anyMessage: true,
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
        anyMessage: false,
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
        anyMessage: false,
        anyMatch: false,
        anyMismatch: false,
      }),
    ).toBe("wait");
  });
});
