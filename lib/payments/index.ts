import { NowPaymentsProcessor } from "./nowpayments";
import type { CryptoProcessor, CryptoProcessorSlug } from "./types";

export * from "./types";

const cache = new Map<CryptoProcessorSlug, CryptoProcessor>();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

export function getProcessor(slug: CryptoProcessorSlug): CryptoProcessor {
  const cached = cache.get(slug);
  if (cached) return cached;

  let processor: CryptoProcessor;
  switch (slug) {
    case "nowpayments":
      processor = new NowPaymentsProcessor(
        requireEnv("NOWPAYMENTS_API_KEY"),
        requireEnv("NOWPAYMENTS_IPN_SECRET"),
      );
      break;
    case "cryptomus":
      throw new Error("cryptomus processor not implemented (Phase 2)");
    default:
      throw new Error(`unknown processor: ${slug satisfies never}`);
  }

  cache.set(slug, processor);
  return processor;
}
