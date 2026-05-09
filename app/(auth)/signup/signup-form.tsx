"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp, type AuthFormState } from "../actions";

export function SignupForm() {
  const [state, formAction, isPending] = useActionState<
    AuthFormState | undefined,
    FormData
  >(signUp, undefined);

  if (state?.ok && state.needsConfirmation) {
    return (
      <div className="card flex flex-col gap-4 text-center">
        <h1 className="h3">Check your email</h1>
        <p className="body">
          We sent a confirmation link to <strong>{state.email}</strong>. Click
          it to finish creating your account.
        </p>
        <p className="caption">
          Didn&apos;t get it? Check spam, or{" "}
          <Link
            href="/signup"
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
        <h1 className="h3">Create an account</h1>
        <p className="caption">Email + password. That&apos;s it.</p>
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

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="8+ characters"
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
          {isPending ? "Creating…" : "Create account"}
        </button>
      </form>

      <p className="caption text-center">
        Already have an account?{" "}
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
