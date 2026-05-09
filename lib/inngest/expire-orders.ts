import { inngest } from "./client";
import { getProvider } from "@/lib/providers";
import { getAdminClient } from "@/lib/supabase/admin";
import { refundOrder } from "@/lib/wallet/refund";

/**
 * Sweeps for orders that passed expires_at while still in pending/active.
 *   - If no SMS was received: cancel upstream + refund the user.
 *   - If SMS was received but the order wasn't finished: mark completed.
 *
 * Runs every minute as a backstop for the per-order poll function.
 */
export const expireOrdersFn = inngest.createFunction(
  {
    id: "expire-orders",
    triggers: [{ cron: "* * * * *" }],
  },
  async ({ step, logger }) => {
    const supabase = getAdminClient();
    const nowIso = new Date().toISOString();

    const { data: orders } = await supabase
      .from("orders")
      .select(
        "id, user_id, provider_slug, upstream_order_id, retail_charged_cents, status",
      )
      .lt("expires_at", nowIso)
      .in("status", ["pending", "active"]);

    if (!orders || orders.length === 0) {
      return { processed: 0 };
    }

    let errored = 0;

    for (const order of orders) {
      try {
        await step.run(`expire-${order.id}`, () => processExpired(order));
      } catch {
        errored++;
      }
    }

    logger.info("expire-orders sweep complete", {
      processed: orders.length,
      errored,
    });
    return { processed: orders.length, errored };
  },
);

interface ExpiringOrder {
  id: string;
  user_id: string;
  provider_slug: string;
  upstream_order_id: string;
  retail_charged_cents: number;
  status: string;
}

async function processExpired(order: ExpiringOrder): Promise<void> {
  const supabase = getAdminClient();

  // Did any SMS arrive?
  const { count } = await supabase
    .from("received_messages")
    .select("*", { count: "exact", head: true })
    .eq("order_id", order.id);

  if ((count ?? 0) > 0) {
    // SMS received but order wasn't marked completed — flip to completed.
    await supabase
      .from("orders")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", order.id);
    return;
  }

  // No SMS — cancel upstream + refund.
  try {
    await getProvider(order.provider_slug).cancelOrder(order.upstream_order_id);
  } catch {
    // Upstream cancel failure is non-fatal: still mark and refund. The
    // wholesale cost may stay committed at upstream — reconciliation job
    // catches mismatches.
  }

  await supabase
    .from("orders")
    .update({ status: "expired", cancelled_at: new Date().toISOString() })
    .eq("id", order.id);

  await refundOrder({
    userId: order.user_id,
    amountCents: order.retail_charged_cents,
    orderId: order.id,
    note: "expired without SMS",
  });
}
