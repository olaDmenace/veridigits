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
  anyMatch: boolean;
  anyMismatch: boolean;
}): SmsOutcome {
  const { upstreamStatus, currentStatus, anyMatch, anyMismatch } = input;

  if (upstreamStatus === "received") {
    if (currentStatus !== "active" && currentStatus !== "pending") {
      return "noop";
    }
    // Positive evidence of a wrong service AND no contradicting match.
    if (anyMismatch && !anyMatch) return "cross_service";
    return "capture";
  }

  if (upstreamStatus === "cancelled") return "upstream_cancelled";

  return "wait";
}
