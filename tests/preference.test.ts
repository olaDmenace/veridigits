import { describe, expect, it } from "vitest";
import {
  PREFERRED_RANK,
  STRICT_SCREENING_SERVICES,
  preferenceRankFor,
} from "@/lib/providers/preference";

describe("preferenceRankFor", () => {
  it("makes TextVerified primary for strict-screening services", () => {
    for (const slug of ["whatsapp", "apple", "tinder", "instagram", "paypal"]) {
      expect(preferenceRankFor("textverified", slug)).toBe(PREFERRED_RANK);
    }
  });

  it("gives TextVerified no preference for non-strict services", () => {
    expect(preferenceRankFor("textverified", "someobscureservice")).toBe(0);
  });

  it("never elevates other providers, even for strict services", () => {
    expect(preferenceRankFor("5sim", "whatsapp")).toBe(0);
    expect(preferenceRankFor("smspool", "apple")).toBe(0);
  });

  it("includes the headline hard-to-verify services in the set", () => {
    for (const slug of ["whatsapp", "google", "apple", "tinder"]) {
      expect(STRICT_SCREENING_SERVICES.has(slug)).toBe(true);
    }
  });
});
