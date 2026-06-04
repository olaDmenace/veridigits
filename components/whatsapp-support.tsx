/**
 * Floating "Chat with us" support button → WhatsApp click-to-chat (wa.me).
 *
 * Deliberately NOT the WhatsApp Business API: that rides on banned CPaaS BSPs
 * (Twilio/Vonage) or Meta direct (business verification, use-case risk). This
 * is a plain deep link — zero integration, zero account-termination risk. The
 * agent answers from a normal WhatsApp / WhatsApp Business app.
 *
 * Configure via env (no secrets — the support number is public):
 *   NEXT_PUBLIC_SUPPORT_WHATSAPP      e.g. "2348012345678" (E.164 digits)
 *   NEXT_PUBLIC_SUPPORT_WHATSAPP_MSG  optional pre-filled message
 *
 * Renders nothing until the number is set, so it's safe to ship now.
 */
const DEFAULT_MESSAGE = "Hi Veridigits 👋 I need a hand with my account.";

export function WhatsAppSupport() {
  const raw = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "";
  const number = raw.replace(/[^0-9]/g, "");
  if (!number) return null;

  const message = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_MSG ?? DEFAULT_MESSAGE;
  const href = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="wa-fab"
      aria-label="Chat with support on WhatsApp"
    >
      <svg
        className="wa-fab-glyph"
        viewBox="0 0 32 32"
        width="26"
        height="26"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill="currentColor"
          d="M16.003 3.2c-7.06 0-12.8 5.74-12.8 12.8 0 2.257.59 4.46 1.713 6.404L3.2 28.8l6.57-1.72a12.74 12.74 0 0 0 6.233 1.62h.005c7.06 0 12.8-5.74 12.8-12.8 0-3.42-1.332-6.635-3.75-9.052A12.71 12.71 0 0 0 16.003 3.2Zm0 23.04h-.004a10.6 10.6 0 0 1-5.4-1.48l-.387-.23-4.01 1.05 1.07-3.91-.252-.4a10.56 10.56 0 0 1-1.62-5.61c0-5.86 4.77-10.63 10.64-10.63 2.84 0 5.51 1.108 7.52 3.118a10.56 10.56 0 0 1 3.114 7.52c0 5.86-4.77 10.63-10.63 10.63Zm5.83-7.96c-.32-.16-1.89-.93-2.18-1.04-.29-.106-.5-.16-.712.16-.21.32-.816 1.04-1 1.253-.184.213-.37.24-.69.08-.32-.16-1.35-.498-2.57-1.586-.95-.847-1.59-1.893-1.776-2.213-.184-.32-.02-.493.14-.652.144-.143.32-.373.48-.56.16-.186.213-.32.32-.533.107-.214.054-.4-.027-.56-.08-.16-.712-1.716-.976-2.35-.257-.616-.518-.533-.712-.543l-.606-.01c-.213 0-.56.08-.853.4-.293.32-1.12 1.094-1.12 2.667 0 1.573 1.147 3.094 1.307 3.307.16.213 2.257 3.447 5.467 4.834.764.33 1.36.527 1.824.674.767.244 1.464.21 2.016.127.615-.092 1.89-.773 2.156-1.52.266-.746.266-1.386.187-1.52-.08-.133-.293-.213-.613-.373Z"
        />
      </svg>
      <span className="wa-fab-label">Chat with us</span>
    </a>
  );
}
