import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { splitUsdCents, formatUsdCents } from "@/lib/utils/money";
import { getServiceDisplay } from "@/lib/services/display";
import { BrandLogo } from "@/components/brand-logo";

export const metadata = {
  title: "Wallet · Veridigits",
};

export default async function DashboardHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: orders }] = await Promise.all([
    supabase
      .from("profiles")
      .select("wallet_balance_cents, total_topped_up_cents, total_spent_cents")
      .eq("id", user.id)
      .single(),
    supabase
      .from("orders")
      .select(
        "id, phone_number, status, retail_charged_cents, created_at, services(name, slug), countries(name)",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const balance = splitUsdCents(profile?.wallet_balance_cents ?? 0);

  return (
    <div className="flex flex-col gap-12">
      <section>
        <div className="eyebrow mb-4">Wallet</div>

        <div className="wallet">
          <div className="lbl">Available balance</div>
          <div className="bal">
            <span className="cur">$</span>
            {balance.sign}
            {balance.dollars}
            <span className="cents">.{balance.cents}</span>
          </div>

          <div className="meta">
            <div>
              Total deposits
              <b>{formatUsdCents(profile?.total_topped_up_cents ?? 0)}</b>
            </div>
            <div>
              Total spent
              <b>{formatUsdCents(profile?.total_spent_cents ?? 0)}</b>
            </div>
          </div>

          <div className="actions">
            <Link className="btn btn-accent" href="/topup">
              Top up
            </Link>
            <Link className="btn btn-on-dark" href="/buy">
              Buy a number
            </Link>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <div className="left">
            <div className="eyebrow">Recent orders</div>
            <h2 className="h3" style={{ marginTop: 8 }}>
              Last 5 numbers you bought
            </h2>
          </div>
          <Link href="/orders" className="btn btn-secondary btn-sm">
            View all
          </Link>
        </div>

        {orders && orders.length > 0 ? (
          <div className="flex flex-col gap-3">
            {orders.map((o) => {
              const svc = o.services as { name: string; slug: string } | null;
              const country = (o.countries as { name: string } | null)?.name;
              const display = svc
                ? getServiceDisplay(svc.slug, svc.name)
                : { name: "—", iconClass: "svc-tg", abbr: "??" };
              return (
                <div key={o.id} className="order-card">
                  <BrandLogo
                    slug={svc?.slug ?? ""}
                    abbr={display.abbr}
                    size={36}
                  />
                  <div className="meta">
                    <div className="top">
                      <span className="ttl">{display.name}</span>
                      <span className="badge">{o.status}</span>
                    </div>
                    <div className="num">
                      {o.phone_number}
                      {country ? ` · ${country}` : ""}
                    </div>
                  </div>
                  <div className="right">
                    <span className="price">
                      {formatUsdCents(o.retail_charged_cents)}
                    </span>
                    <Link href={`/orders/${o.id}`} className="caption">
                      View →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card flex flex-col items-center gap-4 text-center" style={{ padding: 48 }}>
            <div className="eyebrow">Nothing yet</div>
            <p className="body" style={{ maxWidth: 360 }}>
              Top up your wallet, then buy a number for any of 5,000+ services
              across 180+ countries.
            </p>
            <Link href="/topup" className="btn btn-primary">
              <span className="dot"></span>
              Top up wallet
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
