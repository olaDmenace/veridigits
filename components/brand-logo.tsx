import { getBrand } from "@/lib/services/brand-svgs";

/**
 * Renders a brand's official logo inside a circular chip.
 *
 * If the slug isn't in BRANDS, falls back to a colored chip with a
 * 2-character abbreviation — same look as the old svc-ico tiles, so
 * the rendering remains consistent for unmapped services.
 */
export function BrandLogo({
  slug,
  abbr,
  fallbackBg,
  size = 36,
  radius = 8,
  className,
}: {
  slug: string;
  abbr?: string;
  fallbackBg?: string;
  size?: number;
  radius?: number;
  className?: string;
}) {
  const brand = getBrand(slug);
  const inner = Math.round(size * 0.58);

  if (brand) {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: brand.bg,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
        aria-hidden
      >
        <svg
          width={inner}
          height={inner}
          viewBox="0 0 24 24"
          fill={brand.fg}
          role="img"
          aria-label={slug}
        >
          <path d={brand.d} />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: fallbackBg ?? "var(--color-ink)",
        color: "#fff",
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        fontSize: Math.round(size * 0.34),
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: ".02em",
      }}
      aria-hidden
    >
      {abbr ?? slug.slice(0, 2)}
    </div>
  );
}
