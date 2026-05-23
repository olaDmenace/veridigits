import { inngest } from "./client";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Recomputes per-operator SMS receive rates from the last 7 days of orders.
 *
 * Powers the success-rate scoring in `lib/providers/scoring.ts` — when the
 * /buy flow has multiple provider_services candidates for a (service, country),
 * the candidate picker prefers reliable operators (good rate, enough sample)
 * over the absolute cheapest if both options exist.
 *
 * The actual work runs in a Postgres function so the GROUP BY happens close
 * to the data — provider_services has hundreds of thousands of rows and we
 * don't want to round-trip every row through the app. The function:
 *   1. Zeroes out rows that haven't seen orders in the last day (stale data).
 *   2. Updates rows that have orders in the last 7 days with fresh counts.
 *
 * Cron: every 30 minutes. Cache stays fresh enough for the buy flow without
 * hammering the DB, and the granularity matches the volume we expect at MVP.
 */
export const recomputeOperatorSuccessRatesFn = inngest.createFunction(
  {
    id: "recompute-operator-success-rates",
    triggers: [{ cron: "*/30 * * * *" }],
  },
  async ({ step, logger }) => {
    const result = await step.run("recompute", async () => {
      const supabase = getAdminClient();
      const { data, error } = await supabase.rpc(
        "recompute_operator_success_rates",
      );
      if (error) throw new Error(`RPC failed: ${error.message}`);
      const rowsUpdated = Array.isArray(data) && data.length > 0
        ? (data[0] as { rows_updated: number }).rows_updated
        : 0;
      return { rowsUpdated };
    });

    logger.info("recompute-operator-success-rates finished", result);
    return result;
  },
);
