import crypto from "node:crypto";

/**
 * Korapay (NGN) payment processor.
 *
 * Docs: https://developers.korapay.com/docs/checkout-redirect
 *
 * Critical signature quirk: the webhook header `x-korapay-signature` is
 * HMAC-SHA256 over `JSON.stringify(body.data)` — i.e. ONLY the `data`
 * sub-object — using the secret key as the HMAC key. NOT the raw body.
 * Get this wrong and every webhook will be rejected.
 *
 * Currency: amounts on initialize and in webhook payloads are in MAJOR units
 * (integer) for every supported currency — naira (not kobo), cedis (not
 * pesewas). Korapay confirmed naira in the live dashboard; GHS follows the
 * same major-unit convention.
 */

const KORAPAY_API_URL =
  "https://api.korapay.com/merchant/api/v1/charges/initialize";

/** Local currencies we collect via Korapay's hosted checkout. */
export type KorapayCurrency = "NGN" | "GHS";

export interface KorapayInitializeParams {
  amount: number; // positive integer, whole major units (naira / cedis)
  currency: KorapayCurrency;
  reference: string; // unique per transaction
  customer: { email: string; name?: string };
  notificationUrl: string; // our webhook
  redirectUrl?: string; // where customer lands after pay
  narration?: string;
  channels?: KorapayChannel[];
  defaultChannel?: KorapayChannel;
  /** Optional. Max 5 fields, field names max 20 chars. */
  metadata?: Record<string, string | number>;
  /** Defaults to true: merchant absorbs the Korapay fee. */
  merchantBearsCost?: boolean;
}

export type KorapayChannel =
  | "card"
  | "bank_transfer"
  | "pay_with_bank"
  | "mobile_money";

export interface KorapayInitializeResult {
  reference: string;
  checkoutUrl: string;
}

export interface KorapayWebhookVerification {
  ok: boolean;
  payload: KorapayWebhookPayload | null;
  reason?: string;
}

export interface KorapayWebhookData {
  reference?: string;
  payment_reference?: string;
  amount?: number;
  fee?: number;
  currency?: string;
  status?: string;
  payment_method?: string;
  [k: string]: unknown;
}

export interface KorapayWebhookPayload {
  event: KorapayEvent;
  data: KorapayWebhookData;
}

export type KorapayEvent =
  | "charge.success"
  | "charge.failed"
  | "transfer.success"
  | "transfer.failed"
  | "refund.success"
  | "refund.failed";

export class KorapayError extends Error {
  constructor(message: string) {
    super(`korapay: ${message}`);
    this.name = "KorapayError";
  }
}

export class KorapayProcessor {
  readonly displayName = "Korapay";

  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(secretKey: string, baseUrl = KORAPAY_API_URL) {
    this.secretKey = secretKey;
    this.baseUrl = baseUrl;
  }

  async initializeCharge(
    params: KorapayInitializeParams,
  ): Promise<KorapayInitializeResult> {
    if (!Number.isInteger(params.amount) || params.amount <= 0) {
      throw new KorapayError(
        "amount must be a positive integer (whole major units)",
      );
    }
    if (!params.currency) {
      throw new KorapayError("currency is required");
    }
    if (!params.reference) {
      throw new KorapayError("reference is required");
    }
    if (!params.customer?.email) {
      throw new KorapayError("customer.email is required");
    }

    const body: Record<string, unknown> = {
      amount: params.amount,
      currency: params.currency,
      reference: params.reference,
      customer: {
        email: params.customer.email,
        ...(params.customer.name ? { name: params.customer.name } : {}),
      },
      notification_url: params.notificationUrl,
    };
    if (params.redirectUrl) body.redirect_url = params.redirectUrl;
    if (params.narration) body.narration = params.narration;
    if (params.channels?.length) body.channels = params.channels;
    if (params.defaultChannel) body.default_channel = params.defaultChannel;
    if (params.metadata) body.metadata = params.metadata;
    if (typeof params.merchantBearsCost === "boolean") {
      body.merchant_bears_cost = params.merchantBearsCost;
    }

    let res: Response;
    try {
      res = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch (err) {
      throw new KorapayError(
        `initialize network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const text = await res.text();
    let parsed: {
      status?: boolean;
      message?: string;
      data?: { reference?: string; checkout_url?: string };
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new KorapayError(
        `initialize non-JSON ${res.status}: ${text.slice(0, 200)}`,
      );
    }

    if (!res.ok || parsed.status !== true || !parsed.data?.checkout_url) {
      throw new KorapayError(
        `initialize ${res.status}: ${parsed.message ?? text.slice(0, 200)}`,
      );
    }

    return {
      reference: parsed.data.reference ?? params.reference,
      checkoutUrl: parsed.data.checkout_url,
    };
  }

  /**
   * Verifies the `x-korapay-signature` header on a webhook POST.
   *
   * - Algorithm: HMAC-SHA256
   * - Signed payload: JSON.stringify(parsedBody.data) — NOT the raw body
   * - Key: the same secret key used to initialize charges
   *
   * Pass the raw request body so we can JSON.parse once and use the result
   * both for verification and downstream handling.
   */
  verifyWebhook(
    rawBody: string,
    signature: string | null,
  ): KorapayWebhookVerification {
    if (!signature) {
      return { ok: false, payload: null, reason: "missing signature header" };
    }
    if (!this.secretKey) {
      return {
        ok: false,
        payload: null,
        reason: "KORAPAY_SECRET_KEY not configured",
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { ok: false, payload: null, reason: "body is not JSON" };
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("data" in parsed) ||
      !("event" in parsed)
    ) {
      return { ok: false, payload: null, reason: "missing event or data" };
    }
    const payload = parsed as KorapayWebhookPayload;

    // Sign ONLY the data object — this is the documented Korapay scheme.
    const canonical = JSON.stringify(payload.data);
    const expected = crypto
      .createHmac("sha256", this.secretKey)
      .update(canonical)
      .digest("hex");

    const expectedBuf = Buffer.from(expected, "utf8");
    const providedBuf = Buffer.from(signature.trim(), "utf8");
    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return { ok: false, payload, reason: "signature mismatch" };
    }

    return { ok: true, payload };
  }
}

let cached: KorapayProcessor | null = null;

export function getKorapay(): KorapayProcessor {
  if (cached) return cached;
  const key = process.env.KORAPAY_SECRET_KEY;
  if (!key) {
    throw new Error("missing required env var: KORAPAY_SECRET_KEY");
  }
  cached = new KorapayProcessor(key);
  return cached;
}

/** Test-only: reset the singleton between tests. */
export function _resetKorapayCache(): void {
  cached = null;
}
