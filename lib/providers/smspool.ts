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
    // Populate SMSPool for the curated dating / hard-to-verify services
    // (SMSPOOL_SERVICE_SLUGS) in the US + UK. These are exactly the services
    // 5SIM's virtual numbers get rejected on (POF, Badoo, Grindr, ...) — and
    // SMSPool provisions them without a whitelist. Bounded set, so we fetch a
    // real price + success rate per service via /request/price; placeholder
    // price if unavailable (live re-quote at purchase is authoritative).
    // serviceSlug is the canonical slug so rows share a (service, country) with
    // 5SIM and the router can compare them.
    const countriesRaw = await this.get<unknown>("/country/retrieve_all");
    const countries: SmsPoolCountry[] = Array.isArray(countriesRaw)
      ? (countriesRaw as SmsPoolCountry[])
      : [];

    const out: ProviderCatalogEntry[] = [];
    let targetsFound = 0;
    for (const target of SYNC_TARGETS) {
      const match = countries.find((c) =>
        target.test(String(c.short_name ?? ""), c.name ?? ""),
      );
      const countryId = match ? idOf(match.ID ?? match.id) : null;
      if (!countryId) {
        console.warn(
          `[smspool] ${target.iso} country not found (of ${countries.length}) — skipping`,
        );
        continue;
      }
      targetsFound++;

      const servicesRaw = await this.get<unknown>(
        `/service/retrieve_all?country=${encodeURIComponent(countryId)}`,
      );
      const services: SmsPoolCatalogService[] = Array.isArray(servicesRaw)
        ? (servicesRaw as SmsPoolCatalogService[])
        : [];

      let added = 0;
      for (const s of services) {
        const serviceId = idOf(s.ID ?? s.id);
        const name = stringOrNull(s.name);
        if (!serviceId || !name) continue;
        // Curated set: the dating / hard-to-verify services where SMSPool's
        // numbers deliver and 5SIM's virtual numbers get rejected. Keyed by the
        // stable SMSPool service ID -> our canonical slug, so they share a
        // (service, country) with 5SIM and the router can compare them.
        const slug = SMSPOOL_SERVICE_SLUGS[serviceId];
        if (!slug) continue;

        let priceCents = SMSPOOL_PLACEHOLDER_CENTS;
        let publishedSuccessRate: number | null = null;
        try {
          const p = await this.post<SmsPoolPrice>("/request/price", {
            country: countryId,
            service: serviceId,
          });
          const c = Math.round(toNumber(p.price ?? p.cost) * 100);
          if (c > 0) priceCents = c;
          // SMSPool publishes a per-service success rate (0-100) — capture it
          // as our routing signal, same shape as 5SIM's published rate.
          const sr = toNumber(p.success_rate);
          if (Number.isFinite(sr) && sr > 0) {
            publishedSuccessRate = Math.max(0, Math.min(100, sr));
          }
        } catch {
          // keep placeholder — live re-quote at purchase is authoritative
        }

        out.push({
          upstreamServiceCode: serviceId,
          upstreamServiceName: name,
          upstreamCountryCode: countryId,
          upstreamOperator: "default",
          priceCents,
          availableCount: AVAILABILITY_SENTINEL,
          serviceSlug: slug,
          countryIso: target.iso,
          countryName: target.name,
          publishedSuccessRate,
        });
        added++;
      }
      console.warn(`[smspool] ${target.iso} dating/hard-service entries: ${added}`);
    }

    // None of our target countries matched a non-empty list — the country
    // catalog shape likely changed. Surface it rather than sync nothing.
    if (targetsFound === 0) {
      throw new ProviderApiError(
        this.slug,
        `no target countries (US/UK) found of ${countries.length}`,
      );
    }

    return out;
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
 * Countries we populate SMSPool for, with the canonical shared iso (so rows
 * join 5SIM / TextVerified). `test` matches SMSPool's country short_name/name.
 */
const SYNC_TARGETS: Array<{
  iso: string;
  name: string;
  test: (short: string, name: string) => boolean;
}> = [
  {
    iso: "usa",
    name: "USA",
    test: (short, name) => /^us$/i.test(short) || /united states/i.test(name),
  },
  {
    iso: "england",
    name: "England",
    test: (short, name) =>
      /^(gb|uk)$/i.test(short) || /united kingdom|britain|england/i.test(name),
  },
];

const AVAILABILITY_SENTINEL = 999;
const DEFAULT_ACTIVATION_TTL_MS = 10 * 60 * 1000;
/** Cap per-service price calls per sync so the job stays well-bounded. */
/** Cached price used when /request/price is unavailable at sync time; the live
 *  re-quote at purchase is authoritative. */
const SMSPOOL_PLACEHOLDER_CENTS = 150;

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
