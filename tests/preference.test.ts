import { describe, expect, it } from "vitest";
import {
  DISABLED_PROVIDERS,
  PREFERRED_RANK,
  STRICT_SCREENING_SERVICES,
  UK_COUNTRY_ISO,
  isProviderRoutable,
  preferenceRankFor,
} from "@/lib/providers/preference";

describe("preferenceRankFor", () => {
  it("makes TextVerified primary for strict-screening services (any/US)", () => {
    for (const slug of ["whatsapp", "apple", "tinder", "instagram", "paypal"]) {
      expect(preferenceRankFor("textverified", slug, "usa")).toBe(
        PREFERRED_RANK,
      );
    }
  });

  it("gives TextVerified no preference for non-strict services", () => {
    expect(preferenceRankFor("textverified", "someobscureservice", "usa")).toBe(
      0,
    );
  });

  it("makes SMSPool primary for strict services in the UK only", () => {
    expect(preferenceRankFor("smspool", "whatsapp", UK_COUNTRY_ISO)).toBe(
      PREFERRED_RANK,
    );
    // not in the US (TextVerified is primary there)
    expect(preferenceRankFor("smspool", "whatsapp", "usa")).toBe(0);
    // not for non-strict services
    expect(preferenceRankFor("smspool", "someobscureservice", UK_COUNTRY_ISO)).toBe(
      0,
    );
  });

  it("never elevates 5SIM", () => {
    expect(preferenceRankFor("5sim", "whatsapp", "usa")).toBe(0);
    expect(preferenceRankFor("5sim", "whatsapp", UK_COUNTRY_ISO)).toBe(0);
  });

  it("includes the headline hard-to-verify services in the set", () => {
    for (const slug of ["whatsapp", "google", "apple", "tinder"]) {
      expect(STRICT_SCREENING_SERVICES.has(slug)).toBe(true);
    }
  });
});

describe("isProviderRoutable", () => {
  it("always routes 5SIM (never gated)", () => {
    expect(DISABLED_PROVIDERS.has("5sim")).toBe(false);
    expect(isProviderRoutable("5sim")).toBe(true);
  });

  it("is exactly the inverse of DISABLED_PROVIDERS membership", () => {
    for (const p of ["5sim", "textverified", "smspool", "anything"]) {
      expect(isProviderRoutable(p)).toBe(!DISABLED_PROVIDERS.has(p));
    }
  });
});
