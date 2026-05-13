import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BuyPicker, type CountryEntry } from "./picker";
import { getServicesForCountry, type ServicePriceOption } from "./actions";

export const metadata = {
  title: "Buy a number · Veridigits",
};

export default async function BuyPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Admin gates the technical empty-state message.
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  const isAdmin = !!profile?.is_admin;

  // Country-first flow: load the countries that have any in-stock listing.
  // Distinct country_ids from provider_services. The 80-ish country count
  // fits in a single query without the URL-length problem that bit us when
  // we tried the same approach with services.
  const { data: psRows } = await supabase
    .from("provider_services")
    .select("country_id")
    .eq("is_enabled", true)
    .gt("available_count", 0)
    .not("wholesale_price_cents", "is", null);

  const countryIdsWithStock = new Set<string>();
  for (const r of psRows ?? []) {
    if (r.country_id) countryIdsWithStock.add(r.country_id);
  }

  let countries: CountryEntry[] = [];
  if (countryIdsWithStock.size > 0) {
    const { data: rows } = await supabase
      .from("countries")
      .select("id, iso_code, name, flag_emoji")
      .eq("is_enabled", true)
      .in("id", [...countryIdsWithStock])
      .order("name", { ascending: true });
    countries = (rows ?? []).map((r) => ({
      id: r.id,
      isoCode: r.iso_code,
      name: r.name,
      flagEmoji: r.flag_emoji,
    }));
  }

  if (countries.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <div>
          <div className="eyebrow">Buy</div>
          <h1 className="h2" style={{ marginTop: 8 }}>
            Pick a country and service.
          </h1>
        </div>

        <div
          className="card flex flex-col items-center gap-4 text-center"
          style={{ padding: 56 }}
        >
          <div className="eyebrow">We&apos;re refreshing inventory</div>
          <p className="body" style={{ maxWidth: 480 }}>
            Our number catalog is updating. This usually takes a couple of
            minutes — come back shortly and you&apos;ll see countries and
            services here.
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

  // Pre-pick the first country alphabetically and fetch its services so the
  // user lands on /buy with the services list populated.
  const initialCountryId = countries[0]?.id ?? null;
  let initialServices: ServicePriceOption[] = [];
  if (initialCountryId) {
    try {
      const result = await getServicesForCountry(initialCountryId);
      if (result.ok) initialServices = result.services;
    } catch {
      // Non-fatal — client will refetch when user interacts.
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="eyebrow">Buy</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Pick a country and service.
        </h1>
        <p className="body" style={{ marginTop: 14, maxWidth: 640 }}>
          Choose a country first to see which services have stock there.
          Prices below are cached and re-quoted live the moment you click buy.
        </p>
      </div>

      <BuyPicker
        countries={countries}
        initialCountryId={initialCountryId}
        initialServices={initialServices}
      />
    </div>
  );
}
