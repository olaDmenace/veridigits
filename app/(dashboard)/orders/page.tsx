import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatUsdCents } from "@/lib/utils/money";
import { getServiceDisplay } from "@/lib/services/display";

export const metadata = { title: "Orders · Veridigits" };

const STATUS_BADGE: Record<string, string> = {
  pending: "badge-warn",
  active: "badge-info",
  received: "badge-success",
  completed: "badge-success",
  cancelled: "badge",
  expired: "badge",
  refunded: "badge",
};

export default async function OrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id, phone_number, status, retail_charged_cents, mode, created_at, expires_at, services(name, slug), countries(name, iso_code, flag_emoji)",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-col gap-8">
      <div className="section-head">
        <div className="left">
          <div className="eyebrow">Orders</div>
          <h1 className="h2" style={{ marginTop: 8 }}>
            Your activations and rentals
          </h1>
        </div>
        <Link href="/buy" className="btn btn-primary">
          <span className="dot"></span>
          Buy a number
        </Link>
      </div>

      {orders && orders.length > 0 ? (
        <div className="flex flex-col gap-3">
          {orders.map((o) => {
            const svc = o.services as { name: string; slug: string } | null;
            const country = o.countries as
              | { name: string; iso_code: string; flag_emoji: string | null }
              | null;
            const badgeClass = STATUS_BADGE[o.status] ?? "badge";
            const display = svc
              ? getServiceDisplay(svc.slug, svc.name)
              : { name: "—", iconClass: "svc-tg", abbr: "??" };

            return (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="order-card"
                style={{ textDecoration: "none" }}
              >
                <div className={`svc-ico ${display.iconClass}`}>
                  {display.abbr}
                </div>
                <div className="meta">
                  <div className="top">
                    <span className="ttl">{display.name}</span>
                    <span className={`badge ${badgeClass}`}>{o.status}</span>
                  </div>
                  <div className="num">
                    {o.phone_number} · {country?.name ?? "—"}
                  </div>
                </div>
                <div className="right">
                  <span className="price">{formatUsdCents(o.retail_charged_cents)}</span>
                  <span className="caption">{o.mode}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div
          className="card flex flex-col items-center gap-4 text-center"
          style={{ padding: 56 }}
        >
          <div className="eyebrow">Nothing here yet</div>
          <p className="body" style={{ maxWidth: 420 }}>
            Buy your first number — codes show up here in real time.
          </p>
          <Link href="/buy" className="btn btn-primary">
            <span className="dot"></span>
            Buy a number
          </Link>
        </div>
      )}
    </div>
  );
}
