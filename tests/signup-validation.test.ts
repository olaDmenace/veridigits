import { describe, it, expect } from "vitest";
import { validateSignup } from "@/app/(auth)/validation";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const valid = {
  email: "user@example.com",
  username: "nightowl_42",
  display_name: "Night Owl",
  password: "supersecret",
  confirm_password: "supersecret",
  referral_code: "FRIEND10",
};

describe("validateSignup", () => {
  it("accepts a fully valid form and normalizes fields", () => {
    const r = validateSignup(fd(valid));
    expect(r.error).toBeUndefined();
    expect(r.email).toBe("user@example.com");
    expect(r.username).toBe("nightowl_42");
    expect(r.displayName).toBe("Night Owl");
    expect(r.referralCode).toBe("FRIEND10");
  });

  it("rejects a bad email", () => {
    const r = validateSignup(fd({ ...valid, email: "nope" }));
    expect(r.error).toMatch(/valid email/i);
  });

  it("rejects a short password", () => {
    const r = validateSignup(fd({ ...valid, password: "short", confirm_password: "short" }));
    expect(r.error).toMatch(/8 characters/i);
  });

  it("rejects when password and confirmation differ", () => {
    const r = validateSignup(fd({ ...valid, confirm_password: "different1" }));
    expect(r.error).toMatch(/do not match/i);
  });

  it("rejects a username that is too short", () => {
    const r = validateSignup(fd({ ...valid, username: "ab" }));
    expect(r.error).toMatch(/username/i);
  });

  it("rejects a username that does not start with a letter", () => {
    const r = validateSignup(fd({ ...valid, username: "1cool" }));
    expect(r.error).toMatch(/username/i);
  });

  it("rejects a username with illegal characters", () => {
    const r = validateSignup(fd({ ...valid, username: "bad-name!" }));
    expect(r.error).toMatch(/username/i);
  });

  it("accepts a missing (empty) display name and referral code", () => {
    const r = validateSignup(
      fd({ ...valid, display_name: "", referral_code: "" }),
    );
    expect(r.error).toBeUndefined();
    expect(r.displayName).toBe("");
    expect(r.referralCode).toBe("");
  });

  it("rejects an over-long display name", () => {
    const r = validateSignup(fd({ ...valid, display_name: "x".repeat(61) }));
    expect(r.error).toMatch(/display name/i);
  });

  it("checks password match before username validity (match is the first structural gate)", () => {
    const r = validateSignup(
      fd({ ...valid, username: "ab", confirm_password: "different1" }),
    );
    expect(r.error).toMatch(/do not match/i);
  });
});
