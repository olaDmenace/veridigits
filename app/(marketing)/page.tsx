import Link from "next/link";
import { Topbar } from "@/components/topbar";

export default function Home() {
  return (
    <>
      <Topbar
        links={[
          { href: "#how", label: "How it works", anchor: true },
          { href: "#services", label: "Services", anchor: true },
          { href: "#pricing", label: "Pricing", anchor: true },
          { href: "#faq", label: "FAQ", anchor: true },
        ]}
        primary={
          <Link href="/login" className="btn btn-secondary btn-sm">
            Sign in
          </Link>
        }
      />

      <main>
        <Hero />
        <HowItWorks />
        <ServicesGrid />
        <Pricing />
        <Faq />
      </main>

      <SiteFooter />
    </>
  );
}

function Hero() {
  return (
    <section className="page hero">
      <div className="hero-grid">
        <div>
          <div className="eyebrow">SMS verification · no KYC</div>
          <h1>
            Receive SMS<br />
            <span className="accent">without the trace.</span>
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
            <a className="btn btn-secondary btn-lg" href="#how">
              How it works
            </a>
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

        <div className="phone-stage">
          <div className="phone">
            <div className="phone-screen">
              <div className="phone-notch"></div>
              <div className="phone-statusbar">
                <span>9:41</span>
                <span className="right">
                  <span>5G</span> <span>●●●●</span>
                </span>
              </div>
              <div className="phone-content">
                <div className="phone-card-active">
                  <div>
                    <div className="label">Active · Telegram · US</div>
                    <div className="code">+1 415 555 0142</div>
                  </div>
                  <div>
                    <div className="timer-lbl">Expires</div>
                    <div className="timer">16s</div>
                  </div>
                </div>

                <div className="msg-list-head">
                  <div className="ttl">Inbox</div>
                  <div className="cnt">04</div>
                </div>

                <div className="sms-row new">
                  <div className="ico svc-tg">tg</div>
                  <div style={{ flex: 1 }}>
                    <div className="top">
                      <span className="name">Telegram</span>
                      <span className="ago">now</span>
                    </div>
                    <div className="body">
                      Login code: <code>503126</code>
                    </div>
                  </div>
                </div>
                <div className="sms-row">
                  <div className="ico svc-wa">wa</div>
                  <div style={{ flex: 1 }}>
                    <div className="top">
                      <span className="name">WhatsApp</span>
                      <span className="ago">2m</span>
                    </div>
                    <div className="body">
                      Your code is <code>847-291</code>. Don&apos;t share.
                    </div>
                  </div>
                </div>
                <div className="sms-row">
                  <div className="ico svc-go">G</div>
                  <div style={{ flex: 1 }}>
                    <div className="top">
                      <span className="name">Google</span>
                      <span className="ago">5m</span>
                    </div>
                    <div className="body">
                      <code>G-928451</code> is your verification code.
                    </div>
                  </div>
                </div>
                <div className="sms-row">
                  <div className="ico svc-tk">tk</div>
                  <div style={{ flex: 1 }}>
                    <div className="top">
                      <span className="name">TikTok</span>
                      <span className="ago">8m</span>
                    </div>
                    <div className="body">
                      <code>6729</code> is your TikTok code.
                    </div>
                  </div>
                </div>

                <div className="receiving">
                  <span className="dots">
                    <i></i>
                    <i></i>
                    <i></i>
                  </span>
                  Receiving SMS…
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    num: "01",
    title: "Top up your wallet",
    body: "Send USDT, USDC, BTC, or any of 200+ coins via NOWPayments. Funds land in your wallet in minutes. No card, no statements.",
  },
  {
    num: "02",
    title: "Pick a service and country",
    body: "Browse 5,000+ services across 180+ countries. We re-quote the wholesale price the moment you click buy — what you see is what you pay.",
  },
  {
    num: "03",
    title: "Receive your code, copy, done",
    body: "The number is yours for ~20 minutes (or rent for hours/days). The code lands in your dashboard the moment SMS arrives.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="page section">
      <div className="section-head">
        <div className="left">
          <div className="eyebrow">How it works</div>
          <h2 className="h2">Three steps. No paperwork.</h2>
          <p className="body" style={{ marginTop: 14 }}>
            Buy a temporary number, receive the code, get on with your day. The
            product is anonymity. The price is fair.
          </p>
        </div>
      </div>

      <div className="how-grid">
        {STEPS.map((s) => (
          <div key={s.num} className="card flex flex-col gap-4">
            <div className="eyebrow mono">{s.num}</div>
            <h3 className="h3">{s.title}</h3>
            <p className="body">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const POPULAR_SERVICES: Array<{
  iconClass: string;
  abbr: string;
  name: string;
  fromCents: number;
}> = [
  { iconClass: "svc-tg", abbr: "tg", name: "Telegram", fromCents: 15 },
  { iconClass: "svc-wa", abbr: "wa", name: "WhatsApp", fromCents: 25 },
  { iconClass: "svc-go", abbr: "G", name: "Google", fromCents: 18 },
  { iconClass: "svc-tk", abbr: "tk", name: "TikTok", fromCents: 22 },
  { iconClass: "svc-di", abbr: "di", name: "Discord", fromCents: 12 },
  { iconClass: "svc-ig", abbr: "ig", name: "Instagram", fromCents: 30 },
  { iconClass: "svc-go", abbr: "fb", name: "Facebook", fromCents: 28 },
  { iconClass: "svc-tg", abbr: "x", name: "X (Twitter)", fromCents: 20 },
  { iconClass: "svc-tk", abbr: "sn", name: "Snapchat", fromCents: 22 },
  { iconClass: "svc-wa", abbr: "ub", name: "Uber", fromCents: 35 },
  { iconClass: "svc-di", abbr: "tn", name: "Tinder", fromCents: 38 },
  { iconClass: "svc-ig", abbr: "+", name: "5,000+ more", fromCents: 5 },
];

function ServicesGrid() {
  return (
    <section id="services" className="page section">
      <div className="section-head">
        <div className="left">
          <div className="eyebrow">Services</div>
          <h2 className="h2">Verify any service that takes a phone number.</h2>
          <p className="body" style={{ marginTop: 14 }}>
            From mainstream apps to crypto exchanges, dating sites, and ride-share
            platforms. Prices below are starting points — actual price depends on
            country and current upstream supply.
          </p>
        </div>
      </div>

      <div className="svc-grid">
        {POPULAR_SERVICES.map((s) => (
          <div key={s.name} className="svc-tile">
            <div className={`ico ${s.iconClass}`}>{s.abbr}</div>
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
      <div className="section-head">
        <div className="left">
          <div className="eyebrow">Pricing</div>
          <h2 className="h2">Pay-as-you-go. No subscriptions, no minimums.</h2>
          <p className="body" style={{ marginTop: 14 }}>
            Top up your wallet with crypto, then deduct per activation or rental.
            Real-time wholesale pricing, transparent markup.
          </p>
        </div>
      </div>

      <div className="pricing-grid">
        <div className="card flex flex-col gap-3">
          <div className="eyebrow">Activation</div>
          <div className="flex items-baseline gap-2">
            <span className="h2 mono">$0.05</span>
            <span className="caption">+ per number</span>
          </div>
          <p className="small">
            One-time use. Number expires after first SMS or 20 minutes,
            whichever comes first. Best for account signups.
          </p>
          <ul className="caption flex flex-col gap-2" style={{ marginTop: 8 }}>
            <li>· Auto-cancel + refund if no SMS arrives</li>
            <li>· 5,000+ services covered</li>
            <li>· 180+ countries</li>
          </ul>
        </div>

        <div className="card flex flex-col gap-3" style={{ borderColor: "var(--color-ink)" }}>
          <div className="eyebrow">Rental</div>
          <div className="flex items-baseline gap-2">
            <span className="h2 mono">$1+</span>
            <span className="caption">/ hour, day, week</span>
          </div>
          <p className="small">
            Keep the same number for hours, days, or weeks. Receives unlimited
            SMS during the rental window. Best for ongoing 2FA.
          </p>
          <ul className="caption flex flex-col gap-2" style={{ marginTop: 8 }}>
            <li>· Unlimited inbound SMS</li>
            <li>· Auto-renewable</li>
            <li>· US, UK, EU coverage</li>
          </ul>
        </div>

        <div className="card flex flex-col gap-3">
          <div className="eyebrow">Volume</div>
          <div className="flex items-baseline gap-2">
            <span className="h2 mono">API</span>
          </div>
          <p className="small">
            B2B reseller tier with a programmatic API and bulk pricing. For teams
            running automation at scale.
          </p>
          <ul className="caption flex flex-col gap-2" style={{ marginTop: 8 }}>
            <li>· REST API + webhooks</li>
            <li>· Negotiated markup tiers</li>
            <li>· Phase 3 — contact us</li>
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
    a: "Crypto only. USDT, USDC, BTC, ETH, and 200+ other coins via NOWPayments. You top up your wallet first, then deduct per number you buy. We never charge your wallet directly per purchase.",
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
    <section id="faq" className="page section">
      <div className="section-head">
        <div className="left">
          <div className="eyebrow">FAQ</div>
          <h2 className="h2">Questions, answered honestly.</h2>
        </div>
      </div>

      <div className="faq-list">
        {FAQ_ITEMS.map((item, i) => (
          <details key={item.q} className="faq-item" open={i === 0}>
            <summary>
              <span className="faq-q">{item.q}</span>
              <span className="faq-toggle" aria-hidden>
                +
              </span>
            </summary>
            <p className="faq-a">{item.a}</p>
          </details>
        ))}
      </div>
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
