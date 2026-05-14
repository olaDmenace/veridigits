import type { ReactNode } from "react";

/**
 * Informational notice with a leading "i" icon. Use for empty / loading /
 * hint states inside cards — anywhere we want the user to know *why*
 * something is currently empty or pending.
 *
 * Not an error or warning — for those use the .badge .badge-danger /
 * .badge-warn patterns.
 */
export function InfoNotice({
  children,
  align = "center",
  emphasis = "bold",
}: {
  children: ReactNode;
  align?: "center" | "start";
  emphasis?: "bold" | "normal";
}) {
  return (
    <div
      className="info-notice"
      style={{
        justifyContent: align === "center" ? "center" : "flex-start",
        textAlign: align,
        fontWeight: emphasis === "bold" ? 600 : 500,
      }}
    >
      <InfoIcon />
      <span>{children}</span>
    </div>
  );
}

function InfoIcon() {
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
      className="info-notice-icon"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
