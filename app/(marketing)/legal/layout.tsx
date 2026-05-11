import Link from "next/link";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="topbar">
        <div className="page topbar-inner">
          <Link className="logo" href="/">
            <span className="mark">v.</span>
            <span>
              veridigits<span className="dot">.</span>
            </span>
          </Link>
          <nav>
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/aup">Acceptable use</Link>
          </nav>
          <span className="meta">
            <Link href="/login">Sign in</Link>
          </span>
        </div>
      </header>

      <main className="page section legal-prose">{children}</main>
    </>
  );
}
