import crypto from "node:crypto";
import {
  PaymentProcessorError,
  type CreateInvoiceParams,
  type CreateInvoiceResult,
  type CryptoProcessor,
  type IpnVerification,
  type PaymentStatus,
} from "./types";

interface NowPaymentsCreateBody {
  price_amount: number;
  price_currency: string;
  pay_currency: string;
  order_id: string;
  order_description?: string;
  ipn_callback_url: string;
  success_url?: string;
  cancel_url?: string;
}

interface NowPaymentsCreateResponse {
  payment_id: number | string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  order_id: string;
  expiration_estimate_date?: string;
}

/**
 * NOWPayments processor.
 *
 * Docs: https://documenter.getpostman.com/view/7907941/S1a32n38
 *
 * IPN signature: header `x-nowpayments-sig` is the hex-encoded HMAC-SHA512
 * of `JSON.stringify(body, Object.keys(body).sort())` — top-level keys
 * sorted alphabetically — using NOWPAYMENTS_IPN_SECRET as the HMAC key.
 */
export class NowPaymentsProcessor implements CryptoProcessor {
  readonly slug = "nowpayments" as const;
  readonly displayName = "NOWPayments";

  private readonly apiKey: string;
  private readonly ipnSecret: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    ipnSecret: string,
    baseUrl = "https://api.nowpayments.io/v1",
  ) {
    this.apiKey = apiKey;
    this.ipnSecret = ipnSecret;
    this.baseUrl = baseUrl;
  }

  async createInvoice(
    params: CreateInvoiceParams,
  ): Promise<CreateInvoiceResult> {
    const body: NowPaymentsCreateBody = {
      price_amount: params.amountUsdCents / 100,
      price_currency: "usd",
      pay_currency: params.payCurrency,
      order_id: params.externalReference,
      order_description: "Veridigits wallet top-up",
      ipn_callback_url: params.ipnCallbackUrl,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    };

    const res = await fetch(`${this.baseUrl}/payment`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      throw new PaymentProcessorError(
        this.slug,
        `createInvoice ${res.status}: ${text.slice(0, 200)}`,
      );
    }

    let parsed: NowPaymentsCreateResponse;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PaymentProcessorError(
        this.slug,
        `createInvoice non-JSON: ${text.slice(0, 200)}`,
      );
    }

    return {
      externalId: String(parsed.payment_id),
      status: mapStatus(parsed.payment_status),
      payAddress: parsed.pay_address,
      payAmount: String(parsed.pay_amount),
      payCurrency: parsed.pay_currency,
      expiresAt: parsed.expiration_estimate_date
        ? new Date(parsed.expiration_estimate_date)
        : undefined,
    };
  }

  /**
   * Reads a payment's CURRENT status straight from NOWPayments.
   *
   * The IPN webhook is a single point of failure: if a callback is never
   * delivered (or gets rejected), a user's real money silently never reaches
   * their wallet. That is exactly what happened — 26 payments sat at "waiting"
   * on our side while NOWPayments had them finished/expired. The API is the
   * source of truth, so the reconciler polls it and the webhook becomes an
   * optimization rather than the only path to a credit.
   */
  async getPaymentStatus(externalId: string): Promise<{
    status: PaymentStatus;
    actuallyPaid: number;
    priceAmountUsdCents: number;
    raw: Record<string, unknown>;
  }> {
    const res = await fetch(
      `${this.baseUrl}/payment/${encodeURIComponent(externalId)}`,
      {
        headers: { "x-api-key": this.apiKey, Accept: "application/json" },
        cache: "no-store",
      },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new PaymentProcessorError(
        this.slug,
        `getPaymentStatus ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PaymentProcessorError(
        this.slug,
        `getPaymentStatus non-JSON: ${text.slice(0, 200)}`,
      );
    }
    return {
      status:
        typeof parsed.payment_status === "string"
          ? mapStatus(parsed.payment_status)
          : "waiting",
      actuallyPaid: Number(parsed.actually_paid ?? 0),
      priceAmountUsdCents: Math.round(Number(parsed.price_amount ?? 0) * 100),
      raw: parsed,
    };
  }

  /**
   * Verifies the IPN signature on a webhook POST.
   *
   * Critical: pass the RAW request body string (not a re-stringified parsed
   * object). The raw body is parsed here, sorted, re-stringified, and HMACed
   * — this matches NOWPayments' canonicalization exactly.
   */
  verifyIpn(rawBody: string, signature: string | null): IpnVerification {
    if (!signature) {
      return { ok: false, payload: null, reason: "missing signature header" };
    }
    if (!this.ipnSecret) {
      return {
        ok: false,
        payload: null,
        reason: "NOWPAYMENTS_IPN_SECRET not configured",
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { ok: false, payload: null, reason: "body is not JSON" };
    }

    const sortedJson = JSON.stringify(parsed, Object.keys(parsed).sort());
    const expected = crypto
      .createHmac("sha512", this.ipnSecret)
      .update(sortedJson)
      .digest("hex");

    const expectedBuf = Buffer.from(expected, "utf8");
    const providedBuf = Buffer.from(signature, "utf8");
    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return { ok: false, payload: parsed, reason: "signature mismatch" };
    }

    const externalId =
      parsed.payment_id != null ? String(parsed.payment_id) : undefined;
    const status =
      typeof parsed.payment_status === "string"
        ? mapStatus(parsed.payment_status)
        : undefined;
    const priceAmount = Number(parsed.price_amount ?? 0);

    return {
      ok: true,
      payload: parsed,
      externalId,
      status,
      amountUsdCents: Math.round(priceAmount * 100),
    };
  }
}

function mapStatus(s: string): PaymentStatus {
  // NOWPayments statuses: waiting, confirming, confirmed, sending,
  // partially_paid, finished, failed, refunded, expired.
  switch (s.toLowerCase()) {
    case "finished":
    case "confirmed":
      return "confirmed";
    case "confirming":
    case "sending":
    case "partially_paid":
      return "confirming";
    case "failed":
    case "refunded":
      return "failed";
    case "expired":
      return "expired";
    case "waiting":
    default:
      return "waiting";
  }
}
