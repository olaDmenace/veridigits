/**
 * Crypto payment processor abstraction.
 *
 * Top-ups always run through this interface — never call NOWPayments /
 * Cryptomus from a route or component. Adding a new processor means
 * implementing this surface and registering it.
 */

export type CryptoProcessorSlug = "nowpayments" | "cryptomus";

export type PaymentStatus =
  | "waiting"
  | "confirming"
  | "confirmed"
  | "failed"
  | "expired";

export interface CreateInvoiceParams {
  amountUsdCents: number;
  payCurrency: string; // e.g. "usdttrc20", "btc", "ethbase"
  /** Internal id we attach so callbacks can be matched back to a row. */
  externalReference: string;
  /** Where the IPN/webhook should POST. */
  ipnCallbackUrl: string;
  /** Where the user lands after a successful pay (informational). */
  successUrl?: string;
  /** Where the user lands if they bail. */
  cancelUrl?: string;
}

export interface CreateInvoiceResult {
  /** Provider-side payment id we store in crypto_payments.external_id. */
  externalId: string;
  status: PaymentStatus;
  payAddress: string;
  payAmount: string; // string to avoid float precision loss
  payCurrency: string;
  expiresAt?: Date;
}

export interface IpnVerification {
  ok: boolean;
  payload: Record<string, unknown> | null;
  externalId?: string;
  status?: PaymentStatus;
  amountUsdCents?: number;
  reason?: string;
}

export interface CryptoProcessor {
  readonly slug: CryptoProcessorSlug;
  readonly displayName: string;
  createInvoice(params: CreateInvoiceParams): Promise<CreateInvoiceResult>;
  verifyIpn(rawBody: string, signature: string | null): IpnVerification;
}

export class PaymentProcessorError extends Error {
  readonly slug: CryptoProcessorSlug;
  constructor(slug: CryptoProcessorSlug, message: string) {
    super(`${slug}: ${message}`);
    this.name = "PaymentProcessorError";
    this.slug = slug;
  }
}
