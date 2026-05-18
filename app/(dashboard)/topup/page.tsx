import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopUpForm } from "./topup-form";

export const metadata = { title: "Top up · Veridigits" };

export default async function TopUpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-col gap-8" style={{ maxWidth: 640 }}>
      <div>
        <div className="eyebrow">Top up</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Add funds to your wallet
        </h1>
        <p className="body" style={{ marginTop: 14 }}>
          Pay in Naira (card, bank transfer, or pay-with-bank via Korapay) or
          in crypto (USDT, USDC, BTC, ETH, and more). Your wallet balance is
          always shown in USD; the amount you&apos;ll receive is locked when
          you start the payment.
        </p>
      </div>

      <TopUpForm />
    </div>
  );
}
