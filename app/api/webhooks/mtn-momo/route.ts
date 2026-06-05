import { NextResponse, type NextRequest } from "next/server";
import { settleMomoByReference } from "@/lib/payments/momo-settle";

/**
 * MTN MoMo RequestToPay callback.
 *
 * MTN PUTs (some setups POST) the transaction result to our X-Callback-Url. The
 * callback is UNAUTHENTICATED, so we treat it only as a nudge: we read the
 * externalId (our reference) and hand off to settleMomoByReference, which
 * re-queries MTN's authoritative status before crediting anything. A spoofed
 * callback therefore can't credit a wallet. The client poll is the backstop if
 * the callback never arrives.
 */
async function handle(request: NextRequest) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Non-JSON / empty — ack so MTN doesn't retry; the poll will settle.
    return NextResponse.json({ ok: true, skipped: "no_body" });
  }

  const externalId =
    body && typeof body === "object" && "externalId" in body
      ? (body as { externalId?: unknown }).externalId
      : null;

  if (typeof externalId !== "string" || !externalId) {
    return NextResponse.json({ ok: true, skipped: "no_external_id" });
  }

  try {
    await settleMomoByReference(externalId);
  } catch {
    // Non-fatal: the client poll re-attempts settlement.
  }

  return NextResponse.json({ ok: true });
}

export async function PUT(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
