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
 * ─── VERIFY-ON-FIRST-LIVE-RUN ──────────────────────────────────────────────
 * This environment has no outbound network, so the response *shapes* below are
 * from SMSPool's documented contract, not a live probe. Three spots are the
 * only ones that can be wrong, and each is isolated for a one-line fix:
 *   1) mapCheckStatus()  — the numeric /sms/check status → our status mapping
 *   2) parsePurchase()   — field names on the /purchase/sms response
 *   3) getPriceAndAvailability() — SMSPool exposes price but not a clear stock
 *      count, so availability is inferred (see note there).
 * Confirm these against a real order once, then delete this banner.
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
    const text = body.full_sms ?? body.sms ?? null;
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
    // Per-country service lists with price/stock. SMSPool uses numeric IDs, so
    // upstream_*_code stays the ID (what buy/check need) while the canonical
    // serviceSlug/countryIso come from the human names so services align with
    // 5SIM (e.g. "Telegram" -> "telegram"). Only positively priced + stocked
    // rows are emitted, so an unexpected response shape yields nothing rather
    // than bad data.
    //
    // ─── VERIFY-ON-FIRST-LIVE-RUN ─────────────────────────────────────────
    // Whether /service/retrieve_all?country= returns price+stock, and the
    // field names, are unconfirmed (no network here). Also: SMSPool country
    // NAMES rarely match 5SIM's idiosyncratic slugs (e.g. "United States" ->
    // "unitedstates" vs 5SIM "usa"), so cross-provider fallback by country
    // needs a country-mapping table — a documented follow-up.
    const countries = await this.get<SmsPoolCountry[]>("/country/retrieve_all");
    const out: ProviderCatalogEntry[] = [];

    for (const c of countries ?? []) {
      const countryId = idOf(c.ID ?? c.id);
      if (!countryId) continue;
      const countryName = stringOrNull(c.name) ?? countryId;

      let services: SmsPoolCatalogService[] | null = null;
      try {
        services = await this.get<SmsPoolCatalogService[]>(
          `/service/retrieve_all?country=${encodeURIComponent(countryId)}`,
        );
      } catch {
        continue; // skip this country on a transient error
      }

      for (const s of services ?? []) {
        const serviceId = idOf(s.ID ?? s.id);
        if (!serviceId) continue;
        const price = toNumber(s.price ?? s.cost);
        const avail = pickNumber(s.available, s.stock, s.count, s.amount) ?? 0;
        if (price <= 0 || avail <= 0) continue;
        const serviceName = stringOrNull(s.name) ?? serviceId;
        out.push({
          upstreamServiceCode: serviceId,
          upstreamServiceName: serviceName,
          upstreamCountryCode: countryId,
          upstreamOperator: "default",
          priceCents: Math.round(price * 100),
          availableCount: avail,
          serviceSlug: slugify(serviceName),
          countryIso: slugify(countryName),
          countryName,
        });
      }
    }
    return out;
  }

  /** Unauthenticated GET for the public catalog endpoints. */
  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
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
}
interface SmsPoolCatalogService {
  ID?: string | number;
  id?: string | number;
  name?: string;
  price?: string | number;
  cost?: string | number;
  available?: string | number;
  stock?: string | number;
  count?: string | number;
  amount?: string | number;
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

const AVAILABILITY_SENTINEL = 999;
const DEFAULT_ACTIVATION_TTL_MS = 10 * 60 * 1000;

/** Canonical service slug from a display name (aligns across providers). */
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
