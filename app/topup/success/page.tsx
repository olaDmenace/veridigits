import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { formatUsdCents } from "@/lib/utils/money";
import { Topbar } from "@/components/topbar";

export const metadata = { title: "Payment received · Veridigits" };
export const dynamic = "force-dynamic";

/**
 * Public post-payment landing for Korapay and NOWPayments.
 *
 * Lives outside the (dashboard) route group so it doesn't inherit the
 * dashboard layout's auth gate. Korapay's cross-domain redirect occasionally
 * drops our session cookies (Lax + slow checkout / iOS Safari quirks), and
 * NOWPayments' success URL fires after the user's already off-domain too.
 *
 * The page resolves payment context from the ?rail + ?ref query params so it
 * can show a personalized confirmation (amount, status, masked email + pre-
 * filled sign-in) even when no session is present.
 *
 * The webhook is the source of truth for crediting — this page is a UX
 * confirmation, never a credit trigger.
 */
export default async function PaymentReceivedPage({
  searchParams,
}: {
  searchParams: Promise<{ rail?: string; ref?: string }>;
}) {
  const { rail, ref } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Personalization payload assembled below. If we can resolve it from either
  // the session or the ref param, we show amount + status; otherwise we fall
  // back to a generic confirmation.
  let payment: ResolvedPayment | null = null;
  let balanceCents: number | null = null;
  let prefillEmail: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("wallet_balance_cents")
      .eq("id", user.id)
      .single();
    balanceCents = profile?.wallet_balance_cents ?? null;
  }

  if (rail && ref) {
    payment = await resolvePaymentByRef(rail, ref);
    if (payment && !user) {
      prefillEmail = await fetchEmailForUserId(payment.userId);
    }
  }

  const headline = composeHeadline(payment);
  const subhead = composeSubhead(payment);

  const loginHref = prefillEmail
    ? `/login?redirect=/dashboard&email=${encodeURIComponent(prefillEmail)}`
    : `/login?redirect=/dashboard`;

  return (
    <div className="theme-dark">
      <Topbar
        brandHref={user ? "/dashboard" : "/"}
        links={[]}
        primary={
          user ? null : (
            <Link href={loginHref} className="btn btn-secondary btn-sm">
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
          <h1 className="h3">{headline}</h1>
          <p className="body" style={{ maxWidth: 380 }}>
            {subhead}
          </p>

          {payment ? (
            <div className="card-flat" style={{ padding: 16, width: "100%" }}>
              <div className="flex items-center justify-between gap-3">
                <span className="caption">You paid</span>
                <span className="mono" style={{ fontWeight: 500 }}>
                  {payment.displayAmount}
                </span>
              </div>
              <div
                className="flex items-center justify-between gap-3"
                style={{ marginTop: 8 }}
              >
                <span className="caption">Credit to wallet</span>
                <span className="mono" style={{ fontWeight: 500 }}>
                  {formatUsdCents(payment.amountUsdCents)}
                </span>
              </div>
              <div
                className="flex items-center justify-between gap-3"
                style={{ marginTop: 8 }}
              >
                <span className="caption">Status</span>
                <span className={`badge ${badgeForStatus(payment.normalizedStatus)}`}>
                  {payment.normalizedStatus}
                </span>
              </div>
            </div>
          ) : null}

          {user && balanceCents !== null ? (
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
              <Link href={loginHref} className="btn btn-primary">
                <span className="dot"></span>
                {prefillEmail ? "Sign in to continue" : "Sign in"}
              </Link>
            )}
          </div>

          {prefillEmail && !user ? (
            <p className="caption" style={{ marginTop: -4 }}>
              Signed in as <span className="mono">{maskEmail(prefillEmail)}</span>
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}

const FIAT_SYMBOL: Record<string, string> = { NGN: "₦", GHS: "₵" };

interface ResolvedPayment {
  userId: string;
  amountUsdCents: number;
  displayAmount: string;
  normalizedStatus: "pending" | "confirming" | "credited" | "failed";
  rail: "fiat" | "crypto";
}

async function resolvePaymentByRef(
  rail: string,
  ref: string,
): Promise<ResolvedPayment | null> {
  const admin = getAdminClient();

  // Local fiat rails redirect with ?rail=<currency lowercased> (ngn, ghs).
  if (rail === "ngn" || rail === "ghs") {
    const { data } = await admin
      .from("fiat_payments")
      .select("user_id, currency, amount_local, amount_usd_cents_credited, status")
      .eq("reference", ref)
      .maybeSingle();
    if (!data) return null;
    const sym = FIAT_SYMBOL[data.currency] ?? "";
    return {
      userId: data.user_id,
      amountUsdCents: data.amount_usd_cents_credited,
      displayAmount: `${sym}${Number(data.amount_local).toLocaleString()}`,
      normalizedStatus: normalizeFiat(data.status),
      rail: "fiat",
    };
  }

  if (rail === "crypto") {
    const { data } = await admin
      .from("crypto_payments")
      .select("user_id, amount_usd_cents, crypto_currency, status")
      .eq("id", ref)
      .maybeSingle();
    if (!data) return null;
    return {
      userId: data.user_id,
      amountUsdCents: data.amount_usd_cents,
      displayAmount: `${formatUsdCents(data.amount_usd_cents)} (${String(
        data.crypto_currency,
      ).toUpperCase()})`,
      normalizedStatus: normalizeCrypto(data.status),
      rail: "crypto",
    };
  }

  return null;
}

async function fetchEmailForUserId(userId: string): Promise<string | null> {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

function normalizeFiat(
  status: string,
): "pending" | "confirming" | "credited" | "failed" {
  if (status === "success") return "credited";
  if (status === "pending") return "pending";
  return "failed";
}

function normalizeCrypto(
  status: string,
): "pending" | "confirming" | "credited" | "failed" {
  if (status === "confirmed" || status === "finished") return "credited";
  if (status === "confirming" || status === "partially_paid") return "confirming";
  if (status === "waiting") return "pending";
  return "failed";
}

function badgeForStatus(
  status: "pending" | "confirming" | "credited" | "failed",
): string {
  switch (status) {
    case "credited":
      return "badge-success";
    case "confirming":
    case "pending":
      return "badge-warn";
    case "failed":
      return "badge-danger";
  }
}

function composeHeadline(payment: ResolvedPayment | null): string {
  if (!payment) return "Funds are on their way to your wallet.";
  if (payment.normalizedStatus === "credited") return "Funds credited to your wallet.";
  if (payment.normalizedStatus === "failed") return "We couldn't confirm this payment.";
  return "Funds are on their way to your wallet.";
}

function composeSubhead(payment: ResolvedPayment | null): string {
  if (!payment) {
    return "Confirmation depends on the network — your dashboard updates the moment the deposit clears.";
  }
  if (payment.normalizedStatus === "credited") {
    return "Your balance is updated. Pick up where you left off.";
  }
  if (payment.normalizedStatus === "failed") {
    return "If you were charged, our reconciliation job will catch and credit it within a few minutes.";
  }
  return "Confirmation depends on the network — your dashboard updates the moment the deposit clears.";
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  if (local.length <= 2) return `${local[0] ?? ""}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}
