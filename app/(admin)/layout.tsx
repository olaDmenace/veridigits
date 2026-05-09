import Link from "next/link";
import { redirect } from "next/navigation";
import { logOut } from "@/app/(auth)/actions";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) {
    // Authenticated but not admin — kick to the regular dashboard.
    redirect("/dashboard");
  }

  return (
    <>
      <header className="topbar">
        <div className="page topbar-inner">
          <Link className="logo" href="/admin">
            <span className="mark">v.</span>
            <span>
              veridigits<span className="dot">.</span>
            </span>
            <span className="meta" style={{ marginLeft: 12 }}>
              ADMIN
            </span>
          </Link>
          <nav>
            <Link href="/admin">Overview</Link>
            <Link href="/admin/users">Users</Link>
            <Link href="/admin/providers">Providers</Link>
            <Link href="/dashboard">Exit admin</Link>
          </nav>
          <div className="flex items-center gap-3">
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
