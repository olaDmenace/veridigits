"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { applyWalletTransaction } from "@/lib/wallet/apply";

export type AdminActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

async function requireAdmin(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  return profile?.is_admin ? { id: user.id } : null;
}

export async function setUserBanned(
  userId: string,
  banned: boolean,
): Promise<AdminActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "not authorized" };

  const { error } = await getAdminClient()
    .from("profiles")
    .update({ is_banned: banned })
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/users");
  return { ok: true, message: banned ? "User banned." : "Ban lifted." };
}

export async function adjustUserBalance(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "not authorized" };

  const userId = String(formData.get("userId") ?? "");
  const amountUsd = Number(formData.get("amountUsd") ?? 0);
  const note = String(formData.get("note") ?? "").trim();

  if (!userId) return { ok: false, error: "missing userId" };
  if (!Number.isFinite(amountUsd) || amountUsd === 0) {
    return { ok: false, error: "amount must be non-zero" };
  }
  if (Math.abs(amountUsd) > 10_000) {
    return { ok: false, error: "single adjustment capped at $10,000" };
  }

  const amountCents = Math.round(amountUsd * 100);

  try {
    await applyWalletTransaction({
      userId,
      amountCents,
      type: "adjustment",
      referenceType: "manual",
      note: note || `admin adjustment by ${admin.id}`,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "adjustment failed",
    };
  }

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: `Adjusted balance by $${amountUsd.toFixed(2)}.`,
  };
}
