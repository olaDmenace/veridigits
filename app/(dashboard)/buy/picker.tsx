"use client";

import { useMemo, useState, useTransition, useActionState } from "react";
import {
  getCountriesForService,
  getQuote,
  purchaseAndRedirect,
  type CountryOption,
  type PurchaseError,
  type QuoteResult,
} from "./actions";
import { formatUsdCents } from "@/lib/utils/money";

export interface ServiceOption {
  id: string;
  slug: string;
  name: string;
}

type Quote = Extract<QuoteResult, { ok: true }>;

interface QuoteState {
  loading: boolean;
  data: Quote | null;
  error: string | null;
}

const EMPTY_QUOTE: QuoteState = { loading: false, data: null, error: null };

const ICON_PALETTE = [
  "svc-tg",
  "svc-wa",
  "svc-go",
  "svc-tk",
  "svc-di",
  "svc-ig",
];

function abbrFor(slug: string): string {
  return slug.replace(/[^a-z0-9]/gi, "").slice(0, 2).toLowerCase() || "??";
}

function iconClassFor(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return ICON_PALETTE[Math.abs(h) % ICON_PALETTE.length];
}

export function BuyPicker({ services }: { services: ServiceOption[] }) {
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [countryId, setCountryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [quote, setQuote] = useState<QuoteState>(EMPTY_QUOTE);
  const [, startTransition] = useTransition();

  const filteredServices = useMemo(() => {
    if (!search.trim()) return services;
    const q = search.toLowerCase();
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
    );
  }, [services, search]);

  function selectService(id: string) {
    if (id === serviceId) return;
    setServiceId(id);
    setCountryId(null);
    setCountries([]);
    setQuote(EMPTY_QUOTE);
    setLoadingCountries(true);

    startTransition(async () => {
      try {
        const data = await getCountriesForService(id);
        // Guard against a stale response if the user has clicked another
        // service while this one was inflight.
        setCountries((prev) => (serviceIdRef.current === id ? data : prev));
      } catch {
        setCountries([]);
      } finally {
        setLoadingCountries(false);
      }
    });

    serviceIdRef.current = id;
  }

  function selectCountry(id: string) {
    if (!serviceId || id === countryId) return;
    setCountryId(id);
    setQuote({ loading: true, data: null, error: null });

    startTransition(async () => {
      const result = await getQuote(serviceId, id);
      // Same staleness guard.
      if (countryIdRef.current !== id) return;

      if (result.ok) {
        setQuote({ loading: false, data: result, error: null });
      } else {
        setQuote({ loading: false, data: null, error: result.message });
      }
    });

    countryIdRef.current = id;
  }

  const selectedService = services.find((s) => s.id === serviceId) ?? null;
  const selectedCountry = countries.find((c) => c.countryId === countryId) ?? null;

  return (
    <div className="buy-grid">
      <ServicesPanel
        services={filteredServices}
        selectedId={serviceId}
        onSelect={selectService}
        search={search}
        onSearch={setSearch}
      />

      <CountriesPanel
        service={selectedService}
        countries={countries}
        loading={loadingCountries}
        selectedId={countryId}
        onSelect={selectCountry}
      />

      <QuotePanel
        service={selectedService}
        country={selectedCountry}
        quote={quote}
      />
    </div>
  );
}

// Module-scoped refs — used to drop stale async results without depending on
// React refs (which would force a forwardRef pattern here).
const serviceIdRef = { current: null as string | null };
const countryIdRef = { current: null as string | null };

function ServicesPanel({
  services,
  selectedId,
  onSelect,
  search,
  onSearch,
}: {
  services: ServiceOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (s: string) => void;
}) {
  return (
    <div className="card flex flex-col gap-4" style={{ minHeight: 480 }}>
      <div className="flex items-center justify-between gap-3">
        <div className="eyebrow">Service</div>
        <span className="caption mono">{services.length} available</span>
      </div>

      <input
        type="search"
        className="input"
        placeholder="Search services…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />

      <div className="services-list">
        {services.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`svc-tile ${selectedId === s.id ? "selected" : ""}`}
            onClick={() => onSelect(s.id)}
            style={{ width: "100%" }}
          >
            <div className={`ico ${iconClassFor(s.slug)}`}>
              {abbrFor(s.slug)}
            </div>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div className="nm">{s.name}</div>
              <div className="pr">{s.slug}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CountriesPanel({
  service,
  countries,
  loading,
  selectedId,
  onSelect,
}: {
  service: ServiceOption | null;
  countries: CountryOption[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!service) {
    return (
      <div
        className="card flex items-center justify-center text-center"
        style={{ minHeight: 480, padding: 32 }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Country
          </div>
          <p className="caption">Pick a service first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-4" style={{ minHeight: 480 }}>
      <div className="flex items-center justify-between gap-3">
        <div className="eyebrow">Country · {service.name}</div>
        <span className="caption mono">
          {loading ? "loading…" : `${countries.length} in stock`}
        </span>
      </div>

      {!loading && countries.length === 0 ? (
        <p className="caption">
          No upstream stock for this service right now. Try another.
        </p>
      ) : (
        <div className="cty-list">
          {countries.map((c) => (
            <button
              key={c.countryId}
              type="button"
              className={`cty-row ${selectedId === c.countryId ? "selected" : ""}`}
              onClick={() => onSelect(c.countryId)}
              style={{ border: "0", background: "transparent", textAlign: "left", width: "100%" }}
            >
              <span className="flag">
                {c.flagEmoji ?? c.isoCode.slice(0, 2).toUpperCase()}
              </span>
              <span>{c.name}</span>
              <span className="iso">{c.isoCode.toUpperCase()}</span>
              <span className="pr">{formatUsdCents(c.retailCents)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuotePanel({
  service,
  country,
  quote,
}: {
  service: ServiceOption | null;
  country: CountryOption | null;
  quote: QuoteState;
}) {
  const [purchaseState, formAction, isPending] = useActionState<
    PurchaseError | undefined,
    FormData
  >(purchaseAndRedirect, undefined);

  if (!service || !country) {
    return (
      <div className="card flex items-center justify-center text-center" style={{ padding: 32, minHeight: 240 }}>
        <p className="caption">Select a service + country to see a live price.</p>
      </div>
    );
  }

  if (quote.loading) {
    return (
      <div className="card flex items-center justify-center text-center" style={{ padding: 32, minHeight: 240 }}>
        <p className="caption">Re-quoting upstream…</p>
      </div>
    );
  }

  if (quote.error || !quote.data) {
    return (
      <div className="card flex flex-col gap-3" style={{ padding: 24, minHeight: 240 }}>
        <div className="eyebrow">Quote unavailable</div>
        <p className="small">
          {quote.error ?? "Something went wrong fetching the price."}
        </p>
      </div>
    );
  }

  const q = quote.data;

  return (
    <div className="card flex flex-col gap-4" style={{ padding: 24, minHeight: 240 }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Live quote</div>
          <h3 className="h3" style={{ marginTop: 4 }}>
            {service.name} · {country.name}
          </h3>
        </div>
        <div className="dotline ok">
          <span className="d"></span>
          {q.availableCount} in stock
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="eyebrow">You pay</div>
          <div className="h2 mono" style={{ marginTop: 4 }}>
            {formatUsdCents(q.retailCents)}
          </div>
        </div>
        <span className="caption">via {q.providerSlug}</span>
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
