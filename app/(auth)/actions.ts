"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthFormState {
  ok: boolean;
  error?: string;
  email?: string;
  /** Set on signup when Supabase requires email confirmation. */
  needsConfirmation?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials(formData: FormData): {
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

export async function signUp(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const { email, password, error: validationError } =
    validateCredentials(formData);
  if (validationError) {
    return { ok: false, error: validationError, email };
  }

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, error: error.message, email };
  }

  // If the project requires email confirmation, Supabase returns a user with
  // no session. Show a "check your email" state instead of redirecting.
  if (!data.session) {
    return { ok: true, email, needsConfirmation: true };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
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
  revalidatePath("/", "layout");
  redirect("/");
}
