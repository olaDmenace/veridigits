/**
 * Expected SMS sender substrings per service. Used by the order poller to
 * detect when an arriving SMS clearly didn't come from the service the user
 * paid for (e.g. a Telegram code on a number bought for WhatsApp). When the
 * heuristic fires, we auto-refund instead of marking the order received.
 *
 * Match rule (see senderMatchesService): case-insensitive substring of the
 * sender string against the entries below.
 *
 * Bias: conservative. False positives cost us money (we eat the wholesale on
 * a refund). So we only auto-refund when (a) the service has a known pattern
 * here, AND (b) the sender contains letters, AND (c) none of the entries
 * appear. Numeric short-codes default to "trust the upstream" — we can't tell
 * what they're from.
 *
 * Add services as we profile them. Keys are the `services.slug` column.
 */
export const SERVICE_SENDER_PATTERNS: Record<string, readonly string[]> = {
  whatsapp: ["whatsapp", "whats app"],
  telegram: ["telegram"],
  google: ["google", "g-"],
  gmail: ["google", "gmail"],
  youtube: ["google", "youtube"],
  googlevoice: ["google", "voice"],
  discord: ["discord"],
  facebook: ["facebook", "fb"],
  instagram: ["instagram"],
  twitter: ["twitter"],
  x: ["twitter"],
  tinder: ["tinder"],
  snapchat: ["snapchat", "snap"],
  tiktok: ["tiktok", "tik tok"],
  uber: ["uber"],
  ubereats: ["uber"],
  amazon: ["amazon", "amzn"],
  microsoft: ["microsoft", "msft"],
  apple: ["apple"],
  linkedin: ["linkedin"],
  github: ["github"],
  paypal: ["paypal"],
  signal: ["signal"],
  airbnb: ["airbnb"],
  lyft: ["lyft"],
  binance: ["binance"],
  coinbase: ["coinbase"],
};

export type SenderMatchResult =
  | { decision: "match" }
  | { decision: "mismatch"; expected: readonly string[] }
  | { decision: "unknown"; reason: "no_pattern" | "no_sender" | "numeric_shortcode" };

/**
 * Decide whether a sender looks like it came from the expected service.
 *
 * Returns one of:
 *   - "match"      — sender contains an expected substring; keep order as received
 *   - "mismatch"   — sender has letters but matches none of the expected; auto-refund
 *   - "unknown"    — no profile / no sender / numeric shortcode; default to received
 *
 * Caller policy: auto-refund only on "mismatch". All other cases fall back to
 * the existing behavior (mark received).
 */
export function senderMatchesService(
  serviceSlug: string | null | undefined,
  sender: string | null | undefined,
): SenderMatchResult {
  if (!serviceSlug) return { decision: "unknown", reason: "no_pattern" };

  const expected = SERVICE_SENDER_PATTERNS[serviceSlug.toLowerCase()];
  if (!expected) return { decision: "unknown", reason: "no_pattern" };

  if (!sender) return { decision: "unknown", reason: "no_sender" };

  const senderLower = sender.toLowerCase();
  if (expected.some((p) => senderLower.includes(p))) {
    return { decision: "match" };
  }

  // Numeric short-codes ("+15551234", "8888", etc.) are common for carrier-
  // delivered OTPs even from legitimate services. Don't classify these as
  // mismatch — too noisy.
  if (!/[a-z]/i.test(sender)) {
    return { decision: "unknown", reason: "numeric_shortcode" };
  }

  return { decision: "mismatch", expected };
}
