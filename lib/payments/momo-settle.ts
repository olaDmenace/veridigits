import { getAdminClient } from "@/lib/supabase/admin";
import { creditWallet } from "@/lib/wallet/credit";
import { getMtnMomo } from "./mtn-momo";
import type { Json } from "@/lib/supabase/database.types";

export type MomoSettleStatus =
  | "pending"
  | "success"
  | "failed"
  | "not_found";

/**
 * Authoritatively resolves an MTN MoMo top-up.
 *
 * Re-queries MTN by the row's momo_reference_id (we NEVER trust the
 * unauthenticated callback body), and on SUCCESSFUL credits the wallet exactly
 * once. Safe to call concurrently from the callback route and the client poll:
 * the credit is gated by an atomic confirmed_at claim, with rollback if the
 * wallet credit itself fails so a later retry can complete it.
 */
export async function settleMomoByReference(
  reference: string,
): Promise<MomoSettleStatus> {
  const admin = getAdminClient();

  const { data: row } = await admin
    .from("fiat_payments")
    .select(
      "id, user_id, currency, amount_usd_cents_credited, confirmed_at, momo_reference_id, provider",
    )
    .eq("reference", reference)
    .maybeSingle();

  if (!row || row.provider !== "mtn_momo" || !row.momo_reference_id) {
    return "not_found";
  }
  if (row.confirmed_at) return "success"; // already credited

  let result;
  try {
    result = await getMtnMomo().getStatus(row.momo_reference_id);
  } catch {
    return "pending"; // transient — caller may retry
  }

  if (result.status === "FAILED") {
    await admin
      .from("fiat_payments")
      .update({ status: "failed", webhook_payload: result.raw as Json })
      .eq("id", row.id);
    return "failed";
  }

  if (result.status === "SUCCESSFUL") {
    // Atomic claim: only the caller that flips confirmed_at from null wins.
    const { data: claimed } = await admin
      .from("fiat_payments")
      .update({
        status: "success",
        confirmed_at: new Date().toISOString(),
        webhook_payload: result.raw as Json,
      })
      .eq("id", row.id)
      .is("confirmed_at", null)
      .select("id");

    if (!claimed || claimed.length === 0) return "success"; // someone else won

    try {
      await creditWallet({
        userId: row.user_id,
        amountCents: row.amount_usd_cents_credited,
        type: "topup",
        referenceType: "fiat_payment",
        referenceId: row.id,
        note: `mtn_momo:${row.currency}:${reference}`,
      });
    } catch {
      // Roll back the claim so a retry can still credit.
      await admin
        .from("fiat_payments")
        .update({ confirmed_at: null })
        .eq("id", row.id);
      return "pending";
    }
    return "success";
  }

  return "pending";
}
