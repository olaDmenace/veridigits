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

interface FivesimPriceLeaf {
  cost: number;
  count: number;
  rate: number;
}

type FivesimPriceTree = Record<
  string,
  Record<string, Record<string, FivesimPriceLeaf>>
>;

interface FivesimSms {
  created_at: string;
  date?: string;
  sender: string;
  text: string;
  code?: string;
}

interface FivesimOrder {
  id: number;
  phone: string;
  operator: string;
  product: string;
  price: number; // in account currency, treated as USD float here
  status: string;
  expires: string; // RFC3339
  created_at: string;
  sms: FivesimSms[] | null;
  country: string;
}

const DEFAULT_OPERATOR = "any";

/**
 * 5SIM upstream provider.
 *
 * Docs: https://5sim.net/docs
 * Catalog endpoints under /v1/guest are public.
 * User endpoints under /v1/user require Bearer auth.
 */
export class FiveSimProvider implements OtpProvider {
  readonly slug = "5sim";
  readonly displayName = "5SIM";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://5sim.net/v1") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getPriceAndAvailability(
    params: PriceLookupParams,
  ): Promise<ProviderPriceQuote> {
    const { upstreamServiceCode, upstreamCountryCode } = params;
    const operator = params.upstreamOperator ?? DEFAULT_OPERATOR;

    const url = new URL(`${this.baseUrl}/guest/prices`);
    url.searchParams.set("country", upstreamCountryCode);
    url.searchParams.set("product", upstreamServiceCode);

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new ProviderApiError(
        this.slug,
        `getPriceAndAvailability returned ${res.status}`,
        res.status,
      );
    }
    const tree = (await res.json()) as FivesimPriceTree;

    const products = tree[upstreamCountryCode] ?? {};
    const operators = products[upstreamServiceCode] ?? {};
    const leaf = operators[operator] ?? operators[DEFAULT_OPERATOR];

    if (!leaf) {
      return { priceCents: 0, availableCount: 0 };
    }

    return {
      priceCents: Math.round(leaf.cost * 100),
      availableCount: leaf.count ?? 0,
    };
  }

  async buyActivation(params: ActivationBuyParams): Promise<ProviderBuyResult> {
    const operator = params.upstreamOperator ?? DEFAULT_OPERATOR;
    const path = `/user/buy/activation/${encodeURIComponent(params.upstreamCountryCode)}/${encodeURIComponent(operator)}/${encodeURIComponent(params.upstreamServiceCode)}`;

    const order = await this.authenticatedGet<FivesimOrder | { error?: string }>(path);

    if (!isOrder(order)) {
      const message = order.error ?? "buyActivation: unknown error";
      if (/no free phones|out of stock|no_numbers/i.test(message)) {
        throw new ProviderOutOfStockError(this.slug, message);
      }
      throw new ProviderApiError(this.slug, `buyActivation: ${message}`);
    }

    return {
      upstreamOrderId: String(order.id),
      phoneNumber: order.phone,
      expiresAt: new Date(order.expires),
      wholesaleCents: Math.round((order.price ?? 0) * 100),
    };
  }

  async rentNumber(params: RentalBuyParams): Promise<ProviderBuyResult> {
    // 5SIM rental ("hosting") endpoint:
    //   GET /v1/user/buy/hosting/{country}/{operator}/{durationProduct}
    // Where durationProduct is a slug like "4hours", "1day", "3day", "7day",
    // "30day". The catalog of available hosting durations comes from
    // /v1/guest/products/{country}/{operator} — when wiring rental fully to
    // production, validate the user's chosen durationHours against that.
    const durationProduct = mapDurationToHostingSlug(params.durationHours);
    const operator = DEFAULT_OPERATOR;
    const path = `/user/buy/hosting/${encodeURIComponent(params.upstreamCountryCode)}/${encodeURIComponent(operator)}/${encodeURIComponent(durationProduct)}`;

    const order = await this.authenticatedGet<FivesimOrder | { error?: string }>(path);

    if (!isOrder(order)) {
      const message = order.error ?? "rentNumber: unknown error";
      if (/no free phones|out of stock|no_numbers/i.test(message)) {
        throw new ProviderOutOfStockError(this.slug, message);
      }
      throw new ProviderApiError(this.slug, `rentNumber: ${message}`);
    }

    return {
      upstreamOrderId: String(order.id),
      phoneNumber: order.phone,
      expiresAt: new Date(order.expires),
      wholesaleCents: Math.round((order.price ?? 0) * 100),
    };
  }

  async checkOrder(upstreamOrderId: string): Promise<ProviderOrderState> {
    const order = await this.authenticatedGet<FivesimOrder>(
      `/user/check/${encodeURIComponent(upstreamOrderId)}`,
    );
    return {
      status: mapStatus(order.status),
      messages: (order.sms ?? []).map(toProviderMessage),
    };
  }

  async getBalance(): Promise<number | null> {
    try {
      const p = await this.authenticatedGet<{ balance?: number }>(
        "/user/profile",
      );
      return typeof p.balance === "number" ? p.balance : null;
    } catch {
      return null;
    }
  }

  async finishOrder(upstreamOrderId: string): Promise<void> {
    await this.authenticatedGet<FivesimOrder>(
      `/user/finish/${encodeURIComponent(upstreamOrderId)}`,
    );
  }

  async cancelOrder(upstreamOrderId: string): Promise<void> {
    await this.authenticatedGet<FivesimOrder>(
      `/user/cancel/${encodeURIComponent(upstreamOrderId)}`,
    );
  }

  async syncCatalog(): Promise<ProviderCatalogEntry[]> {
    const res = await fetch(`${this.baseUrl}/guest/prices`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new ProviderApiError(
        this.slug,
        `GET /guest/prices returned ${res.status}`,
        res.status,
      );
    }

    const tree = (await res.json()) as FivesimPriceTree;
    const entries: ProviderCatalogEntry[] = [];

    for (const [countrySlug, products] of Object.entries(tree)) {
      for (const [productSlug, operators] of Object.entries(products)) {
        for (const [operatorSlug, leaf] of Object.entries(operators)) {
          if (
            typeof leaf?.cost !== "number" ||
            typeof leaf?.count !== "number"
          ) {
            continue;
          }
          entries.push({
            upstreamServiceCode: productSlug,
            upstreamServiceName: humanize(productSlug),
            upstreamCountryCode: countrySlug,
            upstreamOperator: operatorSlug,
            priceCents: Math.round(leaf.cost * 100),
            availableCount: leaf.count,
            // 5SIM publishes a per-operator success rate (0-100). Carry it so
            // routing can avoid known-bad operators (e.g. virtual8 at ~0%).
            publishedSuccessRate:
              typeof leaf.rate === "number" ? leaf.rate : null,
          });
        }
      }
    }

    return entries;
  }

  private async authenticatedGet<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const text = await res.text();

    if (!res.ok) {
      // 5SIM returns plain-text error bodies like "no free phones" with non-2xx status,
      // but sometimes returns 200 with JSON containing an error key.
      const body = text.trim();
      if (/no free phones|out of stock|no_numbers/i.test(body)) {
        throw new ProviderOutOfStockError(this.slug, body);
      }
      throw new ProviderApiError(
        this.slug,
        `${path} returned ${res.status}: ${body.slice(0, 200)}`,
        res.status,
      );
    }

    // 200 OK — could still be a textual error like "no free phones".
    if (text.startsWith("no free phones") || text === "no_numbers") {
      throw new ProviderOutOfStockError(this.slug, text);
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
}

function isOrder(value: unknown): value is FivesimOrder {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "phone" in value
  );
}

function mapStatus(s: string): ProviderOrderStatus {
  // 5SIM statuses: PENDING, RECEIVED, CANCELED, TIMEOUT, FINISHED, BANNED.
  // TRAP: 5SIM "RECEIVED" means "number live, WAITING for an SMS" — not "SMS
  // arrived". It flips ~2s after purchase with an empty sms[] array. The real
  // "code arrived" signal is the sms[] array being non-empty (-> messages).
  // So callers must gate capture/charge on actual messages, never on this
  // status alone (see decideSmsOutcome's anyMessage guard).
  switch (s) {
    case "PENDING":
      return "pending";
    case "RECEIVED":
    case "FINISHED":
      return "received";
    case "CANCELED":
    case "BANNED":
      return "cancelled";
    case "TIMEOUT":
      return "expired";
    default:
      return "pending";
  }
}

function toProviderMessage(sms: FivesimSms): ProviderMessage {
  return {
    sender: sms.sender,
    content: sms.text,
    receivedAt: new Date(sms.date ?? sms.created_at),
  };
}

function humanize(slug: string): string {
  return slug
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Maps a duration-in-hours request to 5SIM's hosting product slug.
 * Picks the smallest 5SIM tier that covers the requested duration so the
 * user never gets less than they paid for.
 */
function mapDurationToHostingSlug(durationHours: number): string {
  if (durationHours <= 4) return "4hours";
  if (durationHours <= 24) return "1day";
  if (durationHours <= 72) return "3day";
  if (durationHours <= 24 * 7) return "7day";
  return "30day";
}
