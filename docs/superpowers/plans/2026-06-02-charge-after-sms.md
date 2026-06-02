# Charge-After-SMS + Cancel Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop debiting the wallet at purchase; charge only when the first *valid* SMS lands. Fix the Cancel control so it stops erroring (inverted 5SIM window) and stacks correctly on mobile.

**Architecture:** Defer-debit model. Purchase buys the upstream number and records the order as `active` with the intended price in `retail_charged_cents`, but moves **no money**. The per-order poll (and the expiry backstop) become the charge point: when a valid, service-matching SMS arrives, we atomically latch the order `active → received` and debit the wallet once. Cancel/expiry/no-SMS/cross-service paths never charge, so there is nothing to refund. A new `orders.charged_at` column records when (and whether) the debit actually succeeded so an uncharged-but-delivered order is auditable.

**Tech Stack:** Next.js 16 server actions, Inngest jobs, Supabase Postgres (admin client), Vitest (Node env, pure-logic tests with mocked fetch), Tailwind v4 utilities.

**Accepted risk (explicit, per product owner):** Without a fund hold, a user with balance $X can hold several `active` numbers at once and, if codes land on all of them, we can only collect up to what's in the wallet at each capture. Task 8 adds an **optional** concurrent-active cap to *bound* this; it can be disabled by setting the cap to 0.

---

## File Structure

- `lib/orders/cancel-eligibility.ts` — **new.** Pure function `canCancelOrder()` deciding whether an order may be cancelled (correct, non-inverted 5SIM window). Imported by both the server action and the client UI.
- `lib/orders/sms-outcome.ts` — **new.** Pure function `decideSmsOutcome()` mapping (upstream status, current status, match/mismatch evidence) → an action enum. Lets us unit-test the capture decision without a DB.
- `supabase/migrations/0004_order_charged_at.sql` — **new.** Adds `orders.charged_at timestamptz`.
- `lib/inngest/poll-orders.ts` — **modify.** Becomes the charge point; uses both helpers.
- `lib/inngest/expire-orders.ts` — **modify.** No refund; mark expired (uncharged) or completed (already charged).
- `app/(dashboard)/buy/actions.ts` — **modify.** Remove the wallet debit from `purchase`; keep the balance pre-check; optional concurrent-active cap.
- `app/(dashboard)/orders/[id]/actions.ts` — **modify.** Use `canCancelOrder`; drop the refund (uncharged); keep upstream cancel + mark cancelled.
- `app/(dashboard)/orders/[id]/live-feed.tsx` — **modify.** Re-gate + relabel the cancel control via `canCancelOrder`; stack on mobile; update cross-service copy.
- `app/(dashboard)/buy/picker.tsx` — **modify.** QuotePanel copy: "you're charged when the code arrives."
- `tests/cancel-eligibility.test.ts` — **new.**
- `tests/sms-outcome.test.ts` — **new.**

---

## Task 1: Cancel-eligibility helper (pure, tested)

**Files:**
- Create: `lib/orders/cancel-eligibility.ts`
- Test: `tests/cancel-eligibility.test.ts`

Root cause being fixed: today both UI and server allow cancel only when `ageMs < 2min`, but 5SIM's `/user/cancel` **rejects** cancellation during the first ~2 minutes — so every in-window cancel throws `upstream_error`. The correct rule: cancel is allowed only **after** a minimum age (`MIN_CANCEL_AGE_MS`, 2 min) AND before expiry AND no SMS AND status is `active`/`pending`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cancel-eligibility.test.ts
import { describe, expect, it } from "vitest";
import {
  canCancelOrder,
  MIN_CANCEL_AGE_MS,
} from "@/lib/orders/cancel-eligibility";

const base = {
  status: "active" as string,
  createdAtMs: 0,
  expiresAtMs: 20 * 60 * 1000,
  hasSms: false,
  nowMs: 3 * 60 * 1000, // 3 min in — past the 2-min floor
};

describe("canCancelOrder", () => {
  it("allows cancel after the 2-minute upstream floor with no SMS", () => {
    expect(canCancelOrder(base)).toEqual({ ok: true });
  });

  it("blocks cancel before the 2-minute floor (5SIM would reject)", () => {
    const r = canCancelOrder({ ...base, nowMs: 60 * 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_early");
  });

  it("blocks cancel once an SMS has arrived", () => {
    const r = canCancelOrder({ ...base, hasSms: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("already_received");
  });

  it("blocks cancel past expiry", () => {
    const r = canCancelOrder({ ...base, nowMs: 25 * 60 * 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("blocks cancel for a terminal status", () => {
    const r = canCancelOrder({ ...base, status: "received" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_status");
  });

  it("exposes the 2-minute floor as a constant", () => {
    expect(MIN_CANCEL_AGE_MS).toBe(2 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cancel-eligibility.test.ts`
Expected: FAIL — cannot resolve `@/lib/orders/cancel-eligibility`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/orders/cancel-eligibility.ts

/**
 * 5SIM rejects cancellation during the first ~2 minutes after purchase.
 * (The old code had this inverted, which made every cancel error out.)
 * A number may be cancelled only AFTER this floor, before it expires,
 * while still active, and only if no SMS has arrived.
 */
export const MIN_CANCEL_AGE_MS = 2 * 60 * 1000;

export type CancelEligibility =
  | { ok: true }
  | {
      ok: false;
      reason: "wrong_status" | "too_early" | "expired" | "already_received";
      message: string;
    };

export function canCancelOrder(input: {
  status: string;
  createdAtMs: number;
  expiresAtMs: number;
  hasSms: boolean;
  nowMs: number;
}): CancelEligibility {
  const { status, createdAtMs, expiresAtMs, hasSms, nowMs } = input;

  if (status !== "active" && status !== "pending") {
    return {
      ok: false,
      reason: "wrong_status",
      message: `Cannot cancel an order with status ${status}.`,
    };
  }
  if (hasSms) {
    return {
      ok: false,
      reason: "already_received",
      message: "An SMS already arrived — this number can't be cancelled.",
    };
  }
  if (nowMs >= expiresAtMs) {
    return {
      ok: false,
      reason: "expired",
      message: "This number has already expired.",
    };
  }
  if (nowMs - createdAtMs < MIN_CANCEL_AGE_MS) {
    return {
      ok: false,
      reason: "too_early",
      message:
        "You can cancel after 2 minutes if no code has arrived (the upstream network requires the wait).",
    };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cancel-eligibility.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/orders/cancel-eligibility.ts tests/cancel-eligibility.test.ts
git commit -m "Orders: pure cancel-eligibility helper (fixes inverted 5SIM window)"
```

---

## Task 2: SMS-outcome decision helper (pure, tested)

**Files:**
- Create: `lib/orders/sms-outcome.ts`
- Test: `tests/sms-outcome.test.ts`

Extract the "what do we do with this SMS batch" decision so the capture branch in poll-orders is testable without a DB. Mirrors the existing `classifyMessages` rule (mismatch-and-no-match ⇒ cross-service) but returns a single action.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sms-outcome.test.ts
import { describe, expect, it } from "vitest";
import { decideSmsOutcome } from "@/lib/orders/sms-outcome";

describe("decideSmsOutcome", () => {
  it("captures when upstream received a matching code", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "active",
        anyMatch: true,
        anyMismatch: false,
      }),
    ).toBe("capture");
  });

  it("treats no-evidence (neither match nor mismatch) as a normal capture", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "active",
        anyMatch: false,
        anyMismatch: false,
      }),
    ).toBe("capture");
  });

  it("flags cross-service when there's a mismatch and no match", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "active",
        anyMatch: false,
        anyMismatch: true,
      }),
    ).toBe("cross_service");
  });

  it("captures when a real match coexists with an incidental mismatch", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "active",
        anyMatch: true,
        anyMismatch: true,
      }),
    ).toBe("capture");
  });

  it("does nothing if already received (idempotent re-poll)", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "received",
        currentStatus: "received",
        anyMatch: true,
        anyMismatch: false,
      }),
    ).toBe("noop");
  });

  it("reports upstream cancellation", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "cancelled",
        currentStatus: "active",
        anyMatch: false,
        anyMismatch: false,
      }),
    ).toBe("upstream_cancelled");
  });

  it("waits while still pending upstream", () => {
    expect(
      decideSmsOutcome({
        upstreamStatus: "pending",
        currentStatus: "active",
        anyMatch: false,
        anyMismatch: false,
      }),
    ).toBe("wait");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sms-outcome.test.ts`
Expected: FAIL — cannot resolve `@/lib/orders/sms-outcome`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/orders/sms-outcome.ts
import type { ProviderOrderStatus } from "@/lib/providers/types";

export type SmsOutcome =
  | "capture" // valid SMS — latch received + debit
  | "cross_service" // wrong-service SMS — release, never charge
  | "upstream_cancelled" // cancelled upstream-side
  | "wait" // nothing actionable yet
  | "noop"; // already terminal/charged

export function decideSmsOutcome(input: {
  upstreamStatus: ProviderOrderStatus;
  currentStatus: string;
  anyMatch: boolean;
  anyMismatch: boolean;
}): SmsOutcome {
  const { upstreamStatus, currentStatus, anyMatch, anyMismatch } = input;

  if (upstreamStatus === "received") {
    if (currentStatus !== "active" && currentStatus !== "pending") {
      return "noop";
    }
    // Positive evidence of a wrong service AND no contradicting match.
    if (anyMismatch && !anyMatch) return "cross_service";
    return "capture";
  }

  if (upstreamStatus === "cancelled") return "upstream_cancelled";

  return "wait";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sms-outcome.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/orders/sms-outcome.ts tests/sms-outcome.test.ts
git commit -m "Orders: pure SMS-outcome decision helper"
```

---

## Task 3: Add `orders.charged_at` column

**Files:**
- Create: `supabase/migrations/0004_order_charged_at.sql`

`charged_at` is the money-truth latch: set only after a successful debit. A `received` order with `charged_at IS NULL` means "code delivered but not charged" (the accepted-risk case) and is what reconciliation/admin should surface.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0004_order_charged_at.sql
-- Defer-debit model: the wallet is charged when the first valid SMS lands,
-- not at purchase. charged_at records when that debit actually succeeded.
-- NULL on a received order = delivered-but-uncharged (surfaced for reconcile).
alter table public.orders
  add column if not exists charged_at timestamptz;

-- Find delivered-but-uncharged orders quickly (reconcile + admin).
create index if not exists orders_uncharged_received_idx
  on public.orders (status)
  where status = 'received' and charged_at is null;
```

- [ ] **Step 2: Apply the migration (CONFIRM PROJECT REF FIRST)**

The veridigits project ref is `asttwswjqffuwupdmrqr` (a second account `dmktcvpckdascgyhrmos` exists — do **not** target it). Apply via the Supabase MCP `apply_migration` against the confirmed project, or have the owner run it. After applying, regenerate types:

Run (regenerate types): use Supabase MCP `generate_typescript_types` for project `asttwswjqffuwupdmrqr` and write the result to `lib/supabase/database.types.ts`.
Expected: `orders.Row` now includes `charged_at: string | null`.

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_order_charged_at.sql lib/supabase/database.types.ts
git commit -m "DB: add orders.charged_at for defer-debit capture latch"
```

---

## Task 4: Remove the debit from `purchase` (defer it)

**Files:**
- Modify: `app/(dashboard)/buy/actions.ts` (the `purchase` function, ~lines 663-691)

The order is still inserted as `active` with `retail_charged_cents` (now the *intended* price). We keep the balance pre-check (a friendly gate) but **do not** move money. The compensating-cancel on insert failure stays. Remove the `applyWalletTransaction` debit block and its rollback (there is no debit to roll back now); keep the poll dispatch.

- [ ] **Step 1: Replace the settle-locally block**

Find this block (after the `orders` insert, starting `// Settle locally — debit the wallet`):

```ts
  // Settle locally — debit the wallet against the order we just created.
  try {
    await applyWalletTransaction({
      userId: user.id,
      amountCents: -payload.retailCents,
      type: "purchase",
      referenceType: "order",
      referenceId: orderRow.id,
      note: `${payload.providerSlug}:${buyResult.upstreamOrderId}`,
    });
  } catch (err) {
    // Wallet drained between getQuote and purchase, or other DB error.
    // Compensating cancel: restore upstream + delete the local order row.
    await safeCancelOrder(payload.providerSlug, buyResult.upstreamOrderId);
    await admin.from("orders").delete().eq("id", orderRow.id);

    if (err instanceof InsufficientBalanceError) {
      return {
        ok: false,
        code: "insufficient_balance",
        message: "Wallet was drained mid-purchase. Top up and try again.",
      };
    }
    return {
      ok: false,
      code: "internal",
      message: err instanceof Error ? err.message : "wallet debit failed",
    };
  }
```

Replace it with:

```ts
  // Defer-debit: we do NOT charge here. The wallet is debited when the first
  // valid SMS lands (see lib/inngest/poll-orders.ts). The balance pre-check
  // above is a friendly gate only; nothing is reserved, so the eventual
  // capture can still fail if the user spends the balance elsewhere first.
```

- [ ] **Step 2: Drop now-unused imports**

In the import block at the top of the file, remove the `applyWalletTransaction` import and the `InsufficientBalanceError` import (the pre-check uses neither). Specifically delete:

```ts
import {
  applyWalletTransaction,
} from "@/lib/wallet/apply";
import { InsufficientBalanceError } from "@/lib/wallet/types";
```

(Leave every other import intact — `getProvider`, `pickBestCandidate`, `sanitizeProviderError`, pricing, supabase clients, inngest, hold-token, constants.)

- [ ] **Step 3: Typecheck & lint**

Run: `npx tsc --noEmit && npx eslint "app/(dashboard)/buy/actions.ts"`
Expected: exit 0, no unused-import errors. (If eslint flags `InsufficientBalanceError` still referenced elsewhere in the file, search the file — it should only have been used in the deleted block.)

- [ ] **Step 4: Run the suite (no regressions)**

Run: `npm test`
Expected: all suites pass (existing counts + Tasks 1-2 additions).

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/buy/actions.ts"
git commit -m "Buy: defer wallet debit — purchase no longer charges up front"
```

---

## Task 5: Move the charge into `poll-orders` (capture on valid SMS)

**Files:**
- Modify: `lib/inngest/poll-orders.ts`

The capture point. Use `decideSmsOutcome`. The **status flip is the idempotency latch**: atomically claim `active → received`; only the winning claim performs the debit; `charged_at` is set only after a *successful* debit. On `InsufficientBalanceError`, leave the order `received` (the user has the code) with `charged_at` null — the delivered-but-uncharged case the index in Task 3 surfaces. Cross-service and upstream-cancelled paths never debit and never refund (nothing was charged).

- [ ] **Step 1: Update imports**

At the top of `lib/inngest/poll-orders.ts`, replace:

```ts
import { refundOrder } from "@/lib/wallet/refund";
import { senderMatchesService } from "@/lib/services/sender-patterns";
```

with:

```ts
import { debitWalletForOrder } from "@/lib/wallet/debit";
import { InsufficientBalanceError } from "@/lib/wallet/types";
import { senderMatchesService } from "@/lib/services/sender-patterns";
import { decideSmsOutcome } from "@/lib/orders/sms-outcome";
```

(`refundOrder` is no longer used here.)

- [ ] **Step 2: Replace the received / cancelled handling in `pollOnce`**

Replace this whole region (from `// Flip order status when upstream confirms received.` through the `if (upstream.status === "cancelled") { ... }` block, i.e. the current lines ~126-185):

```ts
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
```

with:

```ts
  // Classify any received SMS, then decide the outcome. Under defer-debit we
  // charge ONLY on a valid capture; cross-service and upstream-cancel paths
  // move no money (nothing was charged up front).
  const evidence =
    upstream.status === "received"
      ? await classifyEvidence(supabase, orderId, serviceSlug)
      : { anyMatch: false, anyMismatch: false };

  const outcome = decideSmsOutcome({
    upstreamStatus: upstream.status,
    currentStatus: order.status,
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
        // Delivered but uncharged (e.g. balance spent elsewhere — the
        // accepted defer-debit risk). Leave status 'received', charged_at
        // null; the orders_uncharged_received_idx surfaces it for reconcile.
        if (!(err instanceof InsufficientBalanceError)) {
          // Unexpected wallet error: log, still leave received.
          console.error("capture debit failed", { orderId, err });
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
```

- [ ] **Step 3: Replace `classifyMessages` with `classifyEvidence`**

Replace the existing `classifyMessages` function (returns `"normal" | "cross_service"`) with one that returns raw evidence, leaving the decision to `decideSmsOutcome`:

```ts
/**
 * Returns whether the order's SMS batch contains any confident match and/or
 * any confident mismatch against the expected service. The capture decision
 * itself lives in decideSmsOutcome (pure, unit-tested).
 */
async function classifyEvidence(
  supabase: ReturnType<typeof getAdminClient>,
  orderId: string,
  serviceSlug: string | null,
): Promise<{ anyMatch: boolean; anyMismatch: boolean }> {
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
  return { anyMatch, anyMismatch };
}
```

- [ ] **Step 4: Typecheck, lint, test**

Run: `npx tsc --noEmit && npx eslint lib/inngest/poll-orders.ts && npm test`
Expected: exit 0; all tests pass. (Watch for an unused `order.retail_charged_cents` select — it's still selected and now used in the debit.)

- [ ] **Step 5: Commit**

```bash
git add lib/inngest/poll-orders.ts
git commit -m "Poll: charge the wallet on first valid SMS (defer-debit capture)"
```

---

## Task 6: Update `expire-orders` (no refund; uncharged expiry)

**Files:**
- Modify: `lib/inngest/expire-orders.ts`

Under defer-debit an expiring `active` order was never charged, so expiry must **not** refund. If an SMS did arrive (the poll should already have captured), mark `completed`; otherwise cancel upstream and mark `expired`. The expire job also acts as the capture backstop only insofar as the poll missed it — but to keep this task surgical, expiry does not itself debit (the poll is the charge path; a missed capture surfaces via the uncharged index). Remove the `refundOrder` call and import.

- [ ] **Step 1: Drop the refund import**

Remove:

```ts
import { refundOrder } from "@/lib/wallet/refund";
```

- [ ] **Step 2: Rewrite `processExpired`**

Replace the body after the SMS-count check:

```ts
  if ((count ?? 0) > 0) {
    // SMS received but order wasn't marked completed — flip to completed.
    await supabase
      .from("orders")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", order.id);
    return;
  }

  // No SMS — cancel upstream + refund.
  try {
    await getProvider(order.provider_slug).cancelOrder(order.upstream_order_id);
  } catch {
    // Upstream cancel failure is non-fatal: still mark and refund. The
    // wholesale cost may stay committed at upstream — reconciliation job
    // catches mismatches.
  }

  await supabase
    .from("orders")
    .update({ status: "expired", cancelled_at: new Date().toISOString() })
    .eq("id", order.id);

  await refundOrder({
    userId: order.user_id,
    amountCents: order.retail_charged_cents,
    orderId: order.id,
    note: "expired without SMS",
  });
```

with:

```ts
  if ((count ?? 0) > 0) {
    // SMS arrived (poll should have captured the charge already) — finalize.
    await supabase
      .from("orders")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", order.id);
    return;
  }

  // No SMS — defer-debit means nothing was charged, so there is nothing to
  // refund. Cancel upstream to recover our wholesale cost, then mark expired.
  try {
    await getProvider(order.provider_slug).cancelOrder(order.upstream_order_id);
  } catch {
    // Non-fatal: the reconciliation job catches a stuck upstream cancel.
  }

  await supabase
    .from("orders")
    .update({ status: "expired", cancelled_at: new Date().toISOString() })
    .eq("id", order.id)
    .in("status", ["pending", "active"]);
```

- [ ] **Step 3: Typecheck, lint, test**

Run: `npx tsc --noEmit && npx eslint lib/inngest/expire-orders.ts && npm test`
Expected: exit 0; all pass. (`retail_charged_cents` is now unused in the select — remove it from the `.select(...)` string and from the `ExpiringOrder` interface to satisfy lint.)

- [ ] **Step 4: Commit**

```bash
git add lib/inngest/expire-orders.ts
git commit -m "Expire: no refund on uncharged expiry (defer-debit)"
```

---

## Task 7: Update the cancel server action (no refund; correct window)

**Files:**
- Modify: `app/(dashboard)/orders/[id]/actions.ts`

Use `canCancelOrder` for the timing/SMS/status gate (fixes the inverted window). Drop the wallet refund — nothing was charged. Keep ownership check, upstream cancel, and mark cancelled.

- [ ] **Step 1: Swap imports and rewrite the gate + remove refund**

Replace the `refundOrder` import with the helper:

```ts
import { canCancelOrder } from "@/lib/orders/cancel-eligibility";
```

(remove `import { refundOrder } from "@/lib/wallet/refund";`)

Delete the local `CANCEL_WINDOW_MS` constant and the inline status/age checks, and replace the SMS-count + window logic with a single `canCancelOrder` call. The function becomes:

```ts
export async function cancelOrderAction(orderId: string): Promise<CancelResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthorized", message: "not signed in" };

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, user_id, status, provider_slug, upstream_order_id, created_at, expires_at",
    )
    .eq("id", orderId)
    .single();

  if (!order || order.user_id !== user.id) {
    return { ok: false, code: "not_found", message: "order not found" };
  }

  // Has any SMS arrived? (admin client bypasses RLS for the count)
  const admin = getAdminClient();
  const { count: smsCount } = await admin
    .from("received_messages")
    .select("*", { count: "exact", head: true })
    .eq("order_id", orderId);

  const eligibility = canCancelOrder({
    status: order.status,
    createdAtMs: new Date(order.created_at).getTime(),
    expiresAtMs: new Date(order.expires_at).getTime(),
    hasSms: (smsCount ?? 0) > 0,
    nowMs: Date.now(),
  });
  if (!eligibility.ok) {
    return { ok: false, code: eligibility.reason, message: eligibility.message };
  }

  // Fire upstream cancel (allowed now that we're past the 2-minute floor).
  try {
    await getProvider(order.provider_slug).cancelOrder(order.upstream_order_id);
  } catch (err) {
    return {
      ok: false,
      code: "upstream_error",
      message: err instanceof Error ? err.message : "upstream cancel failed",
    };
  }

  // Mark cancelled. Defer-debit: nothing was charged, so there is no refund.
  const { error: updateErr } = await admin
    .from("orders")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", orderId)
    .in("status", ["pending", "active"]);

  if (updateErr) {
    return {
      ok: false,
      code: "internal",
      message: `couldn't mark cancelled: ${updateErr.message}`,
    };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck, lint, test**

Run: `npx tsc --noEmit && npx eslint "app/(dashboard)/orders/[id]/actions.ts" && npm test`
Expected: exit 0; all pass.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/orders/[id]/actions.ts"
git commit -m "Cancel: use correct 5SIM window, drop refund (uncharged)"
```

---

## Task 8: Optional concurrent-active cap (bounds the accepted risk)

**Files:**
- Modify: `app/(dashboard)/buy/actions.ts` (inside `purchase`, before the upstream buy)

Bounds the "one balance backs many numbers" exposure by capping how many `active` (unpaid) orders a user may hold at once. Set `MAX_CONCURRENT_ACTIVE = 0` to disable.

- [ ] **Step 1: Add the constant and the check**

Near the top of `app/(dashboard)/buy/actions.ts` (after the imports), add:

```ts
// Defer-debit guardrail: cap simultaneously-held unpaid numbers per user.
// 0 disables the cap. Tune to taste; small is safer.
const MAX_CONCURRENT_ACTIVE = 3;
```

In `purchase`, after the `is_banned` check and before the activation re-quote (i.e. right after the balance pre-check block), insert:

```ts
  if (MAX_CONCURRENT_ACTIVE > 0) {
    const { count: activeCount } = await getAdminClient()
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["pending", "active"]);
    if ((activeCount ?? 0) >= MAX_CONCURRENT_ACTIVE) {
      return {
        ok: false,
        code: "internal",
        message: `You can hold up to ${MAX_CONCURRENT_ACTIVE} active numbers at once. Wait for one to receive a code or expire.`,
      };
    }
  }
```

- [ ] **Step 2: Typecheck, lint, test**

Run: `npx tsc --noEmit && npx eslint "app/(dashboard)/buy/actions.ts" && npm test`
Expected: exit 0; all pass.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/buy/actions.ts"
git commit -m "Buy: cap concurrent active numbers (bounds defer-debit exposure)"
```

---

## Task 9: Cancel UI — re-gate, relabel, mobile stacking

**Files:**
- Modify: `app/(dashboard)/orders/[id]/live-feed.tsx`

Drive the control's visibility from `canCancelOrder` (so UI and server agree), relabel from "Cancel & refund" → "Cancel number" (nothing is refunded), explain the 2-minute wait while it's too early, stack the card on mobile, and update the cross-service explainer copy (we *didn't charge*, rather than *credited back*).

- [ ] **Step 1: Import the helper and remove the local constant**

Replace `const CANCEL_WINDOW_MS = 2 * 60 * 1000;` with:

```ts
import { canCancelOrder, MIN_CANCEL_AGE_MS } from "@/lib/orders/cancel-eligibility";
```

(add to the import block at top; delete the local constant).

- [ ] **Step 2: Replace the `cancelable` derivation**

Replace:

```ts
  const expiresAtMs = new Date(order.expires_at).getTime();
  const remainingMs = Math.max(0, expiresAtMs - now);
  const ageMs = now - new Date(order.created_at).getTime();
  const cancelable =
    (status === "pending" || status === "active") &&
    messages.length === 0 &&
    ageMs < CANCEL_WINDOW_MS;
```

with:

```ts
  const expiresAtMs = new Date(order.expires_at).getTime();
  const createdAtMs = new Date(order.created_at).getTime();
  const remainingMs = Math.max(0, expiresAtMs - now);
  const ageMs = now - createdAtMs;
  const eligibility = canCancelOrder({
    status,
    createdAtMs,
    expiresAtMs,
    hasSms: messages.length > 0,
    nowMs: now,
  });
  const cancelable = eligibility.ok;
  // Show a "waiting for the 2-min floor" hint while the number is fresh.
  const tooEarly =
    !eligibility.ok &&
    eligibility.reason === "too_early" &&
    messages.length === 0;
  const msUntilCancelable = Math.max(0, createdAtMs + MIN_CANCEL_AGE_MS - now);
```

- [ ] **Step 3: Replace the cancel control block (stack on mobile + relabel + early hint)**

Replace the existing `{cancelable ? ( ... ) : null}` block:

```tsx
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
```

with:

```tsx
      {/* Cancel control — stacks under the text on mobile */}
      {cancelable ? (
        <div className="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="eyebrow">Not getting a code?</div>
            <p className="caption" style={{ marginTop: 4 }}>
              You weren&apos;t charged for this number — you&apos;re only billed
              when a valid code arrives. Cancel it now to free it up, or just
              let it expire.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary w-full sm:w-auto"
            onClick={onCancel}
            disabled={isPendingCancel}
          >
            {isPendingCancel ? "Cancelling…" : "Cancel number"}
          </button>
        </div>
      ) : tooEarly ? (
        <div className="card">
          <div className="eyebrow">Cancel</div>
          <p className="caption" style={{ marginTop: 4 }}>
            You can cancel in {formatRemaining(msUntilCancelable)} if no code
            arrives. You haven&apos;t been charged — billing only happens when a
            valid code lands.
          </p>
        </div>
      ) : null}
```

- [ ] **Step 4: Update the cross-service explainer copy**

The cross-service order is now marked `cancelled` (not `refunded`) with `refund_reason === "cross_service_sms"`. Update the explainer condition and wording. Replace:

```tsx
      {/* Auto-refund explainer for cross-service SMS */}
      {status === "refunded" && order.refund_reason === "cross_service_sms" ? (
        <div className="card" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ color: "var(--color-vg-700)" }}>
            Auto-refunded
          </div>
          <p className="body" style={{ marginTop: 6 }}>
            The SMS that arrived didn&apos;t look like a {order.service} code,
            so we credited the charge back to your wallet automatically.
            Incidental messages and codes for other services occasionally land
            on these numbers — there&apos;s nothing for you to do.
          </p>
          <p className="caption" style={{ marginTop: 10 }}>
            Want to try again? <a href="/buy">Buy a new number</a>.
          </p>
        </div>
      ) : null}
```

with:

```tsx
      {/* Cross-service explainer — we never charged for this number */}
      {(status === "cancelled" || status === "refunded") &&
      order.refund_reason === "cross_service_sms" ? (
        <div className="card" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ color: "var(--color-vg-700)" }}>
            Not charged
          </div>
          <p className="body" style={{ marginTop: 6 }}>
            The SMS that arrived didn&apos;t look like a {order.service} code,
            so we closed this number without charging you. Incidental messages
            and codes for other services occasionally land on these numbers —
            there&apos;s nothing for you to do.
          </p>
          <p className="caption" style={{ marginTop: 10 }}>
            Want to try again? <a href="/buy">Buy a new number</a>.
          </p>
        </div>
      ) : null}
```

- [ ] **Step 5: Typecheck, lint, test**

Run: `npx tsc --noEmit && npx eslint "app/(dashboard)/orders/[id]/live-feed.tsx" && npm test`
Expected: exit 0; all pass. (`remainingMs` is still used by the number card's "Expires in" line — keep it.)

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/orders/[id]/live-feed.tsx"
git commit -m "Order UI: relabel cancel, stack on mobile, charge-on-receipt copy"
```

---

## Task 10: Buy-flow copy (charge happens on receipt)

**Files:**
- Modify: `app/(dashboard)/buy/picker.tsx` (the `QuotePanel` submit button + caption)

Set expectations at the point of purchase so the deferred charge isn't a surprise.

- [ ] **Step 1: Update the submit button label and caption**

In `QuotePanel`, replace the submit button text and the trailing caption:

```tsx
        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={isPending}
          style={{ width: "100%" }}
        >
          <span className="dot"></span>
          {isPending
            ? "Charging wallet…"
            : `Buy for ${formatUsdCents(q.retailCents)}`}
        </button>
      </form>

      <p className="caption text-center">
        Quote valid for 30s. Refunded automatically if no SMS arrives.
      </p>
```

with:

```tsx
        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={isPending}
          style={{ width: "100%" }}
        >
          <span className="dot"></span>
          {isPending
            ? "Reserving number…"
            : `Get number · ${formatUsdCents(q.retailCents)}`}
        </button>
      </form>

      <p className="caption text-center">
        Quote valid for 30s. You&apos;re only charged{" "}
        {formatUsdCents(q.retailCents)} when a valid code arrives — cancel or
        let it expire for free otherwise.
      </p>
```

- [ ] **Step 2: Typecheck, lint, test**

Run: `npx tsc --noEmit && npx eslint "app/(dashboard)/buy/picker.tsx" && npm test`
Expected: exit 0; all pass.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/buy/picker.tsx"
git commit -m "Buy: copy reflects charge-on-receipt billing"
```

---

## Task 11: Manual verification (real flow)

**Files:** none (verification only)

Defer-debit and the capture latch touch Supabase + Inngest, which the Vitest suite doesn't exercise. Verify the live flow once on a dev/test account.

- [ ] **Step 1: Pre-checks**

Run: `npx tsc --noEmit && npx eslint "app/**/*.tsx" "app/**/*.ts" "lib/**/*.ts" && npm test`
Expected: all green.

- [ ] **Step 2: Purchase does not debit**

Note wallet balance. Buy a number on `/buy`. Confirm: order page shows `active`, **balance unchanged**, no `purchase` row in `wallet_ledger` for this order yet, `orders.charged_at` is NULL.

- [ ] **Step 3: Capture on SMS**

Trigger/receive a valid SMS (or simulate via the provider sandbox). Confirm: status flips to `received`, balance drops by exactly `retail_charged_cents`, one `purchase` ledger row appears, `charged_at` is set.

- [ ] **Step 4: Cancel works after 2 minutes**

Buy another number. Before 2 minutes: the cancel card shows the "you can cancel in M:SS" hint and no button. After 2 minutes (no SMS): "Cancel number" button appears, click it — confirm it succeeds (no `upstream_error`), status `cancelled`, balance unchanged.

- [ ] **Step 5: Expiry without SMS**

Buy a number, let it expire (or shorten `expires_at` in dev). Confirm: status `expired`, balance unchanged, no refund ledger row.

- [ ] **Step 6: Mobile layout**

At 390px on the order page with a cancelable order, confirm the cancel card stacks (text above, full-width button below) with no overflow.

- [ ] **Step 7: Final commit (if any verification tweaks were needed)**

```bash
git add -p
git commit -m "Charge-after-SMS: verification fixups"
```

---

## Self-Review notes

- **Spec coverage:** charge-after-SMS (Tasks 4–6), cancel error root cause / correct window (Tasks 1, 7, 9), mobile stacking (Task 9), accepted-risk guardrail (Task 8), copy (Tasks 9–10), schema latch (Task 3). Covered.
- **Idempotency:** capture uses the `active → received` status flip as the single-winner latch; `charged_at` set only post-debit; cross-service and upstream-cancel use the same `.in("status",[...])` guarded update.
- **Type consistency:** `canCancelOrder` signature and `MIN_CANCEL_AGE_MS` match across Tasks 1/7/9; `decideSmsOutcome` enum matches Tasks 2/5; `debitWalletForOrder({userId, amountCents, orderId, note})` matches `lib/wallet/debit.ts`.
- **Open risks to watch:** (a) delivered-but-uncharged orders (received + `charged_at` NULL) rely on reconciliation/admin to surface — consider extending `lib/inngest/reconcile-wallets.ts` in a follow-up; (b) `pending` status appears vestigial but is handled defensively in all status guards.
