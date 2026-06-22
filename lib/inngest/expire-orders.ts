import { inngest } from "./client";
import { getProvider } from "@/lib/providers";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Sweeps for orders that passed expires_at while still in pending/active.
 *   - If no SMS was received: cancel upstream + mark expired (defer-debit
 *     means nothing was charged, so there is nothing to refund).
 *   - If SMS was received but the order wasn't finished: mark completed.
 *
 * Runs every 5 minutes as a backstop for the per-order poll function
 * (`poll-order`), which is the primary, event-driven expiry/finalize path.
 * This sweep only catches stragglers poll missed, so it doesn't need
 * minute precision — the only cost of a slower cadence is that an expired
 * order's upstream cancel and the user's freed concurrent-active slot lag
 * by up to the interval. Nothing is charged (defer-debit), so there's no
 * money implication to the delay. Tune the cron below: every 2 minutes for
 * snappier slot release, every 15 to cut Inngest runs further.
 */
export const expireOrdersFn = inngest.createFunction(
  {
    id: "expire-orders",
    triggers: [{ cron: "*/5 * * * *" }],
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
    // SMS arrived and the poll already captured+charged it (status 'received').
    // Finalize ONLY from 'received' — never complete a still-'active' order,
    // which would mark it done without ever charging. A rare active+SMS order
    // at expiry is left for the poll; this stays a cosmetic finalization.
    await supabase
      .from("orders")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", "received");
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
