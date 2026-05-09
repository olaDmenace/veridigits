import { getAdminClient } from "@/lib/supabase/admin";
import {
  InsufficientBalanceError,
  ProfileNotFoundError,
  type WalletTransaction,
  type WalletTxReferenceType,
  type WalletTxType,
} from "./types";

interface ApplyParams {
  userId: string;
  amountCents: number; // positive = credit, negative = debit
  type: WalletTxType;
  referenceType?: WalletTxReferenceType;
  referenceId?: string;
  note?: string;
}

/**
 * Single source of truth for wallet movement. Calls the `wallet_apply`
 * Postgres function which holds a SELECT ... FOR UPDATE lock on the profile
 * row for the duration of the operation, so concurrent purchases can't
 * race to overdraw the wallet.
 *
 * Throws InsufficientBalanceError when a debit would push balance below
 * zero, and ProfileNotFoundError when the user has no profile row.
 */
export async function applyWalletTransaction(
  params: ApplyParams,
): Promise<WalletTransaction> {
  const supabase = getAdminClient();

  const { data, error } = await supabase.rpc("wallet_apply", {
    p_user_id: params.userId,
    p_amount_cents: params.amountCents,
    p_type: params.type,
    ...(params.referenceType !== undefined && { p_reference_type: params.referenceType }),
    ...(params.referenceId !== undefined && { p_reference_id: params.referenceId }),
    ...(params.note !== undefined && { p_note: params.note }),
  });

  if (error) {
    if (error.message.includes("insufficient_balance")) {
      throw new InsufficientBalanceError();
    }
    if (error.message.includes("profile_not_found")) {
      throw new ProfileNotFoundError(params.userId);
    }
    throw new Error(`wallet_apply failed: ${error.message}`);
  }

  return data as WalletTransaction;
}
