"use client";

import { useState, useTransition } from "react";
import {
  adjustUserBalance,
  setUserBanned,
  type AdminActionResult,
} from "./actions";
import { formatUsdCents } from "@/lib/utils/money";

export interface AdminUserRow {
  id: string;
  email: string | null;
  walletBalanceCents: number;
  totalSpentCents: number;
  totalToppedUpCents: number;
  isAdmin: boolean;
  isBanned: boolean;
  createdAt: string;
}

export function UsersTable({ users }: { users: AdminUserRow[] }) {
  const [search, setSearch] = useState("");
  const [adjusting, setAdjusting] = useState<string | null>(null);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      (u.email ?? "").toLowerCase().includes(q) ||
      u.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          className="input"
          placeholder="Search email or id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 360 }}
        />
        <span className="caption mono">{filtered.length} users</span>
      </div>

      <div className="table-wrap">
        <table className="table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Balance</th>
            <th>Spent</th>
            <th>Topped up</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((u) => (
            <tr key={u.id}>
              <td>
                <div style={{ fontWeight: 500 }}>{u.email ?? "—"}</div>
                <div className="caption mono" style={{ marginTop: 4 }}>
                  {u.id.slice(0, 8)}…
                </div>
              </td>
              <td className="num">{formatUsdCents(u.walletBalanceCents)}</td>
              <td className="num">{formatUsdCents(u.totalSpentCents)}</td>
              <td className="num">{formatUsdCents(u.totalToppedUpCents)}</td>
              <td>
                {u.isBanned ? (
                  <span className="badge badge-danger">banned</span>
                ) : u.isAdmin ? (
                  <span className="badge badge-info">admin</span>
                ) : (
                  <span className="badge badge-success">active</span>
                )}
              </td>
              <td>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      setAdjusting((id) => (id === u.id ? null : u.id))
                    }
                  >
                    {adjusting === u.id ? "Close" : "Adjust"}
                  </button>
                  <BanButton userId={u.id} banned={u.isBanned} />
                </div>
                {adjusting === u.id ? (
                  <AdjustForm
                    userId={u.id}
                    onDone={() => setAdjusting(null)}
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}

function BanButton({
  userId,
  banned,
}: {
  userId: string;
  banned: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    start(async () => {
      const result = await setUserBanned(userId, !banned);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      <button
        type="button"
        className={banned ? "btn btn-secondary btn-sm" : "btn btn-danger btn-sm"}
        onClick={toggle}
        disabled={pending}
      >
        {pending ? "…" : banned ? "Unban" : "Ban"}
      </button>
      {error ? (
        <div className="caption" style={{ color: "var(--color-danger)" }}>
          {error}
        </div>
      ) : null}
    </>
  );
}

function AdjustForm({
  userId,
  onDone,
}: {
  userId: string;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<AdminActionResult | null>(null);

  function submit(formData: FormData) {
    setFeedback(null);
    start(async () => {
      const result = await adjustUserBalance(formData);
      setFeedback(result);
      if (result.ok) {
        setTimeout(onDone, 800);
      }
    });
  }

  return (
    <form
      action={submit}
      className="card-flat flex items-center gap-3"
      style={{ padding: 12, marginTop: 8 }}
    >
      <input type="hidden" name="userId" value={userId} />
      <input
        type="number"
        step="0.01"
        name="amountUsd"
        placeholder="USD (signed)"
        className="input"
        style={{ width: 140 }}
        required
      />
      <input
        type="text"
        name="note"
        placeholder="Reason (optional)"
        className="input"
        style={{ flex: 1 }}
      />
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
        {pending ? "Applying…" : "Apply"}
      </button>
      {feedback ? (
        <div
          className="caption"
          style={{
            color: feedback.ok
              ? "var(--color-vg-700)"
              : "var(--color-danger)",
          }}
        >
          {feedback.ok ? feedback.message : feedback.error}
        </div>
      ) : null}
    </form>
  );
}
