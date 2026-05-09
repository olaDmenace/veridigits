import Link from "next/link";
import { redirect } from "next/navigation";
import { logOut } from "@/app/(auth)/actions";
import { createClient } from "@/lib/supabase/server";
import { formatUsdCents } from "@/lib/utils/money";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Middleware should have redirected already; defensive fallback.
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("wallet_balance_cents, is_admin")
    .eq("id", user.id)
    .single();

  const balanceCents = profile?.wallet_balance_cents ?? 0;

  return (
    <>
      <header className="topbar">
        <div className="page topbar-inner">
          <Link className="logo" href="/dashboard">
            <span className="mark">v.</span>
            <span>
              veridigits<span className="dot">.</span>
            </span>
          </Link>
          <nav>
            <Link href="/dashboard">Wallet</Link>
            <Link href="/buy">Buy</Link>
            <Link href="/orders">Orders</Link>
            <Link href="/settings">Settings</Link>
            {profile?.is_admin ? <Link href="/admin">Admin</Link> : null}
          </nav>
          <div className="flex items-center gap-4">
            <span className="meta">{formatUsdCents(balanceCents)}</span>
            <form action={logOut}>
              <button type="submit" className="btn btn-ghost btn-sm">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="page section">{children}</main>
    </>
  );
}
