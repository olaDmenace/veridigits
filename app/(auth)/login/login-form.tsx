"use client";

import Link from "next/link";
import { useActionState } from "react";
import { logIn, type AuthFormState } from "../actions";

interface Props {
  initialRedirect?: string;
  initialNotice?: string;
}

export function LoginForm({ initialRedirect, initialNotice }: Props) {
  const [state, formAction, isPending] = useActionState<
    AuthFormState | undefined,
    FormData
  >(logIn, undefined);

  return (
    <div className="card flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="h3">Sign in</h1>
        <p className="caption">Welcome back. No KYC, no questions.</p>
      </div>

      {initialNotice ? <Notice tone="warn">{initialNotice}</Notice> : null}

      <form action={formAction} className="flex flex-col gap-4">
        {initialRedirect ? (
          <input type="hidden" name="redirect" value={initialRedirect} />
        ) : null}

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
            autoComplete="current-password"
            required
            minLength={8}
          />
        </div>

        {state?.ok === false && state.error ? (
          <Notice tone="danger">{state.error}</Notice>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={isPending}
        >
          <span className="dot"></span>
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="caption text-center">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-[var(--color-ink)] underline-offset-2 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "warn" | "danger";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`badge ${tone === "danger" ? "badge-danger" : "badge-warn"}`}
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
      {children}
    </div>
  );
}
