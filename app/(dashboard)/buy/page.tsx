import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BuyPicker, type ServiceOption } from "./picker";

export const metadata = {
  title: "Buy a number · Veridigits",
};

export default async function BuyPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Whether this user is an admin gates the technical empty-state message.
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  const isAdmin = !!profile?.is_admin;

  // 1. Distinct service_ids that have at least one in-stock provider_services row.
  const { data: psRows } = await supabase
    .from("provider_services")
    .select("service_id")
    .eq("is_enabled", true)
    .gt("available_count", 0)
    .not("wholesale_price_cents", "is", null);

  const serviceIdsWithStock = new Set<string>();
  for (const r of psRows ?? []) {
    if (r.service_id) serviceIdsWithStock.add(r.service_id);
  }

  let services: ServiceOption[] = [];
  if (serviceIdsWithStock.size > 0) {
    const { data: rows } = await supabase
      .from("services")
      .select("id, slug, name")
      .eq("is_enabled", true)
      .in("id", [...serviceIdsWithStock])
      .order("name", { ascending: true });

    services = (rows ?? []).map((r) => ({ id: r.id, slug: r.slug, name: r.name }));
  }

  if (services.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <div>
          <div className="eyebrow">Buy</div>
          <h1 className="h2" style={{ marginTop: 8 }}>
            Pick a service and country.
          </h1>
        </div>

        <div
          className="card flex flex-col items-center gap-4 text-center"
          style={{ padding: 56 }}
        >
          <div className="eyebrow">We&apos;re refreshing inventory</div>
          <p className="body" style={{ maxWidth: 480 }}>
            Our number catalog is updating. This usually takes a couple of
            minutes — come back shortly and you&apos;ll see services and
            countries here.
          </p>

          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/dashboard" className="btn btn-secondary">
              Back to dashboard
            </Link>
            {isAdmin ? (
              <Link href="/admin/providers" className="btn btn-primary">
                <span className="dot"></span>
                Trigger sync (admin)
              </Link>
            ) : null}
          </div>

          {isAdmin ? (
            <p
              className="caption"
              style={{ maxWidth: 480, marginTop: 12, opacity: 0.7 }}
            >
              Admin note: no <span className="mono">provider_services</span>{" "}
              rows in stock. Run <span className="mono">sync-catalog</span> from{" "}
              <span className="mono">/admin/providers</span> or wait for the 6-hour cron.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="eyebrow">Buy</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Pick a service and country.
        </h1>
        <p className="body" style={{ marginTop: 14, maxWidth: 640 }}>
          Prices on the right are cached and re-quoted live the moment you
          click buy. We never charge a stale price.
        </p>
      </div>

      <BuyPicker services={services} />
    </div>
  );
}
