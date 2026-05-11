import { redirect } from "next/navigation";
import { logOut } from "@/app/(auth)/actions";
import { createClient } from "@/lib/supabase/server";
import { formatUsdCents } from "@/lib/utils/money";
import { Topbar, type TopbarLink } from "@/components/topbar";

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

  const links: TopbarLink[] = [
    { href: "/dashboard", label: "Wallet" },
    { href: "/buy", label: "Buy" },
    { href: "/orders", label: "Orders" },
    { href: "/settings", label: "Settings" },
  ];
  if (profile?.is_admin) links.push({ href: "/admin", label: "Admin" });

  return (
    <>
      <Topbar
        brandHref="/dashboard"
        links={links}
        meta={<span className="meta">{formatUsdCents(balanceCents)}</span>}
        primary={
          <form action={logOut}>
            <button type="submit" className="btn btn-ghost btn-sm">
              Sign out
            </button>
          </form>
        }
      />
      <main className="page section">{children}</main>
    </>
  );
}
