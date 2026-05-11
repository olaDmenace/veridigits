"use client";

import { useActionState } from "react";
import {
  changeEmail,
  changePassword,
  deleteAccount,
  type SettingsFormState,
} from "./actions";

function FeedbackBadge({
  state,
}: {
  state: SettingsFormState | undefined;
}) {
  if (!state) return null;
  return (
    <div
      className={`badge ${state.ok ? "badge-success" : "badge-danger"}`}
      style={{
        height: "auto",
        padding: "10px 12px",
        textTransform: "none",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        letterSpacing: 0,
        fontWeight: 500,
      }}
    >
      {state.ok ? state.message : state.error}
    </div>
  );
}

export function ChangePasswordCard() {
  const [state, formAction, pending] = useActionState<
    SettingsFormState | undefined,
    FormData
  >(changePassword, undefined);

  return (
    <div className="card flex flex-col gap-5">
      <div>
        <div className="eyebrow">Security</div>
        <h2 className="h3" style={{ marginTop: 6 }}>
          Change password
        </h2>
        <p className="caption" style={{ marginTop: 8 }}>
          Re-enter your current password as a safety check.
        </p>
      </div>
      <form
        action={formAction}
        className="flex flex-col gap-4"
        key={state?.ok ? "ok" : "form"}
      >
        <div>
          <label className="label" htmlFor="currentPassword">
            Current password
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="newPassword">
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="input"
            placeholder="8+ characters"
          />
        </div>
        <FeedbackBadge state={state} />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending}
          style={{ alignSelf: "flex-start" }}
        >
          {pending ? "Updating…" : "Update password"}
        </button>
      </form>
    </div>
  );
}

export function ChangeEmailCard({ currentEmail }: { currentEmail: string }) {
  const [state, formAction, pending] = useActionState<
    SettingsFormState | undefined,
    FormData
  >(changeEmail, undefined);

  return (
    <div className="card flex flex-col gap-5">
      <div>
        <div className="eyebrow">Email</div>
        <h2 className="h3" style={{ marginTop: 6 }}>
          Change email
        </h2>
        <p className="caption" style={{ marginTop: 8 }}>
          Current: <span className="mono">{currentEmail}</span>. We&apos;ll send
          a confirmation link to the new address; the old one stays active
          until you click it.
        </p>
      </div>
      <form action={formAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="newEmail">
            New email
          </label>
          <input
            id="newEmail"
            name="newEmail"
            type="email"
            autoComplete="email"
            required
            className="input"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="label" htmlFor="emailChangePassword">
            Password
          </label>
          <input
            id="emailChangePassword"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="input"
          />
        </div>
        <FeedbackBadge state={state} />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending}
          style={{ alignSelf: "flex-start" }}
        >
          {pending ? "Sending link…" : "Send confirmation"}
        </button>
      </form>
    </div>
  );
}

export function DeleteAccountCard() {
  const [state, formAction, pending] = useActionState<
    SettingsFormState | undefined,
    FormData
  >(deleteAccount, undefined);

  return (
    <div
      className="card flex flex-col gap-5"
      style={{
        borderColor: "var(--color-danger-soft)",
      }}
    >
      <div>
        <div className="eyebrow" style={{ color: "var(--color-danger)" }}>
          Danger zone
        </div>
        <h2 className="h3" style={{ marginTop: 6 }}>
          Delete account
        </h2>
        <p className="caption" style={{ marginTop: 8 }}>
          Permanently removes your account, order history, wallet ledger, and
          received SMS. Cannot be undone. Your wallet must be empty.
        </p>
      </div>
      <form action={formAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="deletePassword">
            Password
          </label>
          <input
            id="deletePassword"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            Type <span className="mono">DELETE</span> to confirm
          </label>
          <input
            id="confirm"
            name="confirm"
            type="text"
            autoComplete="off"
            required
            className="input mono"
            placeholder="DELETE"
          />
        </div>
        <FeedbackBadge state={state} />
        <button
          type="submit"
          className="btn btn-danger"
          disabled={pending}
          style={{ alignSelf: "flex-start" }}
        >
          {pending ? "Deleting…" : "Delete account permanently"}
        </button>
      </form>
    </div>
  );
}
