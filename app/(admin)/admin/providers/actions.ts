"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

export type SyncTriggerResult =
  | { ok: true }
  | { ok: false; error: string };

export async function triggerCatalogSync(
  providerSlug?: string,
): Promise<SyncTriggerResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) return { ok: false, error: "not authorized" };

  try {
    await inngest.send({
      name: "app/provider.sync.requested",
      data: providerSlug ? { providerSlug } : {},
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "inngest send failed",
    };
  }

  revalidatePath("/admin/providers");
  return { ok: true };
}
