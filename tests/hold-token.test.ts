import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HoldTokenError,
  signHoldToken,
  verifyHoldToken,
  type HoldTokenPayload,
} from "@/lib/utils/hold-token";

const FAKE_SECRET =
  "test-secret-only-for-tests-not-in-production-not-real-creds";

const ORIGINAL_SECRET = process.env.HOLD_TOKEN_SECRET;

beforeEach(() => {
  process.env.HOLD_TOKEN_SECRET = FAKE_SECRET;
});

afterEach(() => {
  process.env.HOLD_TOKEN_SECRET = ORIGINAL_SECRET;
  vi.useRealTimers();
});

function fixture(): Omit<HoldTokenPayload, "iat" | "exp"> {
  return {
    userId: "u-1",
    serviceId: "svc-1",
    countryId: "cty-1",
    providerSlug: "5sim",
    upstreamServiceCode: "telegram",
    upstreamCountryCode: "usa",
    upstreamOperator: "any",
    wholesaleCents: 100,
    retailCents: 131,
  };
}

describe("hold token", () => {
  it("signs and verifies a round-trip payload", () => {
    const token = signHoldToken(fixture());
    const payload = verifyHoldToken(token);
    expect(payload.userId).toBe("u-1");
    expect(payload.wholesaleCents).toBe(100);
    expect(payload.retailCents).toBe(131);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it("rejects a token with a tampered payload", () => {
    const token = signHoldToken({ ...fixture(), retailCents: 100 });
    const [body, sig] = token.split(".");

    // Forge a new payload with a different price but keep the original signature.
    const tampered = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
        retailCents: 1,
      }),
    ).toString("base64url");

    expect(() => verifyHoldToken(`${tampered}.${sig}`)).toThrow(HoldTokenError);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signHoldToken(fixture());
    process.env.HOLD_TOKEN_SECRET = "a-completely-different-test-secret-value";
    expect(() => verifyHoldToken(token)).toThrow(HoldTokenError);
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const token = signHoldToken(fixture(), 30);

    vi.setSystemTime(new Date("2030-01-01T00:01:00Z")); // 60s later
    expect(() => verifyHoldToken(token)).toThrow(/expired/i);
  });

  it("rejects a token with no dot separator", () => {
    expect(() => verifyHoldToken("not-a-token")).toThrow(/malformed/i);
  });

  it("rejects a token with a signature of the wrong length", () => {
    const token = signHoldToken(fixture());
    const [body] = token.split(".");
    expect(() => verifyHoldToken(`${body}.ZZZ`)).toThrow(HoldTokenError);
  });
});
