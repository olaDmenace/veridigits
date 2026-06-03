import { inngest } from "./client";
import { getAdminClient } from "@/lib/supabase/admin";
import { debitWalletForOrder } from "@/lib/wallet/debit";
import { InsufficientBalanceError } from "@/lib/wallet/types";

/**
 * Recover "delivered but uncharged" orders.
 *
 * Under defer-debit the wallet is charged when the first valid SMS lands. If
 * that capture debit fails because the user's balance can't cover it (the
 * accepted no-hold risk), the order is left `received`/`completed` with
 * `charged_at = null` — the code was delivered but we never collected. The
 * `orders_uncharged_received_idx` indexes exactly those.
 *
 * This job retries the debit on a short cron. If the user has since topped up,
 * we collect; otherwise it's left for the next run. After RETRY_WINDOW the
 * order ages out of the retry set (written off) but stays visible via the index
 * for admin.
 *
 * Idempotency: we CLAIM the order by stamping `charged_at` first (single
 * winner via the `charged_at is null` guard), then debit. If the debit fails we
 * revert the claim so it retries. This makes a double-charge impossible — a
 * concurrent run / re-run sees `charged_at` already set and skips.
 */
const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // stop retrying after 7 days
const BATCH = 100;

/** Orders created before this are written off (no longer retried). */
export function unchargedRetryCutoffIso(nowMs: number): string {
  return new Date(nowMs - RETRY_WINDOW_MS).toISOString();
}

export const reconcileUnchargedOrdersFn = inngest.createFunction(
  {
    id: "reconcile-uncharged-orders",
    concurrency: { limit: 1 }, // never overlap — the claim guard relies on it
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step, logger }) => {
    const result = await step.run("recover", () => recoverUncharged(Date.now()));
    if (result.recovered > 0 || result.errored > 0) {
      logger.info("uncharged-orders reconcile", result);
    }
    return result;
  },
);

export interface ReconcileResult {
  scanned: number;
  recovered: number;
  recoveredCents: number;
  stillShort: number;
  errored: number;
}

async function recoverUncharged(nowMs: number): Promise<ReconcileResult> {
  const admin = getAdminClient();

  const { data: orders } = await admin
    .from("orders")
    .select("id, user_id, retail_charged_cents, provider_slug, upstream_order_id")
    .is("charged_at", null)
    .in("status", ["received", "completed"])
    .gt("retail_charged_cents", 0)
    .gte("created_at", unchargedRetryCutoffIso(nowMs))
    .limit(BATCH);

  let recovered = 0;
  let recoveredCents = 0;
  let stillShort = 0;
  let errored = 0;

  for (const o of orders ?? []) {
    // Claim first so a re-run can't double-debit.
    const { data: claimed } = await admin
      .from("orders")
      .update({ charged_at: new Date().toISOString() })
      .eq("id", o.id)
      .is("charged_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    try {
      await debitWalletForOrder({
        userId: o.user_id,
        amountCents: o.retail_charged_cents,
        orderId: o.id,
        note: `reconcile-capture · ${o.provider_slug}:${o.upstream_order_id}`,
      });
      recovered++;
      recoveredCents += o.retail_charged_cents;
    } catch (err) {
      // Couldn't collect — undo the claim so a later run (after a top-up) retries.
      await admin.from("orders").update({ charged_at: null }).eq("id", o.id);
      if (err instanceof InsufficientBalanceError) stillShort++;
      else errored++;
    }
  }

  return {
    scanned: orders?.length ?? 0,
    recovered,
    recoveredCents,
    stillShort,
    errored,
  };
}
