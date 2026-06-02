/**
 * 5SIM rejects cancellation during the first ~2 minutes after purchase.
 * (The old code had this inverted, which made every cancel error out.)
 * A number may be cancelled only AFTER this floor, before it expires,
 * while still active, and only if no SMS has arrived.
 */
export const MIN_CANCEL_AGE_MS = 2 * 60 * 1000;

export type CancelEligibility =
  | { ok: true }
  | {
      ok: false;
      reason: "wrong_status" | "too_early" | "expired" | "already_received";
      message: string;
    };

export function canCancelOrder(input: {
  status: string;
  createdAtMs: number;
  expiresAtMs: number;
  hasSms: boolean;
  nowMs: number;
}): CancelEligibility {
  const { status, createdAtMs, expiresAtMs, hasSms, nowMs } = input;

  if (status !== "active" && status !== "pending") {
    return {
      ok: false,
      reason: "wrong_status",
      message: `Cannot cancel an order with status ${status}.`,
    };
  }
  if (hasSms) {
    return {
      ok: false,
      reason: "already_received",
      message: "An SMS already arrived — this number can't be cancelled.",
    };
  }
  if (nowMs >= expiresAtMs) {
    return {
      ok: false,
      reason: "expired",
      message: "This number has already expired.",
    };
  }
  if (nowMs - createdAtMs < MIN_CANCEL_AGE_MS) {
    return {
      ok: false,
      reason: "too_early",
      message:
        "You can cancel after 2 minutes if no code has arrived (the upstream network requires the wait).",
    };
  }
  return { ok: true };
}
