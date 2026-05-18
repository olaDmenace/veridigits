import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import {
  KorapayProcessor,
  _resetKorapayCache,
} from "@/lib/payments/korapay";

const SECRET = "sk_test_korapay_secret_xyz";

afterEach(() => {
  _resetKorapayCache();
  vi.restoreAllMocks();
});

function sign(secret: string, data: unknown): string {
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(data))
    .digest("hex");
}

describe("KorapayProcessor.verifyWebhook", () => {
  const processor = new KorapayProcessor(SECRET);

  it("accepts a payload signed correctly over body.data only", () => {
    const data = {
      reference: "vd_abc123",
      amount: 5000,
      currency: "NGN",
      status: "success",
      payment_method: "card",
    };
    const body = JSON.stringify({ event: "charge.success", data });
    const signature = sign(SECRET, data);

    const result = processor.verifyWebhook(body, signature);

    expect(result.ok).toBe(true);
    expect(result.payload?.event).toBe("charge.success");
    expect(result.payload?.data.reference).toBe("vd_abc123");
  });

  it("rejects a payload signed over the full body (common mistake)", () => {
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: "vd_abc123", amount: 5000, status: "success" },
    });
    // Wrong: sign the whole body string instead of just the data object.
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(body)
      .digest("hex");

    const result = processor.verifyWebhook(body, signature);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("signature mismatch");
  });

  it("rejects when signature header is missing", () => {
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: "x", status: "success" },
    });
    const result = processor.verifyWebhook(body, null);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing signature header");
  });

  it("rejects when the body is not JSON", () => {
    const result = processor.verifyWebhook("not-json{", "deadbeef");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("body is not JSON");
  });

  it("rejects when event or data is missing", () => {
    const body = JSON.stringify({ event: "charge.success" });
    const result = processor.verifyWebhook(body, sign(SECRET, {}));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing event or data");
  });

  it("rejects when signed with a different secret", () => {
    const data = { reference: "vd_x", status: "success" };
    const body = JSON.stringify({ event: "charge.success", data });
    const signature = sign("sk_test_wrong_secret", data);

    const result = processor.verifyWebhook(body, signature);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("signature mismatch");
  });
});

describe("KorapayProcessor.initializeCharge", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            status: true,
            message: "Charge created successfully",
            data: {
              reference: "vd_abc123",
              checkout_url: "https://checkout.korapay.com/abc/pay",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
  });

  it("posts the correct body and returns checkout_url", async () => {
    const processor = new KorapayProcessor(SECRET);
    const result = await processor.initializeCharge({
      amountNgn: 10_000,
      reference: "vd_abc123",
      customer: { email: "user@example.com" },
      notificationUrl: "https://veridigits.com/api/webhooks/korapay",
    });

    expect(result.reference).toBe("vd_abc123");
    expect(result.checkoutUrl).toBe("https://checkout.korapay.com/abc/pay");

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain("api.korapay.com");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    const body = JSON.parse(String(init.body));
    expect(body.amount).toBe(10_000);
    expect(body.currency).toBe("NGN");
    expect(body.customer.email).toBe("user@example.com");
    expect(body.notification_url).toBe(
      "https://veridigits.com/api/webhooks/korapay",
    );
  });

  it("throws if amountNgn is not a positive integer", async () => {
    const processor = new KorapayProcessor(SECRET);
    await expect(
      processor.initializeCharge({
        amountNgn: 0,
        reference: "x",
        customer: { email: "user@example.com" },
        notificationUrl: "https://example.com/webhook",
      }),
    ).rejects.toThrow(/positive integer/);
  });
});
