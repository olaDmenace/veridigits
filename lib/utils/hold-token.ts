import crypto from "node:crypto";

/**
 * HMAC-signed, time-limited carrier between getQuote and purchase.
 *
 * The token is the base64url-encoded JSON payload concatenated with a dot and
 * the base64url-encoded HMAC-SHA256 signature. Invariants:
 *   - tampering with the payload invalidates the signature
 *   - tokens older than `expSec` are rejected
 *
 * Secret comes from HOLD_TOKEN_SECRET env. Falls back to SUPABASE_SERVICE_ROLE_KEY
 * (always set in our deployment) so we don't have yet another secret to manage.
 */

const DEFAULT_EXP_SEC = 30;

export interface HoldTokenPayload {
  userId: string;
  serviceId: string;
  countryId: string;
  providerSlug: string;
  upstreamServiceCode: string;
  upstreamCountryCode: string;
  upstreamOperator: string;
  wholesaleCents: number;
  retailCents: number;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expires-at, unix seconds. */
  exp: number;
}

export class HoldTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoldTokenError";
  }
}

function getSecret(): string {
  const secret =
    process.env.HOLD_TOKEN_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "hold-token secret not configured (set HOLD_TOKEN_SECRET or SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return secret;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function signHoldToken(
  payload: Omit<HoldTokenPayload, "iat" | "exp">,
  expSec = DEFAULT_EXP_SEC,
): string {
  const now = Math.floor(Date.now() / 1000);
  const full: HoldTokenPayload = {
    ...payload,
    iat: now,
    exp: now + expSec,
  };

  const body = b64url(JSON.stringify(full));
  const sig = b64url(
    crypto.createHmac("sha256", getSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifyHoldToken(token: string): HoldTokenPayload {
  const dot = token.lastIndexOf(".");
  if (dot < 0) throw new HoldTokenError("malformed");

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expectedSig = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest();

  let provided: Buffer;
  try {
    provided = fromB64url(sig);
  } catch {
    throw new HoldTokenError("bad signature encoding");
  }

  if (provided.length !== expectedSig.length) {
    throw new HoldTokenError("bad signature");
  }
  if (!crypto.timingSafeEqual(provided, expectedSig)) {
    throw new HoldTokenError("bad signature");
  }

  let payload: HoldTokenPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    throw new HoldTokenError("bad payload");
  }

  if (typeof payload.exp !== "number") {
    throw new HoldTokenError("missing exp");
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new HoldTokenError("token expired");
  }

  return payload;
}
