/**
 * Static landing-page lookups.
 *
 * - POPULAR_SERVICES: the curated tiles shown in the marketing "Services"
 *   section. (The hero now reads the live catalog, not this list.)
 * - COUNTRY_FLAGS: iso_code → flag emoji. The `countries` table stores
 *   flag_emoji as null, so the UI supplies flags here; unknown isos fall back
 *   to the two-letter code (same as the /buy picker).
 */

export interface PopularService {
  slug: string;
  abbr: string;
  name: string;
  fromCents: number;
}

export const POPULAR_SERVICES: PopularService[] = [
  { slug: "telegram", abbr: "tg", name: "Telegram", fromCents: 15 },
  { slug: "whatsapp", abbr: "wa", name: "WhatsApp", fromCents: 25 },
  { slug: "google", abbr: "G", name: "Google", fromCents: 18 },
  { slug: "tiktok", abbr: "tk", name: "TikTok", fromCents: 22 },
  { slug: "discord", abbr: "di", name: "Discord", fromCents: 12 },
  { slug: "instagram", abbr: "ig", name: "Instagram", fromCents: 30 },
  { slug: "facebook", abbr: "fb", name: "Facebook", fromCents: 28 },
  { slug: "x", abbr: "x", name: "X (Twitter)", fromCents: 20 },
  { slug: "snapchat", abbr: "sn", name: "Snapchat", fromCents: 22 },
  { slug: "uber", abbr: "ub", name: "Uber", fromCents: 35 },
  { slug: "tinder", abbr: "tn", name: "Tinder", fromCents: 38 },
];

/** Upstream-slug iso_code → flag emoji (DB stores null). */
export const COUNTRY_FLAGS: Record<string, string> = {
  usa: "🇺🇸",
  england: "🇬🇧",
  canada: "🇨🇦",
  germany: "🇩🇪",
  france: "🇫🇷",
  netherlands: "🇳🇱",
  spain: "🇪🇸",
  italy: "🇮🇹",
  poland: "🇵🇱",
  portugal: "🇵🇹",
  ireland: "🇮🇪",
  sweden: "🇸🇪",
  norway: "🇳🇴",
  denmark: "🇩🇰",
  finland: "🇫🇮",
  belgium: "🇧🇪",
  austria: "🇦🇹",
  switzerland: "🇨🇭",
  romania: "🇷🇴",
  ukraine: "🇺🇦",
  russia: "🇷🇺",
  turkey: "🇹🇷",
  greece: "🇬🇷",
  czech: "🇨🇿",
  hungary: "🇭🇺",
  nigeria: "🇳🇬",
  ghana: "🇬🇭",
  kenya: "🇰🇪",
  southafrica: "🇿🇦",
  egypt: "🇪🇬",
  morocco: "🇲🇦",
  india: "🇮🇳",
  indonesia: "🇮🇩",
  philippines: "🇵🇭",
  vietnam: "🇻🇳",
  thailand: "🇹🇭",
  malaysia: "🇲🇾",
  pakistan: "🇵🇰",
  bangladesh: "🇧🇩",
  china: "🇨🇳",
  hongkong: "🇭🇰",
  japan: "🇯🇵",
  cambodia: "🇰🇭",
  myanmar: "🇲🇲",
  laos: "🇱🇦",
  brazil: "🇧🇷",
  mexico: "🇲🇽",
  argentina: "🇦🇷",
  colombia: "🇨🇴",
  chile: "🇨🇱",
  peru: "🇵🇪",
  australia: "🇦🇺",
  newzealand: "🇳🇿",
  israel: "🇮🇱",
  saudiarabia: "🇸🇦",
  uae: "🇦🇪",
};

/** Flag for an iso_code, or the uppercased code as a fallback badge. */
export function flagFor(iso: string): string {
  return COUNTRY_FLAGS[iso.toLowerCase()] ?? iso.slice(0, 2).toUpperCase();
}
