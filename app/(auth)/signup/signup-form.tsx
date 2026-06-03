"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signUp, type AuthFormState } from "../actions";
import { PasswordField } from "@/components/password-field";

export function SignupForm() {
  const [state, formAction, isPending] = useActionState<
    AuthFormState | undefined,
    FormData
  >(signUp, undefined);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && password !== confirm;

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
        <p className="caption">No real name needed. Pick a handle and go.</p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <div className="field-grid">
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
            <label className="label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className="input"
              name="username"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              maxLength={20}
              pattern="[a-zA-Z][a-zA-Z0-9_]{2,19}"
              defaultValue={state?.username}
              placeholder="e.g. nightowl_42"
            />
          </div>
        </div>

        <div className="field-grid">
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <PasswordField
              id="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="8+ characters"
              onChange={setPassword}
            />
          </div>

          <div>
            <label className="label" htmlFor="confirm_password">
              Confirm password
            </label>
            <PasswordField
              id="confirm_password"
              name="confirm_password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="Re-enter password"
              onChange={setConfirm}
            />
            {mismatch ? (
              <p
                className="caption"
                style={{ marginTop: 6, color: "var(--color-danger)" }}
              >
                Passwords don&apos;t match.
              </p>
            ) : null}
          </div>
        </div>

        <div className="field-grid">
          <div>
            <label className="label" htmlFor="display_name">
              Display name <span className="caption">(optional)</span>
            </label>
            <input
              id="display_name"
              className="input"
              name="display_name"
              type="text"
              autoComplete="off"
              maxLength={60}
              defaultValue={state?.displayName}
              placeholder="Shown in your dashboard"
            />
          </div>

          <div>
            <label className="label" htmlFor="referral_code">
              Referral code <span className="caption">(optional)</span>
            </label>
            <input
              id="referral_code"
              className="input"
              name="referral_code"
              type="text"
              autoComplete="off"
              maxLength={32}
              defaultValue={state?.referralCode}
              placeholder="If a friend invited you"
            />
          </div>
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
          disabled={isPending || mismatch}
        >
          <span className="dot"></span>
          {isPending ? "Creating…" : "Create account"}
        </button>
      </form>

      <p className="caption text-center">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-semibold text-[var(--color-vg-700)] underline underline-offset-2"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
