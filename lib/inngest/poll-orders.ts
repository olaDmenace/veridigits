import { inngest } from "./client";
import { getProvider } from "@/lib/providers";
import { getAdminClient } from "@/lib/supabase/admin";
import { debitWalletForOrder } from "@/lib/wallet/debit";
import { InsufficientBalanceError } from "@/lib/wallet/types";
import { senderMatchesService } from "@/lib/services/sender-patterns";
import { decideSmsOutcome } from "@/lib/orders/sms-outcome";

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 600; // safety cap: 600 × 3s = 30min

/**
 * Per-order polling. Started by `app/order.poll-started` event from
 * the purchase action, this function loops with durable step.sleep(3s)
 * until the order has received an SMS, been cancelled, or expired.
 *
 * Each iteration:
 *   - re-reads the order from DB to detect cancel/expiry handled elsewhere
 *   - calls provider.checkOrder for any new SMS
 *   - inserts received_messages rows + flips status when SMS arrives
 *
 * Inngest concurrency cap keeps a sane upper bound on simultaneous polls.
 */
export const pollOrderFn = inngest.createFunction(
  {
    id: "poll-order",
    // Inngest free plan caps per-function concurrency at 5. Each poll
    // step.sleeps for 3s between checks, so 5 simultaneous active orders
    // is plenty for MVP volume. Bump this when on a paid plan: 50 lets a
    // few hundred concurrent active orders be polled comfortably.
    concurrency: { limit: 5 },
    triggers: [{ event: "app/order.poll-started" }],
  },
  async ({ event, step, logger }) => {
    const data = event.data as { orderId?: string };
    if (!data?.orderId) return { skipped: true, reason: "no orderId" };
    const orderId = data.orderId;

    for (let i = 0; i < MAX_POLLS; i++) {
      const tick = await step.run(`poll-${i}`, () => pollOnce(orderId));
      if (tick.done) {
        return { orderId, polls: i + 1, status: tick.status };
      }
      await step.sleep(`wait-${i}`, POLL_INTERVAL_MS);
    }

    logger.warn("poll-order hit MAX_POLLS without terminating", { orderId });
    return { orderId, polls: MAX_POLLS, status: "max_polls" };
  },
);

interface PollTick {
  done: boolean;
  status: string;
}

async function pollOnce(orderId: string): Promise<PollTick> {
  const supabase = getAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, user_id, status, provider_slug, upstream_order_id, expires_at, retail_charged_cents, services(slug)",
    )
    .eq("id", orderId)
    .single();

  if (!order) return { done: true, status: "missing" };

  const serviceSlug =
    (order.services as { slug: string } | null)?.slug ?? null;

  if (
    order.status === "completed" ||
    order.status === "cancelled" ||
    order.status === "expired" ||
    order.status === "refunded"
  ) {
    return { done: true, status: order.status };
  }

  if (new Date(order.expires_at).getTime() < Date.now()) {
    // Past expiry — let expire-orders handle the wind-down. Stop polling.
    return { done: true, status: "expired" };
  }

  let upstream;
  try {
    upstream = await getProvider(order.provider_slug).checkOrder(
      order.upstream_order_id,
    );
  } catch {
    // Transient upstream error — keep polling.
    return { done: false, status: order.status };
  }

  // Insert any new messages (idempotent: dedupe by sender+content+received_at).
  if (upstream.messages.length > 0) {
    const { data: existing } = await supabase
      .from("received_messages")
      .select("sender, content, received_at")
      .eq("order_id", orderId);

    const existingKeys = new Set(
      (existing ?? []).map((m) => keyFor(m.sender, m.content, m.received_at)),
    );

    const fresh = upstream.messages
      .filter(
        (m) =>
          !existingKeys.has(
            keyFor(m.sender, m.content, m.receivedAt.toISOString()),
          ),
      )
      .map((m) => ({
        order_id: orderId,
        sender: m.sender,
        content: m.content,
        extracted_code: extractCode(m.content),
        received_at: m.receivedAt.toISOString(),
      }));

    if (fresh.length > 0) {
      await supabase.from("received_messages").insert(fresh);
    }
  }

  // Classify any received SMS, then decide the outcome. Under defer-debit we
  // charge ONLY on a valid capture; cross-service and upstream-cancel paths
  // move no money (nothing was charged up front). Note: provider status
  // "received" does not imply an SMS exists (5SIM's RECEIVED = "waiting for
  // SMS"), so capture is gated on anyMessage below.
  const evidence =
    upstream.status === "received"
      ? await classifyEvidence(supabase, orderId, serviceSlug)
      : { anyMessage: false, anyMatch: false, anyMismatch: false };

  const outcome = decideSmsOutcome({
    upstreamStatus: upstream.status,
    currentStatus: order.status,
    anyMessage: evidence.anyMessage,
    anyMatch: evidence.anyMatch,
    anyMismatch: evidence.anyMismatch,
  });

  if (outcome === "cross_service") {
    // Latch active -> cancelled (cross-service). No charge ever happened.
    const { data: claimed } = await supabase
      .from("orders")
      .update({
        status: "cancelled",
        refund_reason: "cross_service_sms",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .in("status", ["pending", "active"])
      .select("id");
    if (claimed && claimed.length > 0) {
      // Free the upstream number so our wholesale cost is recovered.
      try {
        await getProvider(order.provider_slug).cancelOrder(
          order.upstream_order_id,
        );
      } catch {
        /* reconciliation job catches a stuck upstream cancel */
      }
    }
    return { done: true, status: "cancelled" };
  }

  if (outcome === "capture") {
    // The status flip is the idempotency latch — only one poll/expire run
    // can transition active -> received, and only that winner debits.
    const { data: claimed } = await supabase
      .from("orders")
      .update({ status: "received" })
      .eq("id", orderId)
      .in("status", ["pending", "active"])
      .select("id");

    if (claimed && claimed.length === 1) {
      try {
        if (order.retail_charged_cents > 0) {
          await debitWalletForOrder({
            userId: order.user_id,
            amountCents: order.retail_charged_cents,
            orderId,
            note: `sms-received · ${order.provider_slug}:${order.upstream_order_id}`,
          });
          await supabase
            .from("orders")
            .update({ charged_at: new Date().toISOString() })
            .eq("id", orderId);
        }
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          // Accepted defer-debit risk: code delivered but the wallet can't
          // cover it (balance spent elsewhere). Leave status 'received',
          // charged_at null; orders_uncharged_received_idx surfaces it.
        } else {
          // Transient wallet/DB error — undo the latch so the next poll tick
          // re-attempts the capture instead of silently losing the charge.
          console.error("capture debit failed — will retry", { orderId, err });
          await supabase
            .from("orders")
            .update({ status: "active" })
            .eq("id", orderId)
            .eq("status", "received");
          return { done: false, status: "active" };
        }
      }
    }
    return { done: true, status: "received" };
  }

  if (outcome === "upstream_cancelled") {
    await supabase
      .from("orders")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", orderId)
      .in("status", ["pending", "active"]);
    return { done: true, status: "cancelled" };
  }

  return { done: false, status: order.status };
}

function keyFor(
  sender: string | null,
  content: string,
  receivedAt: string,
): string {
  return `${sender ?? ""}|${content}|${receivedAt}`;
}

/**
 * Returns whether the order's SMS batch contains any confident match and/or
 * any confident mismatch against the expected service. The capture decision
 * itself lives in decideSmsOutcome (pure, unit-tested).
 */
async function classifyEvidence(
  supabase: ReturnType<typeof getAdminClient>,
  orderId: string,
  serviceSlug: string | null,
): Promise<{ anyMessage: boolean; anyMatch: boolean; anyMismatch: boolean }> {
  const { data: msgs } = await supabase
    .from("received_messages")
    .select("sender")
    .eq("order_id", orderId);

  let anyMatch = false;
  let anyMismatch = false;
  for (const m of msgs ?? []) {
    const d = senderMatchesService(serviceSlug, m.sender);
    if (d.decision === "match") anyMatch = true;
    if (d.decision === "mismatch") anyMismatch = true;
  }
  return { anyMessage: (msgs?.length ?? 0) > 0, anyMatch, anyMismatch };
}

/**
 * Best-effort regex extraction of the verification code. Common patterns:
 *   - "code: 123456"
 *   - "G-928451"
 *   - "Your code is 847-291"
 *   - "YourWhatsAppcode:778467Don'tshare"  (mashed, no spaces)
 *
 * Anchors on DIGIT boundaries (not `\b` word boundaries): WhatsApp and others
 * jam the code straight against letters ("code:778467Don't"), where a trailing
 * `\b` never matches because digit→letter is word→word. Returns the first
 * standalone 4-8 digit run. Null if nothing matches.
 */
export function extractCode(content: string): string | null {
  const candidates = [
    /G-(\d{4,8})(?!\d)/,
    /(?<!\d)(\d{3}-\d{3})(?!\d)/,
    /(?<!\d)(\d{4,8})(?!\d)/,
  ];
  for (const re of candidates) {
    const m = content.match(re);
    if (m) return m[1];
  }
  return null;
}
