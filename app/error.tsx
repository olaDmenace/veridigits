"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Per-segment error boundary. Renders inside the root layout, so the
 * topbar / chrome show on either side. Catches anything thrown during
 * rendering of routes under app/.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Future: pipe to Sentry. For now, surface in the browser console.
    console.error("app error boundary:", error);
  }, [error]);

  return (
    <div className="theme-dark">
      <main className="page section">
        <div
          className="card flex flex-col items-center gap-5 text-center"
          style={{ padding: 56, maxWidth: 560, margin: "0 auto" }}
        >
        <div
          className="eyebrow mono"
          style={{ color: "var(--color-danger)" }}
        >
          something broke
        </div>
        <h1 className="h2">We hit a snag loading this page.</h1>
        <p className="body" style={{ maxWidth: 420 }}>
          The team has been pinged. Try again — most of the time it&apos;s a
          one-off blip.
        </p>
        {error.digest ? (
          <p
            className="caption mono"
            style={{ opacity: 0.6, wordBreak: "break-all" }}
          >
            ref: {error.digest}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3 justify-center">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => reset()}
          >
            <span className="dot"></span>
            Try again
          </button>
          <Link href="/" className="btn btn-secondary">
            Back to home
          </Link>
        </div>
        </div>
      </main>
    </div>
  );
}
