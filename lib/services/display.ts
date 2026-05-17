/**
 * Service display helpers — maps the lowercase upstream slug ("whatsapp")
 * to a proper display name ("WhatsApp"), a brand-accurate badge color
 * class, and a 2-char abbreviation for the badge.
 *
 * Used everywhere we render a service tile in the UI. Unknown slugs fall
 * back to a deterministic-hash palette so the UI never looks broken when
 * a new service shows up in the catalog before we've curated it.
 */

export interface ServiceDisplay {
  name: string;
  iconClass: string;
  abbr: string;
}

const FALLBACK_PALETTE = [
  "svc-tg",
  "svc-wa",
  "svc-go",
  "svc-tk",
  "svc-di",
  "svc-ig",
  "svc-fb",
  "svc-x",
  "svc-sn",
  "svc-yt",
  "svc-rd",
  "svc-li",
];

/**
 * Curated overrides — the top services users actually look for. Keep
 * additions ordered alphabetically by slug to avoid merge conflicts.
 */
const OVERRIDES: Record<string, ServiceDisplay> = {
  airbnb:      { name: "Airbnb",      iconClass: "svc-x",  abbr: "ab" },
  amazon:      { name: "Amazon",      iconClass: "svc-yt", abbr: "az" },
  apple:       { name: "Apple",       iconClass: "svc-x",  abbr: "ap" },
  badoo:       { name: "Badoo",       iconClass: "svc-md", abbr: "bd" },
  binance:     { name: "Binance",     iconClass: "svc-sn", abbr: "bn" },
  bumble:      { name: "Bumble",      iconClass: "svc-sn", abbr: "bm" },
  bybit:       { name: "Bybit",       iconClass: "svc-go", abbr: "by" },
  coinbase:    { name: "Coinbase",    iconClass: "svc-di", abbr: "cb" },
  craigslist:  { name: "Craigslist",  iconClass: "svc-md", abbr: "cl" },
  discord:     { name: "Discord",     iconClass: "svc-di", abbr: "ds" },
  doordash:    { name: "DoorDash",    iconClass: "svc-go", abbr: "dd" },
  ebay:        { name: "eBay",        iconClass: "svc-fb", abbr: "eb" },
  facebook:    { name: "Facebook",    iconClass: "svc-fb", abbr: "fb" },
  github:      { name: "GitHub",      iconClass: "svc-x",  abbr: "gh" },
  gmail:       { name: "Gmail",       iconClass: "svc-go", abbr: "gm" },
  google:      { name: "Google",      iconClass: "svc-go", abbr: "G" },
  grindr:      { name: "Grindr",      iconClass: "svc-yt", abbr: "gr" },
  hinge:       { name: "Hinge",       iconClass: "svc-md", abbr: "hg" },
  hotmail:     { name: "Hotmail",     iconClass: "svc-fb", abbr: "hm" },
  imo:         { name: "imo",         iconClass: "svc-li", abbr: "im" },
  instagram:   { name: "Instagram",   iconClass: "svc-ig", abbr: "ig" },
  kakaotalk:   { name: "KakaoTalk",   iconClass: "svc-sn", abbr: "kk" },
  kucoin:      { name: "KuCoin",      iconClass: "svc-wa", abbr: "kc" },
  line:        { name: "LINE",        iconClass: "svc-wa", abbr: "ln" },
  linkedin:    { name: "LinkedIn",    iconClass: "svc-li", abbr: "li" },
  lyft:        { name: "Lyft",        iconClass: "svc-md", abbr: "lf" },
  match:       { name: "Match",       iconClass: "svc-md", abbr: "mt" },
  meta:        { name: "Meta",        iconClass: "svc-fb", abbr: "mt" },
  microsoft:   { name: "Microsoft",   iconClass: "svc-li", abbr: "ms" },
  netflix:     { name: "Netflix",     iconClass: "svc-yt", abbr: "nf" },
  openai:      { name: "OpenAI",      iconClass: "svc-x",  abbr: "oa" },
  outlook:     { name: "Outlook",     iconClass: "svc-fb", abbr: "ol" },
  paypal:      { name: "PayPal",      iconClass: "svc-li", abbr: "pp" },
  pinterest:   { name: "Pinterest",   iconClass: "svc-yt", abbr: "pn" },
  reddit:      { name: "Reddit",      iconClass: "svc-rd", abbr: "rd" },
  signal:      { name: "Signal",      iconClass: "svc-li", abbr: "sg" },
  skype:       { name: "Skype",       iconClass: "svc-tg", abbr: "sk" },
  snapchat:    { name: "Snapchat",    iconClass: "svc-sn", abbr: "sn" },
  spotify:     { name: "Spotify",     iconClass: "svc-wa", abbr: "sp" },
  steam:       { name: "Steam",       iconClass: "svc-x",  abbr: "st" },
  telegram:    { name: "Telegram",    iconClass: "svc-tg", abbr: "tg" },
  tiktok:      { name: "TikTok",      iconClass: "svc-tk", abbr: "tk" },
  tinder:      { name: "Tinder",      iconClass: "svc-yt", abbr: "tn" },
  twilio:      { name: "Twilio",      iconClass: "svc-yt", abbr: "tw" },
  twitch:      { name: "Twitch",      iconClass: "svc-di", abbr: "tw" },
  twitter:     { name: "X (Twitter)", iconClass: "svc-x",  abbr: "x" },
  uber:        { name: "Uber",        iconClass: "svc-x",  abbr: "ub" },
  viber:       { name: "Viber",       iconClass: "svc-di", abbr: "vb" },
  vk:          { name: "VK",          iconClass: "svc-fb", abbr: "vk" },
  wechat:      { name: "WeChat",      iconClass: "svc-wa", abbr: "wc" },
  whatsapp:    { name: "WhatsApp",    iconClass: "svc-wa", abbr: "wa" },
  x:           { name: "X (Twitter)", iconClass: "svc-x",  abbr: "x" },
  yahoo:       { name: "Yahoo",       iconClass: "svc-md", abbr: "yh" },
  youtube:     { name: "YouTube",     iconClass: "svc-yt", abbr: "yt" },
  zoom:        { name: "Zoom",        iconClass: "svc-tg", abbr: "zm" },
};

function abbrFallback(slug: string): string {
  const cleaned = slug.replace(/[^a-z0-9]/gi, "");
  return (cleaned.slice(0, 2) || "??").toLowerCase();
}

function paletteForSlug(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length];
}

function titleCase(slug: string): string {
  return slug
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function getServiceDisplay(
  slug: string,
  fallbackName?: string,
): ServiceDisplay {
  const lower = slug.toLowerCase();
  const hit = OVERRIDES[lower];
  if (hit) return hit;
  return {
    name: fallbackName && fallbackName.length > 0
      ? fallbackName
      : titleCase(slug),
    iconClass: paletteForSlug(slug),
    abbr: abbrFallback(slug),
  };
}
