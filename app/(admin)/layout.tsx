import { redirect } from "next/navigation";
import { logOut } from "@/app/(auth)/actions";
import { createClient } from "@/lib/supabase/server";
import { Topbar } from "@/components/topbar";

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
      <Topbar
        brandHref="/admin"
        brandLabel="ADMIN"
        links={[
          { href: "/admin", label: "Overview" },
          { href: "/admin/users", label: "Users" },
          { href: "/admin/providers", label: "Providers" },
          { href: "/admin/pricing-rules", label: "Pricing" },
          { href: "/dashboard", label: "Exit admin" },
        ]}
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
