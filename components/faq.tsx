"use client";

import { useState } from "react";

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * Single-open accordion with an animated height expand/retract (grid-rows
 * 0fr→1fr, no JS measuring) and a lime active toggle + item accent. The first
 * item starts open. Clicking the open item collapses it.
 */
export function Faq({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="faq-list reveal">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div key={item.q} className={`faq-item${isOpen ? " open" : ""}`}>
            <button
              type="button"
              className="faq-trigger"
              aria-expanded={isOpen}
              onClick={() => setOpenIndex(isOpen ? -1 : i)}
            >
              <span className="faq-q">{item.q}</span>
              <span className="faq-toggle" aria-hidden>
                +
              </span>
            </button>
            <div className="faq-body">
              <div className="faq-body-inner">
                <p className="faq-a">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
