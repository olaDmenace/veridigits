import { applyWalletTransaction } from "./apply";
import type {
  WalletTransaction,
  WalletTxReferenceType,
  WalletTxType,
} from "./types";

interface CreditParams {
  userId: string;
  amountCents: number;
  type: Extract<WalletTxType, "topup" | "bonus" | "adjustment">;
  referenceType?: WalletTxReferenceType;
  referenceId?: string;
  note?: string;
}

/**
 * Adds funds to a user's wallet. Used for confirmed crypto top-ups, manual
 * adjustments, and promotional bonuses. For refunding a cancelled order, use
 * `refundOrder` instead — it carries the order reference correctly.
 */
export async function creditWallet(
  params: CreditParams,
): Promise<WalletTransaction> {
  if (params.amountCents <= 0) {
    throw new Error("creditWallet requires a positive amountCents");
  }
  return applyWalletTransaction({
    userId: params.userId,
    amountCents: params.amountCents,
    type: params.type,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    note: params.note,
  });
}
