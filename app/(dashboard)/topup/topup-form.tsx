"use client";

import { useState, useTransition } from "react";
import { createTopup, type CreateTopupResult } from "./actions";
import { formatUsdCents } from "@/lib/utils/money";

const PRESETS = [10_00, 25_00, 50_00, 100_00] as const;

const CRYPTO_OPTIONS = [
  { code: "usdttrc20", label: "USDT (Tron)", recommended: true },
  { code: "usdterc20", label: "USDT (ERC-20)" },
  { code: "usdcsol", label: "USDC (Solana)" },
  { code: "btc", label: "BTC" },
  { code: "eth", label: "ETH" },
  { code: "sol", label: "SOL" },
  { code: "ltc", label: "LTC" },
] as const;

export function TopUpForm() {
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
          {PRESETS.map((p) => (
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
