import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role Supabase client.
 *
 * Bypasses RLS. Use only in:
 *   - webhook handlers (NOWPayments, Cryptomus IPN)
 *   - Inngest jobs (polling, expiring orders, syncing prices)
 *   - admin server actions
 *
 * Never import this into a client component or any file that's bundled to
 * the browser. The service-role key must never leak.
 */

let _client: SupabaseClient<Database> | null = null;

export function getAdminClient(): SupabaseClient<Database> {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  _client = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _client;
}
