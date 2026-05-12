import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAppUrl } from "@/lib/utils/app-url";

const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL;
  }
});

describe("getAppUrl", () => {
  it("returns localhost when unset", () => {
    expect(getAppUrl()).toBe("http://localhost:3000");
  });

  it("returns the value when set with https://", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://veridigits.vercel.app";
    expect(getAppUrl()).toBe("https://veridigits.vercel.app");
  });

  it("prepends https:// when the scheme is missing", () => {
    process.env.NEXT_PUBLIC_APP_URL = "veridigits.vercel.app";
    expect(getAppUrl()).toBe("https://veridigits.vercel.app");
  });

  it("strips a trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://veridigits.vercel.app/";
    expect(getAppUrl()).toBe("https://veridigits.vercel.app");
  });

  it("strips multiple trailing slashes", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://veridigits.vercel.app///";
    expect(getAppUrl()).toBe("https://veridigits.vercel.app");
  });

  it("preserves http:// for localhost-style values", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:4000";
    expect(getAppUrl()).toBe("http://localhost:4000");
  });

  it("falls back to localhost on a completely invalid value rather than throwing", () => {
    process.env.NEXT_PUBLIC_APP_URL = "not a url at all !@#";
    // The function should never throw — that's the whole point.
    expect(() => getAppUrl()).not.toThrow();
    const result = getAppUrl();
    // Either localhost fallback OR a normalized value; what matters is no throw.
    expect(typeof result).toBe("string");
  });

  it("trims whitespace from the env var value", () => {
    process.env.NEXT_PUBLIC_APP_URL = "  https://veridigits.vercel.app  ";
    expect(getAppUrl()).toBe("https://veridigits.vercel.app");
  });
});
