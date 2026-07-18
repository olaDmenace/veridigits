import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NowPaymentsProcessor } from "@/lib/payments/nowpayments";
import { PaymentProcessorError } from "@/lib/payments/types";

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

function processor() {
  return new NowPaymentsProcessor("test-api-key", "test-ipn-secret");
}

/**
 * getPaymentStatus is the backbone of the crypto reconciler — the thing that
 * recovers a user's money when the IPN webhook never fires. These lock the
 * upstream-status -> our-status mapping that decides whether a wallet is credited.
 */
describe("NowPaymentsProcessor.getPaymentStatus", () => {
  it("maps a finished payment to confirmed and reports what was paid", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        payment_status: "finished",
        actually_paid: 0.00569945,
        price_amount: 10,
      }),
    );
    const r = await processor().getPaymentStatus("5730668083");
    expect(r.status).toBe("confirmed");
    expect(r.actuallyPaid).toBeCloseTo(0.00569945);
    expect(r.priceAmountUsdCents).toBe(1000);
  });

  it("maps confirmed to confirmed (the other creditable state)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ payment_status: "confirmed", price_amount: 5 }),
    );
    expect((await processor().getPaymentStatus("1")).status).toBe("confirmed");
  });

  it("does NOT treat a partially_paid payment as confirmed", async () => {
    // The real incident: 9.97 of 9.977 USDC. Auto-crediting a short payment is
    // a judgement call, so it must never land in the creditable state.
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        payment_status: "partially_paid",
        actually_paid: 9.97,
        price_amount: 10,
      }),
    );
    const r = await processor().getPaymentStatus("4616998307");
    expect(r.status).toBe("confirming");
    expect(r.status).not.toBe("confirmed");
    expect(r.actuallyPaid).toBe(9.97);
  });

  it("maps expired and failed away from confirmed", async () => {
    const f = global.fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse({ payment_status: "expired", price_amount: 25 }));
    expect((await processor().getPaymentStatus("a")).status).toBe("expired");
    f.mockResolvedValueOnce(jsonResponse({ payment_status: "failed", price_amount: 25 }));
    expect((await processor().getPaymentStatus("b")).status).toBe("failed");
  });

  it("treats a waiting payment as waiting", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ payment_status: "waiting", actually_paid: 0, price_amount: 5 }),
    );
    expect((await processor().getPaymentStatus("c")).status).toBe("waiting");
  });

  it("defaults to waiting when the status field is missing entirely", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ price_amount: 5 }),
    );
    expect((await processor().getPaymentStatus("d")).status).toBe("waiting");
  });

  it("throws PaymentProcessorError on a non-OK response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ message: "not found" }, 404),
    );
    await expect(processor().getPaymentStatus("nope")).rejects.toBeInstanceOf(
      PaymentProcessorError,
    );
  });

  it("throws PaymentProcessorError on a non-JSON body", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("<html>gateway</html>", { status: 200 }),
    );
    await expect(processor().getPaymentStatus("x")).rejects.toBeInstanceOf(
      PaymentProcessorError,
    );
  });

  it("sends the api key and hits the payment endpoint", async () => {
    const f = global.fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse({ payment_status: "finished", price_amount: 1 }));
    await processor().getPaymentStatus("abc123");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/payment/abc123");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-api-key");
  });
});
