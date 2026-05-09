import { applyWalletTransaction } from "./apply";
import type { WalletTransaction } from "./types";

interface RefundParams {
  userId: string;
  amountCents: number;
  orderId: string;
  note?: string;
}

/**
 * Returns funds to a user's wallet for a cancelled or expired order. Always
 * carries the order reference so the ledger stays auditable.
 */
export async function refundOrder(
  params: RefundParams,
): Promise<WalletTransaction> {
  if (params.amountCents <= 0) {
    throw new Error("refundOrder requires a positive amountCents");
  }
  return applyWalletTransaction({
    userId: params.userId,
    amountCents: params.amountCents,
    type: "refund",
    referenceType: "order",
    referenceId: params.orderId,
    note: params.note,
  });
}
