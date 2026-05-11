"use client";

import { useState, useTransition } from "react";
import {
  createRule,
  deleteRule,
  toggleRuleActive,
  updateRule,
  type RuleResult,
} from "./actions";

export interface AdminRule {
  id: string;
  service_id: string | null;
  country_id: string | null;
  markup_percent: number;
  flat_fee_cents: number;
  min_retail_cents: number;
  priority: number;
  is_active: boolean;
}

export interface NamedOption {
  id: string;
  label: string;
}

export function RulesTable({
  rules,
  services,
  countries,
}: {
  rules: AdminRule[];
  services: NamedOption[];
  countries: NamedOption[];
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [feedback, setFeedback] = useState<RuleResult | null>(null);

  const serviceLabel = (id: string | null) =>
    id ? services.find((s) => s.id === id)?.label ?? "—" : "any";
  const countryLabel = (id: string | null) =>
    id ? countries.find((c) => c.id === id)?.label ?? "—" : "any";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="caption">
          Higher specificity wins (service+country &gt; service &gt; country &gt;
          global). Within a specificity tier, higher priority wins.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setEditing(editing === "new" ? null : "new")}
        >
          {editing === "new" ? "Close" : "New rule"}
        </button>
      </div>

      {feedback ? (
        <div
          className={`badge ${feedback.ok ? "badge-success" : "badge-danger"}`}
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
          {feedback.ok ? feedback.message : feedback.error}
        </div>
      ) : null}

      {editing === "new" ? (
        <RuleForm
          services={services}
          countries={countries}
          onSubmit={async (fd) => {
            const r = await createRule(fd);
            setFeedback(r);
            if (r.ok) setEditing(null);
            return r;
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      <div className="card-flat" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Country</th>
                <th>Markup</th>
                <th>Flat fee</th>
                <th>Min retail</th>
                <th>Priority</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const isGlobalDefault =
                  r.service_id === null && r.country_id === null;
                return editing === r.id ? (
                  <tr key={r.id}>
                    <td colSpan={8} style={{ padding: 16 }}>
                      <RuleForm
                        initial={r}
                        services={services}
                        countries={countries}
                        onSubmit={async (fd) => {
                          const res = await updateRule(r.id, fd);
                          setFeedback(res);
                          if (res.ok) setEditing(null);
                          return res;
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id}>
                    <td>
                      {serviceLabel(r.service_id)}
                      {isGlobalDefault ? (
                        <span
                          className="badge"
                          style={{ marginLeft: 8 }}
                        >
                          default
                        </span>
                      ) : null}
                    </td>
                    <td>{countryLabel(r.country_id)}</td>
                    <td className="num">{r.markup_percent.toFixed(2)}%</td>
                    <td className="num">{r.flat_fee_cents}¢</td>
                    <td className="num">{r.min_retail_cents}¢</td>
                    <td className="num">{r.priority}</td>
                    <td>
                      <ToggleActive
                        ruleId={r.id}
                        active={r.is_active}
                        onResult={setFeedback}
                      />
                    </td>
                    <td>
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            setEditing(editing === r.id ? null : r.id)
                          }
                        >
                          Edit
                        </button>
                        {!isGlobalDefault ? (
                          <DeleteButton
                            ruleId={r.id}
                            onResult={setFeedback}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ToggleActive({
  ruleId,
  active,
  onResult,
}: {
  ruleId: string;
  active: boolean;
  onResult: (r: RuleResult) => void;
}) {
  const [pending, start] = useTransition();

  function flip() {
    start(async () => {
      const r = await toggleRuleActive(ruleId, !active);
      onResult(r);
    });
  }

  return (
    <button
      type="button"
      onClick={flip}
      disabled={pending}
      className={`badge ${active ? "badge-success" : ""}`}
      style={{
        border: 0,
        cursor: "pointer",
        background: active ? undefined : "var(--color-quiet)",
      }}
    >
      {active ? "active" : "inactive"}
    </button>
  );
}

function DeleteButton({
  ruleId,
  onResult,
}: {
  ruleId: string;
  onResult: (r: RuleResult) => void;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function clicked() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    start(async () => {
      const r = await deleteRule(ruleId);
      onResult(r);
      setConfirming(false);
    });
  }

  return (
    <button
      type="button"
      className={confirming ? "btn btn-danger btn-sm" : "btn btn-ghost btn-sm"}
      onClick={clicked}
      disabled={pending}
    >
      {pending ? "…" : confirming ? "Sure?" : "Delete"}
    </button>
  );
}

function RuleForm({
  initial,
  services,
  countries,
  onSubmit,
  onCancel,
}: {
  initial?: AdminRule;
  services: NamedOption[];
  countries: NamedOption[];
  onSubmit: (fd: FormData) => Promise<RuleResult>;
  onCancel: () => void;
}) {
  const [pending, start] = useTransition();
  const isGlobalDefault =
    initial?.service_id === null && initial?.country_id === null;

  function submit(formData: FormData) {
    start(async () => {
      await onSubmit(formData);
    });
  }

  return (
    <form
      action={submit}
      className="card-flat flex flex-col gap-4"
      style={{ padding: 16 }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="label" htmlFor="service_id">
            Service
          </label>
          <select
            id="service_id"
            name="service_id"
            className="input"
            defaultValue={initial?.service_id ?? ""}
            disabled={isGlobalDefault}
          >
            <option value="">any</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="label" htmlFor="country_id">
            Country
          </label>
          <select
            id="country_id"
            name="country_id"
            className="input"
            defaultValue={initial?.country_id ?? ""}
            disabled={isGlobalDefault}
          >
            <option value="">any</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="markup_percent">
            Markup %
          </label>
          <input
            id="markup_percent"
            name="markup_percent"
            type="number"
            step="0.01"
            min="0"
            max="999.99"
            required
            className="input"
            defaultValue={initial?.markup_percent ?? 30}
            style={{ width: 120 }}
          />
        </div>
        <div>
          <label className="label" htmlFor="flat_fee_cents">
            Flat fee (¢)
          </label>
          <input
            id="flat_fee_cents"
            name="flat_fee_cents"
            type="number"
            step="1"
            min="0"
            required
            className="input"
            defaultValue={initial?.flat_fee_cents ?? 1}
            style={{ width: 100 }}
          />
        </div>
        <div>
          <label className="label" htmlFor="min_retail_cents">
            Min retail (¢)
          </label>
          <input
            id="min_retail_cents"
            name="min_retail_cents"
            type="number"
            step="1"
            min="0"
            required
            className="input"
            defaultValue={initial?.min_retail_cents ?? 5}
            style={{ width: 100 }}
          />
        </div>
        <div>
          <label className="label" htmlFor="priority">
            Priority
          </label>
          <input
            id="priority"
            name="priority"
            type="number"
            step="1"
            min="0"
            required
            className="input"
            defaultValue={initial?.priority ?? 0}
            style={{ width: 100 }}
          />
        </div>
        <label
          className="flex items-center gap-2 caption"
          style={{ marginBottom: 12 }}
        >
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={initial?.is_active ?? true}
          />
          Active
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending
            ? "Saving…"
            : initial
              ? "Save changes"
              : "Create rule"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
