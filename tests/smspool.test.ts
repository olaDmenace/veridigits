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

/**
 * Route SMSPool's catalog endpoints by URL so the mock is order-independent —
 * the full-catalog sync fetches per-country price books concurrently, so a
 * call-order (`mockResolvedValueOnce`) mock would be flaky.
 */
function routeCatalogFetch(opts: {
  countries: unknown;
  /** price book keyed by SMSPool country id. */
  pricing?: Record<string, unknown>;
  /** /request/price success rate keyed by `${countryId}:${serviceId}`. */
  price?: Record<string, unknown>;
  /** country ids whose price book should return a 500 (failure isolation). */
  errorPricing?: string[];
}) {
  return vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/country/retrieve_all")) {
      return jsonResponse(opts.countries);
    }
    if (url.includes("/request/pricing")) {
      const id = url.match(/country=([^&]+)/)?.[1] ?? "";
      if (opts.errorPricing?.includes(id)) {
        return jsonResponse({ error: "upstream boom" }, 500);
      }
      return jsonResponse(opts.pricing?.[id] ?? []);
    }
    if (url.includes("/request/price")) {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const key = `${form.get("country") ?? ""}:${form.get("service") ?? ""}`;
      return jsonResponse(opts.price?.[key] ?? { price: "0", success_rate: 0 });
    }
    return jsonResponse({}, 404);
  });
}

describe("SmsPoolProvider.syncCatalog", () => {
  it("syncs the full country catalog: cheapest pool, curated + auto slugs, US success_rate", async () => {
    global.fetch = routeCatalogFetch({
      countries: [
        { ID: 2, name: "Canada", short_name: "CA" },
        { ID: 1, name: "United States", short_name: "US" },
      ],
      pricing: {
        "1": [
          { service: 724, service_name: "Plenty Of Fish", price: "0.42", pool: 12 },
          { service: 724, service_name: "Plenty Of Fish", price: "0.40", pool: 7 }, // cheaper pool wins
          { service: 1244, service_name: "CocaCola", price: "0.04", pool: 7 }, // uncurated → auto-slug
          { service: 1660, service_name: "HandshakeAI", price: "0.12", pool: 7 }, // curated → handshake
        ],
        "2": [
          { service: 50, service_name: "Telegram", price: "0.20", pool: 7 },
        ],
      },
      price: {
        "1:724": { price: "0.40", success_rate: 62 },
        "1:1660": { price: "0.12", success_rate: 86 },
      },
    });

    const entries = await provider().syncCatalog();

    // US rows merge into 5SIM's canonical "usa"; enriched with success rates.
    const us = entries.filter((e) => e.upstreamCountryCode === "1");
    expect(us.map((e) => e.serviceSlug).sort()).toEqual([
      "cocacola",
      "handshake",
      "pof",
    ]);
    expect(us.every((e) => e.countryIso === "usa")).toBe(true);
    expect(us.find((e) => e.serviceSlug === "pof")).toMatchObject({
      priceCents: 40, // cheapest pool
      publishedSuccessRate: 62,
    });
    expect(us.find((e) => e.serviceSlug === "cocacola")).toMatchObject({
      priceCents: 4,
      publishedSuccessRate: null, // uncurated long-tail starts null
    });
    expect(us.find((e) => e.serviceSlug === "handshake")).toMatchObject({
      upstreamServiceCode: "1660",
      publishedSuccessRate: 86,
    });

    // Canada also synced — merges into 5SIM's "canada", null rate (not enriched).
    const ca = entries.filter((e) => e.upstreamCountryCode === "2");
    expect(ca).toHaveLength(1);
    expect(ca[0]).toMatchObject({
      countryIso: "canada",
      serviceSlug: "telegram",
      publishedSuccessRate: null,
    });
  });

  it("a curated slug wins a collision with an auto-slugified name, even when pricier", async () => {
    global.fetch = routeCatalogFetch({
      countries: [{ ID: 1, name: "United States", short_name: "US" }],
      pricing: {
        "1": [
          { service: 9999, service_name: "Hand-Shake", price: "0.01", pool: 7 }, // auto → "handshake"
          { service: 1660, service_name: "HandshakeAI", price: "0.12", pool: 7 }, // curated → "handshake"
        ],
      },
      price: { "1:1660": { price: "0.12", success_rate: 86 } },
    });

    const entries = await provider().syncCatalog();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      serviceSlug: "handshake",
      upstreamServiceCode: "1660", // curated row, not the cheaper auto one
      priceCents: 12,
      publishedSuccessRate: 86,
    });
  });

  it("aligns UK rows to the 'england' canonical iso via ISO-2", async () => {
    global.fetch = routeCatalogFetch({
      countries: [{ ID: 44, name: "United Kingdom", short_name: "GB" }],
      pricing: {
        "44": [
          { service: 724, service_name: "Plenty Of Fish", price: "0.50", pool: 7 },
        ],
      },
      price: { "44:724": { price: "0.50", success_rate: 55 } },
    });

    const entries = await provider().syncCatalog();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      serviceSlug: "pof",
      upstreamCountryCode: "44",
      countryIso: "england",
      publishedSuccessRate: 55,
    });
  });

  it("creates a new canonical country for a 5SIM-exclusive country (Switzerland)", async () => {
    global.fetch = routeCatalogFetch({
      countries: [{ ID: 134, name: "Switzerland", short_name: "CH" }],
      pricing: {
        "134": [
          { service: 50, service_name: "Telegram", price: "0.90", pool: 7 },
        ],
      },
    });

    const entries = await provider().syncCatalog();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      countryIso: "switzerland", // no 5SIM row — falls back to name-slug
      countryName: "Switzerland",
      upstreamCountryCode: "134",
      serviceSlug: "telegram",
      publishedSuccessRate: null, // not enriched outside US/UK
    });
  });

  it("skips SMSPool virtual pools (short_name like 'US_V')", async () => {
    global.fetch = routeCatalogFetch({
      countries: [
        { ID: 22, name: "United States (Virtual)", short_name: "US_V" },
        { ID: 1, name: "United States", short_name: "US" },
      ],
      pricing: {
        "1": [{ service: 50, service_name: "Telegram", price: "0.20", pool: 7 }],
        // id 22 has a price book too, but it must never be fetched/emitted.
        "22": [{ service: 50, service_name: "Telegram", price: "0.05", pool: 7 }],
      },
    });

    const entries = await provider().syncCatalog();
    expect(entries.every((e) => e.upstreamCountryCode !== "22")).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0].upstreamCountryCode).toBe("1");
  });

  it("isolates a single country's price-book failure — the rest still sync", async () => {
    global.fetch = routeCatalogFetch({
      countries: [
        { ID: 1, name: "United States", short_name: "US" },
        { ID: 2, name: "Canada", short_name: "CA" },
        { ID: 134, name: "Switzerland", short_name: "CH" },
      ],
      pricing: {
        "1": [{ service: 50, service_name: "Telegram", price: "0.20", pool: 7 }],
        "134": [{ service: 50, service_name: "Telegram", price: "0.90", pool: 7 }],
      },
      errorPricing: ["2"], // Canada's price book 500s mid-sync
    });

    const entries = await provider().syncCatalog();
    const countries = new Set(entries.map((e) => e.upstreamCountryCode));
    expect(countries.has("1")).toBe(true); // US synced
    expect(countries.has("134")).toBe(true); // Switzerland synced
    expect(countries.has("2")).toBe(false); // the failed country contributes nothing
  });

  it("throws when the country list is empty or an unrecognized shape", async () => {
    global.fetch = routeCatalogFetch({ countries: [] });
    await expect(provider().syncCatalog()).rejects.toBeInstanceOf(
      ProviderApiError,
    );
  });

  it("throws when every country's price book is empty (shape changed)", async () => {
    global.fetch = routeCatalogFetch({
      countries: [{ ID: 1, name: "United States", short_name: "US" }],
      pricing: { "1": [] },
    });
    await expect(provider().syncCatalog()).rejects.toBeInstanceOf(
      ProviderApiError,
    );
  });
});
