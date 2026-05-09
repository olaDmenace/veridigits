import { applyWalletTransaction } from "./apply";
import type { WalletTransaction } from "./types";

interface DebitParams {
  userId: string;
  amountCents: number;
  orderId: string;
  note?: string;
}

/**
 * Charges a user's wallet for an order purchase. Throws
 * InsufficientBalanceError if the user can't cover it — the caller (the
 * purchase server action) must roll back the upstream provider call before
 * surfacing the error.
 */
export async function debitWalletForOrder(
  params: DebitParams,
): Promise<WalletTransaction> {
  if (params.amountCents <= 0) {
    throw new Error("debitWalletForOrder requires a positive amountCents");
  }
  return applyWalletTransaction({
    userId: params.userId,
    amountCents: -params.amountCents,
    type: "purchase",
    referenceType: "order",
    referenceId: params.orderId,
    note: params.note,
  });
}
