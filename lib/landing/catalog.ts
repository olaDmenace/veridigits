import { createClient } from "@/lib/supabase/server";

/**
 * Public catalog reads for the landing hero. Anonymous RLS allows SELECT on
 * `countries`, `countries_with_stock`, `services`, and `provider_services`, so
 * the unauthenticated homepage can show the same real inventory as /buy. The
 * per-country service list (with live-cached prices) is fetched on demand via
 * the existing `getServicesForCountry` server action — this module only needs
 * to supply the country list for the country-first flow.
 */

export interface LandingCountry {
  id: string;
  iso: string;
  name: string;
  flagEmoji: string | null;
}

/**
 * Every enabled country that currently has in-stock inventory, name-sorted.
 * Reads the `countries_with_stock` view (≈140 rows) rather than scanning the
 * 120k-row `provider_services` table — the same cap-avoidance the /buy page uses.
 */
export async function getLandingCountries(): Promise<LandingCountry[]> {
  const supabase = await createClient();

  const { data: stockRows } = await supabase
    .from("countries_with_stock")
    .select("country_id");

  const ids = new Set<string>();
  for (const r of stockRows ?? []) {
    if (r.country_id) ids.add(r.country_id);
  }
  if (ids.size === 0) return [];

  const { data: rows } = await supabase
    .from("countries")
    .select("id, iso_code, name, flag_emoji")
    .eq("is_enabled", true)
    .in("id", [...ids])
    .order("name", { ascending: true });

  return (rows ?? []).map((r) => ({
    id: r.id,
    iso: r.iso_code,
    name: r.name,
    flagEmoji: r.flag_emoji,
  }));
}
