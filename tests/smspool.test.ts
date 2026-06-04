import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmsPoolProvider } from "@/lib/providers/smspool";
import { ProviderApiError, ProviderOutOfStockError } from "@/lib/providers/types";

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function provider() {
  return new SmsPoolProvider("test-key");
}

describe("SmsPoolProvider.getPriceAndAvailability", () => {
  it("parses a dollar price into cents and uses a stock field when present", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ price: "0.32", available: 14 }),
    );
    const q = await provider().getPriceAndAvailability({
      upstreamServiceCode: "telegram",
      upstreamCountryCode: "1",
    });
    expect(q).toEqual({ priceCents: 32, availableCount: 14 });
  });

  it("infers availability when no stock field is returned but a price exists", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ price: "0.50" }),
    );
    const q = await provider().getPriceAndAvailability({
      upstreamServiceCode: "whatsapp",
      upstreamCountryCode: "1",
    });
    expect(q.priceCents).toBe(50);
    expect(q.availableCount).toBeGreaterThan(0);
  });

  it("reports zero availability when there is no price", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ price: 0 }),
    );
    const q = await provider().getPriceAndAvailability({
      upstreamServiceCode: "telegram",
      upstreamCountryCode: "999",
    });
    expect(q).toEqual({ priceCents: 0, availableCount: 0 });
  });
});

describe("SmsPoolProvider.buyActivation", () => {
  it("maps a successful purchase to the common buy result", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        success: 1,
        order_id: "abc123",
        number: "447700900123",
        expires_in: 600,
        cost: "0.30",
      }),
    );
    const r = await provider().buyActivation({
      upstreamServiceCode: "telegram",
      upstreamCountryCode: "44",
    });
    expect(r.upstreamOrderId).toBe("abc123");
    expect(r.phoneNumber).toBe("447700900123");
    expect(r.wholesaleCents).toBe(30);
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("throws ProviderOutOfStockError when the purchase reports no stock", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ success: 0, message: "Out of stock for this service" }),
    );
    await expect(
      provider().buyActivation({
        upstreamServiceCode: "telegram",
        upstreamCountryCode: "44",
      }),
    ).rejects.toBeInstanceOf(ProviderOutOfStockError);
  });

  it("throws ProviderApiError on a generic failure payload", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ success: 0, message: "Invalid service" }),
    );
    await expect(
      provider().buyActivation({
        upstreamServiceCode: "nope",
        upstreamCountryCode: "44",
      }),
    ).rejects.toBeInstanceOf(ProviderApiError);
  });
});

describe("SmsPoolProvider.checkOrder", () => {
  it("returns pending while waiting (status 1)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ status: 1 }),
    );
    const s = await provider().checkOrder("abc123");
    expect(s.status).toBe("pending");
    expect(s.messages).toHaveLength(0);
  });

  it("returns received with the message once the code arrives (status 3)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ status: 3, sms: "123456", full_sms: "Your code is 123456" }),
    );
    const s = await provider().checkOrder("abc123");
    expect(s.status).toBe("received");
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].content).toBe("Your code is 123456");
  });

  it("maps a refunded/cancelled status (6) to cancelled", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ status: 6 }),
    );
    const s = await provider().checkOrder("abc123");
    expect(s.status).toBe("cancelled");
  });
});

describe("SmsPoolProvider.cancelOrder", () => {
  it("resolves on success", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ success: 1 }),
    );
    await expect(provider().cancelOrder("abc123")).resolves.toBeUndefined();
  });

  it("throws when cancel is rejected", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ success: 0, message: "too late to cancel" }),
    );
    await expect(provider().cancelOrder("abc123")).rejects.toBeInstanceOf(
      ProviderApiError,
    );
  });
});

describe("SmsPoolProvider.syncCatalog", () => {
  it("US strict services: real price where available, placeholder otherwise; aligns to 'usa'; skips non-strict", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      // /country/retrieve_all
      .mockResolvedValueOnce(
        jsonResponse([
          { ID: 2, name: "Canada", short_name: "CA" },
          { ID: 1, name: "United States", short_name: "US" },
        ]),
      )
      // /service/retrieve_all?country=1  (no prices in this response)
      .mockResolvedValueOnce(
        jsonResponse([
          { ID: 10, name: "Telegram", favourite: 0 },
          { ID: 11, name: "WhatsApp", favourite: 0 },
          { ID: 12, name: "Google", favourite: 0 },
          { ID: 99, name: "1688", favourite: 0 }, // not strict → ignored
        ]),
      )
      // /request/price for the 3 strict services (1688 is filtered before pricing)
      .mockResolvedValueOnce(jsonResponse({ price: "0.20" }))
      .mockResolvedValueOnce(jsonResponse({ price: "0.35" }))
      .mockResolvedValueOnce(jsonResponse({ price: "0" })); // no price → placeholder

    const entries = await provider().syncCatalog();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.serviceSlug)).toEqual([
      "telegram",
      "whatsapp",
      "google",
    ]);
    expect(entries[0]).toMatchObject({
      upstreamServiceCode: "10",
      upstreamCountryCode: "1",
      countryIso: "usa",
      priceCents: 20,
    });
    expect(entries[1].priceCents).toBe(35);
    expect(entries[2].priceCents).toBeGreaterThan(0); // google → placeholder
  });

  it("populates UK strict services aligned to 'england' when only the UK is present", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      // /country/retrieve_all — no US, has UK
      .mockResolvedValueOnce(
        jsonResponse([
          { ID: 2, name: "Canada", short_name: "CA" },
          { ID: 44, name: "United Kingdom", short_name: "GB" },
        ]),
      )
      // /service/retrieve_all?country=44
      .mockResolvedValueOnce(
        jsonResponse([
          { ID: 10, name: "Telegram", favourite: 0 },
          { ID: 99, name: "1688", favourite: 0 }, // not strict → ignored
        ]),
      )
      // /request/price for Telegram
      .mockResolvedValueOnce(jsonResponse({ price: "0.50" }));

    const entries = await provider().syncCatalog();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      serviceSlug: "telegram",
      upstreamServiceCode: "10",
      upstreamCountryCode: "44",
      countryIso: "england",
      priceCents: 50,
    });
  });

  it("throws a diagnostic when no target country (US/UK) is found", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse([{ ID: 2, name: "Canada", short_name: "CA" }]),
    );
    await expect(provider().syncCatalog()).rejects.toBeInstanceOf(
      ProviderApiError,
    );
  });
});
