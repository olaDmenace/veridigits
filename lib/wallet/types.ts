export type WalletTxType =
  | "topup"
  | "purchase"
  | "refund"
  | "bonus"
  | "adjustment";

export type WalletTxReferenceType = "crypto_payment" | "order" | "manual";

export interface WalletTransaction {
  id: string;
  user_id: string;
  amount_cents: number;
  type: WalletTxType;
  reference_type: WalletTxReferenceType | null;
  reference_id: string | null;
  balance_after_cents: number;
  note: string | null;
  created_at: string;
}

export class InsufficientBalanceError extends Error {
  constructor(message = "insufficient balance") {
    super(message);
    this.name = "InsufficientBalanceError";
  }
}

export class ProfileNotFoundError extends Error {
  constructor(userId: string) {
    super(`profile not found: ${userId}`);
    this.name = "ProfileNotFoundError";
  }
}
