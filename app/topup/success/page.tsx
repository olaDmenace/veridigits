import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatUsdCents } from "@/lib/utils/money";
import { Topbar } from "@/components/topbar";

export const metadata = { title: "Payment received · Veridigits" };

/**
 * Public post-payment landing.
 *
 * Lives OUTSIDE the (dashboard) route group so it doesn't inherit the
 * dashboard layout's auth gate. Cross-domain returns from Korapay or
 * NOWPayments occasionally arrive without our session cookies (Lax + POST
 * return, or session expired during the user's time on the processor's
 * checkout). When that happens we still want to confirm the payment was
 * received and offer a sign-in CTA, not redirect to /login mid-flow.
 *
 * The webhook is the source of truth for crediting the wallet — this page
 * is purely a UX confirmation.
 */
export default async function PaymentReceivedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let balanceCents: number | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("wallet_balance_cents")
      .eq("id", user.id)
      .single();
    balanceCents = profile?.wallet_balance_cents ?? null;
  }

  return (
    <>
      <Topbar
        brandHref={user ? "/dashboard" : "/"}
        links={[]}
        primary={
          user ? null : (
            <Link href="/login" className="btn btn-secondary btn-sm">
              Sign in
            </Link>
          )
        }
      />
      <main className="page section">
        <div
          className="card flex flex-col items-center gap-5 text-center"
          style={{ padding: 56, maxWidth: 520, margin: "0 auto" }}
        >
          <div className="eyebrow">Payment received</div>
          <h1 className="h3">Funds are on their way to your wallet.</h1>
          <p className="body" style={{ maxWidth: 380 }}>
            Confirmation depends on the network — your dashboard updates the
            moment the deposit clears.
          </p>

          {balanceCents !== null ? (
            <div className="caption mono">
              Current balance:{" "}
              <span style={{ fontWeight: 600 }}>
                {formatUsdCents(balanceCents)}
              </span>
            </div>
          ) : null}

          <div className="flex gap-3">
            {user ? (
              <>
                <Link href="/dashboard" className="btn btn-primary">
                  <span className="dot"></span>
                  Back to dashboard
                </Link>
                <Link href="/buy" className="btn btn-secondary">
                  Buy a number
                </Link>
              </>
            ) : (
              <Link href="/login" className="btn btn-primary">
                <span className="dot"></span>
                Sign in to continue
              </Link>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
