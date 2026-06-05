"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useEffect, useTransition } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { flagFor } from "@/lib/landing/options";
import { formatUsdCents } from "@/lib/utils/money";
import { getServiceDisplay } from "@/lib/services/display";
import {
  getServicesForCountry,
  type ServicePriceOption,
} from "@/app/(dashboard)/buy/actions";

/**
 * Interactive hero selector — country first, then service, mirroring /buy.
 *
 * The country list is the real in-stock catalog (passed from the server). On
 * country select we fetch that country's full, live-priced service list via the
 * same `getServicesForCountry` action /buy uses. The pick is encoded into a
 * /buy deep link and carried through signup/login so the user lands on a
 * pre-filled, pre-priced buy picker after auth.
 */

export interface HeroCountry {
  id: string;
  iso: string;
  name: string;
}

type OpenPanel = "country" | "service" | null;

export function HeroSelector({ countries }: { countries: HeroCountry[] }) {
  const [countryId, setCountryId] = useState<string | null>(null);
  const [serviceSlug, setServiceSlug] = useState<string | null>(null);
  const [services, setServices] = useState<ServicePriceOption[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenPanel>(null);
  const [countrySearch, setCountrySearch] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  // Drop stale async service results if the user switches country mid-flight.
  const countryRef = useRef<string | null>(null);

  const country = useMemo(
    () => countries.find((c) => c.id === countryId) ?? null,
    [countries, countryId],
  );
  const service = useMemo(
    () => services.find((s) => s.slug === serviceSlug) ?? null,
    [services, serviceSlug],
  );

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

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) => c.name.toLowerCase().includes(q) || c.iso.toLowerCase().includes(q),
    );
  }, [countries, countrySearch]);

  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return services;
    return services.filter(
      (s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
    );
  }, [services, serviceSearch]);

  function selectCountry(c: HeroCountry) {
    setCountryId(c.id);
    setServiceSlug(null);
    setServices([]);
    setServicesError(null);
    setCountrySearch("");
    setLoadingServices(true);
    setOpen("service"); // forward nudge: open the service step next
    countryRef.current = c.id;

    startTransition(async () => {
      try {
        const result = await getServicesForCountry(c.id);
        if (countryRef.current !== c.id) return; // superseded
        if (result.ok) {
          setServices(result.services);
          setServicesError(null);
        } else {
          setServices([]);
          setServicesError("Couldn’t load services. Try another country.");
        }
      } catch {
        if (countryRef.current !== c.id) return;
        setServices([]);
        setServicesError("Couldn’t load services. Try another country.");
      } finally {
        if (countryRef.current === c.id) setLoadingServices(false);
      }
    });
  }

  function selectService(s: ServicePriceOption) {
    setServiceSlug(s.slug);
    setServiceSearch("");
    setOpen(null);
  }

  const ready = !!country && !!service;
  const deepLink = ready
    ? `/buy?country=${encodeURIComponent(country.iso)}&service=${encodeURIComponent(service.slug)}`
    : null;
  const signupHref = deepLink
    ? `/signup?next=${encodeURIComponent(deepLink)}`
    : "/signup";
  const loginHref = deepLink
    ? `/login?redirect=${encodeURIComponent(deepLink)}`
    : "/login";

  return (
    <div className="hero-picker reveal" ref={rootRef}>
      <div className="hero-picker-head">
        <span className="eyebrow-pill">
          <span className="pulse" />
          Try it — pick &amp; go
        </span>
        <p className="hero-picker-title">Which code do you need, and where?</p>
      </div>

      <div className="hero-picker-fields">
        {/* COUNTRY (first, like /buy) */}
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
                <span className="hero-flag">{flagFor(country.iso)}</span>
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
                placeholder={`Search ${countries.length} countries…`}
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
                      key={c.id}
                      type="button"
                      className={`hero-pop-row ${countryId === c.id ? "selected" : ""}`}
                      onClick={() => selectCountry(c)}
                    >
                      <span className="hero-flag">{flagFor(c.iso)}</span>
                      <span className="nm">{c.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* SERVICE (depends on country) */}
        <div className="hero-field">
          <span className="hero-field-lbl">Service</span>
          <button
            type="button"
            className={`hero-field-btn ${open === "service" ? "is-open" : ""}`}
            onClick={() => country && setOpen(open === "service" ? null : "service")}
            aria-expanded={open === "service"}
            disabled={!country}
          >
            {service ? (
              <span className="hero-field-val">
                <BrandLogo
                  slug={service.slug}
                  abbr={getServiceDisplay(service.slug, service.name).abbr}
                  size={26}
                />
                {getServiceDisplay(service.slug, service.name).name}
              </span>
            ) : (
              <span className="hero-field-placeholder">
                {country ? "Choose a service" : "Pick a country first"}
              </span>
            )}
            <Chevron />
          </button>

          {open === "service" && country ? (
            <div className="hero-pop">
              <input
                type="search"
                className="input hero-pop-search"
                placeholder="Search services…"
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                autoFocus
              />
              <div className="hero-pop-list">
                {loadingServices ? (
                  <p className="caption hero-pop-empty">Loading services…</p>
                ) : servicesError ? (
                  <p className="caption hero-pop-empty">{servicesError}</p>
                ) : filteredServices.length === 0 ? (
                  <p className="caption hero-pop-empty">
                    {services.length === 0
                      ? "No stock here right now — try another country."
                      : "No match."}
                  </p>
                ) : (
                  filteredServices.map((s) => {
                    const d = getServiceDisplay(s.slug, s.name);
                    return (
                      <button
                        key={s.serviceId}
                        type="button"
                        className={`hero-pop-row ${serviceSlug === s.slug ? "selected" : ""}`}
                        onClick={() => selectService(s)}
                      >
                        <BrandLogo slug={s.slug} abbr={d.abbr} size={24} />
                        <span className="nm">{d.name}</span>
                        <span className="hero-pop-price mono">
                          {formatUsdCents(s.retailCents)}
                        </span>
                      </button>
                    );
                  })
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
            <span className="lbl">From</span>
            <span className="val mono">{formatUsdCents(service.retailCents)}</span>
            <span className="note">
              re-quoted live at checkout — no charge until a code arrives
            </span>
          </>
        ) : (
          <span className="note">
            {countries.length}+ countries in stock · 5,000+ services · pay only
            when the code lands
          </span>
        )}
      </div>

      {/* CTA */}
      {ready ? (
        <Link href={signupHref} className="btn btn-primary btn-lg hero-picker-cta">
          <span className="dot" />
          Continue with {getServiceDisplay(service.slug, service.name).name} ·{" "}
          {country.name}
        </Link>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-lg hero-picker-cta"
          disabled
          onClick={() => setOpen(country ? "service" : "country")}
        >
          <span className="dot" />
          {country ? "Pick a service" : "Pick a country to start"}
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
