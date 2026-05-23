import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { syncCatalogFn } from "@/lib/inngest/sync-catalog";
import { pollOrderFn } from "@/lib/inngest/poll-orders";
import { expireOrdersFn } from "@/lib/inngest/expire-orders";
import { abuseVelocityFn } from "@/lib/inngest/abuse-velocity";
import { reconcileWalletsFn } from "@/lib/inngest/reconcile-wallets";
import { recomputeOperatorSuccessRatesFn } from "@/lib/inngest/operator-success-rates";

/**
 * Inngest serves all registered functions over a single endpoint.
 * Local dev: `npx inngest-cli dev -u http://localhost:3000/api/inngest`
 * Prod: register the deployed URL in the Inngest dashboard.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    syncCatalogFn,
    pollOrderFn,
    expireOrdersFn,
    abuseVelocityFn,
    reconcileWalletsFn,
    recomputeOperatorSuccessRatesFn,
  ],
});
