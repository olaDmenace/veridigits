/**
 * Provider routing preference — the source of truth for which provider is
 * "primary" for which services. Applied by the catalog sync (and seedable
 * directly), it sets provider_services.preference_rank so the registry's
 * hard-preference routing picks the preferred provider first and falls back to
 * the rest automatically.
 *
 * Today: TextVerified (real, non-VoIP US numbers) is primary for the services
 * that are notoriously hard to verify with virtual numbers. Edit the set below
 * to widen/narrow it; the next sync (or a re-seed) applies the change.
 */

/** Canonical service slugs (shared `services.slug`) that should prefer TextVerified. */
export const STRICT_SCREENING_SERVICES = new Set<string>([
  // messaging / social — aggressive virtual-number screening
  "whatsapp",
  "telegram",
  "signal",
  "instagram",
  "facebook",
  "snapchat",
  "discord",
  "twitter",
  // google / apple / microsoft accounts
  "google",
  "googlevoice",
  "apple",
  "microsoft",
  // dating — heavy SMS-screening (virtual numbers ~0% here; e.g. POF/USA is
  // 0% on every 5SIM operator, so these must go to real numbers or show
  // out-of-stock rather than sell a guaranteed-fail activation)
  "tinder",
  "bumble",
  "hinge",
  "pof",
  "okcupid",
  "grindr",
  "badoo",
  "match",
  // fintech / crypto — strict KYC-adjacent SMS
  "paypal",
  "venmo",
  "cashapp",
  "coinbase",
  // marketplaces / gig / misc that block VoIP
  "amazon",
  "airbnb",
  "uber",
  "lyft",
  "doordash",
  "netflix",
  "openai",
  "ticketmaster",
]);

/**
 * Providers temporarily excluded from routing — e.g. unfunded upstream balance.
 * Their catalog rows still SYNC (so nothing is lost), but getQuote won't route
 * to them, so orders fall to the next-best provider (5SIM's delivery-ranked
 * operators) instead of hard-failing at purchase against an account with no
 * balance. The purchase flow has no provider fallback, so this gate is how we
 * avoid sending users to a provider that can't fulfill.
 *
 * Remove a slug here the moment its balance is funded — its rows are already in
 * the catalog, so it goes live immediately on the next quote.
 */
export const DISABLED_PROVIDERS = new Set<string>([]);

/** Whether routing may select this provider right now. */
export function isProviderRoutable(providerSlug: string): boolean {
  return !DISABLED_PROVIDERS.has(providerSlug);
}

/** Higher rank wins. Marks the preferred (quality) lane for a service+country. */
export const PREFERRED_RANK = 10;

/** Canonical country iso (shared `countries.iso_code`) for the UK. 5SIM uses this. */
export const UK_COUNTRY_ISO = "england";

/**
 * Routing rank for a (provider, canonical service slug, canonical country iso).
 * Returns PREFERRED_RANK when the provider is the designated quality lane for
 * that service+country, else 0. This is a SOFT signal (a high cold-start prior
 * in scoring), not a hard override — a proven, cheaper alternative still wins.
 *
 *  - US strict-screening services  -> TextVerified (real US numbers).
 *  - UK strict-screening services  -> SMSPool (non-VoIP UK; TextVerified is
 *    US-only, so SMSPool is the best lane there, with 5SIM as backup).
 */
export function preferenceRankFor(
  providerSlug: string,
  serviceSlug: string,
  countryIso?: string | null,
): number {
  if (!STRICT_SCREENING_SERVICES.has(serviceSlug)) return 0;

  if (providerSlug === "textverified") return PREFERRED_RANK;
  if (providerSlug === "smspool" && countryIso === UK_COUNTRY_ISO) {
    return PREFERRED_RANK;
  }
  return 0;
}
