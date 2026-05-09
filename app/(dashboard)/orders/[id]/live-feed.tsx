"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { cancelOrderAction } from "./actions";

export interface InitialMessage {
  id: string;
  sender: string | null;
  content: string;
  extracted_code: string | null;
  received_at: string;
}

export interface InitialOrder {
  id: string;
  status: string;
  phone_number: string;
  expires_at: string;
  created_at: string;
  retail_charged_cents: number;
  provider_slug: string;
  service: string;
  country: string;
}

const CANCEL_WINDOW_MS = 2 * 60 * 1000;

export function LiveOrderView({
  order,
  initialMessages,
}: {
  order: InitialOrder;
  initialMessages: InitialMessage[];
}) {
  const [messages, setMessages] = useState<InitialMessage[]>(initialMessages);
  const [status, setStatus] = useState<string>(order.status);
  const [now, setNow] = useState(() => Date.now());
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isPendingCancel, startCancel] = useTransition();
  const [copied, setCopied] = useState(false);

  // Tick once a second for the countdown / cancel-window display.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Realtime subscriptions: new SMS rows + order status changes.
  useEffect(() => {
    const supabase = createClient();

    const messagesChannel = supabase
      .channel(`order-msgs:${order.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "received_messages",
          filter: `order_id=eq.${order.id}`,
        },
        (payload) => {
          const row = payload.new as InitialMessage;
          setMessages((prev) =>
            prev.some((m) => m.id === row.id) ? prev : [row, ...prev],
          );
        },
      )
      .subscribe();

    const orderChannel = supabase
      .channel(`order-row:${order.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${order.id}`,
        },
        (payload) => {
          const row = payload.new as { status?: string };
          if (typeof row.status === "string") setStatus(row.status);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(orderChannel);
    };
  }, [order.id]);

  const expiresAtMs = new Date(order.expires_at).getTime();
  const remainingMs = Math.max(0, expiresAtMs - now);
  const ageMs = now - new Date(order.created_at).getTime();
  const cancelable =
    (status === "pending" || status === "active") &&
    messages.length === 0 &&
    ageMs < CANCEL_WINDOW_MS;

  function copyPhone() {
    navigator.clipboard.writeText(order.phone_number).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function onCancel() {
    setCancelError(null);
    startCancel(async () => {
      const result = await cancelOrderAction(order.id);
      if (!result.ok) setCancelError(result.message);
    });
  }

  const latestMessage = messages[0];
  const extractedCode = latestMessage?.extracted_code;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <div className="eyebrow">{order.provider_slug} · {order.country}</div>
        <h1 className="h2">{order.service}</h1>
      </div>

      {/* Number card */}
      <div className="otp-reveal" style={{ position: "relative" }}>
        <button
          type="button"
          className="copy"
          onClick={copyPhone}
        >
          {copied ? "copied" : "copy"}
        </button>
        <div className="lbl">Active number</div>
        <div className="code" style={{ fontSize: 40, letterSpacing: "0.06em", marginTop: 16 }}>
          {order.phone_number}
        </div>
        <div className="src">
          {status === "received" || status === "completed"
            ? "Code received."
            : status === "cancelled" || status === "expired" || status === "refunded"
              ? `Order ${status}.`
              : remainingMs > 0
                ? `Expires in ${formatRemaining(remainingMs)}`
                : "Expired."}
        </div>
      </div>

      {/* Code reveal — once first SMS arrives */}
      {extractedCode ? (
        <div className="otp-reveal">
          <div className="lbl">Verification code</div>
          <div className="code">{extractedCode}</div>
          <div className="src">from {latestMessage.sender ?? "unknown"}</div>
        </div>
      ) : null}

      {/* SMS list */}
      <div>
        <div className="msg-list-head" style={{ padding: "0 0 12px" }}>
          <div className="ttl">Inbox</div>
          <div className="cnt">
            {String(messages.length).padStart(2, "0")}
          </div>
        </div>

        {messages.length > 0 ? (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <div key={m.id} className="sms-bubble">
                <div className="av svc-tg">{(m.sender ?? "?").slice(0, 2).toLowerCase()}</div>
                <div>
                  <div className="who">{m.sender ?? "Unknown sender"}</div>
                  <div className="msg">
                    {renderWithCode(m.content, m.extracted_code)}
                  </div>
                </div>
                <div className="when">
                  {formatRelative(new Date(m.received_at), now)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card flex items-center gap-3" style={{ padding: 18 }}>
            <span className="dots" style={{ display: "inline-flex", gap: 3 }}>
              <i style={{ width: 4, height: 4, borderRadius: 9999, background: "var(--color-vg-500)", animation: "blink 1.2s var(--ease-out) infinite" }}></i>
              <i style={{ width: 4, height: 4, borderRadius: 9999, background: "var(--color-vg-500)", animation: "blink 1.2s var(--ease-out) infinite", animationDelay: "0.2s" }}></i>
              <i style={{ width: 4, height: 4, borderRadius: 9999, background: "var(--color-vg-500)", animation: "blink 1.2s var(--ease-out) infinite", animationDelay: "0.4s" }}></i>
            </span>
            <span className="caption">Waiting for SMS…</span>
          </div>
        )}
      </div>

      {/* Cancel control */}
      {cancelable ? (
        <div className="card flex items-center justify-between gap-4">
          <div>
            <div className="eyebrow">Cancel window</div>
            <p className="caption" style={{ marginTop: 4 }}>
              You have {formatRemaining(CANCEL_WINDOW_MS - ageMs)} to cancel for
              a full refund. After that, you keep the number for the rest of
              its 20-minute window.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isPendingCancel}
          >
            {isPendingCancel ? "Cancelling…" : "Cancel & refund"}
          </button>
        </div>
      ) : null}

      {cancelError ? (
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
          {cancelError}
        </div>
      ) : null}
    </div>
  );
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatRelative(when: Date, nowMs: number): string {
  const diff = Math.max(0, nowMs - when.getTime());
  if (diff < 60_000) return "now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h`;
}

function renderWithCode(content: string, code: string | null) {
  if (!code) return content;
  const idx = content.indexOf(code);
  if (idx < 0) return content;
  return (
    <>
      {content.slice(0, idx)}
      <code>{code}</code>
      {content.slice(idx + code.length)}
    </>
  );
}
