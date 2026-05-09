/**
 * Upstream OTP provider abstraction.
 *
 * Every call to a provider's API goes through this interface — never direct.
 * Adding a new provider means implementing this surface and registering it.
 */

export type OrderMode = "activation" | "rental";

export interface ProviderPriceQuote {
  priceCents: number;
  availableCount: number;
}

export interface ProviderBuyResult {
  upstreamOrderId: string;
  phoneNumber: string;
  expiresAt: Date;
  wholesaleCents: number;
}

export interface ProviderMessage {
  sender: string;
  content: string;
  receivedAt: Date;
}

export type ProviderOrderStatus =
  | "pending"
  | "received"
  | "cancelled"
  | "expired";

export interface ProviderOrderState {
  status: ProviderOrderStatus;
  messages: ProviderMessage[];
}

export interface ProviderCatalogEntry {
  upstreamServiceCode: string;
  upstreamServiceName: string;
  upstreamCountryCode: string;
  upstreamOperator: string;
  priceCents: number;
  availableCount: number;
}

export interface PriceLookupParams {
  upstreamServiceCode: string;
  upstreamCountryCode: string;
  upstreamOperator?: string;
}

export type ActivationBuyParams = PriceLookupParams;

export interface RentalBuyParams {
  upstreamServiceCode: string;
  upstreamCountryCode: string;
  durationHours: number;
}

export interface OtpProvider {
  readonly slug: string;
  readonly displayName: string;

  getPriceAndAvailability(params: PriceLookupParams): Promise<ProviderPriceQuote>;
  buyActivation(params: ActivationBuyParams): Promise<ProviderBuyResult>;
  rentNumber(params: RentalBuyParams): Promise<ProviderBuyResult>;
  checkOrder(upstreamOrderId: string): Promise<ProviderOrderState>;
  finishOrder(upstreamOrderId: string): Promise<void>;
  cancelOrder(upstreamOrderId: string): Promise<void>;
  syncCatalog(): Promise<ProviderCatalogEntry[]>;
}

/** Thrown when the upstream reports the requested service/country has zero stock. */
export class ProviderOutOfStockError extends Error {
  readonly providerSlug: string;
  constructor(providerSlug: string, message?: string) {
    super(message ?? `${providerSlug}: out of stock`);
    this.name = "ProviderOutOfStockError";
    this.providerSlug = providerSlug;
  }
}

/** Thrown when the upstream API returns a non-success response we cannot interpret. */
export class ProviderApiError extends Error {
  readonly providerSlug: string;
  readonly statusCode?: number;
  constructor(providerSlug: string, message: string, statusCode?: number) {
    super(`${providerSlug}: ${message}`);
    this.name = "ProviderApiError";
    this.providerSlug = providerSlug;
    this.statusCode = statusCode;
  }
}
