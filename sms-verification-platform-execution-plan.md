# SMS Verification Platform — Execution Plan

> **Brand:** Veridigits

---

## 0. The honest business reality (read first, get client buy-in)

This space operates differently from mainstream telecom SaaS. Surface this with the client before signing scope:

1. **Mainstream telecom providers are off-limits.** Twilio, Telnyx, Plivo, Bandwidth all detect and terminate accounts running OTP-receive resale. You'll be reselling from established OTP aggregators (5SIM, SMSPool, SMS-MAN, HeroSMS, Daisy SMS). They source from SIM farms.
2. **Crypto-first payments.** Stripe, PayPal, Paystack, Flutterwave all classify this as high-risk and will terminate. Card payments require specialized high-risk merchant accounts at 5–10% fees and frequent rolling reserves. The industry norm is USDT/USDC via NOWPayments, Cryptomus, or Coinbase Commerce.
3. **No KYC by design.** Anonymity is the product. Email + password (or no email at all — just a wallet token) is the standard onboarding.
4. **Grey market.** Not illegal in most jurisdictions, but several target services (Google, WhatsApp, Meta) prohibit using temp numbers in their ToS. The platform itself isn't liable for what users do, but reputational/processor risk is real.
5. **You're a thin margin layer.** Upstream sets the floor price; you mark up 20–60%. Differentiation is on UX, reliability, breadth of service/country coverage, and uptime — not on having something proprietary.

The client should accept points 1–4 in writing before you build anything.

---

## 1. Business model

**Revenue model:** Wallet top-up + per-purchase deduction. Standard in the industry — competing on subscription tiers does not work here because volume is bursty.

**Two product modes** (build both, the API differs):

| Mode | Description | Price range | Use case |
|---|---|---|---|
| **Activation** | One-time use, ~20 min validity, expires after first SMS | $0.05 – $5.00 | Account signups |
| **Rental** | Number rented for hours/days/weeks, receives unlimited SMS | $1 – $50+ | Ongoing 2FA, longer-term accounts |

**Markup logic:**
- Pull live wholesale price from upstream (5SIM API, etc.)
- Apply markup: `retail = wholesale × (1 + markup_pct) + flat_fee`
- Default: 30% markup + $0.01 floor
- Per-service overrides (e.g., higher markup on premium services like Telegram, lower on commodity ones)

**Unit economics example:**
- 5SIM Telegram US number wholesale: $0.50
- Your retail: $0.65 (30% markup)
- Your gross margin: $0.15 per activation
- Crypto processing fee (NOWPayments): 0.5% on top-up only, not per-purchase
- Realistic monthly target at MVP: 2,000 successful activations × $0.15 avg = $300 gross, scaling from there

The business is volume-dependent. You need either SEO + paid traffic from day one, or you need to reach a specific niche.

---

## 2. Upstream OTP providers

Pick 2–3 to launch. Aggregating multiple = better inventory + price arbitrage + redundancy.

### Tier 1 (must integrate at MVP)

**5SIM.net**
- Largest inventory, 180+ countries
- Mature REST API with JWT auth
- Wholesale discounts at scale
- Pricing starts ~$0.014/number
- Both activation and rental modes
- Good docs at `5sim.net/docs`
- **Use as primary**

**SMSPool**
- Non-VoIP (real SIM-backed) numbers — passes Google/WhatsApp checks
- Smaller inventory than 5SIM but higher quality
- Premium pricing
- API documented at `smspool.net`
- **Use as fallback for high-quality services**

### Tier 2 (add in phase 2)

- **SMS-MAN** — solid for crypto exchanges (Bitget, Coinbase niche)
- **HeroSMS** — good API, good developer community
- **Daisy SMS** — US/Canada heavy
- **PVAPins** — strong on Telegram, WhatsApp, TikTok

### What NOT to use
- ❌ Twilio, Telnyx, Plivo, Vonage, Bandwidth (will terminate)
- ❌ Free public-inbox sites (these get burned constantly, useless for paid product)
- ❌ TextVerified for resale (their ToS doesn't allow it)

---

## 3. Tech stack

Aligned with your existing toolkit so this is fast to ship.

**Frontend**
- Next.js 14+ App Router
- TypeScript
- Tailwind + shadcn/ui
- Server Components for marketing/static pages, Client Components for the dashboard (real-time SMS view, wallet, purchase flow)

**Database & Auth**
- Supabase (Postgres + Auth + Realtime + Storage)
- Use Supabase Auth with email/password only — skip social logins (anonymity is the product)
- Row-Level Security policies on every table

**Real-time SMS delivery to user**
- Supabase Realtime channels — subscribe to `received_messages` table changes for the user's active orders
- Fallback: Server-Sent Events from a Next.js route handler

**Background jobs**
- **Inngest** for scheduled and event-driven jobs:
  - Polling upstream for received SMS (every 3–5s for active orders)
  - Order expiry/auto-cancel
  - Daily price/inventory sync from upstream providers
  - Wallet reconciliation
- Self-hosted alternative: BullMQ + Redis on your Hostinger VPS, but Inngest is far less work

**Hosting**
- Vercel for the Next.js app
- Hostinger VPS for: optional Redis/BullMQ, optional rate-limit cache, Cron for upstream price/inventory pulls if not using Inngest

**Crypto payments**
- **NOWPayments** (primary) — easy integration, supports 200+ coins, 0.5% fee, IPN webhooks
- **Cryptomus** (secondary/backup) — popular in this space, supports Tron heavily, 0.4–1% fee
- Both: top-up to wallet model, never per-purchase

**Optional card payments (phase 3)**
- High-risk merchant accounts: PaymentCloud, Soar Payments, or Corepay
- Fees: 4.95–9.95% + monthly minimums
- Expect rolling reserves of 5–10%
- Skip until volume justifies the operational overhead

**Supporting**
- Email: Resend (transactional only — receipts, password reset)
- Error tracking: Sentry
- Analytics: PostHog (self-hosted on Hostinger VPS for full privacy)
- Status page: BetterStack

---

## 4. Compliance, abuse, and platform risk

The compliance picture is light, but platform risk is heavy. Plan for it.

**What you don't need:**
- KYC on users
- A2P 10DLC (you're not sending SMS)
- TCR registration
- Telecom-class fraud detection
- US business entity (most operators run from non-US jurisdictions)

**What you do need:**

1. **Terms of Service that put the user on the hook for use case.** Lawyer-reviewed. Standard pattern: "you agree numbers are for legitimate use, you accept all responsibility for compliance with target service ToS, no fraudulent or illegal use."

2. **Abuse detection at the platform level.** Even though your users are anonymous, you can detect:
   - Single user buying >100 numbers/day (suggests automation/scraping)
   - Same crypto wallet funding many accounts
   - Rapid-fire repeat purchases of the same service/country (suggests credential stuffing)
   - Block these or rate-limit them aggressively. Upstream will throttle you if your "ban rate" gets too high.

3. **Hosting in a friendly jurisdiction.** Vercel will likely host this without issue (it's just a web app to them). If they push back, fall back to Hostinger VPS or a Cloudflare-fronted setup.

4. **Domain registrar with no questions asked.** Namecheap, Porkbun. Not GoDaddy.

5. **Cloudflare in front of everything** — DDoS mitigation, WAF, Turnstile (CAPTCHA replacement) on signup and top-up flows.

6. **Operational opsec for the client.** Don't put a real personal name on WHOIS. Use Cloudflare Registrar (free WHOIS privacy) or Njalla.

---

## 5. Cost baseline (monthly)

| Item | Cost |
|---|---|
| Vercel Pro | $20 |
| Supabase Pro | $25 |
| Inngest | $0–20 |
| Resend | $20 |
| Sentry | $0–26 |
| BetterStack | $29 |
| Cloudflare Pro (recommended) | $20 |
| PostHog (self-host on VPS) | $0 |
| Domain (.com via Cloudflare/Porkbun) | ~$1/mo |
| Hostinger VPS (already paid) | $0 |
| **Fixed monthly OpEx** | **~$135–165** |

Variable costs:
- NOWPayments: 0.5% on top-ups (no monthly minimum)
- Upstream OTP providers: pay-as-you-go from float
- Lawyer (one-time ToS/Privacy/AUP review): $300–800

**Working capital needed:** $500–2000 to pre-fund accounts at 5SIM/SMSPool. You buy from them in bulk, sell to end users with markup, and replenish.

---

## 6. Build phases

### Phase 1 — MVP (4–6 weeks for a senior dev)
- Landing page + auth (email/password)
- Wallet system (USD-denominated balance)
- NOWPayments integration (USDT/USDC top-up only at first)
- 5SIM integration (single upstream)
- Service/country browse + buy flow
- Real-time SMS receive view
- Order history
- Cancel/finish flow
- Admin panel (basic): manual user lookup, balance adjustment, order force-cancel
- ToS, Privacy, abuse policy live

### Phase 2 — Production hardening (3–4 weeks)
- Add SMSPool as second upstream + provider abstraction layer fully in use
- Cryptomus as backup payment processor
- Rental mode (multi-SMS over time window)
- Pricing rules engine (per-service markup overrides)
- Abuse detection: rate limits, wallet velocity checks, ban-rate monitoring against upstream
- Cloudflare Turnstile on signup + top-up
- BetterStack status page live
- Affiliate/referral system (huge in this space — 10–15% lifetime commission is standard)

### Phase 3 — Growth & differentiation (ongoing)
- Add SMS-MAN, HeroSMS, Daisy as additional upstreams
- API for power users (B2B reseller tier)
- Telegram bot for purchase flow (massive in this space)
- High-risk card processing
- Mobile apps if traction warrants
- Mention to client: virtual business numbers product as a separate brand later

---

## 7. Risks specific to this space

1. **Upstream price/inventory volatility.** Wholesale prices change hourly. Cache aggressively but refresh on every purchase attempt — never let a user pay a stale price.
2. **Upstream account suspension.** If your "cancel rate" or "ban rate" gets too high (you're cancelling more numbers than you complete, signal of abuse), 5SIM will throttle or suspend you. Solution: don't auto-cancel without paying close attention; build dashboards to monitor your provider account health.
3. **Crypto payment volatility.** Convert to USDC/USDT immediately on receipt — don't hold BTC/ETH price exposure.
4. **Phishing/scams targeting your users.** Common pattern: scammers register on your platform claiming to be support, message users via your channels. Defense: clear "we never DM you" messaging + locked customer support to one channel.
5. **DDoS.** Common in this space (competitors do it, abusers do it). Cloudflare Pro is non-negotiable.
6. **Wallet drain attacks.** If your purchase flow has a race condition, attackers will burn the wallet. Use database-level locks (`SELECT ... FOR UPDATE`) on wallet operations.
7. **Reputation/SEO challenges.** Hard to rank organically since search engines treat the niche cautiously. Plan for community building (Reddit, Telegram, Discord), affiliate partnerships, and direct paid traffic.

---

## 8. First-week action list (for the client)

1. Confirm name + buy domain (Cloudflare Registrar or Porkbun)
2. Sign up at 5SIM and SMSPool, deposit $100 each, manually buy a few test numbers to feel the API surface
3. Sign up at NOWPayments — this is the long pole, KYB review takes 3–7 days (they actually do KYC merchants even though merchants don't KYC end users)
4. Set up Cloudflare account, point domain
5. Provision Supabase project, Vercel project
6. Get a lawyer to review the ToS template — they'll likely add disclaimer language about user responsibility
7. Buy a Hostinger VPS (you have one) — set up Cloudflare Tunnel for any backend services
8. Hand the technical-handover doc to the dev team / Claude Code

---

## 9. What I'd watch out for as the agency delivering this

- **Get paid in milestones.** Don't carry float for the client. Phase 1 deliverable, money. Phase 2, money.
- **No revenue share unless the equity terms are real.** Lots of clients in this space pitch "you build it, we'll split revenue" — politely no.
- **Hosting & accounts in client's name from day one.** You don't want NOWPayments, 5SIM, Vercel accounts in your name when this goes live.
- **Indemnification clause in your contract.** If their users do something illegal, that's not on you.
- **Document everything with the client in writing.** Especially the legal/grey-area acknowledgment.
