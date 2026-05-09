import { inngest } from "./client";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

const VELOCITY_WINDOW_MIN = 60;
const ORDERS_THRESHOLD_PER_HOUR = 50;
const CANCELS_THRESHOLD_PER_HOUR = 20;

/**
 * Velocity / abuse pattern detection.
 *
 * Runs every 5 minutes. Looks at the last hour of orders + cancels and emits
 * abuse_events rows when a user crosses configured thresholds. Action is
 * recorded as 'none' for now — admin reviews via /admin/users and bans
 * manually. Auto-banning at this stage is too risky.
 */
export const abuseVelocityFn = inngest.createFunction(
  {
    id: "abuse-velocity-check",
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ logger }) => {
    const admin = getAdminClient();
    const sinceIso = new Date(
      Date.now() - VELOCITY_WINDOW_MIN * 60 * 1000,
    ).toISOString();

    // Recent orders for the per-user counts. We pull all rows in the window
    // and aggregate in JS — avoids needing a SQL function for the MVP.
    const { data: recentOrders, error } = await admin
      .from("orders")
      .select("user_id, status, created_at")
      .gte("created_at", sinceIso);

    if (error) {
      logger.error("abuse-velocity query failed", { err: error.message });
      return { processed: 0 };
    }
    if (!recentOrders || recentOrders.length === 0) {
      return { processed: 0 };
    }

    const counts = new Map<
      string,
      { total: number; cancels: number }
    >();
    for (const o of recentOrders) {
      const c = counts.get(o.user_id) ?? { total: 0, cancels: 0 };
      c.total++;
      if (o.status === "cancelled" || o.status === "refunded") c.cancels++;
      counts.set(o.user_id, c);
    }

    const eventsToInsert: Array<{
      user_id: string;
      event_type: "velocity" | "rapid_cancel";
      details: Json;
      action_taken: "none";
    }> = [];

    for (const [userId, c] of counts) {
      if (c.total >= ORDERS_THRESHOLD_PER_HOUR) {
        eventsToInsert.push({
          user_id: userId,
          event_type: "velocity",
          details: {
            window_minutes: VELOCITY_WINDOW_MIN,
            orders: c.total,
            threshold: ORDERS_THRESHOLD_PER_HOUR,
          },
          action_taken: "none",
        });
      }
      if (c.cancels >= CANCELS_THRESHOLD_PER_HOUR) {
        eventsToInsert.push({
          user_id: userId,
          event_type: "rapid_cancel",
          details: {
            window_minutes: VELOCITY_WINDOW_MIN,
            cancels: c.cancels,
            threshold: CANCELS_THRESHOLD_PER_HOUR,
          },
          action_taken: "none",
        });
      }
    }

    if (eventsToInsert.length === 0) return { processed: 0, flagged: 0 };

    // Idempotency: don't write duplicate flags within the window. Match on
    // (user_id, event_type) and skip if a row was created within the
    // current window — admin still sees the prior alert.
    const { data: existing } = await admin
      .from("abuse_events")
      .select("user_id, event_type")
      .gte("created_at", sinceIso)
      .in(
        "user_id",
        eventsToInsert.map((e) => e.user_id),
      );

    const existingKeys = new Set(
      (existing ?? []).map((r) => `${r.user_id}|${r.event_type}`),
    );

    const fresh = eventsToInsert.filter(
      (e) => !existingKeys.has(`${e.user_id}|${e.event_type}`),
    );

    if (fresh.length > 0) {
      await admin.from("abuse_events").insert(fresh);
    }

    return {
      processed: counts.size,
      flagged: fresh.length,
      duplicate_skipped: eventsToInsert.length - fresh.length,
    };
  },
);
