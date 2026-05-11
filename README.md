# Veridigits

Anonymity-first SMS verification platform. Users top up a wallet with crypto, buy temporary phone numbers from upstream OTP aggregators (5SIM, SMSPool), and receive verification codes in real time. No KYC, no card payments, no social logins.

The platform is a thin reseller: upstream aggregators own the SIMs, we own the wallet, the markup engine, the abuse detection, and the UX.

## Stack

- **Next.js 16** App Router + React 19, TypeScript strict
- **Tailwind CSS v4** — CSS-first `@theme`, no `tailwind.config.ts`
- **Supabase** — Postgres + Auth + Realtime + RLS on every table
- **Inngest** — cron + event-driven background jobs (catalog sync, per-order SMS polling, wallet reconciliation, abuse detection)
- **NOWPayments** — crypto invoice creation, IPN signature verification (HMAC-SHA512)

## Locked architectural constraints

These exist for product reasons. Read `veridigits-claude-code-handover.md` for the full rationale before changing any of them.

1. **No mainstream CPaaS** (Twilio, Telnyx, Plivo, Bandwidth, Vonage). They terminate accounts on this use case.
2. **No mainstream payment processors** (Stripe, PayPal). Crypto only.
3. **No KYC, no social logins.** Email + password is the entire onboarding.
4. **Wallet-based money flow.** All purchases debit a pre-funded wallet — never charge per purchase.
5. **DB-level locks on wallet operations** via the `wallet_apply` Postgres function (`SELECT ... FOR UPDATE`). Race conditions here will be exploited.
6. **All upstream provider calls go through `lib/providers/`.** Never call 5SIM/SMSPool directly from a route or component.
7. **Cheapest-first provider selection with live re-quote at purchase time.** Cached prices are stale within minutes.

## Project layout

```
app/
  (marketing)/        # / and /legal/*
  (auth)/             # /login, /signup, /forgot-password, /reset-password
  (dashboard)/        # /dashboard, /buy, /orders, /topup, /settings
  (admin)/            # /admin/*
  api/
    inngest/          # background job endpoint
    webhooks/
      nowpayments/    # IPN handler
  auth/callback/      # email confirmation redirect

components/
  topbar.tsx          # shared topbar with hamburger drawer
  mobile-menu.tsx

lib/
  providers/          # OtpProvider abstraction (5sim, smspool, registry)
  payments/           # CryptoProcessor abstraction (nowpayments, cryptomus stub)
  wallet/             # credit / debit / refund via wallet_apply RPC
  pricing/            # markup engine with most-specific-rule resolution
  inngest/            # sync-catalog, poll-orders, expire-orders, abuse-velocity, reconcile-wallets
  supabase/           # browser / server / admin clients + generated Database types
  utils/              # hold-token, money

supabase/migrations/  # SQL migrations, applied via Supabase MCP or dashboard SQL editor
tests/                # vitest — pure logic only (no DOM tests yet)
```

## Local setup

```bash
# 1. Install deps
npm install

# 2. Copy env template and fill in values
cp .env.local.example .env.local
# Edit .env.local — see "Environment variables" below.

# 3. Apply the schema to your Supabase project
# Either via the Supabase dashboard SQL editor (paste supabase/migrations/0001_init.sql)
# or via the Supabase MCP tool if your Claude session has it configured.

# 4. Run dev
npm run dev               # http://localhost:3000

# 5. In a separate terminal, the Inngest dev server (required for cron + queued jobs)
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
# Inngest UI is at http://localhost:8288
```

To trigger your first catalog sync, sign up, then in Supabase SQL editor:
```sql
update public.profiles set is_admin = true where id = auth.uid();
```
Then visit `/admin/providers` and click **Sync all providers**.

## Commands

| Script | Purpose |
|---|---|
| `npm run dev` | Next 16 dev server, Turbopack |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint (`eslint-config-next` flat config) |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest watcher |
| `npm run test:coverage` | Vitest with v8 coverage |

Tests live in `tests/`. They cover pure logic — pricing math, hold-token signing/verification, 5SIM API parsing (mocked fetch). No DOM/integration tests yet.

## Environment variables

See `.env.local.example` for the full list. Quick reference:

| Block | Required for | Where to get |
|---|---|---|
| Supabase URL + anon + service-role | Everything | Dashboard → Settings → API |
| `FIVESIM_API_KEY` | Buy / poll / cancel orders | https://5sim.net/profile/security |
| `NOWPAYMENTS_API_KEY` + `NOWPAYMENTS_IPN_SECRET` | Top-up flow | NOWPayments dashboard |
| `INNGEST_DEV=1` (dev) **or** `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` (prod) | Background jobs | app.inngest.com |
| `RESEND_API_KEY` | Transactional email | https://resend.com |
| `NEXT_PUBLIC_APP_URL` | OG tags, redirect URLs, IPN callbacks | Your deployed URL |

Production deploys must **not** set `INNGEST_DEV=1` — dev mode skips signature verification.

## Deploy notes

Designed for **Vercel** but portable.

- `next.config.ts` emits standard security headers (`X-Frame-Options`, `Permissions-Policy`, HSTS, etc.).
- `productionBrowserSourceMaps` is `false` — we don't ship sourcemaps of the wallet logic.
- `.vercelignore` excludes design references, tests, and env files.
- `app/robots.ts` disallows crawling of auth-gated routes; `app/sitemap.ts` lists the public ones.
- Required platform setup before going live:
  1. Set every var listed in `.env.local.example` in the host's env config. **Service-role key is server-only — never expose it to the browser.**
  2. Register the deployed `/api/inngest` URL in the Inngest dashboard, get an event + signing key, set them as env vars. Remove `INNGEST_DEV`.
  3. Set the deployed `/api/webhooks/nowpayments` URL as the IPN callback in NOWPayments' merchant dashboard.
  4. Lawyer-review the placeholder copy in `/legal/*` before launch.
  5. Configure Supabase Auth → Providers → Email → confirm-email behaviour for your launch flow.

## Reference

- `veridigits-claude-code-handover.md` — binding architecture: data model, RLS, provider abstraction interface, core flows, Inngest job specs, env vars, Phase 1 task breakdown.
- `sms-verification-platform-execution-plan.md` — business model, upstream provider trade-offs, compliance posture, cost baseline, build phases.
- `CLAUDE.md` — instructions for AI assistants working in this repo. Includes stack gotchas and locked constraints.

## Status

Phase 1 complete: marketing site, auth (signup/login/reset), wallet, browse + purchase, live order page (realtime SMS), top-up, admin panel, all five Inngest jobs, tests, legal page placeholders.

Phase 2 in progress: rental mode, pricing rules admin UI, additional upstream providers.

Deferred: Sentry, BetterStack, Cloudflare Turnstile, per-IP rate limiting — wire when closer to public launch.
