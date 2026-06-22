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
 * SMSPool rentals — verified live 2026-06-22 via `POST /rental/retrieve_all
 * {type:1}`. Rentals are a SEPARATE product from activations: keyed by a
 * country `rentalID` + a fixed set of purchasable day-tiers (not our
 * service/country/operator activation shape). SMSPool offers rentals for only
 * these three countries, so rental routing is limited to them. Keyed by the
 * shared canonical `countries.iso_code` (5SIM's name-slugs). Prices are NOT
 * hardcoded — they're re-fetched live at quote time; only the rentalID and the
 * available day-tiers are stable enough to pin here.
 */
export const SMSPOOL_RENTALS: Record<
  string,
  { rentalID: number; days: number[] }
> = {
  usa: { rentalID: 11, days: [1, 7, 28] },
  england: { rentalID: 13, days: [30, 180, 360] },
  canada: { rentalID: 14, days: [30] },
};

/** Whether SMSPool offers a rental for this canonical country iso. */
export function smspoolRentalFor(
  countryIso: string,
): { rentalID: number; days: number[] } | null {
  return SMSPOOL_RENTALS[countryIso] ?? null;
}

// SMSPool's rental lifecycle (retrieve SMS, refund) is keyed by BOTH `orderid`
// and `rental_code`, but our OtpProvider interface carries a single
// `upstreamOrderId`. We pack both into one opaque string with a "rental|"
// prefix so checkOrder/cancelOrder can detect a rental and unpack — no schema
// change, and activation ids (plain alphanumeric) never collide.
const RENTAL_ID_PREFIX = "rental|";

export function encodeRentalId(orderid: string, rentalCode: string): string {
  return `${RENTAL_ID_PREFIX}${orderid}|${rentalCode}`;
}

export function decodeRentalId(
  upstreamOrderId: string,
): { orderid: string; rentalCode: string } | null {
  if (!upstreamOrderId.startsWith(RENTAL_ID_PREFIX)) return null;
  const rest = upstreamOrderId.slice(RENTAL_ID_PREFIX.length);
  const sep = rest.indexOf("|");
  if (sep < 0) return null;
  return { orderid: rest.slice(0, sep), rentalCode: rest.slice(sep + 1) };
}

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
 *   3) parseRentalPurchase() — orderid / rental_code / phone / expiry field
 *      names on the /purchase/rental response (a ~$6 US 1-day rental confirms).
 *   4) checkRental()    — the /rental/retrieve SMS array shape.
 *   Rental pricing + availability (/rental/retrieve_all, /rental/retrieve_pricing)
 *   ARE confirmed live (2026-06-22). Only the paid purchase+retrieve shapes pend.
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

  /**
   * Rent a number. getQuote routes the SMSPool `rentalID` through
   * `upstreamCountryCode` and the chosen day-tier through `durationHours`
   * (validated against SMSPOOL_RENTALS before the hold token is signed).
   *
   * MVP buys the full, unlocked line (no `service_id`). A service-scoped line is
   * 50% cheaper, but that discount is NOT reflected in /rental/retrieve_pricing,
   * so quoting it would trip the rental price-deviation guard in purchase().
   * The unlocked line receives every SMS to the number, so the user's code still
   * arrives — the discount is a future optimization once verified on a real order.
   */
  async rentNumber(params: RentalBuyParams): Promise<ProviderBuyResult> {
    const rentalID = params.upstreamCountryCode;
    const days = Math.max(1, Math.round(params.durationHours / 24));
    const body = await this.post<SmsPoolRentalPurchase>("/purchase/rental", {
      rentalID,
      days: String(days),
    });
    const result = parseRentalPurchase(this.slug, body);
    if (result.wholesaleCents <= 0) {
      // The purchase response didn't carry a cost — backfill from live pricing
      // so purchase()'s rental price-deviation guard compares like-for-like
      // (a 0 here would read as a 100% deviation and wrongly cancel+refund).
      const n = Number(rentalID);
      result.wholesaleCents = Number.isFinite(n)
        ? await this.getRentalPriceCents(n, days)
        : 0;
    }
    return result;
  }

  /**
   * Live wholesale price (cents) for renting `rentalID` for `days`. Drives the
   * rental quote. /rental/retrieve_pricing returns `pricing` as a map of
   * day-tier → USD price; 0 means that tier isn't purchasable.
   */
  async getRentalPriceCents(rentalID: number, days: number): Promise<number> {
    const body = await this.post<SmsPoolRentalPricing>(
      "/rental/retrieve_pricing",
      { id: String(rentalID) },
    );
    const n = toNumber(body.pricing?.[String(days)]);
    return n > 0 ? Math.round(n * 100) : 0;
  }

  async checkOrder(upstreamOrderId: string): Promise<ProviderOrderState> {
    const rental = decodeRentalId(upstreamOrderId);
    if (rental) return this.checkRental(rental);

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

  /**
   * Check a rental for received SMS via /rental/retrieve (needs both orderid and
   * rental_code, unpacked from the composite upstreamOrderId). A rental stays
   * open for its whole term, so status is "received" once any SMS lands, else
   * "pending" — the order's own expires_at (days out) drives expiry, not this.
   * Response field names coded to the documented shape; VERIFY on first rental.
   */
  private async checkRental(rental: {
    orderid: string;
    rentalCode: string;
  }): Promise<ProviderOrderState> {
    const body = await this.post<SmsPoolRentalCheck>("/rental/retrieve", {
      orderid: rental.orderid,
      rental_code: rental.rentalCode,
    });
    const raw = body.sms ?? body.messages ?? [];
    const messages: ProviderMessage[] = (Array.isArray(raw) ? raw : [])
      .map((m): ProviderMessage | null => {
        const content = stringOrNull(m.message ?? m.sms ?? m.code);
        if (!content) return null;
        const parsed = m.date ? new Date(String(m.date)) : null;
        const receivedAt =
          parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
        return {
          sender: stringOrNull(m.sender ?? m.from) ?? "SMSPool",
          content,
          receivedAt,
        };
      })
      .filter((m): m is ProviderMessage => m !== null);
    const status: ProviderOrderStatus =
      messages.length > 0 ? "received" : "pending";
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
    const rental = decodeRentalId(upstreamOrderId);
    if (rental) {
      // Rentals refund via /rental/refund (orderid + rental_code), not /sms/cancel.
      const body = await this.post<SmsPoolCancel>("/rental/refund", {
        orderid: rental.orderid,
        rental_code: rental.rentalCode,
      });
      if (body.success === 0 || body.success === false) {
        throw new ProviderApiError(
          this.slug,
          `rental refund failed: ${stringOrNull(body.message) ?? "unknown"}`,
        );
      }
      return;
    }

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

// ── rental response shapes (VERIFY field names on first paid rental) ────────
interface SmsPoolRentalPricing {
  pricing?: Record<string, string | number>;
  extend?: Record<string, string | number>;
}
interface SmsPoolRentalSms {
  sender?: string;
  from?: string;
  message?: string;
  sms?: string;
  code?: string;
  date?: string;
}
interface SmsPoolRentalCheck {
  success?: number | boolean;
  message?: string;
  sms?: SmsPoolRentalSms[] | null;
  messages?: SmsPoolRentalSms[] | null;
  expiry?: string | number;
  status?: string | number;
}
interface SmsPoolRentalPurchase {
  success?: number | boolean;
  message?: string;
  rental_code?: string;
  orderid?: string | number;
  order_id?: string | number;
  number?: string;
  phonenumber?: string;
  phone_number?: string;
  expiry?: string | number;
  expiration?: string | number;
  expires_in?: string | number;
  days?: string | number;
  cost?: string | number;
  price?: string | number;
}

/**
 * /purchase/rental result → common shape. Requires BOTH orderid and rental_code
 * (the lifecycle needs both) and packs them into the composite upstreamOrderId.
 */
function parseRentalPurchase(
  slug: string,
  body: SmsPoolRentalPurchase,
): ProviderBuyResult {
  const ok = body.success === 1 || body.success === true;
  const orderid = stringOrNull(body.orderid ?? body.order_id);
  const rentalCode = stringOrNull(body.rental_code);
  if (!ok || !orderid || !rentalCode) {
    const msg = stringOrNull(body.message) ?? "rental purchase failed";
    if (/out of stock|no (stock|numbers|free)|sold out/i.test(msg)) {
      throw new ProviderOutOfStockError(slug, msg);
    }
    throw new ProviderApiError(slug, `rental: ${msg}`);
  }
  const phone = body.phone_number ?? body.number ?? body.phonenumber ?? "";
  const wholesale = toNumber(body.cost ?? body.price);
  return {
    upstreamOrderId: encodeRentalId(orderid, rentalCode),
    phoneNumber: String(phone),
    expiresAt: parseRentalExpiry(body),
    wholesaleCents: wholesale > 0 ? Math.round(wholesale * 100) : 0,
  };
}

/** Resolve a rental's expiry from whichever field the purchase response carries. */
function parseRentalExpiry(body: SmsPoolRentalPurchase): Date {
  const abs = body.expiry ?? body.expiration;
  if (abs != null) {
    const n = toNumber(abs);
    if (n > 1_000_000_000) return new Date(n * 1000); // unix seconds
    const d = new Date(String(abs));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const secs = toNumber(body.expires_in);
  if (secs > 0) return new Date(Date.now() + secs * 1000);
  const days = toNumber(body.days);
  if (days > 0) return new Date(Date.now() + days * 86_400_000);
  return new Date(Date.now() + 86_400_000); // safe fallback: 1 day
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
