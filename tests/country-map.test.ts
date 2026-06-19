import { describe, expect, it } from "vitest";
import {
  canonicalCountryIso,
  normCountry,
  flagEmoji,
  flagForCanonicalIso,
  ISO2_TO_FIVESIM_SLUG,
} from "@/lib/providers/country-map";

describe("canonicalCountryIso", () => {
  it("maps the 5SIM name-slug quirks via ISO-2, not by name", () => {
    // 5SIM uses idiosyncratic slugs; SMSPool names would never match by string.
    expect(canonicalCountryIso("US", "United States")).toBe("usa");
    expect(canonicalCountryIso("GB", "United Kingdom")).toBe("england");
    expect(canonicalCountryIso("BT", "Bhutan")).toBe("bhutane");
    expect(canonicalCountryIso("CZ", "Czechia")).toBe("czech");
    expect(canonicalCountryIso("BA", "Bosnia and Herzegovina")).toBe("bih");
  });

  it("pins FR to mainland france, never the frenchguiana collision", () => {
    expect(canonicalCountryIso("FR", "France")).toBe("france");
    expect(ISO2_TO_FIVESIM_SLUG.FR).toBe("france");
  });

  it("is case-insensitive on the alpha-2 code", () => {
    expect(canonicalCountryIso("ch", "Switzerland")).toBe("switzerland");
    expect(canonicalCountryIso("Ca", "Canada")).toBe("canada");
  });

  it("falls back to a normalized name-slug for SMSPool-exclusive countries", () => {
    // 5SIM carries none of these — they become brand-new canonical countries.
    expect(canonicalCountryIso("CH", "Switzerland")).toBe("switzerland");
    expect(canonicalCountryIso("TR", "Turkey")).toBe("turkey");
    expect(canonicalCountryIso("SG", "Singapore")).toBe("singapore");
    expect(canonicalCountryIso("AX", "Aland Islands")).toBe("alandislands");
  });

  it("does not collide a fallback with a different existing 5SIM slug", () => {
    // SMSPool Dominica (DM) must NOT become 5SIM's dominicana (Dominican Rep, DO).
    expect(canonicalCountryIso("DM", "Dominica")).toBe("dominica");
    expect(canonicalCountryIso("DO", "Dominican Republic")).toBe("dominicana");
  });

  it("returns null when there is nothing usable to key on", () => {
    expect(canonicalCountryIso("", "")).toBeNull();
    expect(canonicalCountryIso(null, "!!!")).toBeNull();
  });
});

describe("normCountry", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normCountry("United States")).toBe("unitedstates");
    expect(normCountry("Côte d'Ivoire")).toBe("ctedivoire");
    expect(normCountry("")).toBe("");
  });
});

describe("flagEmoji", () => {
  it("builds the flag from an ISO-2 code", () => {
    expect(flagEmoji("CH")).toBe("🇨🇭");
    expect(flagEmoji("us")).toBe("🇺🇸"); // case-insensitive
    expect(flagEmoji("GB")).toBe("🇬🇧");
  });

  it("returns null for anything that isn't a 2-letter code", () => {
    expect(flagEmoji("USA")).toBeNull();
    expect(flagEmoji("U")).toBeNull();
    expect(flagEmoji("U1")).toBeNull();
    expect(flagEmoji("")).toBeNull();
    expect(flagEmoji(null)).toBeNull();
  });
});

describe("flagForCanonicalIso", () => {
  it("resolves a 5SIM canonical slug back to its flag via the bridge", () => {
    expect(flagForCanonicalIso("usa")).toBe("🇺🇸");
    expect(flagForCanonicalIso("england")).toBe("🇬🇧");
    expect(flagForCanonicalIso("bhutane")).toBe("🇧🇹"); // name-slug quirk
    expect(flagForCanonicalIso("france")).toBe("🇫🇷");
  });

  it("returns null for slugs not in the bridge (SMSPool-exclusive name-slugs)", () => {
    // These carry their flag on the catalog entry instead (from the provider's ISO-2).
    expect(flagForCanonicalIso("switzerland")).toBeNull();
    expect(flagForCanonicalIso("turkey")).toBeNull();
    expect(flagForCanonicalIso("")).toBeNull();
  });
});
