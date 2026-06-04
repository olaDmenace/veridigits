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

/** Higher rank wins. TextVerified is the preferred lane for strict services. */
export const PREFERRED_RANK = 10;

/**
 * Routing rank for a (provider, canonical service slug). Returns PREFERRED_RANK
 * when the provider is the designated primary for that service, else 0.
 */
export function preferenceRankFor(
  providerSlug: string,
  serviceSlug: string,
): number {
  if (
    providerSlug === "textverified" &&
    STRICT_SCREENING_SERVICES.has(serviceSlug)
  ) {
    return PREFERRED_RANK;
  }
  return 0;
}
