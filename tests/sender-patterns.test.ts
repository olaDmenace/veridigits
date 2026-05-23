import { describe, it, expect } from "vitest";
import { senderMatchesService } from "@/lib/services/sender-patterns";

describe("senderMatchesService", () => {
  it("matches whatsapp sender for whatsapp service", () => {
    expect(senderMatchesService("whatsapp", "WhatsApp")).toEqual({
      decision: "match",
    });
    expect(senderMatchesService("whatsapp", "WHATSAPP-OTP")).toEqual({
      decision: "match",
    });
  });

  it("flags Telegram sender on a whatsapp order as mismatch", () => {
    const r = senderMatchesService("whatsapp", "Telegram");
    expect(r.decision).toBe("mismatch");
  });

  it("matches google variants for google service", () => {
    expect(senderMatchesService("google", "Google").decision).toBe("match");
    expect(senderMatchesService("google", "G-123456").decision).toBe("match");
  });

  it("returns unknown when no pattern is profiled for the service", () => {
    expect(senderMatchesService("zzzunknown", "Whatever")).toEqual({
      decision: "unknown",
      reason: "no_pattern",
    });
  });

  it("returns unknown for numeric short-codes even when sender doesn't match", () => {
    // Carrier-level short codes are routinely used for legit OTPs; we don't
    // want false-positive auto-refunds based on numeric senders.
    expect(senderMatchesService("whatsapp", "8888").decision).toBe("unknown");
    expect(senderMatchesService("whatsapp", "+15551234567").decision).toBe("unknown");
  });

  it("returns unknown when sender is missing", () => {
    expect(senderMatchesService("whatsapp", null).decision).toBe("unknown");
    expect(senderMatchesService("whatsapp", "").decision).toBe("unknown");
  });

  it("is case-insensitive on both service slug and sender", () => {
    expect(senderMatchesService("WHATSAPP", "whatsapp").decision).toBe("match");
    expect(senderMatchesService("whatsapp", "WHATSAPP").decision).toBe("match");
  });
});
