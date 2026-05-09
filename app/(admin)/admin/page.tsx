import Link from "next/link";
import { getAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Admin · Veridigits" };

// Server components run once per request — `Date.now()` is fine here. The
// purity rule is for client components / hooks and doesn't differentiate.
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export default async function AdminOverview() {
  const admin = getAdminClient();
  const sevenDaysAgoIso = isoDaysAgo(7);

  const [
    { count: userCount },
    { count: orderCount },
    { count: paymentCount },
    { count: providerServiceCount },
    { count: abuseCount },
  ] = await Promise.all([
    admin.from("profiles").select("*", { count: "exact", head: true }),
    admin.from("orders").select("*", { count: "exact", head: true }),
    admin
      .from("crypto_payments")
      .select("*", { count: "exact", head: true })
      .eq("status", "confirmed"),
    admin
      .from("provider_services")
      .select("*", { count: "exact", head: true })
      .eq("is_enabled", true),
    admin
      .from("abuse_events")
      .select("*", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgoIso),
  ]);

  const stats: Array<{ label: string; value: string; href?: string }> = [
    { label: "Users", value: String(userCount ?? 0), href: "/admin/users" },
    { label: "Orders", value: String(orderCount ?? 0) },
    { label: "Confirmed top-ups", value: String(paymentCount ?? 0) },
    {
      label: "Provider listings",
      value: String(providerServiceCount ?? 0),
      href: "/admin/providers",
    },
    { label: "Abuse events (7d)", value: String(abuseCount ?? 0) },
  ];

  return (
    <div className="flex flex-col gap-10">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Operations overview
        </h1>
      </div>

      <div className="how-grid">
        {stats.map((s) => {
          const card = (
            <div className="card flex flex-col gap-2">
              <div className="eyebrow">{s.label}</div>
              <div className="h2 mono">{s.value}</div>
            </div>
          );
          return s.href ? (
            <Link
              key={s.label}
              href={s.href}
              style={{ textDecoration: "none" }}
            >
              {card}
            </Link>
          ) : (
            <div key={s.label}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}
