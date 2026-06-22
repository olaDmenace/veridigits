/**
 * Shared, non-server constants for the /buy flow.
 *
 * MUST NOT have a "use server" directive. Server actions files can only
 * export async functions — anything else (objects, arrays) is stripped at
 * the client boundary and resolves to `undefined` on the client side.
 * Keep all client-readable buy-flow constants in this file.
 */

export type OrderMode = "activation" | "rental";

export const RENTAL_DURATIONS: ReadonlyArray<{
  hours: number;
  label: string;
  multiplier: number;
}> = [
  { hours: 4, label: "4 hours", multiplier: 4 },
  { hours: 24, label: "1 day", multiplier: 15 },
  { hours: 72, label: "3 days", multiplier: 35 },
  { hours: 168, label: "1 week", multiplier: 70 },
  { hours: 720, label: "30 days", multiplier: 200 },
];

/**
 * Picks the multiplier for the smallest rental tier that covers the
 * requested duration. If a duration is longer than every tier, falls
 * back to the largest tier.
 */
export function rentalMultiplier(hours: number): number {
  const tier = RENTAL_DURATIONS.find((d) => d.hours >= hours);
  return (tier ?? RENTAL_DURATIONS[RENTAL_DURATIONS.length - 1]).multiplier;
}

/**
 * SMSPool rental day-tiers by canonical country iso (shared `countries.iso_code`).
 * Client-safe mirror of `SMSPOOL_RENTALS` in lib/providers/smspool.ts (the source
 * of truth) so the picker can show the real, country-specific durations without a
 * server round-trip. Rentals exist only for these countries; keep in sync.
 */
export const RENTAL_TIERS_BY_ISO: Record<string, number[]> = {
  usa: [1, 7, 28],
  england: [30, 180, 360],
  canada: [30],
};

export interface RentalDurationOption {
  hours: number;
  days: number;
  label: string;
}

/** Rental duration options for a country, or [] when rentals aren't offered there. */
export function rentalDurationsForIso(
  iso: string | null | undefined,
): RentalDurationOption[] {
  const tiers = (iso && RENTAL_TIERS_BY_ISO[iso]) || [];
  return tiers.map((days) => ({
    hours: days * 24,
    days,
    label: days === 1 ? "1 day" : `${days} days`,
  }));
}
