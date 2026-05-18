import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";

/**
 * Refreshes the auth session on every request and gates protected routes.
 *
 * The `getUser()` call here is REQUIRED — it's what triggers the SSR cookie
 * refresh. Don't skip it.
 *
 * Auth-gated path prefixes are listed below. The marketing pages, auth pages,
 * and the auth callback are public.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/buy",
  "/orders",
  "/topup",
  "/settings",
  "/admin",
];

/**
 * Exact paths that bypass the protected prefix check above. Used for
 * pages that LOOK like they're under a protected section but need to
 * render when the user is signed out — e.g. payment-processor return
 * URLs, where cross-domain redirects sometimes drop our session cookies.
 */
const PUBLIC_OVERRIDES = new Set<string>(["/topup/success"]);

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected =
    !PUBLIC_OVERRIDES.has(pathname) &&
    PROTECTED_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
