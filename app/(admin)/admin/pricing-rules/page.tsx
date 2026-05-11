import { getAdminClient } from "@/lib/supabase/admin";
import { RulesTable, type AdminRule, type NamedOption } from "./rules-table";

export const metadata = { title: "Pricing rules · Admin" };

export default async function PricingRulesPage() {
  const admin = getAdminClient();

  const [{ data: ruleRows }, { data: serviceRows }, { data: countryRows }] =
    await Promise.all([
      admin
        .from("pricing_rules")
        .select(
          "id, service_id, country_id, markup_percent, flat_fee_cents, min_retail_cents, priority, is_active",
        )
        .order("priority", { ascending: false }),
      admin
        .from("services")
        .select("id, name, slug")
        .eq("is_enabled", true)
        .order("name", { ascending: true }),
      admin
        .from("countries")
        .select("id, name, iso_code")
        .eq("is_enabled", true)
        .order("name", { ascending: true }),
    ]);

  const rules: AdminRule[] = (ruleRows ?? []).map((r) => ({
    ...r,
    markup_percent: Number(r.markup_percent),
  }));

  // Sort: global default first (so it's always visible up top), then by
  // specificity desc, then priority desc.
  rules.sort((a, b) => {
    const aGlobal = a.service_id === null && a.country_id === null;
    const bGlobal = b.service_id === null && b.country_id === null;
    if (aGlobal !== bGlobal) return aGlobal ? -1 : 1;
    const aSpec =
      (a.service_id ? 2 : 0) + (a.country_id ? 1 : 0);
    const bSpec =
      (b.service_id ? 2 : 0) + (b.country_id ? 1 : 0);
    if (aSpec !== bSpec) return bSpec - aSpec;
    return b.priority - a.priority;
  });

  const services: NamedOption[] = (serviceRows ?? []).map((s) => ({
    id: s.id,
    label: `${s.name} (${s.slug})`,
  }));
  const countries: NamedOption[] = (countryRows ?? []).map((c) => ({
    id: c.id,
    label: `${c.name} (${c.iso_code.toUpperCase()})`,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Pricing rules
        </h1>
        <p className="body" style={{ marginTop: 14, maxWidth: 640 }}>
          Each retail price is calculated as{" "}
          <span className="mono">
            wholesale × (1 + markup) + flat_fee
          </span>
          , floored at <span className="mono">min_retail</span>. The most
          specific active rule wins.
        </p>
      </div>

      <RulesTable
        rules={rules}
        services={services}
        countries={countries}
      />
    </div>
  );
}
