import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MtnMomoProcessor, _resetMtnMomoCache } from "@/lib/payments/mtn-momo";

const SUB_KEY = "sub_key_abc";
const API_USER = "11111111-1111-1111-1111-111111111111";
const API_KEY = "api_key_xyz";

afterEach(() => {
  _resetMtnMomoCache();
  vi.restoreAllMocks();
});

function makeProcessor() {
  return new MtnMomoProcessor({
    subscriptionKey: SUB_KEY,
    apiUser: API_USER,
    apiKey: API_KEY,
    targetEnv: "sandbox",
    baseUrl: "https://sandbox.momodeveloper.mtn.com",
  });
}

/** Routes fetch by URL: token, requesttopay POST, requesttopay/{id} GET. */
function stubFetch(statusBody?: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, _init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/collection/token/")) {
        return new Response(
          JSON.stringify({
            access_token: "tok_123",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (/\/collection\/v1_0\/requesttopay\/[^/]+$/.test(u)) {
        return new Response(
          JSON.stringify(
            statusBody ?? {
              status: "SUCCESSFUL",
              amount: "100",
              currency: "EUR",
              externalId: "vd_x",
              financialTransactionId: "ft_1",
            },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.endsWith("/collection/v1_0/requesttopay")) {
        return new Response("", { status: 202 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

describe("MtnMomoProcessor.getToken", () => {
  it("sends Basic apiUser:apiKey + subscription key and caches the token", async () => {
    stubFetch();
    const p = makeProcessor();
    const t1 = await p.getToken();
    const t2 = await p.getToken();
    expect(t1).toBe("tok_123");
    expect(t2).toBe("tok_123");

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // Cached: only one token call despite two getToken() invocations.
    const tokenCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/collection/token/"),
    );
    expect(tokenCalls.length).toBe(1);

    const headers = tokenCalls[0][1].headers as Record<string, string>;
    const expectedBasic = Buffer.from(`${API_USER}:${API_KEY}`).toString("base64");
    expect(headers.Authorization).toBe(`Basic ${expectedBasic}`);
    expect(headers["Ocp-Apim-Subscription-Key"]).toBe(SUB_KEY);
  });
});

describe("MtnMomoProcessor.requestToPay", () => {
  beforeEach(() => stubFetch());

  it("posts the correct headers + MSISDN payer body and accepts 202", async () => {
    const p = makeProcessor();
    await p.requestToPay({
      referenceId: "ref-uuid-1",
      amount: "100",
      currency: "EUR",
      externalId: "vd_abc",
      payerMsisdn: "233241234567",
      payerMessage: "top-up",
      payeeNote: "note",
      callbackUrl: "https://veridigits.com/api/webhooks/mtn-momo",
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/collection/v1_0/requesttopay"),
    )!;
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok_123");
    expect(headers["X-Reference-Id"]).toBe("ref-uuid-1");
    expect(headers["X-Target-Environment"]).toBe("sandbox");
    expect(headers["Ocp-Apim-Subscription-Key"]).toBe(SUB_KEY);
    expect(headers["X-Callback-Url"]).toBe(
      "https://veridigits.com/api/webhooks/mtn-momo",
    );

    const body = JSON.parse(String(init.body));
    expect(body.amount).toBe("100");
    expect(body.currency).toBe("EUR");
    expect(body.externalId).toBe("vd_abc");
    expect(body.payer).toEqual({
      partyIdType: "MSISDN",
      partyId: "233241234567",
    });
  });

  it("rejects a non-digit amount", async () => {
    const p = makeProcessor();
    await expect(
      p.requestToPay({
        referenceId: "r",
        amount: "10.50",
        currency: "EUR",
        externalId: "x",
        payerMsisdn: "233241234567",
        payerMessage: "m",
        payeeNote: "n",
      }),
    ).rejects.toThrow(/whole-unit digits/);
  });
});

describe("MtnMomoProcessor.getStatus", () => {
  it("normalizes SUCCESSFUL", async () => {
    stubFetch({ status: "SUCCESSFUL", amount: "100", currency: "EUR" });
    const p = makeProcessor();
    const r = await p.getStatus("ref-uuid-1");
    expect(r.status).toBe("SUCCESSFUL");
  });

  it("maps anything not SUCCESSFUL/FAILED to PENDING", async () => {
    stubFetch({ status: "PENDING" });
    const p = makeProcessor();
    const r = await p.getStatus("ref-uuid-1");
    expect(r.status).toBe("PENDING");
  });

  it("normalizes FAILED with a reason", async () => {
    stubFetch({ status: "FAILED", reason: "PAYER_NOT_FOUND" });
    const p = makeProcessor();
    const r = await p.getStatus("ref-uuid-1");
    expect(r.status).toBe("FAILED");
    expect(r.reason).toBe("PAYER_NOT_FOUND");
  });
});
