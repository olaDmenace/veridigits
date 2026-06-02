import { inngest } from "./client";
import { getProvider } from "@/lib/providers";
import { getAdminClient } from "@/lib/supabase/admin";

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
        "id, user_id, provider_slug, upstream_order_id, status",
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
    // SMS arrived (poll should have captured the charge already) — finalize.
    await supabase
      .from("orders")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", order.id);
    return;
  }

  // No SMS — defer-debit means nothing was charged, so there is nothing to
  // refund. Cancel upstream to recover our wholesale cost, then mark expired.
  try {
    await getProvider(order.provider_slug).cancelOrder(order.upstream_order_id);
  } catch {
    // Non-fatal: the reconciliation job catches a stuck upstream cancel.
  }

  await supabase
    .from("orders")
    .update({ status: "expired", cancelled_at: new Date().toISOString() })
    .eq("id", order.id)
    .in("status", ["pending", "active"]);
}
