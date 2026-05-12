/**
 * Single source of truth for the app's public origin.
 *
 * Reads NEXT_PUBLIC_APP_URL and normalizes:
 *   - missing → "http://localhost:3000"
 *   - missing scheme → prepends "https://"
 *   - trailing slash → stripped
 *   - completely invalid → falls back to localhost rather than throwing
 *
 * Use this everywhere instead of `process.env.NEXT_PUBLIC_APP_URL` so a
 * misconfigured env var doesn't crash the build (which `new URL(...)`
 * does in app/layout.tsx's metadataBase).
 */
export function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return "http://localhost:3000";

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const stripped = withScheme.replace(/\/+$/, "");

  try {
    return new URL(stripped).origin;
  } catch {
    return "http://localhost:3000";
  }
}
