import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quoteNgnTopUp, _resetFxCache } from "@/lib/fx/rates";

afterEach(() => {
  _resetFxCache();
  vi.restoreAllMocks();
});

function mockRate(ngnPerUsd: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return new Response(
        JSON.stringify({
          result: "success",
          rates: { NGN: ngnPerUsd },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
}

describe("quoteNgnTopUp", () => {
  beforeEach(() => {
    delete process.env.NGN_FX_BUFFER_BPS;
  });

  it("returns usdCents less than the unbuffered spot conversion", async () => {
    mockRate(1500); // 1 USD = 1500 NGN
    const q = await quoteNgnTopUp(15_000);
    // Spot: 15000/1500 * 100 = 1000 cents.
    // Default buffer 300 bps (3%): 1000 * 0.97 = 970.
    expect(q.usdCents).toBe(970);
    expect(q.rateNgnPerUsd).toBe(1500);
    expect(q.bufferBps).toBe(300);
  });

  it("honors a custom buffer via env", async () => {
    process.env.NGN_FX_BUFFER_BPS = "500"; // 5%
    // Reload module to pick up env change.
    vi.resetModules();
    const { quoteNgnTopUp: q, _resetFxCache: reset } = await import(
      "@/lib/fx/rates"
    );
    reset();
    mockRate(1500);
    const result = await q(15_000);
    // 1000 * 0.95 = 950.
    expect(result.usdCents).toBe(950);
    expect(result.bufferBps).toBe(500);
  });

  it("throws on non-integer or non-positive input", async () => {
    mockRate(1500);
    await expect(quoteNgnTopUp(0)).rejects.toThrow(/positive integer/);
    await expect(quoteNgnTopUp(-1)).rejects.toThrow(/positive integer/);
    await expect(quoteNgnTopUp(1.5)).rejects.toThrow(/positive integer/);
  });

  it("falls back to the cached rate if upstream fails", async () => {
    mockRate(1500);
    const first = await quoteNgnTopUp(15_000);
    expect(first.rateNgnPerUsd).toBe(1500);

    // Force cache expiry and a failing upstream.
    _resetFxCache();
    mockRate(1500); // need to seed once more
    await quoteNgnTopUp(15_000);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("server down", { status: 500 })),
    );
    // Within cache window, we get the cached value back.
    const second = await quoteNgnTopUp(15_000);
    expect(second.rateNgnPerUsd).toBe(1500);
  });
});
