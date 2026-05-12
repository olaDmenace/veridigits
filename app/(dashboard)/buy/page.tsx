import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BuyPicker, type ServiceOption } from "./picker";
import { getCountriesForService, type CountryOption } from "./actions";

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

  // We deliberately don't pre-filter services by "has stock" here. The
  // 5SIM catalog has 500+ services, and threading every in-stock service
  // id through an `.in()` filter builds a ~20KB URL that fails at Vercel
  // edge / PostgREST limits. Instead we show all enabled services; the
  // country picker (getCountriesForService) does the per-service stock
  // check live and renders "no stock right now" if the catalog is empty
  // for that service.
  const { data: rows } = await supabase
    .from("services")
    .select("id, slug, name")
    .eq("is_enabled", true)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true })
    .limit(1000);

  const services: ServiceOption[] = (rows ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
  }));

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

  // Pre-pick the first service and load its countries server-side. The
  // user lands on /buy and the country panel is already populated for
  // the most prominent service. They can change service freely from
  // there — the action re-fetches on every selection.
  const initialServiceId = services[0]?.id ?? null;
  let initialCountries: CountryOption[] = [];
  if (initialServiceId) {
    try {
      const result = await getCountriesForService(initialServiceId);
      if (result.ok) initialCountries = result.countries;
    } catch {
      // Non-fatal: picker will load via client action on first interaction.
    }
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

      <BuyPicker
        services={services}
        initialServiceId={initialServiceId}
        initialCountries={initialCountries}
      />
    </div>
  );
}
