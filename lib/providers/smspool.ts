import {
  ProviderApiError,
  ProviderOutOfStockError,
  type ActivationBuyParams,
  type OtpProvider,
  type PriceLookupParams,
  type ProviderBuyResult,
  type ProviderCatalogEntry,
  type ProviderMessage,
  type ProviderOrderState,
  type ProviderOrderStatus,
  type ProviderPriceQuote,
  type RentalBuyParams,
} from "./types";
import { canonicalCountryIso, flagEmoji } from "./country-map";

/**
 * SMSPool upstream provider.
 *
 * Base: https://api.smspool.net — all calls accept GET or POST; responses JSON.
 * The API key is passed as the `key` form/query param. Catalog endpoints
 * (`/country/retrieve_all`, `/service/retrieve_all`) are unauthenticated.
 *
 * Used as a non-VoIP alternative to 5SIM. Selection/fallback is handled by
 * the registry — this class only speaks the SMSPool API behind the common
 * OtpProvider interface.
 *
 * ─── VERIFY-ON-FIRST-PAID-ORDER ────────────────────────────────────────────
 * Catalog endpoints are confirmed live (sync pulls /country/retrieve_all +
 * /request/pricing). Two purchase-path response shapes are still coded from
 * SMSPool's documented contract, not a real order — confirm each against one
 * live paid order, then delete this banner:
 *   1) mapCheckStatus() — the numeric /sms/check status → our status mapping.
 *      A wrong "received" code would mis-fire capture/charge.
 *   2) parsePurchase()  — field names on the /purchase/sms response.
 */
export class SmsPoolProvider implements OtpProvider {
  readonly slug = "smspool";
  readonly displayName = "SMSPool";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.smspool.net") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getPriceAndAvailability(
    params: PriceLookupParams,
  ): Promise<ProviderPriceQuote> {
    const body = await this.post<SmsPoolPrice>("/request/price", {
      country: params.upstreamCountryCode,
      service: params.upstreamServiceCode,
    });

    const price = toNumber(body.price);
    if (price <= 0) {
      return { priceCents: 0, availableCount: 0 };
    }

    // SMSPool returns a price when a service/country is purchasable but does
    // not expose a precise stock count. If the response carries one of the
    // known availability fields, use it; otherwise treat a valid price as
    // "in stock" with a sentinel count so the registry can rank it. The
    // upstream buy is the real availability check (it errors when sold out).
    const available =
      pickNumber(body.available, body.amount, body.stock, body.count) ??
      AVAILABILITY_SENTINEL;

    return { priceCents: Math.round(price * 100), availableCount: available };
  }

  async buyActivation(params: ActivationBuyParams): Promise<ProviderBuyResult> {
    const body = await this.post<SmsPoolPurchase>("/purchase/sms", {
      country: params.upstreamCountryCode,
      service: params.upstreamServiceCode,
    });
    return parsePurchase(this.slug, body);
  }

  rentNumber(_params: RentalBuyParams): Promise<ProviderBuyResult> {
    // SMSPool rentals use a separate /purchase/rental flow with its own
    // duration products. Not wired yet — the registry should not route rental
    // orders to SMSPool until this is implemented.
    throw new ProviderApiError(this.slug, "rental not supported yet");
  }

  async checkOrder(upstreamOrderId: string): Promise<ProviderOrderState> {
    const body = await this.post<SmsPoolCheck>("/sms/check", {
      orderid: upstreamOrderId,
    });

    const status = mapCheckStatus(body.status);
    const messages: ProviderMessage[] = [];
    // SMSPool's /sms/check exposes the code under a few field names depending on
    // endpoint/version (full_sms / sms / full_code / code). Read whichever is
    // present so a delivered code is never missed.
    const text =
      stringOrNull(body.full_sms) ??
      stringOrNull(body.sms) ??
      stringOrNull(body.full_code) ??
      stringOrNull(body.code) ??
      null;
    if (status === "received" && text) {
      messages.push({
        sender: stringOrNull(body.service) ?? "SMSPool",
        content: text,
        // SMSPool doesn't return a per-message timestamp; the code lands at
        // check time, so "now" is the best available signal.
        receivedAt: new Date(),
      });
    }
    return { status, messages };
  }

  async getBalance(): Promise<number | null> {
    try {
      const b = await this.post<{ balance?: string | number }>(
        "/request/balance",
        {},
      );
      const n = toNumber(b.balance);
      return Number.isFinite(n) && n >= 0 ? n : null;
    } catch {
      return null;
    }
  }

  async finishOrder(_upstreamOrderId: string): Promise<void> {
    // SMSPool has no explicit finish step — an order with a delivered code is
    // already terminal upstream. No-op.
  }

  async cancelOrder(upstreamOrderId: string): Promise<void> {
    const body = await this.post<SmsPoolCancel>("/sms/cancel", {
      orderid: upstreamOrderId,
    });
    if (body.success === 0 || body.success === false) {
      throw new ProviderApiError(
        this.slug,
        `cancel failed: ${stringOrNull(body.message) ?? "unknown"}`,
      );
    }
  }

  async syncCatalog(): Promise<ProviderCatalogEntry[]> {
    // Sync SMSPool's FULL country catalog. Each country's bulk price book
    // (/request/pricing?country=N) returns every service × pool in ONE call, so
    // the per-country cost is a single GET; we collapse pools to the cheapest
    // price per service and emit one row each.
    //
    // Each country is aligned to a canonical iso (canonicalCountryIso): the
    // 123 countries 5SIM also carries MERGE into 5SIM's existing rows (so they
    // become cross-provider fallback candidates); the ~26 SMSPool-exclusive
    // countries (Switzerland, Turkey, Japan, Singapore, …) become brand-new
    // canonical countries — coverage 5SIM can't provide.
    //
    // serviceSlug is the canonical slug shared with 5SIM/TextVerified:
    //   - curated, hand-verified slugs (SMSPOOL_SERVICE_SLUGS) take precedence;
    //   - everything else is slugify(name) — compact + lowercase, matching
    //     5SIM's slug shape so the same logical service merges across providers.
    const countriesRaw = await this.get<unknown>("/country/retrieve_all");
    const countries = normalizeCountryList(countriesRaw);
    if (countries.length === 0) {
      throw new ProviderApiError(
        this.slug,
        "country list empty or unrecognized shape",
      );
    }

    // Real, buyable countries only: need an id + alpha-2, and skip SMSPool's
    // virtual pools ("US_V", "AU_V") — merging those into a real country would
    // mix virtual and physical numbers under a single listing.
    const targets = countries.filter((c) => {
      const id = idOf(c.ID ?? c.id);
      const short = String(c.short_name ?? "");
      return Boolean(id) && short.length > 0 && !short.includes("_");
    });

    // Bounded concurrency: ~150 sequential price-book calls would push the sync
    // toward the function timeout; a small pool keeps it well within it without
    // hammering SMSPool. Results stay in country order (index-preserving).
    const batches = await mapWithConcurrency(targets, SYNC_CONCURRENCY, (c) =>
      this.syncCountry(c).catch((err) => {
        // One country's failure is isolated; the rest of the catalog still syncs.
        console.warn(
          `[smspool] ${c.name ?? c.short_name ?? "?"} sync failed — skipping: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return [] as ProviderCatalogEntry[];
      }),
    );
    const out = batches.flat();

    // Every country returned an empty/failed price book — the country or pricing
    // endpoint shape likely changed. Surface it rather than syncing nothing.
    if (out.length === 0) {
      throw new ProviderApiError(
        this.slug,
        `no priced services across ${targets.length} countries — catalog shape may have changed`,
      );
    }

    return out;
  }

  /** Build the catalog entries for a single SMSPool country (one price-book call). */
  private async syncCountry(
    country: SmsPoolCountry,
  ): Promise<ProviderCatalogEntry[]> {
    const countryId = idOf(country.ID ?? country.id);
    if (!countryId) return [];
    const canonicalIso = canonicalCountryIso(country.short_name, country.name);
    if (!canonicalIso) return [];
    const displayName = stringOrNull(country.name) ?? canonicalIso;
    // SMSPool's short_name IS the ISO-2, so we can resolve a flag even for the
    // exclusive countries whose canonical iso is a name-slug (no bridge entry).
    const countryFlag = flagEmoji(country.short_name);

    // Bulk price book: one call, every service × pool for this country.
    const pricingRaw = await this.get<unknown>(
      `/request/pricing?country=${encodeURIComponent(countryId)}`,
    );
    const rows: SmsPoolPricingRow[] = Array.isArray(pricingRaw)
      ? (pricingRaw as SmsPoolPricingRow[])
      : [];

    // Collapse pools → cheapest purchasable price per service. The buy call
    // sends no pool, so SMSPool auto-selects; the cheapest pool is the best
    // proxy for what we'll pay (live re-quote at purchase is authoritative).
    const cheapest = new Map<string, { name: string; priceCents: number }>();
    for (const r of rows) {
      const sid = idOf(r.service);
      const name = stringOrNull(r.service_name);
      const cents = Math.round(toNumber(r.price) * 100);
      if (!sid || !name || cents <= 0) continue;
      const ex = cheapest.get(sid);
      if (!ex || cents < ex.priceCents) cheapest.set(sid, { name, priceCents: cents });
    }
    if (cheapest.size === 0) return [];

    // Published success rate is one extra /request/price call per curated
    // service — bound the cost to the high-value countries (US/UK), where the
    // dating/hard services live. Everywhere else starts on a null prior: the
    // scorer treats that as neutral and our measured 7-day stats take over as
    // orders flow.
    const successById = new Map<string, number>();
    if (ENRICH_COUNTRIES.has(String(country.short_name ?? "").toUpperCase())) {
      for (const sid of Object.keys(SMSPOOL_SERVICE_SLUGS)) {
        if (!cheapest.has(sid)) continue;
        try {
          const p = await this.post<SmsPoolPrice>("/request/price", {
            country: countryId,
            service: sid,
          });
          const sr = toNumber(p.success_rate);
          if (Number.isFinite(sr) && sr > 0) {
            successById.set(sid, Math.max(0, Math.min(100, sr)));
          }
        } catch {
          // leave null — long-tail behavior; live re-quote still works
        }
      }
    }

    // Build entries keyed by canonical slug so two upstream names that slugify
    // alike don't both resolve to the same (service, country) row downstream and
    // get dropped by the reconcile dedup. Curated wins a collision; otherwise
    // the cheaper price wins.
    type Tagged = ProviderCatalogEntry & { _curated: boolean };
    const bySlug = new Map<string, Tagged>();
    for (const [sid, info] of cheapest) {
      const curatedSlug = SMSPOOL_SERVICE_SLUGS[sid];
      const slug = curatedSlug ?? slugify(info.name);
      if (!slug) continue;
      const entry: Tagged = {
        upstreamServiceCode: sid,
        upstreamServiceName: info.name,
        upstreamCountryCode: countryId,
        upstreamOperator: "default",
        priceCents: info.priceCents,
        availableCount: AVAILABILITY_SENTINEL,
        serviceSlug: slug,
        countryIso: canonicalIso,
        countryName: displayName,
        countryFlag,
        publishedSuccessRate: successById.get(sid) ?? null,
        _curated: Boolean(curatedSlug),
      };
      const ex = bySlug.get(slug);
      if (!ex) {
        bySlug.set(slug, entry);
      } else if (entry._curated && !ex._curated) {
        bySlug.set(slug, entry);
      } else if (entry._curated === ex._curated && entry.priceCents < ex.priceCents) {
        bySlug.set(slug, entry);
      }
    }

    const entries: ProviderCatalogEntry[] = [];
    for (const e of bySlug.values()) {
      const { _curated, ...rest } = e;
      void _curated;
      entries.push(rest);
    }
    return entries;
  }

  /** GET for catalog endpoints (key appended — SMSPool accepts/expects it). */
  private async get<T>(path: string): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}${path}${sep}key=${encodeURIComponent(this.apiKey)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      throw new ProviderApiError(
        this.slug,
        `${path} returned ${res.status}: ${text.slice(0, 200)}`,
        res.status,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderApiError(
        this.slug,
        `${path}: non-JSON response: ${text.slice(0, 200)}`,
      );
    }
  }

  // ── transport ────────────────────────────────────────────────────────────

  /** POST a form-encoded body (api key injected). Key never goes in the URL. */
  private async post<T>(
    path: string,
    fields: Record<string, string>,
  ): Promise<T> {
    const form = new URLSearchParams({ key: this.apiKey, ...fields });
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form,
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      if (/out of stock|no (stock|numbers)|sold out/i.test(text)) {
        throw new ProviderOutOfStockError(this.slug, text.slice(0, 200));
      }
      throw new ProviderApiError(
        this.slug,
        `${path} returned ${res.status}: ${text.slice(0, 200)}`,
        res.status,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderApiError(
        this.slug,
        `${path}: non-JSON response: ${text.slice(0, 200)}`,
      );
    }
    return json as T;
  }
}

// ── response shapes (documented; verify field names on first live run) ──────
interface SmsPoolPrice {
  price?: string | number;
  cost?: string | number;
  /** Published per-service success rate, 0-100. */
  success_rate?: string | number;
  available?: string | number;
  amount?: string | number;
  stock?: string | number;
  count?: string | number;
}
interface SmsPoolPurchase {
  success?: number | boolean;
  order_id?: string | number;
  number?: string;
  phonenumber?: string;
  cc?: string;
  expires_in?: string | number;
  cost?: string | number;
  message?: string;
}
interface SmsPoolCheck {
  status?: number | string;
  sms?: string | null;
  full_sms?: string | null;
  code?: string | null;
  full_code?: string | null;
  service?: string | null;
}
interface SmsPoolCancel {
  success?: number | boolean;
  message?: string;
}
interface SmsPoolCountry {
  ID?: string | number;
  id?: string | number;
  name?: string;
  short_name?: string;
  cc?: string | number;
  region?: string;
}
/** One row of the bulk price book (/request/pricing?country=N): a service in a
 *  given pool with its wholesale price. One service spans multiple pools. */
interface SmsPoolPricingRow {
  service?: string | number;
  service_name?: string;
  country?: string | number;
  pool?: string | number;
  price?: string | number;
}

/** SMSPool buy result → common shape. Throws on a non-success payload. */
function parsePurchase(
  slug: string,
  body: SmsPoolPurchase,
): ProviderBuyResult {
  const ok = body.success === 1 || body.success === true;
  if (!ok || body.order_id == null) {
    const msg = stringOrNull(body.message) ?? "purchase failed";
    if (/out of stock|no (stock|numbers)|sold out/i.test(msg)) {
      throw new ProviderOutOfStockError(slug, msg);
    }
    throw new ProviderApiError(slug, `purchase: ${msg}`);
  }

  const phone = body.number ?? body.phonenumber ?? "";
  const expiresInSec = toNumber(body.expires_in);
  const expiresAt =
    expiresInSec > 0
      ? new Date(Date.now() + expiresInSec * 1000)
      : new Date(Date.now() + DEFAULT_ACTIVATION_TTL_MS);

  return {
    upstreamOrderId: String(body.order_id),
    phoneNumber: phone,
    expiresAt,
    wholesaleCents: Math.round(toNumber(body.cost) * 100),
  };
}

/**
 * /sms/check `status` → our ProviderOrderStatus.
 * SMSPool documents integer codes; the mapping below is the documented set.
 * VERIFY against a live order — a wrong "received" code would mis-fire capture.
 */
function mapCheckStatus(raw: number | string | undefined): ProviderOrderStatus {
  const code = typeof raw === "string" ? Number(raw) : raw;
  switch (code) {
    case 1: // pending — waiting for the SMS
      return "pending";
    case 3: // completed — SMS received
      return "received";
    case 6: // refunded / cancelled
      return "cancelled";
    default:
      return "pending";
  }
}

/**
 * Curated SMSPool services to sync, keyed by the stable SMSPool service ID ->
 * our canonical slug. Focus: the dating / hard-to-verify services that 5SIM's
 * virtual numbers get rejected on (so SMSPool is the only source), aligned to
 * the same slugs 5SIM uses. Extend as we profile more; keep it bounded (one
 * /request/price call per service per country at sync).
 */
const SMSPOOL_SERVICE_SLUGS: Record<string, string> = {
  "724": "pof", // Plenty Of Fish
  "65": "badoo",
  "142": "bumble",
  "403": "grindr",
  "420": "hinge",
  "559": "match", // Match / Meetic / Zweisam
  "658": "okcupid",
  "564": "meetme",
  "836": "skout",
  "1070": "zoosk",
  // SMSPool-only services that 5SIM doesn't carry at all. Pinned here so their
  // canonical slug is hand-verified (no collision with a 5SIM slug).
  "742": "prolific", // Prolific (research-participant platform)
  "1660": "handshake", // HandshakeAI
};

/**
 * Countries (by SMSPool alpha-2) where we pay the extra per-curated-service
 * /request/price call to capture a published success rate. Bounded on purpose:
 * the dating/hard services that need a cold-start delivery signal concentrate
 * in the US/UK. Every other country starts on a null prior and earns its real
 * rate from measured 7-day stats once orders flow.
 */
const ENRICH_COUNTRIES = new Set(["US", "GB"]);

/** How many countries' price books to fetch in parallel during a full sync. */
const SYNC_CONCURRENCY = 6;

/** Coerce SMSPool's /country/retrieve_all response into a country array. */
function normalizeCountryList(raw: unknown): SmsPoolCountry[] {
  if (Array.isArray(raw)) return raw as SmsPoolCountry[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["countries", "data", "result"]) {
      if (Array.isArray(obj[key])) return obj[key] as SmsPoolCountry[];
    }
  }
  return [];
}

/**
 * Map over items with a bounded number of in-flight promises, preserving input
 * order in the result. Keeps the full-catalog sync (~150 price-book calls) fast
 * without firing every request at once.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const AVAILABILITY_SENTINEL = 999;
const DEFAULT_ACTIVATION_TTL_MS = 10 * 60 * 1000;

/**
 * Canonical service slug from an SMSPool service name. Lowercase, alphanumerics
 * only — matching 5SIM's compact slug shape ("Google Voice" → "googlevoice")
 * so the same logical service merges into one canonical `services` row across
 * providers. Returns "" when the name has no alphanumerics (caller skips it).
 */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Stringify a numeric/string id, or null if absent. */
function idOf(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function toNumber(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}
function pickNumber(...vals: Array<unknown>): number | null {
  for (const v of vals) {
    if (v == null) continue;
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
