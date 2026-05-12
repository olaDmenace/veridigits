"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getProcessor, PaymentProcessorError } from "@/lib/payments";
import { getAppUrl } from "@/lib/utils/app-url";

export type CreateTopupResult =
  | {
      ok: true;
      paymentId: string;
      payAddress: string;
      payAmount: string;
      payCurrency: string;
      amountUsdCents: number;
    }
  | { ok: false; error: string };

const MIN_USD_CENTS = 5_00;
const MAX_USD_CENTS = 5_000_00;

const SUPPORTED_CURRENCIES = new Set([
  "usdttrc20",
  "usdterc20",
  "usdcsol",
  "btc",
  "eth",
  "sol",
  "trx",
  "ltc",
]);

/**
 * Creates a NOWPayments invoice for a wallet top-up.
 *
 * Inserts a `crypto_payments` row in `waiting` status before talking to
 * NOWPayments — that way if we crash mid-call, we can still reconcile
 * later via the IPN.
 */
export async function createTopup(formData: FormData): Promise<CreateTopupResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to top up." };

  const amountUsdCents = Number(formData.get("amountUsdCents") ?? 0);
  const payCurrency = String(formData.get("payCurrency") ?? "");

  if (
    !Number.isInteger(amountUsdCents) ||
    amountUsdCents < MIN_USD_CENTS ||
    amountUsdCents > MAX_USD_CENTS
  ) {
    return {
      ok: false,
      error: `Amount must be between $${(MIN_USD_CENTS / 100).toFixed(2)} and $${(MAX_USD_CENTS / 100).toFixed(2)}.`,
    };
  }
  if (!SUPPORTED_CURRENCIES.has(payCurrency)) {
    return { ok: false, error: "Pick a supported crypto." };
  }

  const admin = getAdminClient();

  // Insert the row first so we have an id to attach as order_id.
  const { data: row, error: insertErr } = await admin
    .from("crypto_payments")
    .insert({
      user_id: user.id,
      provider: "nowpayments",
      external_id: `pending-${crypto.randomUUID()}`, // replaced after createInvoice
      amount_usd_cents: amountUsdCents,
      crypto_currency: payCurrency,
      status: "waiting",
    })
    .select("id")
    .single();

  if (insertErr || !row) {
    return { ok: false, error: insertErr?.message ?? "couldn't queue top-up" };
  }

  let invoice;
  try {
    const processor = getProcessor("nowpayments");
    const origin = getAppUrl();
    invoice = await processor.createInvoice({
      amountUsdCents,
      payCurrency,
      externalReference: row.id,
      ipnCallbackUrl: `${origin}/api/webhooks/nowpayments`,
      successUrl: `${origin}/topup/success`,
      cancelUrl: `${origin}/topup`,
    });
  } catch (err) {
    // Roll back the row so the table doesn't fill with abandoned drafts.
    await admin.from("crypto_payments").delete().eq("id", row.id);
    if (err instanceof PaymentProcessorError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "payment processor unavailable",
    };
  }

  // Patch the row with the real external_id from NOWPayments so the IPN
  // can find it.
  const { error: updateErr } = await admin
    .from("crypto_payments")
    .update({
      external_id: invoice.externalId,
      crypto_amount: invoice.payAmount,
      status: invoice.status,
    })
    .eq("id", row.id);

  if (updateErr) {
    return { ok: false, error: updateErr.message };
  }

  return {
    ok: true,
    paymentId: invoice.externalId,
    payAddress: invoice.payAddress,
    payAmount: invoice.payAmount,
    payCurrency: invoice.payCurrency,
    amountUsdCents,
  };
}
