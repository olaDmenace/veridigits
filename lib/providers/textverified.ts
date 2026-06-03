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
 * TextVerified upstream provider (API v2).
 *
 * Base: https://www.textverified.com — bearer-token auth. Strong for
 * strict-screening services (WhatsApp/Google) on US numbers; pricier than
 * 5SIM, so the registry routes to it only where preference_rank says so.
 *
 * Auth: POST /api/pub/v2/auth with headers X-API-USERNAME + X-API-KEY returns
 * a short-lived bearer token (~15 min). We cache it and re-auth on expiry/401.
 *
 * Model note: TextVerified is reservation-based, not the 5SIM activation model.
 * A "verification" maps to one of our orders: create -> read number -> poll for
 * the SMS -> cancel if unused. Country/operator are not part of its model
 * (US-centric); `upstreamServiceCode` is the TextVerified serviceName.
 *
 * ─── VERIFY-ON-FIRST-LIVE-RUN ──────────────────────────────────────────────
 * No outbound network in this environment, so shapes are from the published
 * swagger, not a live probe. Confirm on the first real order, each is isolated:
 *   1) PRICE_REQUEST fields on POST /pricing/verifications
 *   2) mapState() — the verification `state` enum → our status
 *   3) the SMS list path/params in fetchMessages()
 */
export class TextVerifiedProvider implements OtpProvider {
  readonly slug = "textverified";
  readonly displayName = "TextVerified";

  private readonly apiKey: string;
  private readonly username: string;
  private readonly baseUrl: string;
  private token: { value: string; expiresAtMs: number } | null = null;

  constructor(
    apiKey: string,
    username: string,
    baseUrl = "https://www.textverified.com",
  ) {
    this.apiKey = apiKey;
    this.username = username;
    this.baseUrl = baseUrl;
  }

  async getPriceAndAvailability(
    params: PriceLookupParams,
  ): Promise<ProviderPriceQuote> {
    // VerificationPriceCheckRequest — serviceName is the only field we can be
    // sure of; capability/numberType are sent as the common defaults.
    const body = await this.authedJson<TvPricing>(
      "POST",
      "/api/pub/v2/pricing/verifications",
      {
        serviceName: params.upstreamServiceCode,
        capability: "sms",
        numberType: "mobile",
      },
    );
    const price = toNumber(body.totalCost);
    if (price <= 0) return { priceCents: 0, availableCount: 0 };
    // TextVerified pricing doesn't return a stock count; a returned price means
    // purchasable. The create call is the real availability check.
    return { priceCents: Math.round(price * 100), availableCount: AVAILABILITY_SENTINEL };
  }

  async buyActivation(params: ActivationBuyParams): Promise<ProviderBuyResult> {
    // Create the verification — returns a Link to the new resource.
    const link = await this.authedJson<TvLink>(
      "POST",
      "/api/pub/v2/verifications",
      { serviceName: params.upstreamServiceCode, capability: "sms" },
    );
    const id = extractId(link?.href);
    if (!id) {
      throw new ProviderApiError(this.slug, "create verification: no id in response");
    }

    // Read it back for the assigned number + expiry + cost.
    const v = await this.authedJson<TvVerification>(
      "GET",
      `/api/pub/v2/verifications/${encodeURIComponent(id)}`,
    );
    if (!v.number) {
      // No number provisioned — treat as out of stock so the registry falls back.
      throw new ProviderOutOfStockError(this.slug, "no number assigned");
    }
    return {
      upstreamOrderId: v.id ?? id,
      phoneNumber: v.number,
      expiresAt: v.expiresAt
        ? new Date(v.expiresAt)
        : new Date(Date.now() + DEFAULT_TTL_MS),
      wholesaleCents: Math.round(toNumber(v.totalCost) * 100),
    };
  }

  rentNumber(_params: RentalBuyParams): Promise<ProviderBuyResult> {
    // TextVerified rentals use the /reservations (renewable) flow, not wired
    // yet. The registry should not route rentals here until implemented.
    throw new ProviderApiError(this.slug, "rental not supported yet");
  }

  async checkOrder(upstreamOrderId: string): Promise<ProviderOrderState> {
    const v = await this.authedJson<TvVerification>(
      "GET",
      `/api/pub/v2/verifications/${encodeURIComponent(upstreamOrderId)}`,
    );
    const status = mapState(v.state);

    // Pull any SMS while the verification is live (the code lands before the
    // state flips to completed in some cases). Skip once terminally dead.
    let messages: ProviderMessage[] = [];
    if (status === "pending" || status === "received") {
      messages = await this.fetchMessages(upstreamOrderId);
    }
    return { status, messages };
  }

  async finishOrder(_upstreamOrderId: string): Promise<void> {
    // No explicit finish step in TextVerified — a completed verification is
    // already terminal upstream. No-op.
  }

  async cancelOrder(upstreamOrderId: string): Promise<void> {
    await this.authedJson<unknown>(
      "POST",
      `/api/pub/v2/verifications/${encodeURIComponent(upstreamOrderId)}/cancel`,
    );
  }

  async syncCatalog(): Promise<ProviderCatalogEntry[]> {
    // Service list is available (GET /api/pub/v2/services) but pricing is a
    // per-service call and the model is US-only, so a full priced catalog isn't
    // built from one request. Catalog population is handled separately (admin /
    // targeted sync). Returning [] avoids inserting priceless rows.
    return [];
  }

  // ── messages ───────────────────────────────────────────────────────────────

  private async fetchMessages(verificationId: string): Promise<ProviderMessage[]> {
    const page = await this.authedJson<TvSmsPage>(
      "GET",
      `/api/pub/v2/sms?reservationId=${encodeURIComponent(verificationId)}&reservationType=verification`,
    );
    const rows = page?.data ?? [];
    return rows.map((m) => ({
      sender: stringOrNull(m.from) ?? "TextVerified",
      content: m.message ?? "",
      receivedAt: m.createdAt ? new Date(m.createdAt) : new Date(),
    }));
  }

  // ── transport + auth ─────────────────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAtMs - 30_000 > now) {
      return this.token.value;
    }
    const res = await fetch(`${this.baseUrl}/api/pub/v2/auth`, {
      method: "POST",
      headers: {
        "X-API-USERNAME": this.username,
        "X-API-KEY": this.apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new ProviderApiError(
        this.slug,
        `auth returned ${res.status}`,
        res.status,
      );
    }
    const body = (await res.json()) as TvAuth;
    if (!body.token) {
      throw new ProviderApiError(this.slug, "auth returned no token");
    }
    const expiresAtMs = body.expiresAt
      ? new Date(body.expiresAt).getTime()
      : now + (toNumber(body.expiresIn) || 600) * 1000;
    this.token = { value: body.token, expiresAtMs };
    return body.token;
  }

  private async authedJson<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const doFetch = async (token: string) =>
      fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
      });

    let res = await doFetch(await this.ensureToken());
    if (res.status === 401) {
      // Token rejected — force a re-auth once.
      this.token = null;
      res = await doFetch(await this.ensureToken());
    }

    const text = await res.text();
    if (!res.ok) {
      if (/out of stock|no numbers|unavailable|sold out/i.test(text)) {
        throw new ProviderOutOfStockError(this.slug, text.slice(0, 200));
      }
      throw new ProviderApiError(
        this.slug,
        `${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`,
        res.status,
      );
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderApiError(
        this.slug,
        `${path}: non-JSON response: ${text.slice(0, 200)}`,
      );
    }
  }
}

// ── response shapes (from swagger; verify on first live run) ────────────────
interface TvAuth {
  token?: string;
  expiresIn?: number | string;
  expiresAt?: string;
}
interface TvLink {
  href?: string;
  method?: string;
}
interface TvVerification {
  id?: string;
  number?: string;
  serviceName?: string;
  state?: string;
  createdAt?: string;
  expiresAt?: string;
  totalCost?: number | string;
}
interface TvSms {
  id?: string;
  message?: string;
  to?: string;
  from?: string;
  createdAt?: string;
}
interface TvSmsPage {
  data?: TvSms[];
}
interface TvPricing {
  totalCost?: number | string;
}

/**
 * TextVerified verification `state` → our ProviderOrderStatus.
 * swagger enum: pending | completed | failed | canceled | reported.
 */
function mapState(state: string | undefined): ProviderOrderStatus {
  switch (state) {
    case "completed":
      return "received";
    case "pending":
      return "pending";
    case "canceled":
    case "reported":
      return "cancelled";
    case "failed":
      return "expired";
    default:
      return "pending";
  }
}

/** Pull the trailing id from a resource href like /api/pub/v2/verifications/abc. */
function extractId(href: string | undefined): string | null {
  if (!href) return null;
  const clean = href.split("?")[0].replace(/\/+$/, "");
  const last = clean.slice(clean.lastIndexOf("/") + 1);
  return last || null;
}

const AVAILABILITY_SENTINEL = 999;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function toNumber(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}
function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
