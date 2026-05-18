import { ProviderOutOfStockError, ProviderApiError } from "./types";

/**
 * Maps an upstream provider error into a user-safe (code, message) pair.
 *
 * Raw `ProviderApiError.message` and the underlying URL paths can name
 * the upstream and reveal request shape — CLAUDE.md says upstreams stay
 * internal, so we never bubble those strings to the client. Server logs
 * still get the full detail via the `where` argument so we can debug in
 * Vercel without grepping the browser console.
 */
export function sanitizeProviderError(
  err: unknown,
  where: string,
): { code: "out_of_stock" | "internal"; message: string } {
  // Out-of-stock from the provider abstraction is the only error class we
  // expose with a user-meaningful message. Even here, we don't echo the
  // raw upstream string — it can contain the provider slug.
  if (err instanceof ProviderOutOfStockError) {
    return {
      code: "out_of_stock",
      message: "Out of stock — try a different country or service.",
    };
  }

  if (err instanceof ProviderApiError) {
    // Log full detail server-side so operators can see WHY it failed.
    console.error(`[provider] ${where}:`, {
      slug: err.providerSlug,
      status: err.statusCode,
      message: err.message,
    });

    // "balance" / "credit" / "funds" in the upstream message means our own
    // wholesale balance with the upstream is depleted. To the user this is
    // indistinguishable from being out of stock — same UX, different ops
    // cause (top up the upstream account).
    if (/balance|credit|funds|payment required/i.test(err.message)) {
      return {
        code: "out_of_stock",
        message: "Number temporarily unavailable. Try a different country.",
      };
    }

    return {
      code: "internal",
      message: "Couldn't reach our network. Try again in a moment.",
    };
  }

  // Unknown error class — log the stack, return a generic message.
  console.error(`[provider] ${where} (unknown error class):`, err);
  return {
    code: "internal",
    message: "Something went wrong. Try again.",
  };
}
