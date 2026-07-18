import { inngest } from "./client";
import { getProcessor } from "@/lib/payments";
import { NowPaymentsProcessor } from "@/lib/payments/nowpayments";
import { getAdminClient } from "@/lib/supabase/admin";
import { creditWallet } from "@/lib/wallet/credit";
import type { Json } from "@/lib/supabase/database.types";

/** Only look back this far — older drafts are abandoned, not pending. */
const LOOKBACK_DAYS = 30;

export interface ReconcileCryptoResult {
  checked: number;
  statusUpdated: number;
  credited: number;
  creditedCents: number;
  /** Paid, but short of the invoice — surfaced for a human, never auto-credited. */
  partial: number;
  errors: number;
}

/**
 * Reconciles pending crypto top-ups against NOWPayments and credits the ones
 * that actually completed.
 *
 * Why this exists: the IPN webhook was the ONLY path from "user paid" to
 * "wallet credited", and it silently never fired — 26 payments sat at "waiting"
 * on our side while NOWPayments had them finished/expired, and three users who
 * really paid received nothing. Polling the API (the source of truth) makes a
 * missed or rejected callback a delay instead of lost money.
 *
 * Idempotency: `confirmed_at` is the latch, exactly as in the webhook. The extra
 * ledger check covers the crash window between crediting and setting the latch,
 * so a retry can never double-credit.
 */
export async function reconcileCryptoPayments(): Promise<ReconcileCryptoResult> {
  const admin = getAdminClient();
  const processor = getProcessor("nowpayments");
  if (!(processor instanceof NowPaymentsProcessor)) {
    throw new Error("nowpayments processor unavailable");
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: rows, error } = await admin
    .from("crypto_payments")
    .select("id, user_id, external_id, amount_usd_cents, status, confirmed_at")
    .eq("provider", "nowpayments")
    .is("confirmed_at", null)
    .in("status", ["waiting", "confirming"])
    .gte("created_at", since);
  if (error) throw new Error(`load crypto_payments failed: ${error.message}`);

  const result: ReconcileCryptoResult = {
    checked: 0,
    statusUpdated: 0,
    credited: 0,
    creditedCents: 0,
    partial: 0,
    errors: 0,
  };

  for (const row of rows ?? []) {
    // Drafts whose createInvoice never returned carry a placeholder id.
    if (!row.external_id || row.external_id.startsWith("pending-")) continue;
    result.checked++;

    try {
      const upstream = await processor.getPaymentStatus(row.external_id);

      if (upstream.status !== row.status) {
        await admin
          .from("crypto_payments")
          .update({
            status: upstream.status,
            webhook_payload: upstream.raw as Json,
          })
          .eq("id", row.id);
        result.statusUpdated++;
      }

      // A short payment is a judgement call (a 10% underpay is not a top-up),
      // so we surface it rather than guessing. mapStatus puts partially_paid
      // under "confirming", so it stays in the polling set and stays visible.
      if (
        upstream.status === "confirming" &&
        upstream.actuallyPaid > 0 &&
        typeof upstream.raw.payment_status === "string" &&
        upstream.raw.payment_status.toLowerCase() === "partially_paid"
      ) {
        result.partial++;
        console.warn("reconcile-crypto: partially paid, needs a human", {
          paymentId: row.id,
          externalId: row.external_id,
          actuallyPaid: upstream.actuallyPaid,
        });
        continue;
      }

      if (upstream.status !== "confirmed") continue;

      const { count } = await admin
        .from("wallet_transactions")
        .select("*", { count: "exact", head: true })
        .eq("reference_id", row.id);
      if ((count ?? 0) > 0) {
        // Already credited (crash between credit and latch) — just latch it.
        await admin
          .from("crypto_payments")
          .update({ confirmed_at: new Date().toISOString() })
          .eq("id", row.id);
        continue;
      }

      await creditWallet({
        userId: row.user_id,
        amountCents: row.amount_usd_cents,
        type: "topup",
        referenceType: "crypto_payment",
        referenceId: row.id,
        note: `nowpayments-reconciled:${row.external_id}`,
      });
      await admin
        .from("crypto_payments")
        .update({ confirmed_at: new Date().toISOString() })
        .eq("id", row.id);

      result.credited++;
      result.creditedCents += row.amount_usd_cents;
    } catch (err) {
      result.errors++;
      console.error("reconcile-crypto: payment failed", {
        paymentId: row.id,
        externalId: row.external_id,
        err,
      });
    }
  }

  return result;
}

/**
 * Cron: every 10 minutes. Crypto confirmations land in minutes, so this bounds
 * a missed-IPN credit delay to ~10 min instead of never.
 */
export const reconcileCryptoFn = inngest.createFunction(
  {
    id: "reconcile-crypto-payments",
    triggers: [{ cron: "*/10 * * * *" }],
  },
  async ({ step, logger }) => {
    const result = await step.run("reconcile", () => reconcileCryptoPayments());
    logger.info("reconcile-crypto-payments finished", result);
    return result;
  },
);
