import { Inngest } from "inngest";

/**
 * Single Inngest client for the Veridigits app.
 *
 * Functions register against this client and are served from
 * app/api/inngest/route.ts. In dev, run the Inngest dev server
 * (npx inngest-cli dev -u http://localhost:3000/api/inngest) to see them.
 *
 * Env: INNGEST_EVENT_KEY (send), INNGEST_SIGNING_KEY (receive).
 */
export const inngest = new Inngest({ id: "veridigits" });

/**
 * Type-safe event names. Keep this in sync with the events you actually fire.
 */
export type InngestEvents = {
  "app/provider.sync.requested": {
    data: {
      providerSlug?: string; // omit to sync all enabled providers
    };
  };
};
