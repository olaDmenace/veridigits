import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles the email-confirmation redirect from Supabase.
 *
 * The user clicks the confirmation link in their email, Supabase redirects
 * them to `/auth/callback?code=...&next=/dashboard`, this route exchanges
 * the code for a session, then sends them to `next` (or `/dashboard`).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(
        `${origin}${next.startsWith("/") ? next : "/dashboard"}`,
      );
    }
  }

  return NextResponse.redirect(`${origin}/login?error=invalid_confirmation`);
}
