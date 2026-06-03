import { FiveSimProvider } from "./5sim";
import { SmsPoolProvider } from "./smspool";
import { TextVerifiedProvider } from "./textverified";
import type { OtpProvider } from "./types";

export * from "./types";
export { buyCheapestActivation } from "./registry";
export type { ProviderCandidate } from "./registry";

/**
 * Lazily-instantiated providers, keyed by slug.
 *
 * Each provider reads its API key from env on first use. Throws if the key
 * is missing — callers shouldn't construct providers for a slug they don't
 * have credentials for.
 */
const cache = new Map<string, OtpProvider>();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

export function getProvider(slug: string): OtpProvider {
  const cached = cache.get(slug);
  if (cached) return cached;

  let provider: OtpProvider;
  switch (slug) {
    case "5sim":
      provider = new FiveSimProvider(requireEnv("FIVESIM_API_KEY"));
      break;
    case "smspool":
      provider = new SmsPoolProvider(requireEnv("SMSPOOL_API_KEY"));
      break;
    case "textverified":
      provider = new TextVerifiedProvider(
        requireEnv("TEXTVERIFIED_API_KEY"),
        requireEnv("TEXTVERIFIED_API_USERNAME"),
      );
      break;
    default:
      throw new Error(`unknown provider slug: ${slug}`);
  }

  cache.set(slug, provider);
  return provider;
}
