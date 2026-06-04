import { describe, it, expect } from "vitest";
import { extractCode } from "@/lib/inngest/poll-orders";

describe("extractCode", () => {
  it("extracts a code mashed against text with no spaces (real WhatsApp)", () => {
    // The exact shape that returned null in production.
    expect(extractCode("YourWhatsAppcode:778467Don'tsharethiscodewithothers")).toBe(
      "778467",
    );
  });

  it("extracts the WhatsApp Business variant", () => {
    expect(
      extractCode("YourWhatsAppBusinesscode836997Don'tsharethiscodewithothers"),
    ).toBe("836997");
  });

  it("handles spaced 'code: 123456'", () => {
    expect(extractCode("Your code: 123456")).toBe("123456");
  });

  it("handles Google's G- prefix", () => {
    expect(extractCode("G-928451 is your Google verification code")).toBe(
      "928451",
    );
  });

  it("handles the dashed 3-3 format", () => {
    expect(extractCode("Your code is 847-291. Don't share.")).toBe("847-291");
  });

  it("does not pull a fragment out of a longer number (e.g. a phone number)", () => {
    expect(extractCode("Sent from 17788001707")).toBeNull();
  });

  it("returns null when there's no code", () => {
    expect(extractCode("Welcome to the service!")).toBeNull();
  });
});
