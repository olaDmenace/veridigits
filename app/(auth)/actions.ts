"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/utils/app-url";
import { EMAIL_RE, validateCredentials, validateSignup } from "./validation";

export interface AuthFormState {
  ok: boolean;
  error?: string;
  email?: string;
  /** Echoed back so the form can repopulate after a validation error. */
  displayName?: string;
  username?: string;
  referralCode?: string;
  /** Set on signup when Supabase requires email confirmation. */
  needsConfirmation?: boolean;
}

export async function signUp(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const { email, password, displayName, username, referralCode, error } =
    validateSignup(formData);

  const echo = {
    email,
    displayName,
    username,
    referralCode,
  };

  if (error) {
    return { ok: false, error, ...echo };
  }

  // Post-auth destination from the hero deep link (e.g. /buy?country=…&service=…).
  // Only honor same-origin relative paths to avoid an open-redirect.
  const nextRaw = String(formData.get("next") ?? "");
  const next = nextRaw.startsWith("/") ? nextRaw : "/dashboard";

  const supabase = await createClient();
  const origin = getAppUrl();

  // Friendly pre-check for username collisions. The DB unique index is the
  // real guarantee; this just avoids a cryptic Postgres error in the common case.
  const { data: available } = await supabase.rpc("username_available", {
    candidate: username,
  });
  if (available === false) {
    return { ok: false, error: "That username is taken.", ...echo };
  }

  const { data, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      // Read by the handle_new_user() trigger to populate the profile row.
      data: {
        display_name: displayName || null,
        username,
        referral_code: referralCode || null,
      },
    },
  });

  if (signUpError) {
    return { ok: false, error: signUpError.message, ...echo };
  }

  // If the project requires email confirmation, Supabase returns a user with
  // no session. Show a "check your email" state instead of redirecting.
  if (!data.session) {
    return { ok: true, needsConfirmation: true, ...echo };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function logIn(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const { email, password, error: validationError } =
    validateCredentials(formData);
  if (validationError) {
    return { ok: false, error: validationError, email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return {
      ok: false,
      error:
        error.message === "Invalid login credentials"
          ? "Email or password is incorrect."
          : error.message,
      email,
    };
  }

  const redirectTo = String(formData.get("redirect") ?? "/dashboard");
  revalidatePath("/", "layout");
  redirect(redirectTo.startsWith("/") ? redirectTo : "/dashboard");
}

export async function logOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Don't revalidatePath here — in Next 16 + React 19, a layout-wide
  // revalidate combined with a redirect inside the same action can race
  // when the form is fired from a portal-rendered drawer. The redirect
  // to / naturally re-fetches the marketing page; protected routes
  // re-check via middleware on the next request.
  redirect("/");
}

export interface ResetFormState {
  ok: boolean;
  email?: string;
  error?: string;
  sent?: boolean;
}

export async function requestPasswordReset(
  _prev: ResetFormState | undefined,
  formData: FormData,
): Promise<ResetFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address.", email };
  }

  const supabase = await createClient();
  const origin = getAppUrl();

  // Always return success — we don't leak whether an email exists.
  // (Supabase also doesn't leak this; the underlying call is idempotent.)
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });

  if (error) {
    return { ok: false, error: error.message, email };
  }
  return { ok: true, sent: true, email };
}

export async function updatePassword(
  _prev: ResetFormState | undefined,
  formData: FormData,
): Promise<ResetFormState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    return {
      ok: false,
      error: "Password must be at least 8 characters.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
