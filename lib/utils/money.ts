/**
 * Formats a USD-cents integer as a human-readable dollar amount.
 *   123      -> "$1.23"
 *   1500     -> "$15.00"
 *   0        -> "$0.00"
 *   -250     -> "-$2.50"
 */
export function formatUsdCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

/** Splits cents into the parts the .wallet design component expects. */
export function splitUsdCents(cents: number): {
  sign: string;
  dollars: string;
  cents: string;
} {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return {
    sign,
    dollars: Math.floor(abs / 100).toLocaleString("en-US"),
    cents: (abs % 100).toString().padStart(2, "0"),
  };
}
