/**
 * One-tap "try another number (free)" decision logic.
 *
 * A re-roll buys a FRESH number for the same service/country when the current
 * one didn't deliver. Under defer-debit the user was never charged for a miss,
 * so re-rolls are free to them; 5SIM refunds our wholesale on a timeout, so
 * they're ~free to us too. We still cap attempts to stop runaway loops.
 *
 * This pure function decides WHAT to do; the server action executes it (cancel
 * the dead number if it's still live, then re-quote + buy).
 */

/** How many orders for the same (user, service, country) within the window. */
export const REROLL_MAX_PER_WINDOW = 10;
export const REROLL_WINDOW_MS = 15 * 60 * 1000;

export type RerollDecision =
  | { action: "buy" } // previous order is terminal with no code — just buy
  | { action: "cancel_then_buy" } // previous still live + cancelable — free it first
  | { action: "refuse"; code: "already_received" | "too_many" | "too_early" };

export function decideReroll(input: {
  /** The previous order already captured a code. */
  hasSms: boolean;
  /** Orders created for this user+service+country inside the window. */
  recentCount: number;
  maxPerWindow: number;
  /** The previous order is currently cancelable (active, past the floor, no SMS). */
  cancelEligible: boolean;
  /** The previous order's status. */
  status: string;
}): RerollDecision {
  // Never re-roll a number that already worked.
  if (input.hasSms) return { action: "refuse", code: "already_received" };

  // Runaway / abuse guard.
  if (input.recentCount >= input.maxPerWindow) {
    return { action: "refuse", code: "too_many" };
  }

  // Still-live number we can free now: cancel it, then buy a fresh one.
  if (input.cancelEligible) return { action: "cancel_then_buy" };

  // Still-live but inside the cancel floor (e.g. the 2-minute 5SIM hold) — make
  // the user wait rather than orphan an un-cancelable number.
  if (input.status === "pending" || input.status === "active") {
    return { action: "refuse", code: "too_early" };
  }

  // Terminal with no code (expired / cancelled / refunded): just buy.
  return { action: "buy" };
}
