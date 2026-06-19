import { describe, expect, it } from "vitest";
import {
  canonicalCountryIso,
  normCountry,
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
