"use client";

import { useEffect } from "react";

/**
 * Root-level error boundary. Used when the error happens in the root
 * layout itself (e.g. fonts fail to load, metadata throws). Renders its
 * own <html>/<body> because we can't rely on the broken layout.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("global error boundary:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 24,
          background: "#FAF8F3",
          color: "#14110C",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "#FFFFFF",
            border: "1px solid #E2DED2",
            borderRadius: 14,
            padding: 40,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 20,
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                background: "#14110C",
                color: "#00C46A",
                borderRadius: 6,
                fontFamily: "ui-monospace, monospace",
                fontWeight: 600,
                fontSize: 13,
                display: "grid",
                placeItems: "center",
              }}
            >
              v.
            </span>
            <span style={{ fontSize: 19, fontWeight: 600 }}>
              veridigits<span style={{ color: "#00C46A" }}>.</span>
            </span>
          </div>
          <div
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              color: "#D43F3F",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            critical error
          </div>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>
            Something went badly wrong.
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 15,
              lineHeight: 1.55,
              color: "#3A3630",
            }}
          >
            The application failed to load. Try again, or come back in a
            minute.
          </p>
          {error.digest ? (
            <p
              style={{
                margin: 0,
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                color: "#9A9388",
                wordBreak: "break-all",
              }}
            >
              ref: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "12px 20px",
              fontSize: 14,
              fontWeight: 500,
              background: "#14110C",
              color: "#FAF8F3",
              border: 0,
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
