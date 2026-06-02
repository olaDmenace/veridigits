"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/providers";
import { canCancelOrder } from "@/lib/orders/cancel-eligibility";

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
