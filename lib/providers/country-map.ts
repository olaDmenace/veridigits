/**
 * Canonical country alignment across providers.
 *
 * Our shared `countries.iso_code` is whatever the FIRST provider to sync a
 * country emits as its canonical iso. 5SIM syncs its full catalog and uses its
 * own name-slugs ("usa", "england", "switzerland", "bhutane", "czech") as the
 * country code — so those slugs ARE our canonical iso_codes. For a second
 * provider's rows to MERGE into the same country (and become cross-provider
 * fallback candidates) rather than spawn a duplicate country, it must emit the
 * exact same canonical iso.
 *
 * SMSPool identifies countries by real ISO-3166 alpha-2 (`short_name`: "US",
 * "GB", "CH"), which doesn't match 5SIM's name-slugs. This module bridges the
 * two: ISO-2 -> 5SIM canonical slug.
 *
 * ── How this map was built ──────────────────────────────────────────────────
 * Generated from 5SIM's public catalog, `GET https://5sim.net/v1/guest/countries`,
 * by reading each entry's `iso` object (keyed by alpha-2) -> its slug. To
 * regenerate after 5SIM adds countries, re-pull that endpoint and rebuild.
 *
 * Two things the raw pull gets wrong, fixed by hand below:
 *   - FR: 5SIM assigns iso "fr" to BOTH `france` and `frenchguiana` (the latter
 *     is really GF). The only ISO collision in the dataset. We pin FR -> france;
 *     5SIM's frenchguiana rows still sync under their own slug.
 *
 * Countries SMSPool carries that 5SIM does NOT (Switzerland, Turkey, Japan,
 * Singapore, Ukraine, Iceland, Malta, Qatar, …) have no entry here and fall
 * through to a normalized name-slug — a brand-new canonical country, owned by
 * SMSPool until/unless 5SIM ever adds it under the same slug.
 */

/** ISO-3166 alpha-2 (uppercase) -> 5SIM canonical country slug. */
export const ISO2_TO_FIVESIM_SLUG: Readonly<Record<string, string>> = {
  AF: "afghanistan",
  AL: "albania",
  DZ: "algeria",
  AO: "angola",
  AG: "antiguaandbarbuda",
  AR: "argentina",
  AM: "armenia",
  AW: "aruba",
  AU: "australia",
  AT: "austria",
  AZ: "azerbaijan",
  BS: "bahamas",
  BH: "bahrain",
  BD: "bangladesh",
  BB: "barbados",
  BE: "belgium",
  BZ: "belize",
  BJ: "benin",
  BT: "bhutane",
  BA: "bih",
  BO: "bolivia",
  BW: "botswana",
  BR: "brazil",
  BG: "bulgaria",
  BF: "burkinafaso",
  BI: "burundi",
  KH: "cambodia",
  CM: "cameroon",
  CA: "canada",
  CV: "capeverde",
  TD: "chad",
  CL: "chile",
  CO: "colombia",
  KM: "comoros",
  CG: "congo",
  CR: "costarica",
  HR: "croatia",
  CY: "cyprus",
  CZ: "czech",
  DK: "denmark",
  DJ: "djibouti",
  DO: "dominicana",
  TL: "easttimor",
  EC: "ecuador",
  EG: "egypt",
  GB: "england",
  GQ: "equatorialguinea",
  EE: "estonia",
  ET: "ethiopia",
  FI: "finland",
  FR: "france", // pinned: raw 5SIM data collides FR -> france & frenchguiana
  GA: "gabon",
  GM: "gambia",
  GE: "georgia",
  DE: "germany",
  GH: "ghana",
  GR: "greece",
  GP: "guadeloupe",
  GT: "guatemala",
  GN: "guinea",
  GW: "guineabissau",
  GY: "guyana",
  HT: "haiti",
  HN: "honduras",
  HK: "hongkong",
  HU: "hungary",
  IN: "india",
  ID: "indonesia",
  IE: "ireland",
  IL: "israel",
  IT: "italy",
  CI: "ivorycoast",
  JM: "jamaica",
  JO: "jordan",
  KZ: "kazakhstan",
  KE: "kenya",
  KW: "kuwait",
  KG: "kyrgyzstan",
  LA: "laos",
  LV: "latvia",
  LS: "lesotho",
  LR: "liberia",
  LT: "lithuania",
  LU: "luxembourg",
  MO: "macau",
  MG: "madagascar",
  MW: "malawi",
  MY: "malaysia",
  MV: "maldives",
  MR: "mauritania",
  MU: "mauritius",
  MX: "mexico",
  MD: "moldova",
  MN: "mongolia",
  ME: "montenegro",
  MA: "morocco",
  MZ: "mozambique",
  NA: "namibia",
  NP: "nepal",
  NL: "netherlands",
  NC: "newcaledonia",
  NI: "nicaragua",
  NG: "nigeria",
  MK: "northmacedonia",
  NO: "norway",
  OM: "oman",
  PK: "pakistan",
  PA: "panama",
  PG: "papuanewguinea",
  PY: "paraguay",
  PE: "peru",
  PH: "philippines",
  PL: "poland",
  PT: "portugal",
  PR: "puertorico",
  RE: "reunion",
  RO: "romania",
  RW: "rwanda",
  KN: "saintkittsandnevis",
  LC: "saintlucia",
  VC: "saintvincentandgrenadines",
  SV: "salvador",
  WS: "samoa",
  SA: "saudiarabia",
  SN: "senegal",
  RS: "serbia",
  SC: "seychelles",
  SL: "sierraleone",
  SK: "slovakia",
  SI: "slovenia",
  SB: "solomonislands",
  ZA: "southafrica",
  ES: "spain",
  LK: "srilanka",
  SR: "suriname",
  SZ: "swaziland",
  SE: "sweden",
  TW: "taiwan",
  TJ: "tajikistan",
  TZ: "tanzania",
  TH: "thailand",
  TT: "tit",
  TG: "togo",
  TN: "tunisia",
  TM: "turkmenistan",
  UG: "uganda",
  UY: "uruguay",
  US: "usa",
  UZ: "uzbekistan",
  VE: "venezuela",
  VN: "vietnam",
  ZM: "zambia",
};

/**
 * Normalize a country name to a 5SIM-style slug: lowercase, alphanumerics only.
 * Matches 5SIM's compact convention ("United States" would be "unitedstates",
 * "Switzerland" -> "switzerland") so a future 5SIM entry under the same slug
 * merges cleanly. Returns "" when the name has no alphanumerics.
 */
export function normCountry(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Resolve a provider's (alpha-2 short name, display name) to the canonical
 * country iso our shared `countries` table keys on.
 *
 * Prefers the verified ISO-2 -> 5SIM-slug bridge so the row MERGES with 5SIM;
 * falls back to a normalized name-slug for countries 5SIM doesn't carry (a new
 * canonical country). Returns null only when neither yields a usable slug.
 */
export function canonicalCountryIso(
  shortName: string | null | undefined,
  name: string | null | undefined,
): string | null {
  const iso2 = String(shortName ?? "").trim().toUpperCase();
  const mapped = ISO2_TO_FIVESIM_SLUG[iso2];
  if (mapped) return mapped;
  const slug = normCountry(name ?? "");
  return slug.length > 0 ? slug : null;
}
