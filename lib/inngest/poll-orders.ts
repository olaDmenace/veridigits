import { inngest } from "./client";
import { getProvider } from "@/lib/providers";
import { getAdminClient } from "@/lib/supabase/admin";
import { refundOrder } from "@/lib/wallet/refund";
import { senderMatchesService } from "@/lib/services/sender-patterns";

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
    // Past expiry — let expire-orders handle the refund. Stop polling.
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

  // Flip order status when upstream confirms received. Before committing to
  // "received", check whether the SMS we got looks like it actually came from
  // the service the user paid for. If the sender clearly doesn't match (e.g.
  // a Telegram code on a number bought for WhatsApp), auto-refund instead.
  // We swallow the wholesale loss in exchange for not making the user fight
  // for a refund on what's plainly not their code.
  if (upstream.status === "received" && order.status !== "received") {
    const decision = await classifyMessages(supabase, orderId, serviceSlug);

    if (decision === "cross_service") {
      await supabase
        .from("orders")
        .update({
          status: "refunded",
          refund_reason: "cross_service_sms",
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      try {
        if (order.retail_charged_cents > 0) {
          await refundOrder({
            userId: order.user_id,
            amountCents: order.retail_charged_cents,
            orderId,
            note: "auto-refund: SMS sender did not match expected service",
          });
        }
      } catch {
        // Wallet apply failed. Reconciliation job will retry; leave the order
        // marked refunded so the user UI reflects intent.
      }
      return { done: true, status: "refunded" };
    }

    await supabase
      .from("orders")
      .update({ status: "received" })
      .eq("id", orderId);
    return { done: true, status: "received" };
  }

  if (upstream.status === "cancelled") {
    // Cancelled upstream-side without our action — refund and mark.
    await supabase
      .from("orders")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", orderId);
    try {
      await refundOrder({
        userId: order.user_id,
        amountCents: 0, // Don't refund without knowing the original retail price here.
        orderId,
        note: "upstream cancelled",
      });
    } catch {
      /* refund handled elsewhere or not applicable */
    }
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
 * Look at every SMS on the order and decide whether the batch is legit or a
 * cross-service mismatch. Auto-refund fires only when at least one SMS is a
 * confident mismatch AND no SMS is a match — i.e. we have positive evidence
 * something's wrong and no contradictory evidence that the right code arrived.
 */
async function classifyMessages(
  supabase: ReturnType<typeof getAdminClient>,
  orderId: string,
  serviceSlug: string | null,
): Promise<"normal" | "cross_service"> {
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
  if (anyMismatch && !anyMatch) return "cross_service";
  return "normal";
}

/**
 * Best-effort regex extraction of the verification code. Common patterns:
 *   - "code: 123456"
 *   - "G-928451"
 *   - "Your code is 847-291"
 *   - "<service>: 123456"
 *
 * Returns the first 4-8 digit run we find. Null if nothing matches.
 */
function extractCode(content: string): string | null {
  const candidates = [
    /\bG-(\d{4,8})\b/,
    /\b(\d{3}-\d{3})\b/,
    /\b(\d{4,8})\b/,
  ];
  for (const re of candidates) {
    const m = content.match(re);
    if (m) return m[1];
  }
  return null;
}
