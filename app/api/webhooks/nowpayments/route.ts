import { NextResponse, type NextRequest } from "next/server";
import { getProcessor } from "@/lib/payments";
import { getAdminClient } from "@/lib/supabase/admin";
import { creditWallet } from "@/lib/wallet/credit";
import type { Json } from "@/lib/supabase/database.types";

/**
 * NOWPayments IPN webhook.
 *
 * Verifies x-nowpayments-sig (HMAC-SHA512 over sorted-key JSON of the body),
 * updates the matching crypto_payments row, and credits the user's wallet
 * exactly once when the payment reaches a confirmed/finished state.
 *
 * Idempotency: confirmed_at is set on first credit; subsequent IPN deliveries
 * for the same payment short-circuit before creating a duplicate ledger row.
 */
export async function POST(request: NextRequest) {
  // Read the RAW body — signature canonicalization depends on it.
  const rawBody = await request.text();
  const signature = request.headers.get("x-nowpayments-sig");

  let processor;
  try {
    processor = getProcessor("nowpayments");
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "processor not configured",
      },
      { status: 503 },
    );
  }

  const verification = processor.verifyIpn(rawBody, signature);
  if (!verification.ok) {
    return NextResponse.json(
      { error: "invalid signature", reason: verification.reason },
      { status: 401 },
    );
  }
  if (!verification.externalId) {
    return NextResponse.json({ error: "missing payment_id" }, { status: 400 });
  }

  const admin = getAdminClient();

  const { data: row } = await admin
    .from("crypto_payments")
    .select(
      "id, user_id, amount_usd_cents, status, confirmed_at",
    )
    .eq("provider", "nowpayments")
    .eq("external_id", verification.externalId)
    .single();

  if (!row) {
    // No matching draft — most likely a stray callback for an order we
    // didn't create. ACK so NOWPayments stops retrying.
    return NextResponse.json({ ok: true, skipped: "unknown_payment" });
  }

  // Always store the latest webhook payload for audit, even on no-op.
  // Payload is JSON-by-construction (we just JSON.parse'd it), so the cast
  // through Json is safe.
  await admin
    .from("crypto_payments")
    .update({
      status: verification.status ?? row.status,
      webhook_payload: verification.payload as Json,
    })
    .eq("id", row.id);

  if (verification.status === "confirmed" && !row.confirmed_at) {
    // Credit wallet exactly once.
    try {
      await creditWallet({
        userId: row.user_id,
        amountCents: row.amount_usd_cents,
        type: "topup",
        referenceType: "crypto_payment",
        referenceId: row.id,
        note: `nowpayments:${verification.externalId}`,
      });
    } catch (err) {
      // Surface so NOWPayments retries.
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : "credit failed",
        },
        { status: 500 },
      );
    }

    await admin
      .from("crypto_payments")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  return NextResponse.json({ ok: true });
}
