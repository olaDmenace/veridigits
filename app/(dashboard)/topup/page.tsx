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
          Add crypto to your wallet
        </h1>
        <p className="body" style={{ marginTop: 14 }}>
          Pick an amount in USD, choose a crypto, and we&apos;ll generate a
          one-time deposit address. Once the network confirms, your wallet
          credits automatically.
        </p>
      </div>

      <TopUpForm />
    </div>
  );
}
