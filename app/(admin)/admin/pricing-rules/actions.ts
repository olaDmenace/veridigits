"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

export type RuleResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

async function requireAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  return !!profile?.is_admin;
}

interface RuleInput {
  service_id: string | null;
  country_id: string | null;
  markup_percent: number;
  flat_fee_cents: number;
  min_retail_cents: number;
  priority: number;
  is_active: boolean;
}

function parseRule(formData: FormData): RuleInput | { error: string } {
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const countryId = String(formData.get("country_id") ?? "").trim();
  const markup = Number(formData.get("markup_percent"));
  const flat = Number(formData.get("flat_fee_cents"));
  const min = Number(formData.get("min_retail_cents"));
  const priority = Number(formData.get("priority"));
  const isActive = formData.get("is_active") === "on";

  if (!Number.isFinite(markup) || markup < 0 || markup > 999.99) {
    return { error: "Markup percent must be between 0 and 999.99." };
  }
  if (!Number.isInteger(flat) || flat < 0 || flat > 10_000) {
    return { error: "Flat fee must be 0–10000 cents." };
  }
  if (!Number.isInteger(min) || min < 0 || min > 100_000) {
    return { error: "Minimum retail must be 0–100000 cents." };
  }
  if (!Number.isInteger(priority) || priority < 0 || priority > 1_000_000) {
    return { error: "Priority must be a non-negative integer." };
  }

  return {
    service_id: serviceId || null,
    country_id: countryId || null,
    markup_percent: Math.round(markup * 100) / 100, // numeric(5,2)
    flat_fee_cents: flat,
    min_retail_cents: min,
    priority,
    is_active: isActive,
  };
}

export async function createRule(formData: FormData): Promise<RuleResult> {
  if (!(await requireAdmin())) return { ok: false, error: "not authorized" };
  const parsed = parseRule(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const { error } = await getAdminClient()
    .from("pricing_rules")
    .insert(parsed);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/pricing-rules");
  return { ok: true, message: "Rule created." };
}

export async function updateRule(
  ruleId: string,
  formData: FormData,
): Promise<RuleResult> {
  if (!(await requireAdmin())) return { ok: false, error: "not authorized" };
  const parsed = parseRule(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const { error } = await getAdminClient()
    .from("pricing_rules")
    .update(parsed)
    .eq("id", ruleId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/pricing-rules");
  return { ok: true, message: "Rule updated." };
}

export async function toggleRuleActive(
  ruleId: string,
  active: boolean,
): Promise<RuleResult> {
  if (!(await requireAdmin())) return { ok: false, error: "not authorized" };
  const { error } = await getAdminClient()
    .from("pricing_rules")
    .update({ is_active: active })
    .eq("id", ruleId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/pricing-rules");
  return { ok: true };
}

export async function deleteRule(ruleId: string): Promise<RuleResult> {
  if (!(await requireAdmin())) return { ok: false, error: "not authorized" };

  // Refuse to delete the global default — it must always exist for the
  // pricing engine to have a fallback.
  const admin = getAdminClient();
  const { data: row } = await admin
    .from("pricing_rules")
    .select("service_id, country_id")
    .eq("id", ruleId)
    .single();

  if (row && row.service_id === null && row.country_id === null) {
    return {
      ok: false,
      error: "Can't delete the global default. Edit it instead.",
    };
  }

  const { error } = await admin.from("pricing_rules").delete().eq("id", ruleId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/pricing-rules");
  return { ok: true, message: "Rule deleted." };
}
