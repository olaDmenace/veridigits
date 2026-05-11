"use client";

import { useEffect, useState, useActionState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { updatePassword, type ResetFormState } from "../actions";

/**
 * Supabase delivers the recovery session as URL hash params
 * (#access_token=...&refresh_token=...&type=recovery). The browser client
 * picks those up automatically via detectSessionInUrl (default true) and
 * stores the session in cookies, so by the time this component renders the
 * user is effectively signed in. We then call updateUser via a server
 * action — same cookies, same session.
 */
export function ResetPasswordForm() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState<
    ResetFormState | undefined,
    FormData
  >(updatePassword, undefined);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        setReady(true);
      } else {
        setError(
          "Recovery link is invalid or expired. Request a fresh one below.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="card flex flex-col gap-4 text-center">
        <h1 className="h3">Link expired</h1>
        <p className="body">{error}</p>
        <Link href="/forgot-password" className="btn btn-primary">
          <span className="dot"></span>
          Get a new link
        </Link>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="card text-center">
        <p className="caption">Verifying reset link…</p>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="h3">Set a new password</h1>
        <p className="caption">8+ characters.</p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="password">
            New password
          </label>
          <input
            id="password"
            className="input"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>

        {state?.ok === false && state.error ? (
          <div
            className="badge badge-danger"
            style={{
              height: "auto",
              padding: "10px 12px",
              textTransform: "none",
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              letterSpacing: 0,
              fontWeight: 500,
            }}
          >
            {state.error}
          </div>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={isPending}
        >
          <span className="dot"></span>
          {isPending ? "Saving…" : "Save & sign in"}
        </button>
      </form>
    </div>
  );
}
