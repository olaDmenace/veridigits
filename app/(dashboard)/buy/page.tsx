import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BuyPicker, type CountryEntry } from "./picker";
import { getServicesForCountry, type ServicePriceOption } from "./actions";

export const metadata = {
  title: "Buy a number · Veridigits",
};

export default async function BuyPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; service?: string }>;
}) {
  const { country: countryParam, service: serviceParam } = await searchParams;
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

  // Country-first flow: load every country that has any in-stock listing.
  // Read the DB-side `countries_with_stock` view (distinct country_id) rather
  // than selecting from provider_services directly — that table has 120k+ rows
  // and the API caps a plain select at 1000, which dropped low-volume countries
  // (Denmark, etc.) from the picker. The view returns ~80-140 rows, no cap.
  const { data: stockRows } = await supabase
    .from("countries_with_stock")
    .select("country_id");

  const countryIdsWithStock = new Set<string>();
  for (const r of stockRows ?? []) {
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

  // Honor a deep link from the landing hero (?country=<iso>&service=<slug>):
  // resolve the requested country to its id, falling back to the first country
  // alphabetically. The service slug is passed to the picker, which auto-selects
  // it (and fetches a live quote) once that country's services load.
  const requestedIso = countryParam?.trim().toLowerCase();
  const matchedCountry = requestedIso
    ? countries.find((c) => c.isoCode.toLowerCase() === requestedIso)
    : undefined;
  const initialCountryId = matchedCountry?.id ?? countries[0]?.id ?? null;
  const initialServiceSlug = serviceParam?.trim().toLowerCase() || null;
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
        initialServiceSlug={initialServiceSlug}
      />
    </div>
  );
}
