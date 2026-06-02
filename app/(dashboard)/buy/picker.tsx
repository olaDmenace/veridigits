"use client";

import { useMemo, useState, useTransition, useActionState } from "react";
import {
  getServicesForCountry,
  getQuote,
  purchaseAndRedirect,
  type PurchaseError,
  type QuoteResult,
  type ServicePriceOption,
} from "./actions";
import { RENTAL_DURATIONS, type OrderMode } from "./constants";
import { formatUsdCents } from "@/lib/utils/money";
import { InfoNotice } from "@/components/info-notice";
import { getServiceDisplay } from "@/lib/services/display";
import { BrandLogo } from "@/components/brand-logo";

export interface CountryEntry {
  id: string;
  isoCode: string;
  name: string;
  flagEmoji: string | null;
}

type Quote = Extract<QuoteResult, { ok: true }>;

interface QuoteState {
  loading: boolean;
  data: Quote | null;
  error: string | null;
}

const EMPTY_QUOTE: QuoteState = { loading: false, data: null, error: null };

// Module-scoped staleness refs — drop async results if the user has
// already moved on to another country or service.
const countryIdRef = { current: null as string | null };
const serviceIdRef = { current: null as string | null };

export function BuyPicker({
  countries,
  initialCountryId = null,
  initialServices = [],
}: {
  countries: CountryEntry[];
  initialCountryId?: string | null;
  initialServices?: ServicePriceOption[];
}) {
  const [mode, setMode] = useState<OrderMode>("activation");
  const [durationHours, setDurationHours] = useState<number>(
    RENTAL_DURATIONS[0].hours,
  );
  const [countryId, setCountryId] = useState<string | null>(initialCountryId);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [countrySearch, setCountrySearch] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [services, setServices] = useState<ServicePriceOption[]>(initialServices);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [loadingServices, setLoadingServices] = useState(false);
  const [quote, setQuote] = useState<QuoteState>(EMPTY_QUOTE);
  const [, startTransition] = useTransition();

  if (initialCountryId && countryIdRef.current === null) {
    countryIdRef.current = initialCountryId;
  }

  const filteredCountries = useMemo(() => {
    if (!countrySearch.trim()) return countries;
    const q = countrySearch.toLowerCase();
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.isoCode.toLowerCase().includes(q),
    );
  }, [countries, countrySearch]);

  const filteredServices = useMemo(() => {
    if (!serviceSearch.trim()) return services;
    const q = serviceSearch.toLowerCase();
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
    );
  }, [services, serviceSearch]);

  function selectCountry(id: string) {
    if (id === countryId) return;
    setCountryId(id);
    setServiceId(null);
    setServices([]);
    setServicesError(null);
    setQuote(EMPTY_QUOTE);
    setLoadingServices(true);

    startTransition(async () => {
      try {
        const result = await getServicesForCountry(id);
        if (countryIdRef.current !== id) return;
        if (result.ok) {
          setServices(result.services);
          setServicesError(null);
        } else {
          setServices([]);
          setServicesError(`${result.where}: ${result.error}`);
        }
      } catch (err) {
        if (countryIdRef.current !== id) return;
        setServices([]);
        setServicesError(
          err instanceof Error ? err.message : "Failed to load services",
        );
      } finally {
        setLoadingServices(false);
      }
    });

    countryIdRef.current = id;
  }

  function selectService(id: string) {
    if (!countryId || id === serviceId) return;
    setServiceId(id);
    refetchQuote(id, mode, durationHours);
    serviceIdRef.current = id;
  }

  function refetchQuote(sid: string, m: OrderMode, hours: number) {
    if (!countryId) return;
    setQuote({ loading: true, data: null, error: null });
    startTransition(async () => {
      const result = await getQuote(
        sid,
        countryId,
        m,
        m === "rental" ? hours : undefined,
      );
      if (serviceIdRef.current !== sid) return;
      if (result.ok) {
        setQuote({ loading: false, data: result, error: null });
      } else {
        setQuote({ loading: false, data: null, error: result.message });
      }
    });
  }

  function handleSetMode(m: OrderMode) {
    if (m === mode) return;
    setMode(m);
    if (serviceId) refetchQuote(serviceId, m, durationHours);
  }

  function handleSetDuration(hours: number) {
    if (hours === durationHours) return;
    setDurationHours(hours);
    if (serviceId && mode === "rental") refetchQuote(serviceId, mode, hours);
  }

  const selectedCountry = countries.find((c) => c.id === countryId) ?? null;
  const selectedService = services.find((s) => s.serviceId === serviceId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <ModeBar
        mode={mode}
        onSetMode={handleSetMode}
        durationHours={durationHours}
        onSetDuration={handleSetDuration}
      />

      <QuotePanel
        service={selectedService}
        country={selectedCountry}
        quote={quote}
        mode={mode}
        durationHours={durationHours}
      />

      <div className="buy-grid">
        <CountryPicker
          countries={filteredCountries}
          allCount={countries.length}
          selected={selectedCountry}
          search={countrySearch}
          onSearch={setCountrySearch}
          onSelect={selectCountry}
        />

        <ServicesPanel
          country={selectedCountry}
          services={filteredServices}
          allCount={services.length}
          loading={loadingServices}
          error={servicesError}
          search={serviceSearch}
          onSearch={setServiceSearch}
          selectedId={serviceId}
          onSelect={selectService}
        />
      </div>
    </div>
  );
}

function ModeBar({
  mode,
  onSetMode,
  durationHours,
  onSetDuration,
}: {
  mode: OrderMode;
  onSetMode: (m: OrderMode) => void;
  durationHours: number;
  onSetDuration: (h: number) => void;
}) {
  return (
    <div className="card flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="eyebrow">Mode</div>
          <p className="caption" style={{ marginTop: 6 }}>
            Activation = one-time, ~20 minutes. Rental = unlimited SMS over the
            duration.
          </p>
        </div>
        <div className="mode-toggle" role="tablist" aria-label="Order mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "activation"}
            className={`mode-toggle-btn ${mode === "activation" ? "is-active" : ""}`}
            onClick={() => onSetMode("activation")}
          >
            Activation
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "rental"}
            className={`mode-toggle-btn ${mode === "rental" ? "is-active" : ""}`}
            onClick={() => onSetMode("rental")}
          >
            Rental
          </button>
        </div>
      </div>

      {mode === "rental" ? (
        <div className="flex flex-col gap-2">
          <div className="eyebrow">Duration</div>
          <div className="chips">
            {RENTAL_DURATIONS.map((d) => (
              <button
                key={d.hours}
                type="button"
                className={`chip ${durationHours === d.hours ? "selected" : ""}`}
                onClick={() => onSetDuration(d.hours)}
              >
                <span className="tic">{durationHours === d.hours ? "✓" : ""}</span>
                {d.label}
              </button>
            ))}
          </div>
          <p className="caption" style={{ marginTop: 4 }}>
            Rental prices shown are estimates — final cost is set at purchase
            time, within a ±20% band of the estimate.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function CountryPicker({
  countries,
  allCount,
  selected,
  search,
  onSearch,
  onSelect,
}: {
  countries: CountryEntry[];
  allCount: number;
  selected: CountryEntry | null;
  search: string;
  onSearch: (s: string) => void;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  function pick(id: string) {
    onSelect(id);
    setOpen(false);
    onSearch("");
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Country</div>
          <p className="caption" style={{ marginTop: 4 }}>
            {allCount} countries with stock — pick one to see services.
          </p>
        </div>
        <button
          type="button"
          className={`btn ${open ? "btn-secondary" : "btn-primary"} btn-sm`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Change"}
        </button>
      </div>

      {selected ? (
        <div className="cty-row selected">
          <span className="flag">
            {selected.flagEmoji ?? selected.isoCode.slice(0, 2).toUpperCase()}
          </span>
          <span>{selected.name}</span>
          <span className="iso">{selected.isoCode.toUpperCase()}</span>
          <span></span>
        </div>
      ) : (
        <p className="caption">No country selected.</p>
      )}

      {open ? (
        <div className="picker-panel">
          <input
            type="search"
            className="input"
            placeholder="Search countries…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            autoFocus
          />
          <div className="cty-list" style={{ maxHeight: 360 }}>
            {countries.length === 0 ? (
              <p className="caption" style={{ padding: 12 }}>
                No countries match &ldquo;{search}&rdquo;.
              </p>
            ) : (
              countries.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`cty-row ${selected?.id === c.id ? "selected" : ""}`}
                  onClick={() => pick(c.id)}
                  style={{
                    border: 0,
                    background: "transparent",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span className="flag">
                    {c.flagEmoji ?? c.isoCode.slice(0, 2).toUpperCase()}
                  </span>
                  <span>{c.name}</span>
                  <span className="iso">{c.isoCode.toUpperCase()}</span>
                  <span></span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ServicesPanel({
  country,
  services,
  allCount,
  loading,
  error,
  search,
  onSearch,
  selectedId,
  onSelect,
}: {
  country: CountryEntry | null;
  services: ServicePriceOption[];
  allCount: number;
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (s: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!country) {
    return (
      <div
        className="card flex items-center justify-center text-center"
        style={{ minHeight: 240, padding: 32 }}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="eyebrow">Service</div>
          <InfoNotice>Pick a country first.</InfoNotice>
        </div>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Service · {country.name}</div>
          <p className="caption" style={{ marginTop: 4 }}>
            {loading
              ? "Loading services…"
              : `${allCount} services in stock for ${country.name}`}
          </p>
        </div>
      </div>

      {!loading && error ? (
        <div
          className="badge badge-danger"
          style={{
            height: "auto",
            padding: "10px 12px",
            textTransform: "none",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            letterSpacing: 0,
            fontWeight: 500,
            whiteSpace: "normal",
          }}
        >
          {error}
        </div>
      ) : !loading && services.length === 0 ? (
        <InfoNotice align="start">
          No stock for this country right now. Try another.
        </InfoNotice>
      ) : (
        <>
          <input
            type="search"
            className="input"
            placeholder="Search services…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          <div className="services-list">
            {services.map((s) => {
              const display = getServiceDisplay(s.slug, s.name);
              return (
                <button
                  key={s.serviceId}
                  type="button"
                  className={`svc-tile ${selectedId === s.serviceId ? "selected" : ""}`}
                  onClick={() => onSelect(s.serviceId)}
                  style={{ width: "100%" }}
                >
                  <BrandLogo slug={s.slug} abbr={display.abbr} size={36} />
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div className="nm">{display.name}</div>
                    <div className="pr">{s.slug}</div>
                  </div>
                  <div className="pr mono">{formatUsdCents(s.retailCents)}</div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function QuotePanel({
  service,
  country,
  quote,
  mode,
  durationHours,
}: {
  service: ServicePriceOption | null;
  country: CountryEntry | null;
  quote: QuoteState;
  mode: OrderMode;
  durationHours: number;
}) {
  const [purchaseState, formAction, isPending] = useActionState<
    PurchaseError | undefined,
    FormData
  >(purchaseAndRedirect, undefined);

  if (!service || !country) {
    return (
      <div
        className="card flex items-center justify-center text-center"
        style={{ padding: 32, minHeight: 200 }}
      >
        <InfoNotice>Select a country and service to see a live price.</InfoNotice>
      </div>
    );
  }

  if (quote.loading) {
    return (
      <div
        className="card flex items-center justify-center text-center"
        style={{ padding: 32, minHeight: 200 }}
      >
        <InfoNotice>Re-quoting upstream…</InfoNotice>
      </div>
    );
  }

  if (quote.error || !quote.data) {
    return (
      <div className="card flex flex-col gap-3" style={{ padding: 24, minHeight: 200 }}>
        <div className="eyebrow">Quote unavailable</div>
        <p className="small">
          {quote.error ?? "Something went wrong fetching the price."}
        </p>
      </div>
    );
  }

  const q = quote.data;
  const durationLabel =
    RENTAL_DURATIONS.find((d) => d.hours === durationHours)?.label ??
    `${durationHours}h`;

  return (
    <div className="card flex flex-col gap-4" style={{ padding: 24, minHeight: 200 }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">
            {mode === "rental" ? `Rental · ${durationLabel}` : "Live quote"}
          </div>
          <h3 className="h3" style={{ marginTop: 4 }}>
            {service.name} · {country.name}
          </h3>
        </div>
        <div className="dotline ok">
          <span className="d"></span>
          {q.availableCount} in stock
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">
            {mode === "rental" ? "You pay (estimated)" : "You pay"}
          </div>
          <div className="h2 mono" style={{ marginTop: 4 }}>
            {formatUsdCents(q.retailCents)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {q.estimated ? (
            <span className="badge badge-warn">estimated</span>
          ) : null}
        </div>
      </div>

      {purchaseState && !purchaseState.ok ? (
        <div
          className="badge badge-danger"
          style={{
            height: "auto",
            padding: "10px 12px",
            textTransform: "none",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            letterSpacing: 0,
            fontWeight: 500,
          }}
        >
          {purchaseState.message}
        </div>
      ) : null}

      <form action={formAction}>
        <input type="hidden" name="holdToken" value={q.holdToken} />
        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={isPending}
          style={{ width: "100%" }}
        >
          <span className="dot"></span>
          {isPending
            ? "Charging wallet…"
            : `Buy for ${formatUsdCents(q.retailCents)}`}
        </button>
      </form>

      <p className="caption text-center">
        Quote valid for 30s. Refunded automatically if no SMS arrives.
      </p>
    </div>
  );
}
