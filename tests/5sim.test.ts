import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FiveSimProvider } from "@/lib/providers/5sim";
import { ProviderApiError, ProviderOutOfStockError } from "@/lib/providers/types";

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function mockResponse(body: unknown, init: ResponseInit = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status: 200, ...init });
}

describe("FiveSimProvider.syncCatalog", () => {
  it("flattens the nested country × product × operator price tree", async () => {
    const tree = {
      usa: {
        telegram: {
          any: { cost: 0.5, count: 100, rate: 95 },
          verizon: { cost: 0.7, count: 50, rate: 98 },
        },
        whatsapp: {
          any: { cost: 0.25, count: 200, rate: 90 },
        },
      },
      uk: {
        telegram: {
          any: { cost: 0.4, count: 30, rate: 92 },
        },
      },
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(tree),
    );

    const provider = new FiveSimProvider("fake-key");
    const entries = await provider.syncCatalog();

    expect(entries).toHaveLength(4);
    expect(entries).toContainEqual(
      expect.objectContaining({
        upstreamServiceCode: "telegram",
        upstreamCountryCode: "usa",
        upstreamOperator: "any",
        priceCents: 50,
        availableCount: 100,
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        upstreamServiceCode: "whatsapp",
        upstreamCountryCode: "usa",
        priceCents: 25,
      }),
    );
  });

  it("skips leaves without numeric cost or count", async () => {
    const tree = {
      usa: {
        telegram: {
          any: { cost: "not-a-number", count: 100 },
          verizon: { count: 50 },
          tmobile: { cost: 0.5, count: 10, rate: 95 },
        },
      },
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(tree),
    );

    const provider = new FiveSimProvider("fake-key");
    const entries = await provider.syncCatalog();

    expect(entries).toHaveLength(1);
    expect(entries[0].upstreamOperator).toBe("tmobile");
  });

  it("throws ProviderApiError on non-2xx response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("", { status: 500 }),
    );

    const provider = new FiveSimProvider("fake-key");
    await expect(provider.syncCatalog()).rejects.toBeInstanceOf(ProviderApiError);
  });
});

describe("FiveSimProvider.checkOrder", () => {
  it("maps RECEIVED status to 'received' and parses SMS array", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({
        id: 1,
        status: "RECEIVED",
        sms: [
          {
            created_at: "2026-05-09T10:00:00Z",
            date: "2026-05-09T10:00:00Z",
            sender: "Telegram",
            text: "Code: 123456",
          },
        ],
      }),
    );

    const provider = new FiveSimProvider("fake-key");
    const state = await provider.checkOrder("1");

    expect(state.status).toBe("received");
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].sender).toBe("Telegram");
    expect(state.messages[0].content).toBe("Code: 123456");
  });

  it("maps CANCELED to 'cancelled' and TIMEOUT to 'expired'", async () => {
    const provider = new FiveSimProvider("fake-key");
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(mockResponse({ id: 1, status: "CANCELED", sms: null }));
    expect((await provider.checkOrder("1")).status).toBe("cancelled");

    fetchMock.mockResolvedValueOnce(mockResponse({ id: 2, status: "TIMEOUT", sms: null }));
    expect((await provider.checkOrder("2")).status).toBe("expired");

    fetchMock.mockResolvedValueOnce(mockResponse({ id: 3, status: "PENDING", sms: null }));
    expect((await provider.checkOrder("3")).status).toBe("pending");
  });

  it("sends Bearer auth header", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      mockResponse({ id: 1, status: "PENDING", sms: null }),
    );

    const provider = new FiveSimProvider("my-api-key");
    await provider.checkOrder("1");

    const callArgs = fetchMock.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer my-api-key");
  });
});

describe("FiveSimProvider.buyActivation", () => {
  it("returns parsed order details on success", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({
        id: 11631253,
        phone: "+447350690992",
        operator: "any",
        product: "telegram",
        price: 0.5,
        status: "PENDING",
        expires: "2026-05-09T10:20:00Z",
        created_at: "2026-05-09T10:00:00Z",
        sms: null,
        country: "england",
      }),
    );

    const provider = new FiveSimProvider("fake-key");
    const result = await provider.buyActivation({
      upstreamServiceCode: "telegram",
      upstreamCountryCode: "england",
    });

    expect(result.upstreamOrderId).toBe("11631253");
    expect(result.phoneNumber).toBe("+447350690992");
    expect(result.wholesaleCents).toBe(50);
    expect(result.expiresAt.toISOString()).toBe("2026-05-09T10:20:00.000Z");
  });

  it("maps 'no free phones' textual error to ProviderOutOfStockError", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("no free phones", { status: 200 }),
    );

    const provider = new FiveSimProvider("fake-key");
    await expect(
      provider.buyActivation({
        upstreamServiceCode: "telegram",
        upstreamCountryCode: "usa",
      }),
    ).rejects.toBeInstanceOf(ProviderOutOfStockError);
  });

  it("maps the same textual error returned with a non-2xx status", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("no free phones", { status: 400 }),
    );

    const provider = new FiveSimProvider("fake-key");
    await expect(
      provider.buyActivation({
        upstreamServiceCode: "telegram",
        upstreamCountryCode: "usa",
      }),
    ).rejects.toBeInstanceOf(ProviderOutOfStockError);
  });
});

describe("FiveSimProvider.getPriceAndAvailability", () => {
  it("extracts the requested operator from the tree, falling back to 'any'", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const tree = {
      usa: {
        telegram: {
          any: { cost: 0.5, count: 100, rate: 95 },
          tmobile: { cost: 0.7, count: 5, rate: 98 },
        },
      },
    };

    fetchMock.mockResolvedValueOnce(mockResponse(tree));
    const provider = new FiveSimProvider("fake-key");

    const tmobile = await provider.getPriceAndAvailability({
      upstreamServiceCode: "telegram",
      upstreamCountryCode: "usa",
      upstreamOperator: "tmobile",
    });
    expect(tmobile).toEqual({ priceCents: 70, availableCount: 5 });

    fetchMock.mockResolvedValueOnce(mockResponse(tree));
    const unknown = await provider.getPriceAndAvailability({
      upstreamServiceCode: "telegram",
      upstreamCountryCode: "usa",
      upstreamOperator: "doesnt-exist",
    });
    expect(unknown).toEqual({ priceCents: 50, availableCount: 100 });
  });

  it("returns zero counts when the country/product is absent", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({}),
    );
    const provider = new FiveSimProvider("fake-key");
    const result = await provider.getPriceAndAvailability({
      upstreamServiceCode: "telegram",
      upstreamCountryCode: "atlantis",
    });
    expect(result.availableCount).toBe(0);
    expect(result.priceCents).toBe(0);
  });
});
