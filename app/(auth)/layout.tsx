import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

const PROOF = [
  "No KYC — just an email and a password",
  "Top up with crypto or Naira",
  "5,000+ services across 180+ countries",
  "Auto-refund if your code never arrives",
];

const BRAND_CHIPS = ["telegram", "whatsapp", "google", "discord", "tiktok"];

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-split">
      {/* Brand panel — the "image" half on web; hidden on mobile. */}
      <aside className="auth-brand">
        <div className="auth-brand-glow" aria-hidden />
        <div className="auth-brand-grid" aria-hidden />

        <Link href="/" className="logo auth-brand-logo">
          <span className="mark">v.</span>
          <span>
            veridigits<span className="dot">.</span>
          </span>
        </Link>

        <div className="auth-brand-body">
          <h2 className="auth-brand-h">
            Receive SMS
            <br />
            without the trace.
          </h2>
          <ul className="auth-proof">
            {PROOF.map((p) => (
              <li key={p}>
                <span className="auth-proof-tick" aria-hidden>
                  ✓
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        <div className="auth-brand-chips" aria-hidden>
          {BRAND_CHIPS.map((slug) => (
            <BrandLogo
              key={slug}
              slug={slug}
              size={40}
              radius={12}
              className="auth-chip"
            />
          ))}
        </div>
      </aside>

      {/* Form half. */}
      <section className="auth-form-col">
        <div className="auth-form-wrap">
          <Link href="/" className="logo auth-mobile-logo">
            <span className="mark">v.</span>
            <span>
              veridigits<span className="dot">.</span>
            </span>
          </Link>
          {children}
        </div>
      </section>
    </div>
  );
}
