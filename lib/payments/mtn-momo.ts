/**
 * MTN Mobile Money (MoMo) — Collections API, for Ghana (GHS) top-ups.
 *
 * Docs: https://momodeveloper.mtn.com (Collections → RequestToPay)
 *
 * Flow (unlike Korapay's hosted redirect):
 *   1. getToken()        — OAuth2 access token (Basic apiUser:apiKey + sub key).
 *   2. requestToPay()    — push a PIN prompt to the payer's MoMo number.
 *   3. getStatus()       — poll until SUCCESSFUL / FAILED (callback is a nudge).
 *
 * Environments:
 *   - sandbox  → base https://sandbox.momodeveloper.mtn.com, currency EUR,
 *     X-Target-Environment "sandbox", api user/key self-provisioned via the API.
 *   - production (Ghana) → host + keys issued by MTN after Go-Live (KYC),
 *     X-Target-Environment "mtnghana", currency GHS.
 *
 * Security note: MTN's callback is unauthenticated, so we NEVER credit off the
 * callback body alone — we always re-verify with getStatus() server-side first.
 */

const SANDBOX_BASE = "https://sandbox.momodeveloper.mtn.com";

export type MtnTargetEnvironment = "sandbox" | "mtnghana";

export interface MomoRequestToPayParams {
  /** UUID; becomes the X-Reference-Id and the id you poll status by. */
  referenceId: string;
  /** Whole major units as a string ("100"). */
  amount: string;
  /** "EUR" in sandbox, "GHS" in production. */
  currency: string;
  /** Your own reference, echoed back on status + callback. */
  externalId: string;
  /** Payer MoMo number, MSISDN digits incl. country code, no "+" (233…). */
  payerMsisdn: string;
  payerMessage: string;
  payeeNote: string;
  /** Optional per-request callback URL (MTN PUTs the result here). */
  callbackUrl?: string;
}

export type MomoStatus = "PENDING" | "SUCCESSFUL" | "FAILED";

export interface MomoStatusResult {
  status: MomoStatus;
  amount?: string;
  currency?: string;
  externalId?: string;
  financialTransactionId?: string;
  reason?: string | { code?: string; message?: string };
  raw: unknown;
}

export class MtnMomoError extends Error {
  constructor(message: string) {
    super(`mtn-momo: ${message}`);
    this.name = "MtnMomoError";
  }
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

export class MtnMomoProcessor {
  readonly displayName = "MTN MoMo";

  private readonly subscriptionKey: string;
  private readonly apiUser: string;
  private readonly apiKey: string;
  private readonly targetEnv: MtnTargetEnvironment;
  private readonly baseUrl: string;
  private tokenCache: TokenCache | null = null;

  constructor(opts: {
    subscriptionKey: string;
    apiUser: string;
    apiKey: string;
    targetEnv: MtnTargetEnvironment;
    baseUrl?: string;
  }) {
    this.subscriptionKey = opts.subscriptionKey;
    this.apiUser = opts.apiUser;
    this.apiKey = opts.apiKey;
    this.targetEnv = opts.targetEnv;
    this.baseUrl = opts.baseUrl ?? SANDBOX_BASE;
  }

  /** OAuth2 access token for Collections. Cached until ~1 min before expiry. */
  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && now < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }

    const basic = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString(
      "base64",
    );
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/collection/token/`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Ocp-Apim-Subscription-Key": this.subscriptionKey,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });
    } catch (err) {
      throw new MtnMomoError(
        `token network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const text = await res.text();
    let parsed: { access_token?: string; expires_in?: number };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new MtnMomoError(`token non-JSON ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok || !parsed.access_token) {
      throw new MtnMomoError(`token ${res.status}: ${text.slice(0, 200)}`);
    }

    const ttlMs = Math.max(60, (parsed.expires_in ?? 3600) - 60) * 1000;
    this.tokenCache = { token: parsed.access_token, expiresAt: now + ttlMs };
    return parsed.access_token;
  }

  /**
   * Requests payment from a MoMo wallet — triggers a PIN prompt on the payer's
   * phone. Returns nothing useful on success (202 Accepted); poll getStatus
   * with the same referenceId to learn the outcome.
   */
  async requestToPay(params: MomoRequestToPayParams): Promise<void> {
    if (!/^\d+$/.test(params.amount)) {
      throw new MtnMomoError("amount must be whole-unit digits as a string");
    }
    if (!params.referenceId) throw new MtnMomoError("referenceId is required");
    if (!params.payerMsisdn) throw new MtnMomoError("payerMsisdn is required");

    const token = await this.getToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "X-Reference-Id": params.referenceId,
      "X-Target-Environment": this.targetEnv,
      "Ocp-Apim-Subscription-Key": this.subscriptionKey,
      "Content-Type": "application/json",
    };
    if (params.callbackUrl) headers["X-Callback-Url"] = params.callbackUrl;

    const body = {
      amount: params.amount,
      currency: params.currency,
      externalId: params.externalId,
      payer: { partyIdType: "MSISDN", partyId: params.payerMsisdn },
      payerMessage: params.payerMessage,
      payeeNote: params.payeeNote,
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/collection/v1_0/requesttopay`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch (err) {
      throw new MtnMomoError(
        `requesttopay network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (res.status !== 202) {
      const text = await res.text();
      throw new MtnMomoError(`requesttopay ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  /** Polls the outcome of a RequestToPay by its referenceId. Authoritative. */
  async getStatus(referenceId: string): Promise<MomoStatusResult> {
    const token = await this.getToken();
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Target-Environment": this.targetEnv,
            "Ocp-Apim-Subscription-Key": this.subscriptionKey,
          },
          cache: "no-store",
        },
      );
    } catch (err) {
      throw new MtnMomoError(
        `status network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const text = await res.text();
    let parsed: {
      status?: string;
      amount?: string;
      currency?: string;
      externalId?: string;
      financialTransactionId?: string;
      reason?: string | { code?: string; message?: string };
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new MtnMomoError(`status non-JSON ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new MtnMomoError(`status ${res.status}: ${text.slice(0, 200)}`);
    }

    const raw = parsed.status?.toUpperCase();
    const status: MomoStatus =
      raw === "SUCCESSFUL" ? "SUCCESSFUL" : raw === "FAILED" ? "FAILED" : "PENDING";

    return {
      status,
      amount: parsed.amount,
      currency: parsed.currency,
      externalId: parsed.externalId,
      financialTransactionId: parsed.financialTransactionId,
      reason: parsed.reason,
      raw: parsed,
    };
  }
}

let cached: MtnMomoProcessor | null = null;

export function getMtnMomo(): MtnMomoProcessor {
  if (cached) return cached;
  const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY;
  const apiUser = process.env.MTN_MOMO_API_USER;
  const apiKey = process.env.MTN_MOMO_API_KEY;
  const targetEnv = (process.env.MTN_MOMO_TARGET_ENV ??
    "sandbox") as MtnTargetEnvironment;
  const baseUrl = process.env.MTN_MOMO_BASE_URL || undefined;

  const missing = [
    ["MTN_MOMO_SUBSCRIPTION_KEY", subscriptionKey],
    ["MTN_MOMO_API_USER", apiUser],
    ["MTN_MOMO_API_KEY", apiKey],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`missing required env var(s): ${missing.join(", ")}`);
  }

  cached = new MtnMomoProcessor({
    subscriptionKey: subscriptionKey!,
    apiUser: apiUser!,
    apiKey: apiKey!,
    targetEnv,
    baseUrl,
  });
  return cached;
}

/** Sandbox currency is EUR; production (mtnghana) collects GHS. */
export function momoCurrencyFor(
  targetEnv: MtnTargetEnvironment = (process.env.MTN_MOMO_TARGET_ENV ??
    "sandbox") as MtnTargetEnvironment,
): string {
  return targetEnv === "mtnghana" ? "GHS" : "EUR";
}

/** Test-only: reset the singleton between tests. */
export function _resetMtnMomoCache(): void {
  cached = null;
}
