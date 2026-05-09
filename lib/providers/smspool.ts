import {
  ProviderApiError,
  type ActivationBuyParams,
  type OtpProvider,
  type PriceLookupParams,
  type ProviderBuyResult,
  type ProviderCatalogEntry,
  type ProviderOrderState,
  type ProviderPriceQuote,
  type RentalBuyParams,
} from "./types";

/**
 * SMSPool upstream provider.
 *
 * Docs: https://smspool.net/api
 * Used as fallback for high-quality (non-VoIP) numbers — slower turnover but
 * passes Google/WhatsApp checks more reliably than 5SIM.
 *
 * Stub — endpoints return ProviderApiError until implemented (Phase 2).
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

  getPriceAndAvailability(_params: PriceLookupParams): Promise<ProviderPriceQuote> {
    throw new ProviderApiError(this.slug, "getPriceAndAvailability not implemented");
  }

  buyActivation(_params: ActivationBuyParams): Promise<ProviderBuyResult> {
    throw new ProviderApiError(this.slug, "buyActivation not implemented");
  }

  rentNumber(_params: RentalBuyParams): Promise<ProviderBuyResult> {
    throw new ProviderApiError(this.slug, "rentNumber not implemented");
  }

  checkOrder(_upstreamOrderId: string): Promise<ProviderOrderState> {
    throw new ProviderApiError(this.slug, "checkOrder not implemented");
  }

  finishOrder(_upstreamOrderId: string): Promise<void> {
    throw new ProviderApiError(this.slug, "finishOrder not implemented");
  }

  cancelOrder(_upstreamOrderId: string): Promise<void> {
    throw new ProviderApiError(this.slug, "cancelOrder not implemented");
  }

  syncCatalog(): Promise<ProviderCatalogEntry[]> {
    throw new ProviderApiError(this.slug, "syncCatalog not implemented");
  }
}
