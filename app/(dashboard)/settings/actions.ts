"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

export interface SettingsFormState {
  ok: boolean;
  message?: string;
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function changePassword(
  _prev: SettingsFormState | undefined,
  formData: FormData,
): Promise<SettingsFormState> {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");

  if (newPassword.length < 8) {
    return {
      ok: false,
      error: "New password must be at least 8 characters.",
    };
  }
  if (newPassword === currentPassword) {
    return {
      ok: false,
      error: "New password must be different from the current one.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return { ok: false, error: "Not signed in." };
  }

  // Re-authenticate: verify the current password before allowing change.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    return { ok: false, error: "Current password is incorrect." };
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true, message: "Password updated." };
}

export async function changeEmail(
  _prev: SettingsFormState | undefined,
  formData: FormData,
): Promise<SettingsFormState> {
  const newEmail = String(formData.get("newEmail") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!EMAIL_RE.test(newEmail)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return { ok: false, error: "Not signed in." };
  }
  if (newEmail === user.email.toLowerCase()) {
    return {
      ok: false,
      error: "That's already your email.",
    };
  }

  // Re-auth to make sure it's the actual user driving this.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (reauthError) {
    return { ok: false, error: "Password is incorrect." };
  }

  const { error: updateError } = await supabase.auth.updateUser({
    email: newEmail,
  });
  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return {
    ok: true,
    message: `Check ${newEmail} for a confirmation link. Your old address stays active until you click it.`,
  };
}

export async function deleteAccount(
  _prev: SettingsFormState | undefined,
  formData: FormData,
): Promise<SettingsFormState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (confirm !== "DELETE") {
    return {
      ok: false,
      error: 'Type "DELETE" exactly to confirm.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return { ok: false, error: "Not signed in." };
  }

  // Re-auth required.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (reauthError) {
    return { ok: false, error: "Password is incorrect." };
  }

  // Sanity guard: refuse to delete if there's a non-zero balance. User has
  // to drain it explicitly (top up to refund via support, or burn it on
  // orders) — this prevents accidental forfeiture.
  const { data: profile } = await supabase
    .from("profiles")
    .select("wallet_balance_cents")
    .eq("id", user.id)
    .single();

  if ((profile?.wallet_balance_cents ?? 0) > 0) {
    return {
      ok: false,
      error: `You still have $${((profile?.wallet_balance_cents ?? 0) / 100).toFixed(2)} in your wallet. Spend or withdraw it before deleting.`,
    };
  }

  // Service-role: cascade through profiles → orders → wallet_transactions etc.
  // The auth.users foreign keys are ON DELETE CASCADE in the migration so
  // deleting the auth user removes the rest atomically.
  const admin = getAdminClient();
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return { ok: false, error: deleteError.message };
  }

  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
