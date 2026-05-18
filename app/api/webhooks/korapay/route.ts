import { NextResponse, type NextRequest } from "next/server";
import { getKorapay } from "@/lib/payments/korapay";
import { getAdminClient } from "@/lib/supabase/admin";
import { creditWallet } from "@/lib/wallet/credit";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Korapay webhook.
 *
 * Header: x-korapay-signature (HMAC-SHA256 over JSON.stringify(body.data),
 * keyed with the secret key — verified inside KorapayProcessor).
 *
 * On `charge.success` + status=success, we credit the user's wallet by the
 * pre-locked USD-cents amount stored on the ngn_payments row at quote time.
 * The spot FX rate at webhook time is intentionally ignored — the customer
 * was quoted USD-cents at initialize and gets exactly that.
 *
 * Idempotency: confirmed_at is set on first credit; repeated webhook
 * deliveries for the same reference short-circuit.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-korapay-signature");

  let processor;
  try {
    processor = getKorapay();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "processor not configured",
      },
      { status: 503 },
    );
  }

  const verification = processor.verifyWebhook(rawBody, signature);
  if (!verification.ok || !verification.payload) {
    return NextResponse.json(
      { error: "invalid signature", reason: verification.reason },
      { status: 401 },
    );
  }

  const { event, data } = verification.payload;
  const reference =
    typeof data.reference === "string"
      ? data.reference
      : typeof data.payment_reference === "string"
        ? data.payment_reference
        : null;

  if (!reference) {
    return NextResponse.json({ error: "missing reference" }, { status: 400 });
  }

  const admin = getAdminClient();

  const { data: row } = await admin
    .from("ngn_payments")
    .select(
      "id, user_id, amount_ngn, amount_usd_cents_credited, status, confirmed_at",
    )
    .eq("reference", reference)
    .single();

  if (!row) {
    // Unknown reference — most likely a stray callback. ACK so Korapay
    // doesn't retry.
    return NextResponse.json({ ok: true, skipped: "unknown_reference" });
  }

  // Map Korapay event/status to our status.
  const newStatus = mapStatus(event, typeof data.status === "string" ? data.status : "");

  // Always persist the payload for audit + bump the korapay_reference if present.
  await admin
    .from("ngn_payments")
    .update({
      status: newStatus,
      webhook_payload: verification.payload as unknown as Json,
      korapay_reference:
        typeof data.payment_reference === "string"
          ? data.payment_reference
          : null,
    })
    .eq("id", row.id);

  if (event === "charge.success" && newStatus === "success" && !row.confirmed_at) {
    try {
      await creditWallet({
        userId: row.user_id,
        amountCents: row.amount_usd_cents_credited,
        type: "topup",
        referenceType: "ngn_payment",
        referenceId: row.id,
        note: `korapay:${reference}`,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "credit failed" },
        { status: 500 },
      );
    }

    await admin
      .from("ngn_payments")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  return NextResponse.json({ ok: true });
}

function mapStatus(
  event: string,
  status: string,
): "pending" | "success" | "failed" | "expired" {
  if (event === "charge.success" && status.toLowerCase() === "success") {
    return "success";
  }
  if (event === "charge.failed" || status.toLowerCase() === "failed") {
    return "failed";
  }
  return "pending";
}
