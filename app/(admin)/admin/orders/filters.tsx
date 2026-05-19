"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "received", label: "Received" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
  { value: "expired", label: "Expired" },
  { value: "pending", label: "Pending" },
] as const;

const MODE_OPTIONS = [
  { value: "all", label: "All modes" },
  { value: "activation", label: "Activation" },
  { value: "rental", label: "Rental" },
] as const;

export function OrderFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const initialQ = sp.get("q") ?? "";
  const [q, setQ] = useState(initialQ);

  function pushPatch(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    pushPatch({ q });
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-3 flex-wrap">
      <input
        type="search"
        className="input"
        placeholder="Phone, order id, upstream id, user id…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ minWidth: 280 }}
      />
      <select
        className="input"
        value={sp.get("status") ?? "all"}
        onChange={(e) => pushPatch({ status: e.target.value })}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        className="input"
        value={sp.get("mode") ?? "all"}
        onChange={(e) => pushPatch({ mode: e.target.value })}
      >
        {MODE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-secondary btn-sm">
        Apply
      </button>
    </form>
  );
}
