import Link from "next/link";

export const metadata = {
  title: "Not found · Veridigits",
};

export default function NotFound() {
  return (
    <div className="theme-dark">
      <header className="topbar">
        <div className="page topbar-inner">
          <Link className="logo" href="/">
            <span className="mark">v.</span>
            <span>
              veridigits<span className="dot">.</span>
            </span>
          </Link>
          <div className="topbar-actions">
            <Link href="/login" className="btn btn-secondary btn-sm">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="page section">
        <div
          className="card flex flex-col items-center gap-5 text-center"
          style={{ padding: 56, maxWidth: 560, margin: "0 auto" }}
        >
          <div className="eyebrow mono">404 · not found</div>
          <h1 className="h2">This page doesn&apos;t exist.</h1>
          <p className="body" style={{ maxWidth: 420 }}>
            You may have followed an outdated link, or the page was moved. The
            rest of Veridigits is still here.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/" className="btn btn-primary">
              <span className="dot"></span>
              Back to home
            </Link>
            <Link href="/dashboard" className="btn btn-secondary">
              My dashboard
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
