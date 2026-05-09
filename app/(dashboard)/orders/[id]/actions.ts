"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/providers";
import { refundOrder } from "@/lib/wallet/refund";

export type CancelResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

const CANCEL_WINDOW_MS = 2 * 60 * 1000; // 5SIM allows cancel within 2 minutes

/**
 * Cancels an active order and refunds the user. Only allowed when:
 *   - the order is owned by the calling user
 *   - status is 'pending' or 'active'
 *   - no SMS has been received yet
 *   - the order is younger than the cancel window
 */
export async function cancelOrderAction(orderId: string): Promise<CancelResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthorized", message: "not signed in" };

  // Read the order via the user's RLS-scoped client first — confirms ownership.
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, user_id, status, provider_slug, upstream_order_id, retail_charged_cents, created_at",
    )
    .eq("id", orderId)
    .single();

  if (!order || order.user_id !== user.id) {
    return { ok: false, code: "not_found", message: "order not found" };
  }
  if (order.status !== "pending" && order.status !== "active") {
    return {
      ok: false,
      code: "wrong_status",
      message: `Cannot cancel an order with status ${order.status}.`,
    };
  }

  const ageMs = Date.now() - new Date(order.created_at).getTime();
  if (ageMs > CANCEL_WINDOW_MS) {
    return {
      ok: false,
      code: "window_passed",
      message: "Cancel window has passed (2 minutes).",
    };
  }

  // Has any SMS arrived? Use admin to bypass RLS read for received_messages count.
  const admin = getAdminClient();
  const { count: smsCount } = await admin
    .from("received_messages")
    .select("*", { count: "exact", head: true })
    .eq("order_id", orderId);

  if ((smsCount ?? 0) > 0) {
    return {
      ok: false,
      code: "already_received",
      message: "SMS already received — can't cancel.",
    };
  }

  // Fire upstream cancel.
  try {
    await getProvider(order.provider_slug).cancelOrder(order.upstream_order_id);
  } catch (err) {
    return {
      ok: false,
      code: "upstream_error",
      message: err instanceof Error ? err.message : "upstream cancel failed",
    };
  }

  // Mark cancelled and refund.
  const { error: updateErr } = await admin
    .from("orders")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", orderId);

  if (updateErr) {
    return {
      ok: false,
      code: "internal",
      message: `couldn't mark cancelled: ${updateErr.message}`,
    };
  }

  try {
    await refundOrder({
      userId: user.id,
      amountCents: order.retail_charged_cents,
      orderId,
      note: `cancelled by user · ${order.provider_slug}:${order.upstream_order_id}`,
    });
  } catch (err) {
    // Order is cancelled but refund didn't post — surface so the user knows.
    // The wallet-reconciliation job will catch it.
    return {
      ok: false,
      code: "refund_pending",
      message:
        err instanceof Error
          ? `cancelled but refund failed: ${err.message}`
          : "cancelled but refund failed",
    };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return { ok: true };
}
