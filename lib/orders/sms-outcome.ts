import type { ProviderOrderStatus } from "@/lib/providers/types";

export type SmsOutcome =
  | "capture" // valid SMS — latch received + debit
  | "cross_service" // wrong-service SMS — release, never charge
  | "upstream_cancelled" // cancelled upstream-side
  | "wait" // nothing actionable yet
  | "noop"; // already terminal/charged

export function decideSmsOutcome(input: {
  upstreamStatus: ProviderOrderStatus;
  currentStatus: string;
  /** At least one SMS has actually landed for this order. */
  anyMessage: boolean;
  anyMatch: boolean;
  anyMismatch: boolean;
}): SmsOutcome {
  const { upstreamStatus, currentStatus, anyMessage, anyMatch, anyMismatch } =
    input;

  if (upstreamStatus === "received") {
    if (currentStatus !== "active" && currentStatus !== "pending") {
      return "noop";
    }
    // CRITICAL: provider "received" does NOT imply an SMS exists. 5SIM's
    // RECEIVED status means "number is live, waiting for SMS" — it flips ~2s
    // after purchase with an empty sms[] array. Capturing on status alone
    // charged the wallet and hid Cancel with no code ever delivered. A capture
    // requires a real message; otherwise keep waiting (and stay cancellable).
    if (!anyMessage) return "wait";
    // Positive evidence of a wrong service AND no contradicting match.
    if (anyMismatch && !anyMatch) return "cross_service";
    return "capture";
  }

  if (upstreamStatus === "cancelled") return "upstream_cancelled";

  return "wait";
}
