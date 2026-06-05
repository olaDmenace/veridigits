"use client";

import { useEffect, useState, useTransition } from "react";
import {
  createTopup,
  createFiatTopup,
  quoteFiat,
  type CreateTopupResult,
  type CreateFiatTopupResult,
  type QuoteFiatResult,
} from "./actions";
import { formatUsdCents } from "@/lib/utils/money";

type FiatCurrency = "NGN" | "GHS";

const USD_PRESETS = [10_00, 25_00, 50_00, 100_00] as const;

const CRYPTO_OPTIONS = [
  { code: "usdttrc20", label: "USDT (Tron)", recommended: true },
  { code: "usdterc20", label: "USDT (ERC-20)" },
  { code: "usdcsol", label: "USDC (Solana)" },
  { code: "btc", label: "BTC" },
  { code: "eth", label: "ETH" },
  { code: "sol", label: "SOL" },
  { code: "ltc", label: "LTC" },
] as const;

interface FiatMeta {
  symbol: string;
  locale: string;
  min: number;
  max: number;
  step: number;
  presets: number[];
  defaultAmount: number;
  customPlaceholder: string;
  channels: string;
  payNote: string;
}

const FIAT_META: Record<FiatCurrency, FiatMeta> = {
  NGN: {
    symbol: "₦",
    locale: "en-NG",
    min: 2_000,
    max: 5_000_000,
    step: 500,
    presets: [5_000, 10_000, 25_000, 50_000],
    defaultAmount: 10_000,
    customPlaceholder: "e.g. 15000",
    channels: "Card, bank transfer, or pay-with-bank",
    payNote: "card or bank details",
  },
  GHS: {
    symbol: "₵",
    locale: "en-GH",
    min: 20,
    max: 100_000,
    step: 10,
    presets: [50, 100, 250, 500],
    defaultAmount: 100,
    customPlaceholder: "e.g. 150",
    channels: "Mobile money (MTN, Telecel, AirtelTigo) or card",
    payNote: "mobile money or card details",
  },
};

type Rail = "NGN" | "GHS" | "crypto";

function formatLocal(currency: FiatCurrency, n: number): string {
  const m = FIAT_META[currency];
  return `${m.symbol}${(Number.isFinite(n) ? n : 0).toLocaleString(m.locale)}`;
}

// Ghana stays dark until Korapay has GHS collections enabled on the account.
// Flip NEXT_PUBLIC_ENABLE_GHS=true to surface the Cedi rail.
const GHS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_GHS === "true";

export function TopUpForm() {
  const [rail, setRail] = useState<Rail>("NGN");

  return (
    <div className="flex flex-col gap-6">
      <div
        className="rail-tabs"
        style={GHS_ENABLED ? undefined : { gridTemplateColumns: "1fr 1fr" }}
      >
        <button
          type="button"
          className={`rail-tab ${rail === "NGN" ? "selected" : ""}`}
          onClick={() => setRail("NGN")}
        >
          <span className="lbl">Naira</span>
          <span className="caption">Card, transfer, or pay-with-bank</span>
        </button>
        {GHS_ENABLED ? (
          <button
            type="button"
            className={`rail-tab ${rail === "GHS" ? "selected" : ""}`}
            onClick={() => setRail("GHS")}
          >
            <span className="lbl">Cedi</span>
            <span className="caption">Mobile money (MTN, Telecel…) or card</span>
          </button>
        ) : null}
        <button
          type="button"
          className={`rail-tab ${rail === "crypto" ? "selected" : ""}`}
          onClick={() => setRail("crypto")}
        >
          <span className="lbl">Crypto</span>
          <span className="caption">USDT, USDC, BTC, ETH, and others</span>
        </button>
      </div>

      {rail === "crypto" ? <CryptoForm /> : <FiatForm currency={rail} />}
    </div>
  );
}

// ============================================================
// Local fiat — Korapay (NGN / GHS)
// ============================================================
function FiatForm({ currency }: { currency: FiatCurrency }) {
  const meta = FIAT_META[currency];
  const [amount, setAmount] = useState<number>(meta.defaultAmount);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateFiatTopupResult | null>(null);
  const [quote, setQuote] = useState<QuoteFiatResult | null>(null);

  const usingCustom = customAmount.trim() !== "";
  const effective = usingCustom ? Math.floor(Number(customAmount)) : amount;

  // Reset selection to the currency's default whenever the rail changes.
  useEffect(() => {
    setAmount(meta.defaultAmount);
    setCustomAmount("");
    setResult(null);
    setQuote(null);
  }, [currency, meta.defaultAmount]);

  // Re-quote whenever the effective amount changes. We deliberately leave the
  // previous quote on screen while the new one is fetching — feels smoother
  // than a flash of "Calculating…" between every keystroke.
  useEffect(() => {
    if (!Number.isFinite(effective) || effective < 1) return;
    let cancelled = false;
    quoteFiat(currency, effective).then((q) => {
      if (!cancelled) setQuote(q);
    });
    return () => {
      cancelled = true;
    };
  }, [currency, effective]);

  function submit() {
    setResult(null);
    const fd = new FormData();
    fd.append("amount", String(effective));
    startTransition(async () => {
      const r = await createFiatTopup(currency, fd);
      setResult(r);
      if (r.ok) {
        // Redirect to Korapay-hosted checkout.
        window.location.href = r.checkoutUrl;
      }
    });
  }

  return (
    <div className="card flex flex-col gap-6" style={{ padding: 24 }}>
      <div>
        <div className="eyebrow">Amount</div>
        <div className="topup-grid" style={{ marginTop: 12 }}>
          {meta.presets.map((p) => (
            <button
              key={p}
              type="button"
              className={`topup-tile ${
                !usingCustom && amount === p ? "selected" : ""
              }`}
              onClick={() => {
                setAmount(p);
                setCustomAmount("");
              }}
            >
              <div className="lbl">{currency}</div>
              <div className="amt">{formatLocal(currency, p)}</div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <label className="label" htmlFor="custom-fiat">
            Or a custom amount
          </label>
          <input
            id="custom-fiat"
            type="number"
            inputMode="numeric"
            min={meta.min}
            max={meta.max}
            step={meta.step}
            placeholder={meta.customPlaceholder}
            className="input"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
          />
        </div>
      </div>

      <div className="card-flat" style={{ padding: 14 }}>
        <div className="caption" style={{ marginBottom: 4 }}>
          You&apos;ll receive
        </div>
        {quote && quote.ok ? (
          <div className="flex items-baseline gap-2">
            <span className="h3 mono" style={{ fontWeight: 500 }}>
              {formatUsdCents(quote.usdCents)}
            </span>
            <span className="caption">
              @ {meta.symbol}
              {quote.rate.toFixed(2)} / $ (locked at quote)
            </span>
          </div>
        ) : quote && !quote.ok ? (
          <div className="caption" style={{ color: "var(--color-danger)" }}>
            {quote.error}
          </div>
        ) : (
          <div className="caption">Calculating…</div>
        )}
      </div>

      {result && !result.ok ? (
        <div
          className="badge badge-danger"
          style={{
            height: "auto",
            padding: "10px 12px",
            textTransform: "none",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            letterSpacing: 0,
            fontWeight: 500,
          }}
        >
          {result.error}
        </div>
      ) : null}

      <button
        type="button"
        className="btn btn-primary btn-lg"
        disabled={pending || !quote || !quote.ok || effective < meta.min}
        onClick={submit}
      >
        <span className="dot"></span>
        {pending
          ? "Opening secure checkout…"
          : `Pay ${formatLocal(currency, effective)}`}
      </button>

      <p className="caption text-center">
        Secure checkout opens on korapay.com. We never see your {meta.payNote}.
        Funds credit to your wallet automatically once Korapay confirms the
        payment.
      </p>
    </div>
  );
}

// ============================================================
// Crypto — NOWPayments (unchanged, just extracted)
// ============================================================
function CryptoForm() {
  const [amount, setAmount] = useState<number>(25_00);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [crypto, setCrypto] = useState<string>("usdttrc20");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateTopupResult | null>(null);
  const [copied, setCopied] = useState<"address" | "amount" | null>(null);

  const usingCustom = customAmount.trim() !== "";
  const effectiveAmountCents = usingCustom
    ? Math.round(Number(customAmount) * 100)
    : amount;

  function submit() {
    setResult(null);
    const fd = new FormData();
    fd.append("amountUsdCents", String(effectiveAmountCents));
    fd.append("payCurrency", crypto);
    startTransition(async () => {
      const r = await createTopup(fd);
      setResult(r);
    });
  }

  function copy(text: string, kind: "address" | "amount") {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  if (result?.ok) {
    return (
      <div className="card flex flex-col gap-5" style={{ padding: 24 }}>
        <div>
          <div className="eyebrow">Send {result.payCurrency.toUpperCase()}</div>
          <h2 className="h3" style={{ marginTop: 4 }}>
            Top up {formatUsdCents(result.amountUsdCents)}
          </h2>
        </div>

        <div className="card-flat" style={{ padding: 16 }}>
          <div className="caption" style={{ marginBottom: 4 }}>
            Pay this amount
          </div>
          <div
            className="flex items-center justify-between gap-3"
            style={{ marginBottom: 16 }}
          >
            <span className="mono" style={{ fontSize: 22, fontWeight: 500 }}>
              {result.payAmount} {result.payCurrency.toUpperCase()}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => copy(result.payAmount, "amount")}
            >
              {copied === "amount" ? "Copied" : "Copy amount"}
            </button>
          </div>

          <div className="caption" style={{ marginBottom: 4 }}>
            To this address
          </div>
          <div className="flex items-center justify-between gap-3">
            <span
              className="mono"
              style={{
                fontSize: 13,
                wordBreak: "break-all",
                lineHeight: 1.4,
              }}
            >
              {result.payAddress}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => copy(result.payAddress, "address")}
            >
              {copied === "address" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <p className="caption">
          Once the network confirms your transaction, your wallet credits
          automatically. Keep this page open or revisit{" "}
          <span className="mono">/topup</span> later — the credit happens
          regardless.
        </p>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-6" style={{ padding: 24 }}>
      <div>
        <div className="eyebrow">Amount</div>
        <div className="topup-grid" style={{ marginTop: 12 }}>
          {USD_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`topup-tile ${
                !usingCustom && amount === p ? "selected" : ""
              }`}
              onClick={() => {
                setAmount(p);
                setCustomAmount("");
              }}
            >
              <div className="lbl">USD</div>
              <div className="amt">{formatUsdCents(p)}</div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <label className="label" htmlFor="custom-amount">
            Or a custom amount
          </label>
          <input
            id="custom-amount"
            type="number"
            inputMode="decimal"
            min={5}
            max={5000}
            step={1}
            placeholder="e.g. 75"
            className="input"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
          />
        </div>
      </div>

      <div>
        <div className="eyebrow">Pay with</div>
        <div className="chips" style={{ marginTop: 12 }}>
          {CRYPTO_OPTIONS.map((o) => (
            <button
              key={o.code}
              type="button"
              className={`chip ${crypto === o.code ? "selected" : ""}`}
              onClick={() => setCrypto(o.code)}
            >
              <span className="tic">{crypto === o.code ? "✓" : ""}</span>
              {o.label}
              {"recommended" in o && o.recommended ? (
                <span className="caption" style={{ marginLeft: 4 }}>
                  · low fee
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {result && !result.ok ? (
        <div
          className="badge badge-danger"
          style={{
            height: "auto",
            padding: "10px 12px",
            textTransform: "none",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            letterSpacing: 0,
            fontWeight: 500,
          }}
        >
          {result.error}
        </div>
      ) : null}

      <button
        type="button"
        className="btn btn-primary btn-lg"
        disabled={pending || effectiveAmountCents < 500}
        onClick={submit}
      >
        <span className="dot"></span>
        {pending
          ? "Generating address…"
          : `Top up ${formatUsdCents(effectiveAmountCents)}`}
      </button>

      <p className="caption text-center">
        We never charge a card or take fees on top of NOWPayments&apos; 0.5%
        crypto fee. Funds are credited to your wallet on confirmation.
      </p>
    </div>
  );
}
