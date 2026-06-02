// Pure auth-form validation. Kept out of actions.ts because that file is
// "use server" — every export there must be an async server action, so these
// synchronous helpers (and the test that imports them) live here instead.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 3–20 chars, letters/digits/underscore, must start with a letter.
export const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

export function validateCredentials(formData: FormData): {
  email: string;
  password: string;
  error?: string;
} {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!EMAIL_RE.test(email)) {
    return { email, password, error: "Enter a valid email address." };
  }
  if (password.length < 8) {
    return { email, password, error: "Password must be at least 8 characters." };
  }
  return { email, password };
}

export interface SignupFields {
  email: string;
  password: string;
  displayName: string;
  username: string;
  referralCode: string;
  error?: string;
}

/**
 * Pure signup validation — no I/O, so it's unit-testable. Username uniqueness
 * is NOT checked here (that needs a DB round-trip); see the `signUp` action.
 */
export function validateSignup(formData: FormData): SignupFields {
  const { email, password, error: credError } = validateCredentials(formData);
  const displayName = String(formData.get("display_name") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const confirmPassword = String(formData.get("confirm_password") ?? "");
  const referralCode = String(formData.get("referral_code") ?? "").trim();

  const fields = { email, password, displayName, username, referralCode };

  if (credError) {
    return { ...fields, error: credError };
  }
  if (password !== confirmPassword) {
    return { ...fields, error: "Passwords do not match." };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      ...fields,
      error:
        "Username must be 3–20 characters: letters, digits or underscores, starting with a letter.",
    };
  }
  if (displayName.length > 60) {
    return { ...fields, error: "Display name must be 60 characters or fewer." };
  }
  return fields;
}
