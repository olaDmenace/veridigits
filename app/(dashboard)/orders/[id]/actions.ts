"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/providers";
import { canCancelOrder } from "@/lib/orders/cancel-eligibility";
import {
  decideReroll,
  REROLL_MAX_PER_WINDOW,
  REROLL_WINDOW_MS,
} from "@/lib/orders/reroll";
import { getQuote, purchase } from "@/app/(dashboard)/buy/actions";
import type { OrderMode } from "@/lib/providers/types";

export type CancelResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * Cancels an active order. Only allowed when:
 *   - the order is owned by the calling user
 *   - status is 'pending' or 'active'
 *   - no SMS has been received yet
 *   - the order is past the minimum cancel age (2-minute 5SIM floor)
 *   - the order has not yet expired
 */
export async function cancelOrderAction(orderId: string): Promise<CancelResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthorized", message: "not signed in" };

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, user_id, status, provider_slug, upstream_order_id, created_at, expires_at",
    )
    .eq("id", orderId)
    .single();

  if (!order || order.user_id !== user.id) {
    return { ok: false, code: "not_found", message: "order not found" };
  }

  // Has any SMS arrived? (admin client bypasses RLS for the count)
  const admin = getAdminClient();
  const { count: smsCount } = await admin
    .from("received_messages")
    .select("*", { count: "exact", head: true })
    .eq("order_id", orderId);

  const eligibility = canCancelOrder({
    status: order.status,
    createdAtMs: new Date(order.created_at).getTime(),
    expiresAtMs: new Date(order.expires_at).getTime(),
    hasSms: (smsCount ?? 0) > 0,
    nowMs: Date.now(),
  });
  if (!eligibility.ok) {
    return { ok: false, code: eligibility.reason, message: eligibility.message };
  }

  // Fire upstream cancel (allowed now that we're past the 2-minute floor).
  try {
    await getProvider(order.provider_slug).cancelOrder(order.upstream_order_id);
  } catch (err) {
    return {
      ok: false,
      code: "upstream_error",
      message: err instanceof Error ? err.message : "upstream cancel failed",
    };
  }

  // Mark cancelled. Defer-debit: nothing was charged, so there is no refund.
  const { error: updateErr } = await admin
    .from("orders")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", orderId)
    .in("status", ["pending", "active"]);

  if (updateErr) {
    return {
      ok: false,
      code: "internal",
      message: `couldn't mark cancelled: ${updateErr.message}`,
    };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return { ok: true };
}

export type RerollResult =
  | { ok: true; orderId: string }
  | { ok: false; code: string; message: string };

/**
 * "Try another number (free)" — buys a fresh number for the SAME service /
 * country / mode as a previous order that didn't deliver. Frees the old number
 * first if it's still cancelable. Defer-debit means no charge for the miss; the
 * new order only charges if it actually receives a code. Reuses the exact
 * getQuote + purchase money path so pricing / re-quote / balance checks all
 * still apply.
 */
export async function rerollOrder(prevOrderId: string): Promise<RerollResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthorized", message: "not signed in" };

  const { data: prev } = await supabase
    .from("orders")
    .select(
      "id, user_id, service_id, country_id, mode, status, provider_slug, upstream_order_id, created_at, expires_at",
    )
    .eq("id", prevOrderId)
    .single();

  if (!prev || prev.user_id !== user.id) {
    return { ok: false, code: "not_found", message: "order not found" };
  }
  if (!prev.service_id || !prev.country_id) {
    return { ok: false, code: "internal", message: "order missing service/country" };
  }

  const admin = getAdminClient();

  // Did the previous number already receive a code? Never re-roll a win.
  const { count: smsCount } = await admin
    .from("received_messages")
    .select("*", { count: "exact", head: true })
    .eq("order_id", prevOrderId);

  // Runaway guard: how many orders for this user+service+country recently.
  const since = new Date(Date.now() - REROLL_WINDOW_MS).toISOString();
  const { count: recentCount } = await admin
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("service_id", prev.service_id)
    .eq("country_id", prev.country_id)
    .gte("created_at", since);

  const cancelEligible = canCancelOrder({
    status: prev.status,
    createdAtMs: new Date(prev.created_at).getTime(),
    expiresAtMs: new Date(prev.expires_at).getTime(),
    hasSms: (smsCount ?? 0) > 0,
    nowMs: Date.now(),
  }).ok;

  const decision = decideReroll({
    hasSms: (smsCount ?? 0) > 0,
    recentCount: recentCount ?? 0,
    maxPerWindow: REROLL_MAX_PER_WINDOW,
    cancelEligible,
    status: prev.status,
  });

  if (decision.action === "refuse") {
    const messages: Record<string, string> = {
      already_received: "This number already received a code.",
      too_many: "Too many tries in a short window. Give it a few minutes.",
      too_early: "Hold on a moment before trying another number.",
    };
    return { ok: false, code: decision.code, message: messages[decision.code] };
  }

  // Free the still-live number so we recover the wholesale (5SIM refunds a
  // cancel) before grabbing a new one.
  if (decision.action === "cancel_then_buy") {
    try {
      await getProvider(prev.provider_slug).cancelOrder(prev.upstream_order_id);
    } catch {
      /* reconciliation/expiry handles a stuck upstream cancel */
    }
    await admin
      .from("orders")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", prevOrderId)
      .in("status", ["pending", "active"]);
  }

  // Re-quote + buy a fresh number on the same service/country/mode. This is the
  // identical, tested money path — including the live re-quote and balance check.
  const mode = (prev.mode as OrderMode) ?? "activation";
  const quote = await getQuote(prev.service_id, prev.country_id, mode);
  if (!quote.ok) return { ok: false, code: quote.code, message: quote.message };

  const bought = await purchase(quote.holdToken);
  if (!bought.ok) return { ok: false, code: bought.code, message: bought.message };

  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return { ok: true, orderId: bought.orderId };
}
