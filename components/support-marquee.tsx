/**
 * Lime support announcement marquee at the very top of every page. Continuous,
 * slow horizontal scroll (mature, not busy), pauses on hover, honors
 * reduced-motion. The whole bar deep-links to WhatsApp support (same number as
 * the floating button) when configured.
 */
const SUPPORT_MESSAGE =
  "Running into an issue or have a question? Chat our support team — we're here to help.";

function ChatGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" />
    </svg>
  );
}

export function SupportMarquee() {
  const raw = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "";
  const number = raw.replace(/[^0-9]/g, "");
  const href = number
    ? `https://wa.me/${number}?text=${encodeURIComponent("Hi Veridigits, I need a hand with...")}`
    : undefined;

  // Two identical groups so the -50% scroll loops seamlessly.
  const group = (
    <div className="support-marquee-group">
      {Array.from({ length: 3 }).map((_, i) => (
        <span className="support-marquee-item" key={i}>
          <ChatGlyph />
          <span>{SUPPORT_MESSAGE}</span>
          <span className="support-marquee-dot" aria-hidden="true" />
        </span>
      ))}
    </div>
  );

  const track = (
    <div className="support-marquee-track" aria-hidden="true">
      {group}
      {group}
    </div>
  );

  // Fixed bar (pinned to the very top, above the navbar) + a flow spacer that
  // reserves its height so page content / the sticky navbar start beneath it.
  return (
    <>
      <div className="support-marquee" role="region" aria-label="Support announcement">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="support-marquee-link"
            aria-label={`${SUPPORT_MESSAGE} Chat support on WhatsApp.`}
          >
            {track}
          </a>
        ) : (
          track
        )}
      </div>
      <div className="support-marquee-spacer" aria-hidden="true" />
    </>
  );
}
