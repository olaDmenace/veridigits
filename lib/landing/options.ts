/**
 * Curated service + country options for the public landing hero selector.
 *
 * These are intentionally a popular SUBSET, not the live catalog — the homepage
 * is unauthenticated and the full catalog (139+ countries, 5,000+ services) is
 * auth-gated and re-quoted at purchase time. The hero lets a visitor express
 * intent ("WhatsApp, UK"); that selection is carried through signup/login and
 * pre-fills the real /buy picker, where live stock + price are resolved.
 *
 * Country `iso` values match the real `countries.iso_code` slugs (usa, england,
 * …) so the deep link resolves on the buy page. `fromCents` is an indicative
 * starting price (matches the Services section), shown as "from $X".
 */

export interface PopularService {
  slug: string;
  abbr: string;
  name: string;
  fromCents: number;
}

export interface PopularCountry {
  /** Matches countries.iso_code so /buy can resolve it. */
  iso: string;
  name: string;
  flag: string;
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

export const POPULAR_COUNTRIES: PopularCountry[] = [
  { iso: "usa", name: "United States", flag: "🇺🇸" },
  { iso: "england", name: "United Kingdom", flag: "🇬🇧" },
  { iso: "canada", name: "Canada", flag: "🇨🇦" },
  { iso: "germany", name: "Germany", flag: "🇩🇪" },
  { iso: "france", name: "France", flag: "🇫🇷" },
  { iso: "netherlands", name: "Netherlands", flag: "🇳🇱" },
  { iso: "spain", name: "Spain", flag: "🇪🇸" },
  { iso: "italy", name: "Italy", flag: "🇮🇹" },
  { iso: "poland", name: "Poland", flag: "🇵🇱" },
  { iso: "nigeria", name: "Nigeria", flag: "🇳🇬" },
  { iso: "india", name: "India", flag: "🇮🇳" },
  { iso: "indonesia", name: "Indonesia", flag: "🇮🇩" },
  { iso: "philippines", name: "Philippines", flag: "🇵🇭" },
  { iso: "brazil", name: "Brazil", flag: "🇧🇷" },
  { iso: "mexico", name: "Mexico", flag: "🇲🇽" },
  { iso: "vietnam", name: "Vietnam", flag: "🇻🇳" },
];
