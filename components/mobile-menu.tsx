"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TopbarLink } from "./topbar";

export function MobileMenu({
  links,
  primary,
  meta,
}: {
  links: TopbarLink[];
  primary?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // We don't need a mount-state guard for the portal: `open` starts false
  // on both server and client, and only flips via a click handler that
  // runs in the browser. By the time we'd render the drawer,
  // document.body exists.

  // Close on Escape, lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const drawer =
    open ? (
      <div
        id="topbar-drawer"
        className="topbar-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        onClick={() => setOpen(false)}
      >
        <div
          className="topbar-drawer-panel"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="topbar-drawer-close"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <CloseIcon />
          </button>

          <ul className="topbar-drawer-links">
            {links.map((l) => (
              <li key={l.href}>
                {l.anchor ? (
                  <a href={l.href} onClick={() => setOpen(false)}>
                    {l.label}
                  </a>
                ) : (
                  <Link href={l.href} onClick={() => setOpen(false)}>
                    {l.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>

          {meta || primary ? (
            <div className="topbar-drawer-actions">
              {meta ? <div className="topbar-drawer-meta">{meta}</div> : null}
              {primary}
            </div>
          ) : null}
        </div>
      </div>
    ) : null;

  return (
    <>
      <button
        type="button"
        className="topbar-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="topbar-drawer"
        onClick={() => setOpen((v) => !v)}
      >
        <HamburgerIcon open={open} />
      </button>

      {drawer ? createPortal(drawer, document.body) : null}
    </>
  );
}

function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {open ? (
        <>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </>
      ) : (
        <>
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </>
      )}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  );
}
