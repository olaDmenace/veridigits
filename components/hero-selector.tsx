"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useEffect } from "react";
import { BrandLogo } from "@/components/brand-logo";
import {
  POPULAR_SERVICES,
  POPULAR_COUNTRIES,
  type PopularService,
  type PopularCountry,
} from "@/lib/landing/options";

/**
 * Interactive hero selector. The visitor picks a service + country right on the
 * landing page; the choice is encoded into a /buy deep link and carried through
 * signup (or login) so they land on a pre-filled buy picker after auth. This is
 * the progressive-engagement replacement for the static phone mock — express
 * intent first, commit second.
 */

type OpenPanel = "service" | "country" | null;

export function HeroSelector() {
  const [serviceSlug, setServiceSlug] = useState<string | null>(null);
  const [countryIso, setCountryIso] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenPanel>(null);
  const [serviceSearch, setServiceSearch] = useState("");
  const [countrySearch, setCountrySearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const service = useMemo(
    () => POPULAR_SERVICES.find((s) => s.slug === serviceSlug) ?? null,
    [serviceSlug],
  );
  const country = useMemo(
    () => POPULAR_COUNTRIES.find((c) => c.iso === countryIso) ?? null,
    [countryIso],
  );

  // Close any open panel on outside-click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return POPULAR_SERVICES;
    return POPULAR_SERVICES.filter(
      (s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
    );
  }, [serviceSearch]);

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return POPULAR_COUNTRIES;
    return POPULAR_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.iso.toLowerCase().includes(q),
    );
  }, [countrySearch]);

  const ready = !!service && !!country;
  const deepLink = ready
    ? `/buy?country=${encodeURIComponent(country.iso)}&service=${encodeURIComponent(service.slug)}`
    : null;
  const signupHref = deepLink
    ? `/signup?next=${encodeURIComponent(deepLink)}`
    : "/signup";
  const loginHref = deepLink
    ? `/login?redirect=${encodeURIComponent(deepLink)}`
    : "/login";

  function pickService(s: PopularService) {
    setServiceSlug(s.slug);
    setServiceSearch("");
    // Nudge them forward: if country isn't chosen yet, open it next.
    setOpen(countryIso ? null : "country");
  }

  function pickCountry(c: PopularCountry) {
    setCountryIso(c.iso);
    setCountrySearch("");
    setOpen(serviceSlug ? null : "service");
  }

  return (
    <div className="hero-picker reveal" ref={rootRef}>
      <div className="hero-picker-head">
        <span className="eyebrow-pill">
          <span className="pulse" />
          Try it — pick &amp; go
        </span>
        <p className="hero-picker-title">
          Which code do you need, and where?
        </p>
      </div>

      <div className="hero-picker-fields">
        {/* SERVICE */}
        <div className="hero-field">
          <span className="hero-field-lbl">Service</span>
          <button
            type="button"
            className={`hero-field-btn ${open === "service" ? "is-open" : ""}`}
            onClick={() => setOpen(open === "service" ? null : "service")}
            aria-expanded={open === "service"}
          >
            {service ? (
              <span className="hero-field-val">
                <BrandLogo slug={service.slug} abbr={service.abbr} size={26} />
                {service.name}
              </span>
            ) : (
              <span className="hero-field-placeholder">Choose a service</span>
            )}
            <Chevron />
          </button>

          {open === "service" ? (
            <div className="hero-pop">
              <input
                type="search"
                className="input hero-pop-search"
                placeholder="Search services…"
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                autoFocus
              />
              <div className="hero-pop-grid">
                {filteredServices.length === 0 ? (
                  <p className="caption hero-pop-empty">No match.</p>
                ) : (
                  filteredServices.map((s) => (
                    <button
                      key={s.slug}
                      type="button"
                      className={`hero-pop-tile ${serviceSlug === s.slug ? "selected" : ""}`}
                      onClick={() => pickService(s)}
                    >
                      <BrandLogo slug={s.slug} abbr={s.abbr} size={28} />
                      <span className="nm">{s.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* COUNTRY */}
        <div className="hero-field">
          <span className="hero-field-lbl">Country</span>
          <button
            type="button"
            className={`hero-field-btn ${open === "country" ? "is-open" : ""}`}
            onClick={() => setOpen(open === "country" ? null : "country")}
            aria-expanded={open === "country"}
          >
            {country ? (
              <span className="hero-field-val">
                <span className="hero-flag">{country.flag}</span>
                {country.name}
              </span>
            ) : (
              <span className="hero-field-placeholder">Choose a country</span>
            )}
            <Chevron />
          </button>

          {open === "country" ? (
            <div className="hero-pop">
              <input
                type="search"
                className="input hero-pop-search"
                placeholder="Search countries…"
                value={countrySearch}
                onChange={(e) => setCountrySearch(e.target.value)}
                autoFocus
              />
              <div className="hero-pop-list">
                {filteredCountries.length === 0 ? (
                  <p className="caption hero-pop-empty">No match.</p>
                ) : (
                  filteredCountries.map((c) => (
                    <button
                      key={c.iso}
                      type="button"
                      className={`hero-pop-row ${countryIso === c.iso ? "selected" : ""}`}
                      onClick={() => pickCountry(c)}
                    >
                      <span className="hero-flag">{c.flag}</span>
                      <span className="nm">{c.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* PRICE HINT */}
      <div className="hero-picker-price" aria-live="polite">
        {service ? (
          <>
            <span className="lbl">Starts from</span>
            <span className="val mono">${(service.fromCents / 100).toFixed(2)}</span>
            <span className="note">live price shown after you pick — no charge until a code arrives</span>
          </>
        ) : (
          <span className="note">5,000+ services · 139 countries in stock · pay only when the code lands</span>
        )}
      </div>

      {/* CTA */}
      {ready ? (
        <Link href={signupHref} className="btn btn-primary btn-lg hero-picker-cta">
          <span className="dot" />
          Continue with {service!.name} · {country!.name}
        </Link>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-lg hero-picker-cta"
          disabled
          onClick={() => setOpen(service ? "country" : "service")}
        >
          <span className="dot" />
          {service ? "Pick a country" : "Pick a service to start"}
        </button>
      )}

      <p className="hero-picker-foot">
        Free account, ~20 seconds.{" "}
        <Link href={loginHref} className="link-lime">
          Already have one? Log in
        </Link>
      </p>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      className="hero-field-chev"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
