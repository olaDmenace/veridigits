# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project: Veridigits

SMS verification (OTP-receive) platform. Users top up a wallet with crypto, then buy temporary phone numbers to receive SMS codes from services like Telegram, WhatsApp, Google. We **resell** from upstream OTP aggregators (5SIM, SMSPool) with a markup — we do not own numbers.

Status: **bootstrapped from `create-next-app`, no product code yet**. The `app/` directory holds only the default landing page. Two planning documents define the entire product and must be read before writing code:

- `veridigits-claude-code-handover.md` — full technical spec: folder layout, data model, RLS, provider abstraction interface, core flows (top-up / purchase / receive / cancel), Inngest jobs, env vars, phase 1 task breakdown
- `sms-verification-platform-execution-plan.md` — business model, upstream providers, compliance posture, cost baseline, build phases

Treat the handover doc as binding architecture; do not deviate without flagging.

## Commands

- `npm run dev` — start dev server (Next 16 with Turbopack defaults)
- `npm run build` — production build
- `npm run start` — run production build
- `npm run lint` — eslint (uses `eslint-config-next` flat config, see `eslint.config.mjs`)
- `npm test` — vitest, one-shot run. `npm run test:watch` for the watcher, `npm run test:coverage` for coverage.

Tests live in `tests/`. Vitest uses Node environment (no DOM) — the suite covers pure logic: pricing math, hold-token signing, 5SIM API parsing (mocked fetch). UI/integration tests are intentionally not wired up yet.

## Stack notes that bite

- **Next.js 16.2.6 + React 19.2.4.** AGENTS.md is not boilerplate: APIs and conventions have shifted from prior majors. Before writing Next-specific code (route handlers, server actions, caching, params shape, metadata, fonts, image), read the relevant page in `node_modules/next/dist/docs/01-app/` rather than relying on training data.
- **Tailwind v4** via `@tailwindcss/postcss` (see `postcss.config.mjs`). Theme/config is CSS-first in `app/globals.css` — there is no `tailwind.config.ts`. Don't reach for v3 patterns.
- **TypeScript strict, path alias `@/*` → `./*`** (see `tsconfig.json`). Imports are from project root, not a `src/` directory.
- Package manager in lockfile is **npm** (`package-lock.json` present). The handover doc mentions pnpm — confirm with the user before switching.

## Locked architectural constraints (from the handover doc)

These are the constraints that, if violated, sink the product. Surface concerns before bypassing any of them:

1. **No mainstream CPaaS.** Never integrate Twilio, Telnyx, Plivo, Bandwidth, Vonage. They terminate accounts on this use case. Upstream is OTP aggregators only (5SIM primary, SMSPool fallback at MVP).
2. **No mainstream payment processors.** No Stripe, PayPal, Paystack, Flutterwave for end-user payments. Crypto-only via NOWPayments (primary) and Cryptomus (backup).
3. **No KYC, no social logins.** Email + password auth only; anonymity is the product.
4. **Wallet-based money flow.** All purchases debit a pre-funded wallet — never charge per-purchase through the payment processor.
5. **DB-level locks on wallet operations** (`SELECT ... FOR UPDATE` inside a transaction). Race conditions here will be exploited.
6. **All upstream provider calls go through `lib/providers/` abstraction.** Never call 5SIM/SMSPool directly from a route, server action, or component. The interface is defined in the handover doc.
7. **Cheapest-first provider selection with re-quote at purchase time.** Cached wholesale prices are stale within minutes; always re-fetch right before charging the wallet.

## Architecture in one paragraph

Marketing pages and the dashboard live in route groups under `app/` (`(marketing)`, `(auth)`, `(dashboard)`, `(admin)`). Backend logic sits in `lib/`: `providers/` wraps each upstream OTP aggregator behind a single `OtpProvider` interface with `registry.ts` doing cheapest-first selection + fallback; `payments/` wraps the crypto processors; `wallet/` holds the locked credit/debit/refund operations against Supabase Postgres; `pricing/` resolves markup rules (most-specific match wins: service+country → service → country → global default); `inngest/` holds the polling, expiry, and catalog-sync background jobs. Supabase provides Postgres + Auth + Realtime; RLS is enforced on every table. Webhooks land at `app/api/webhooks/{nowpayments,cryptomus}` and Inngest at `app/api/inngest`. See the handover doc for the full data model and flow diagrams.

## Things to ask the user, not guess

Per the handover doc: domain choice, default markup % per service, whether to include affiliate/referral in Phase 1, logo/visual identity. Also confirm package manager (npm vs pnpm) before adding dependencies.

## Reference

- Supabase MCP server is configured in `.mcp.json` — use it for schema introspection, migrations, advisors, and logs rather than guessing the project state.
- The three `Veridigits Design System*.html` files in the repo root are untracked design system mocks; treat them as design reference, not source.
