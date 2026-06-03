"use client";

import { useEffect } from "react";

/**
 * Mounts a single IntersectionObserver that reveals any element carrying the
 * `.reveal` class as it scrolls into view (adds `.is-visible`, then unobserves).
 * Drop it once per page/layout and tag server-rendered elements with
 * `className="reveal"` — no need to make those elements client components.
 *
 * Motion itself lives in CSS and is gated on `prefers-reduced-motion:
 * no-preference`, so reduced-motion users see content immediately. We still add
 * the class (harmless) and fall back to revealing everything where
 * IntersectionObserver is unavailable.
 */
export function ScrollReveal() {
  useEffect(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(".reveal:not(.is-visible)"),
    );
    if (els.length === 0) return;

    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}
