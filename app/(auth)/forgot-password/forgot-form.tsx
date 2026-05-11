"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type ResetFormState } from "../actions";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState<
    ResetFormState | undefined,
    FormData
  >(requestPasswordReset, undefined);

  if (state?.ok && state.sent) {
    return (
      <div className="card flex flex-col gap-4 text-center">
        <h1 className="h3">Check your email</h1>
        <p className="body">
          If an account exists for <strong>{state.email}</strong>, we sent a
          reset link. It expires in 1 hour.
        </p>
        <p className="caption">
          Didn&apos;t see it? Check spam, then{" "}
          <Link
            href="/forgot-password"
            className="font-medium text-[var(--color-ink)] underline-offset-2 hover:underline"
          >
            try again
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="h3">Reset your password</h1>
        <p className="caption">
          We&apos;ll email you a link to set a new one.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state?.email}
            placeholder="you@example.com"
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
          {isPending ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="caption text-center">
        Remembered it?{" "}
        <Link
          href="/login"
          className="font-medium text-[var(--color-ink)] underline-offset-2 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
