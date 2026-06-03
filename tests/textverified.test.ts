import { afterEach, describe, expect, it, vi } from "vitest";
import { TextVerifiedProvider } from "@/lib/providers/textverified";
import { ProviderOutOfStockError } from "@/lib/providers/types";

const ORIGINAL_FETCH = global.fetch;
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status });
}

/**
 * Route the mock by URL+method so the auto-auth-first call order doesn't matter.
 * `routes` maps a matcher to a Response factory.
 */
function mockRouter(
  handler: (url: string, method: string, body: unknown) => Response,
) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return handler(url, method, body);
  }) as unknown as typeof fetch;
}

function provider() {
  return new TextVerifiedProvider("key", "user@example.com");
}

const AUTH_OK = { token: "tok-123", expiresIn: 899 };

describe("TextVerifiedProvider auth + pricing", () => {
  it("authenticates then returns price in cents", async () => {
    mockRouter((url, method) => {
      if (url.endsWith("/api/pub/v2/auth")) return json(AUTH_OK);
      if (url.endsWith("/api/pub/v2/pricing/verifications") && method === "POST")
        return json({ totalCost: 1.25 });
      return json({}, 404);
    });
    const q = await provider().getPriceAndAvailability({
      upstreamServiceCode: "whatsapp",
      upstreamCountryCode: "us",
    });
    expect(q.priceCents).toBe(125);
    expect(q.availableCount).toBeGreaterThan(0);
  });
});

describe("TextVerifiedProvider.buyActivation", () => {
  it("creates a verification then reads back the number", async () => {
    mockRouter((url, method) => {
      if (url.endsWith("/api/pub/v2/auth")) return json(AUTH_OK);
      if (url.endsWith("/api/pub/v2/verifications") && method === "POST")
        return json({ href: "/api/pub/v2/verifications/ver_abc", method: "GET" }, 201);
      if (url.endsWith("/api/pub/v2/verifications/ver_abc") && method === "GET")
        return json({
          id: "ver_abc",
          number: "12025550143",
          state: "pending",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          totalCost: 1.25,
        });
      return json({}, 404);
    });
    const r = await provider().buyActivation({
      upstreamServiceCode: "whatsapp",
      upstreamCountryCode: "us",
    });
    expect(r.upstreamOrderId).toBe("ver_abc");
    expect(r.phoneNumber).toBe("12025550143");
    expect(r.wholesaleCents).toBe(125);
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("treats a verification with no number as out of stock", async () => {
    mockRouter((url, method) => {
      if (url.endsWith("/api/pub/v2/auth")) return json(AUTH_OK);
      if (url.endsWith("/api/pub/v2/verifications") && method === "POST")
        return json({ href: "/api/pub/v2/verifications/ver_x" }, 201);
      if (url.endsWith("/api/pub/v2/verifications/ver_x"))
        return json({ id: "ver_x", state: "pending" }); // no number
      return json({}, 404);
    });
    await expect(
      provider().buyActivation({
        upstreamServiceCode: "whatsapp",
        upstreamCountryCode: "us",
      }),
    ).rejects.toBeInstanceOf(ProviderOutOfStockError);
  });
});

describe("TextVerifiedProvider.checkOrder", () => {
  it("returns pending with no messages while waiting", async () => {
    mockRouter((url) => {
      if (url.endsWith("/api/pub/v2/auth")) return json(AUTH_OK);
      if (url.includes("/api/pub/v2/verifications/ver_abc"))
        return json({ id: "ver_abc", state: "pending" });
      if (url.includes("/api/pub/v2/sms")) return json({ data: [] });
      return json({}, 404);
    });
    const s = await provider().checkOrder("ver_abc");
    expect(s.status).toBe("pending");
    expect(s.messages).toHaveLength(0);
  });

  it("returns received with the SMS once completed", async () => {
    mockRouter((url) => {
      if (url.endsWith("/api/pub/v2/auth")) return json(AUTH_OK);
      if (url.includes("/api/pub/v2/verifications/ver_abc"))
        return json({ id: "ver_abc", state: "completed" });
      if (url.includes("/api/pub/v2/sms"))
        return json({
          data: [
            {
              id: "s1",
              message: "WhatsApp code 123-456",
              to: "12025550143",
              from: "WhatsApp",
              createdAt: new Date().toISOString(),
            },
          ],
        });
      return json({}, 404);
    });
    const s = await provider().checkOrder("ver_abc");
    expect(s.status).toBe("received");
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].content).toBe("WhatsApp code 123-456");
    expect(s.messages[0].sender).toBe("WhatsApp");
  });

  it("maps canceled -> cancelled and skips the SMS fetch", async () => {
    mockRouter((url) => {
      if (url.endsWith("/api/pub/v2/auth")) return json(AUTH_OK);
      if (url.includes("/api/pub/v2/verifications/ver_abc"))
        return json({ id: "ver_abc", state: "canceled" });
      return json({}, 404);
    });
    const s = await provider().checkOrder("ver_abc");
    expect(s.status).toBe("cancelled");
    expect(s.messages).toHaveLength(0);
  });
});

describe("TextVerifiedProvider.cancelOrder", () => {
  it("posts the cancel action without throwing", async () => {
    mockRouter((url, method) => {
      if (url.endsWith("/api/pub/v2/auth")) return json(AUTH_OK);
      if (url.endsWith("/api/pub/v2/verifications/ver_abc/cancel") && method === "POST")
        return json(undefined, 200);
      return json({}, 404);
    });
    await expect(provider().cancelOrder("ver_abc")).resolves.toBeUndefined();
  });
});

describe("TextVerifiedProvider.syncCatalog", () => {
  it("prices each service and emits US-aligned entries", async () => {
    mockRouter((url, method) => {
      if (url.endsWith("/api/pub/v2/auth")) return json(AUTH_OK);
      if (url.includes("/api/pub/v2/services"))
        return json({ data: [{ serviceName: "whatsapp" }, { serviceName: "google" }] });
      if (url.endsWith("/api/pub/v2/pricing/verifications") && method === "POST")
        return json({ totalCost: 1.5 });
      return json({}, 404);
    });
    const entries = await provider().syncCatalog();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      upstreamServiceCode: "whatsapp",
      serviceSlug: "whatsapp",
      countryIso: "usa",
      priceCents: 150,
    });
  });

  it("skips services it can't price", async () => {
    mockRouter((url, method) => {
      if (url.endsWith("/api/pub/v2/auth")) return json(AUTH_OK);
      if (url.includes("/api/pub/v2/services"))
        return json({ data: [{ serviceName: "whatsapp" }] });
      if (url.endsWith("/api/pub/v2/pricing/verifications") && method === "POST")
        return json({ error: "no price" }, 400);
      return json({}, 404);
    });
    const entries = await provider().syncCatalog();
    expect(entries).toHaveLength(0);
  });
});
