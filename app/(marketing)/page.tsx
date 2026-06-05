import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { BrandLogo } from "@/components/brand-logo";
import { ScrollReveal } from "@/components/scroll-reveal";
import { Faq as FaqAccordion } from "@/components/faq";
import { HeroSelector, type HeroCountry } from "@/components/hero-selector";
import { POPULAR_SERVICES } from "@/lib/landing/options";
import { getLandingCountries } from "@/lib/landing/catalog";

export default async function Home() {
  const landingCountries = await getLandingCountries();
  const heroCountries: HeroCountry[] = landingCountries.map((c) => ({
    id: c.id,
    iso: c.iso,
    name: c.name,
  }));

  return (
    <div className="marketing">
      <Topbar
        hideMobileMenu
        links={[
          { href: "#how", label: "How it works", anchor: true },
          { href: "#services", label: "Services", anchor: true },
          { href: "#pricing", label: "Pricing", anchor: true },
          { href: "#faq", label: "FAQ", anchor: true },
        ]}
        primary={
          <Link href="/login" className="btn btn-primary btn-sm">
            Sign in
          </Link>
        }
      />

      <main>
        <Hero countries={heroCountries} />
        <TrustStrip />
        <HowItWorks />
        <ServicesGrid />
        <Pricing />
        <Faq />
      </main>

      <SiteFooter />
      <ScrollReveal />
    </div>
  );
}

function Hero({ countries }: { countries: HeroCountry[] }) {
  return (
    <section className="hero hero-dark">
      <FloatingIcons />
      <div className="page hero-inner">
        <div className="hero-grid">
          <div className="hero-copy reveal">
            <span className="eyebrow-pill">
              <span className="pulse"></span>SMS verification · no KYC
            </span>
            <h1>
              Receive SMS<br />
              without <span className="hero-accent">the trace.</span>
            </h1>
          <p className="lead">
            Top up with crypto, pick a service and country, receive your
            verification code in seconds. 5,000+ services, 180+ countries,
            no account ID, no questions asked.
          </p>
          <div className="hero-cta">
            <Link className="btn btn-primary btn-lg" href="/signup">
              <span className="dot"></span>
              Get started
            </Link>
            <Link className="btn btn-secondary btn-lg" href="/login">
              Log in
            </Link>
          </div>

          <div className="hero-stats">
            <div className="stat">
              <div className="num">180+</div>
              <div className="lbl">Countries supported</div>
            </div>
            <div className="stat">
              <div className="num">5,000+</div>
              <div className="lbl">Services to verify</div>
            </div>
            <div className="stat">
              <div className="num">$0.05</div>
              <div className="lbl">From, per activation</div>
            </div>
          </div>
        </div>

        <HeroSelector countries={countries} />
      </div>
      </div>
    </section>
  );
}

const FLOATERS: Array<{ slug: string; size: number; cls: string }> = [
  { slug: "telegram", size: 56, cls: "fi-1" },
  { slug: "whatsapp", size: 46, cls: "fi-2" },
  { slug: "google", size: 52, cls: "fi-3" },
  { slug: "discord", size: 44, cls: "fi-4" },
  { slug: "instagram", size: 58, cls: "fi-5" },
  { slug: "x", size: 40, cls: "fi-6" },
  { slug: "spotify", size: 44, cls: "fi-7" },
  { slug: "tiktok", size: 50, cls: "fi-8" },
  { slug: "youtube", size: 46, cls: "fi-9" },
  { slug: "snapchat", size: 40, cls: "fi-10" },
  { slug: "reddit", size: 38, cls: "fi-11" },
  { slug: "uber", size: 42, cls: "fi-12" },
];

function FloatingIcons() {
  return (
    <div className="hero-orbit" aria-hidden>
      <div className="hero-glow" />
      {FLOATERS.map((f) => (
        <span key={f.slug} className={`fi ${f.cls}`}>
          <BrandLogo
            slug={f.slug}
            size={f.size}
            radius={Math.round(f.size * 0.3)}
            className="fi-chip"
          />
        </span>
      ))}
    </div>
  );
}

function TrustStrip() {
  return (
    <section className="page" style={{ paddingTop: 0, paddingBottom: 8 }}>
      <div className="trusted-card reveal">
        <div className="ttl">Top up with crypto or Naira</div>
        <div className="logos">
          <span className="cur" data-cur="usdt">USDT</span>
          <span className="cur" data-cur="usdc">USDC</span>
          <span className="cur" data-cur="btc">BTC</span>
          <span className="cur" data-cur="eth">ETH</span>
          <span className="cur" data-cur="naira">Naira</span>
          <span className="cur" data-cur="more">+200 coins</span>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    num: "01",
    icon: <WalletIcon />,
    title: "Top up your wallet",
    body: "Pay in Naira (card, bank transfer, pay-with-bank) or in crypto (USDT, USDC, BTC, and 200+ coins). Funds land in your wallet in minutes. No statements.",
  },
  {
    num: "02",
    icon: <SearchIcon />,
    title: "Pick a service and country",
    body: "Browse 5,000+ services across 180+ countries. We re-quote the wholesale price the moment you click buy — what you see is what you pay.",
  },
  {
    num: "03",
    icon: <CheckIcon />,
    title: "Receive your code, copy, done",
    body: "The number is yours for ~20 minutes (or rent for hours/days). The code lands in your dashboard the moment SMS arrives.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="page section">
      <div className="section-head reveal">
        <div className="left">
          <div className="eyebrow">How it works</div>
          <h2 className="h2">
            Three steps. <span className="italic-green">No paperwork.</span>
          </h2>
          <p className="body" style={{ marginTop: 14 }}>
            Buy a temporary number, receive the code, get on with your day. The
            product is anonymity. The price is fair.
          </p>
        </div>
      </div>

      <div className="steps stagger">
        {STEPS.map((s) => (
          <div key={s.num} className="step">
            <div className="num">{s.num}</div>
            <div className="ico-sq">{s.icon}</div>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

const SERVICES_GRID = [
  ...POPULAR_SERVICES,
  { slug: "_more", abbr: "+", name: "5,000+ more", fromCents: 5 },
];

function ServicesGrid() {
  return (
    <section id="services" className="page section alt">
      <div className="section-head reveal">
        <div className="left">
          <div className="eyebrow">Services</div>
          <h2 className="h2">
            Verify any service that{" "}
            <span className="italic-green">takes a number.</span>
          </h2>
          <p className="body" style={{ marginTop: 14 }}>
            From mainstream apps to crypto exchanges, dating sites, and ride-share
            platforms. Prices below are starting points — actual price depends on
            country and current upstream supply.
          </p>
        </div>
      </div>

      <div className="svc-grid stagger">
        {SERVICES_GRID.map((s) => (
          <div key={s.name} className="svc-tile">
            <BrandLogo slug={s.slug} abbr={s.abbr} size={36} />
            <div className="flex-1">
              <div className="nm">{s.name}</div>
              <div className="pr">from ${(s.fromCents / 100).toFixed(2)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="page section">
      <div className="section-head reveal">
        <div className="left">
          <div className="eyebrow">Pricing</div>
          <h2 className="h2">
            Pay-as-you-go. <span className="italic-green">No minimums.</span>
          </h2>
          <p className="body" style={{ marginTop: 14 }}>
            Top up your wallet with crypto, then deduct per activation or rental.
            Real-time wholesale pricing, transparent markup.
          </p>
        </div>
      </div>

      <div className="pricing-grid stagger">
        <div className="price-card">
          <span className="tag">Activation</span>
          <div className="svc">Pay per number</div>
          <div className="price">
            $0.05<small>from, one-time use</small>
          </div>
          <ul className="feats">
            <li>Auto-cancel + refund if no SMS arrives</li>
            <li>5,000+ services covered</li>
            <li>180+ countries</li>
          </ul>
        </div>

        <div className="price-card featured">
          <span className="pop">Most flexible</span>
          <span className="tag">Rental</span>
          <div className="svc">Keep your number</div>
          <div className="price">
            $1+<small>per hour, day, or week</small>
          </div>
          <ul className="feats">
            <li>Unlimited inbound SMS</li>
            <li>Auto-renewable</li>
            <li>US, UK, EU coverage</li>
          </ul>
        </div>

        <div className="price-card">
          <span className="tag">Volume</span>
          <div className="svc">API access</div>
          <div className="price">
            API<small>bulk pricing · Phase 3</small>
          </div>
          <ul className="feats">
            <li>REST API + webhooks</li>
            <li>Negotiated markup tiers</li>
            <li>Contact us</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: "Do I need to verify my identity?",
    a: "No. Email and password — that's the entire onboarding. We don't ask for ID, address, or anything beyond an email we use for receipts and password reset.",
  },
  {
    q: "How do I pay?",
    a: "Naira or crypto. Pay in NGN with card, bank transfer, or pay-with-bank, or pay in USDT, USDC, BTC, ETH, and 200+ other coins. You top up your wallet first, then deduct per number you buy. We never charge your wallet directly per purchase.",
  },
  {
    q: "Where do the numbers come from?",
    a: "We work with a network of established OTP providers. We don't own the underlying SIMs ourselves — we aggregate inventory so you get broad coverage and competitive pricing without us having to operate SIM farms.",
  },
  {
    q: "What if I don't receive my SMS?",
    a: "Cancel within ~2 minutes and you get a full automatic refund to your wallet. After that, the number is yours for the rest of its 20-minute window. No SMS in 20 minutes — auto-cancelled, auto-refunded.",
  },
  {
    q: "Is this legal?",
    a: "Receiving SMS verifications via temporary numbers is legal in most jurisdictions. Some target services (Google, WhatsApp, Meta) prohibit using temp numbers in their ToS. You're responsible for compliance with the services you're verifying with.",
  },
  {
    q: "Do you log activity?",
    a: "We log what we have to: wallet transactions (for the ledger), order history (so you can see your numbers), received SMS (so we can deliver them to you). We don't log IP addresses beyond standard anti-abuse retention. We never have your real-world identity, so there's nothing to subpoena.",
  },
];

function Faq() {
  return (
    <section id="faq" className="page section alt">
      <div className="section-head reveal">
        <div className="left">
          <div className="eyebrow">FAQ</div>
          <h2 className="h2">
            Questions, <span className="italic-green">answered honestly.</span>
          </h2>
        </div>
      </div>

      <FaqAccordion items={FAQ_ITEMS} />
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page site-footer-inner">
        <div className="flex flex-col gap-3 max-w-md">
          <Link className="logo" href="/">
            <span className="mark">v.</span>
            <span>
              veridigits<span className="dot">.</span>
            </span>
          </Link>
          <p className="caption">
            Anonymity-first SMS verification. Top up with crypto, receive codes,
            move on with your day.
          </p>
        </div>

        <div className="footer-cols">
          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              Product
            </div>
            <ul className="footer-list">
              <li>
                <a href="#how">How it works</a>
              </li>
              <li>
                <a href="#services">Services</a>
              </li>
              <li>
                <a href="#pricing">Pricing</a>
              </li>
              <li>
                <a href="#faq">FAQ</a>
              </li>
            </ul>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              Account
            </div>
            <ul className="footer-list">
              <li>
                <Link href="/signup">Create account</Link>
              </li>
              <li>
                <Link href="/login">Sign in</Link>
              </li>
            </ul>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              Legal
            </div>
            <ul className="footer-list">
              <li>
                <a href="/legal/terms">Terms</a>
              </li>
              <li>
                <a href="/legal/privacy">Privacy</a>
              </li>
              <li>
                <a href="/legal/aup">Acceptable use</a>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="page site-footer-bottom">
        <span className="caption">
          © {new Date().getFullYear()} Veridigits. All rights reserved.
        </span>
        <span className="caption mono">v0.1.0</span>
      </div>
    </footer>
  );
}
