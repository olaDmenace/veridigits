import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

/**
 * Server-side Supabase client (server components, server actions, route handlers).
 *
 * In Next 16, `cookies()` is async — always `await createClient()`.
 *
 * The setAll() try/catch is the @supabase/ssr-recommended pattern: writing
 * cookies from a Server Component throws (Server Components are read-only),
 * but middleware refreshes the session ahead of the render so the missed
 * write is benign.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* Server Component context — ignore. */
          }
        },
      },
    },
  );
}
