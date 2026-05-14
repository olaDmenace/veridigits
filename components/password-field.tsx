"use client";

import { useState } from "react";

/**
 * Drop-in replacement for <input type="password" className="input" />.
 * Adds a show/hide toggle on the right edge of the field.
 *
 * Positioning is done with inline styles so it's robust against CSS
 * cache / load-order / specificity issues. The CSS class names are
 * kept for hover / focus states (which need pseudo-classes), but the
 * critical layout properties live in the component itself.
 */
export function PasswordField({
  id,
  name,
  autoComplete,
  required,
  minLength,
  defaultValue,
  placeholder,
}: {
  id: string;
  name: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);

  return (
    <div
      className="password-wrap"
      style={{ position: "relative", display: "block", width: "100%" }}
    >
      <input
        id={id}
        name={name}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="input"
        style={{ paddingRight: 44 }}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
        tabIndex={-1}
        style={{
          position: "absolute",
          right: 6,
          top: "50%",
          transform: "translateY(-50%)",
          width: 32,
          height: 32,
          display: "grid",
          placeItems: "center",
          border: 0,
          background: "transparent",
          color: "var(--color-ink-muted)",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
        }}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.77 19.77 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.77 19.77 0 0 1-3.16 4.19" />
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
