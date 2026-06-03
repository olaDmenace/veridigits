import Link from "next/link";
import { MobileMenu } from "./mobile-menu";

export interface TopbarLink {
  href: string;
  label: string;
  /** Use a plain <a> instead of <Link> (e.g. for in-page anchors). */
  anchor?: boolean;
}

/**
 * Shared topbar shell. Renders inline nav + actions on desktop; on mobile,
 * the same links + actions appear in a hamburger-triggered drawer
 * (see components/mobile-menu.tsx).
 *
 * `primary` and `meta` accept JSX so callers can pass server-action forms,
 * balance pills, etc. The MobileMenu client component receives them as
 * children and renders them in the drawer; this works because React lets
 * server-action forms cross the server→client boundary as serialized props.
 */
export function Topbar({
  links,
  primary,
  meta,
  brandHref = "/",
  brandLabel,
  hideMobileMenu = false,
}: {
  links: TopbarLink[];
  primary?: React.ReactNode;
  meta?: React.ReactNode;
  brandHref?: string;
  brandLabel?: string;
  /**
   * Drop the mobile hamburger drawer and keep the primary action visible at
   * all widths instead. Used on the public landing page, where the only
   * mobile affordance an unauthed visitor needs is the Sign in button.
   */
  hideMobileMenu?: boolean;
}) {
  return (
    <header className="topbar">
      <div className="page topbar-inner">
        <Link className="logo" href={brandHref}>
          <span className="mark">v.</span>
          <span>
            veridigits<span className="dot">.</span>
          </span>
          {brandLabel ? (
            <span className="meta" style={{ marginLeft: 12 }}>
              {brandLabel}
            </span>
          ) : null}
        </Link>

        <nav className="topbar-nav">
          {links.map((l) =>
            l.anchor ? (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ) : (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ),
          )}
        </nav>

        <div className={`topbar-actions${hideMobileMenu ? " always-visible" : ""}`}>
          {meta}
          {primary}
        </div>

        {hideMobileMenu ? null : (
          <MobileMenu links={links} primary={primary} meta={meta} />
        )}
      </div>
    </header>
  );
}
