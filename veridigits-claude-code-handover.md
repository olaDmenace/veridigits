# Veridigits — Claude Code Handover

> Drop this into the project root as `CLAUDE.md` so Claude Code reads it on every session start.

---

## Project mission

We're building **Veridigits** — an SMS verification (OTP receive) platform. Users top up a wallet with crypto, then buy temporary phone numbers to receive SMS verification codes from services like Telegram, WhatsApp, Google, Discord, etc. We don't own numbers — we resell from upstream OTP aggregators (5SIM, SMSPool, etc.) and apply a markup.

**Future scope:** Virtual business numbers (OpenPhone-like) as a separate product later. Don't build for that now.

---

## Critical constraints — read before writing any code

1. **Never integrate Twilio, Telnyx, Plivo, Bandwidth, Vonage, or any mainstream CPaaS.** They terminate accounts running this use case. If you find yourself reaching for them, stop and ask.
2. **Never integrate Stripe, Paystack, Flutterwave, or PayPal** for end-user payments. They classify this as high-risk and will terminate. Crypto only via NOWPayments / Cryptomus.
3. **No KYC on end users.** Email + password only. Anonymity is the product. Do not collect names, addresses, ID, or anything beyond email.
4. **No social logins.** Google/Apple/GitHub OAuth defeats the anonymity model.
5. **All money flows are wallet-based.** Top up → balance → deduct on purchase. Never charge per-purchase via the payment processor.
6. **Use database-level locks on wallet operations.** Wallet drain race conditions will be exploited.
7. **All upstream provider calls go through the abstraction layer** (`lib/providers/`). Never call a provider's API directly from a route or component.

---

## Tech stack (locked decisions, do not deviate)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14+ App Router | Olayinka's stack, SSR + Server Actions |
| Language | TypeScript (strict) | Olayinka's preference |
| Styling | Tailwind + shadcn/ui | Standard stack |
| Database | Supabase Postgres | Realtime + Auth + RLS in one |
| Auth | Supabase Auth (email/password only) | No OAuth, no magic links from socials |
| Real-time | Supabase Realtime channels | For pushing received SMS to user |
| Background jobs | Inngest | For polling, expiry, sync jobs |
| Payments | NOWPayments (primary), Cryptomus (backup) | Crypto top-up only |
| Hosting | Vercel | App + edge functions |
| Email | Resend | Transactional only |
| CDN/WAF | Cloudflare | DDoS + Turnstile + DNS |
| Error tracking | Sentry | Standard |
| Analytics | PostHog (self-host on Hostinger VPS) | Privacy |

**Node version:** 20 LTS. **Package manager:** pnpm.

---

## Folder structure

```
veridigits/
├── app/
│   ├── (marketing)/          # Public landing, pricing, FAQ
│   │   ├── page.tsx
│   │   ├── pricing/
│   │   └── faq/
│   ├── (auth)/
│   │   ├── login/
│   │   └── signup/
│   ├── (dashboard)/          # Auth-gated user dashboard
│   │   ├── layout.tsx        # Auth check + sidebar
│   │   ├── page.tsx          # Wallet + recent orders
│   │   ├── buy/              # Service/country picker + purchase flow
│   │   ├── orders/           # Order history + active orders
│   │   ├── orders/[id]/      # Single order with live SMS view
│   │   ├── topup/            # Crypto top-up flow
│   │   └── settings/
│   ├── (admin)/              # Admin panel (separate role)
│   │   ├── layout.tsx
│   │   ├── users/
│   │   ├── orders/
│   │   ├── pricing/
│   │   └── providers/
│   ├── api/
│   │   ├── webhooks/
│   │   │   ├── nowpayments/  # IPN handler
│   │   │   ├── cryptomus/
│   │   │   └── 5sim/         # If/when they add webhooks
│   │   └── inngest/          # Inngest endpoint
│   └── layout.tsx
├── lib/
│   ├── providers/            # Upstream provider abstraction
│   │   ├── types.ts          # OtpProvider interface
│   │   ├── 5sim.ts
│   │   ├── smspool.ts
│   │   ├── registry.ts       # Provider selection + fallback logic
│   │   └── index.ts
│   ├── payments/             # Crypto payment processors
│   │   ├── types.ts
│   │   ├── nowpayments.ts
│   │   ├── cryptomus.ts
│   │   └── index.ts
│   ├── wallet/               # Wallet ledger logic (locked transactions)
│   │   ├── credit.ts
│   │   ├── debit.ts
│   │   └── refund.ts
│   ├── pricing/              # Markup engine
│   │   └── calculate.ts
│   ├── abuse/                # Rate limits + heuristics
│   │   ├── velocity.ts
│   │   └── patterns.ts
│   ├── inngest/              # Background functions
│   │   ├── client.ts
│   │   ├── poll-orders.ts
│   │   ├── expire-orders.ts
│   │   └── sync-prices.ts
│   ├── supabase/
│   │   ├── client.ts         # Browser client
│   │   ├── server.ts         # Server client
│   │   └── admin.ts          # Service-role client
│   └── utils/
├── components/
│   ├── ui/                   # shadcn primitives
│   ├── purchase/             # Service grid, country picker, etc.
│   ├── wallet/               # Top-up, balance, transaction list
│   ├── orders/               # Order card, live SMS panel
│   └── admin/
├── supabase/
│   └── migrations/           # SQL migrations
├── public/
│   └── flags/                # Country flag SVGs
├── CLAUDE.md                 # This file
├── README.md
├── package.json
└── ...
```

---

## Data model

All tables in Postgres via Supabase. Use UUIDs for all primary keys. Use `created_at timestamptz default now()` everywhere.

### `users`
Managed by Supabase Auth. Reference via `auth.users.id`.

### `profiles`
- `id uuid primary key references auth.users(id)`
- `wallet_balance_cents bigint not null default 0` (store as cents to avoid float math)
- `is_admin boolean not null default false`
- `is_banned boolean not null default false`
- `total_spent_cents bigint not null default 0`
- `total_topped_up_cents bigint not null default 0`
- `referral_code text unique`
- `referred_by uuid references profiles(id)`
- `created_at timestamptz default now()`

### `wallet_transactions`
Ledger. Append-only. Every wallet change goes here.
- `id uuid primary key`
- `user_id uuid not null references profiles(id)`
- `amount_cents bigint not null` (positive = credit, negative = debit)
- `type text not null` — enum: `topup | purchase | refund | bonus | adjustment`
- `reference_type text` — `crypto_payment | order | manual`
- `reference_id uuid`
- `balance_after_cents bigint not null`
- `note text`
- `created_at timestamptz default now()`

### `services`
Catalog of services that can be verified.
- `id uuid primary key`
- `slug text unique not null` — e.g., `telegram`, `whatsapp`, `google`
- `name text not null`
- `icon_url text`
- `is_enabled boolean default true`
- `display_order int default 0`
- `created_at`

### `countries`
- `id uuid primary key`
- `iso_code text unique not null` — `us`, `gb`, `ng`
- `name text not null`
- `flag_emoji text`
- `is_enabled boolean default true`

### `provider_services`
Mapping between our service/country and upstream provider's identifiers + cached pricing/availability.
- `id uuid primary key`
- `provider_slug text not null` — `5sim`, `smspool`
- `service_id uuid references services(id)`
- `country_id uuid references countries(id)`
- `upstream_service_code text not null`
- `upstream_country_code text not null`
- `upstream_operator text` — for 5sim, can be `any`
- `wholesale_price_cents bigint`
- `available_count int`
- `last_synced_at timestamptz`
- `is_enabled boolean default true`
- `unique(provider_slug, service_id, country_id, upstream_operator)`

### `pricing_rules`
Markup overrides.
- `id uuid primary key`
- `service_id uuid` (nullable — null = applies to all services)
- `country_id uuid` (nullable)
- `markup_percent numeric(5,2) not null default 30.00`
- `flat_fee_cents int not null default 1`
- `min_retail_cents int default 5`
- `priority int default 0` (higher wins)
- `is_active boolean default true`

Resolution: most-specific match wins (service+country → service → country → global default).

### `orders`
- `id uuid primary key`
- `user_id uuid not null references profiles(id)`
- `service_id uuid references services(id)`
- `country_id uuid references countries(id)`
- `provider_slug text not null`
- `upstream_order_id text not null`
- `phone_number text not null`
- `wholesale_paid_cents bigint not null`
- `retail_charged_cents bigint not null`
- `mode text not null` — `activation | rental`
- `status text not null` — `pending | active | received | completed | cancelled | expired | refunded`
- `expires_at timestamptz not null`
- `created_at timestamptz default now()`
- `completed_at timestamptz`
- `cancelled_at timestamptz`

### `received_messages`
- `id uuid primary key`
- `order_id uuid not null references orders(id)`
- `sender text`
- `content text not null`
- `extracted_code text` — best-effort regex extraction
- `received_at timestamptz default now()`
- index on `order_id`

### `crypto_payments`
- `id uuid primary key`
- `user_id uuid not null references profiles(id)`
- `provider text not null` — `nowpayments | cryptomus`
- `external_id text not null`
- `amount_usd_cents bigint not null`
- `crypto_currency text` — `usdttrc20`, `usdcsol`, `btc`, etc.
- `crypto_amount text` — store as text to avoid precision loss
- `status text not null` — `waiting | confirming | confirmed | failed | expired`
- `webhook_payload jsonb`
- `created_at timestamptz default now()`
- `confirmed_at timestamptz`

### `abuse_events`
- `id uuid primary key`
- `user_id uuid references profiles(id)`
- `event_type text not null` — `velocity | rapid_cancel | suspicious_pattern`
- `details jsonb`
- `action_taken text` — `none | rate_limit | ban`
- `created_at timestamptz default now()`

### Row-Level Security

Every table enables RLS. Standard policies:
- `profiles`: user can `select | update` own row only; `is_admin` cannot be self-set
- `wallet_transactions`: user can `select` own only; insert via service-role only
- `orders`: user can `select` own only; insert/update via service-role only
- `received_messages`: user can `select` where `order.user_id = auth.uid()`
- `services`, `countries`, `provider_services` (price/availability only): public read on enabled rows
- All admin tables: only `is_admin = true` users

---

## Upstream provider abstraction

This is the most important architectural piece. Get it right.

```typescript
// lib/providers/types.ts

export interface OtpProvider {
  readonly slug: string;
  readonly displayName: string;

  /**
   * Fetch live wholesale price + availability for a service/country.
   * Called during browse and right before purchase to validate the price.
   */
  getPriceAndAvailability(params: {
    upstreamServiceCode: string;
    upstreamCountryCode: string;
    upstreamOperator?: string;
  }): Promise<{
    priceCents: number;
    availableCount: number;
  }>;

  /**
   * Buy a number for activation (single-use, ~20min).
   * Returns the upstream order ID and phone number.
   */
  buyActivation(params: {
    upstreamServiceCode: string;
    upstreamCountryCode: string;
    upstreamOperator?: string;
  }): Promise<{
    upstreamOrderId: string;
    phoneNumber: string;
    expiresAt: Date;
    wholesaleCents: number;
  }>;

  /**
   * Rent a number for a duration.
   */
  rentNumber(params: {
    upstreamServiceCode: string;
    upstreamCountryCode: string;
    durationHours: number;
  }): Promise<{
    upstreamOrderId: string;
    phoneNumber: string;
    expiresAt: Date;
    wholesaleCents: number;
  }>;

  /**
   * Poll for received SMS messages on an order.
   */
  checkOrder(upstreamOrderId: string): Promise<{
    status: 'pending' | 'received' | 'cancelled' | 'expired';
    messages: Array<{
      sender: string;
      content: string;
      receivedAt: Date;
    }>;
  }>;

  /** Mark order finished — releases the number, no refund. */
  finishOrder(upstreamOrderId: string): Promise<void>;

  /** Cancel order — refund issued by upstream if no SMS received. */
  cancelOrder(upstreamOrderId: string): Promise<void>;

  /** Sync all service/country/operator combinations + prices. Used by daily cron. */
  syncCatalog(): Promise<Array<{
    upstreamServiceCode: string;
    upstreamServiceName: string;
    upstreamCountryCode: string;
    upstreamOperator: string;
    priceCents: number;
    availableCount: number;
  }>>;
}
```

### Provider selection logic (`lib/providers/registry.ts`)

When a user requests to buy a number for `service + country`:

1. Look up all enabled `provider_services` rows for that service/country combo
2. Filter to those with `available_count > 0` and `wholesale_price_cents IS NOT NULL`
3. Sort by wholesale price ascending (cheapest first)
4. Try the cheapest. If it fails (out of stock, API error), fall through to the next.
5. Cap retries at 3 providers. If all fail, return "out of stock" to the user.

**Critical:** call `getPriceAndAvailability` right before `buyActivation` — never trust the cached price for the actual transaction. Wholesale prices change in real time.

---

## Core flows

### Top-up flow

1. User on `/topup` enters amount in USD (min $5)
2. Server action calls `nowpayments.createInvoice({ amountUsdCents, userId })`
3. NOWPayments returns a hosted payment URL — redirect user
4. User pays with crypto on NOWPayments-hosted page
5. NOWPayments fires IPN webhook to `/api/webhooks/nowpayments`
6. Webhook handler verifies signature, finds `crypto_payments` row by `external_id`
7. On `status = confirmed`: insert `wallet_transactions` credit row inside a transaction with `UPDATE profiles SET wallet_balance_cents = wallet_balance_cents + ... WHERE id = ?`
8. Realtime channel notifies the user's dashboard

### Purchase flow

1. User picks service + country on `/buy`
2. Server action `getQuote(serviceId, countryId)` — calls provider abstraction with cheapest-first selection, returns `{ providerSlug, retailCents, holdToken }` (holdToken is a short-lived JWT containing the quote params, expires in 30s)
3. UI shows "Buy for $X.XX" button
4. Click → server action `purchase(holdToken)`:
   - Verify token, re-quote price (must not deviate >10% from quote)
   - Open DB transaction
   - `SELECT wallet_balance_cents FROM profiles WHERE id = ? FOR UPDATE`
   - If insufficient → return error
   - Call `provider.buyActivation(...)` — this is the slow step, ~1-3s
   - On failure: rollback, return error
   - On success: insert `orders` row, insert `wallet_transactions` debit row, update `profiles.wallet_balance_cents`
   - Commit
5. Redirect to `/orders/[id]` for live view
6. Background: Inngest job starts polling `provider.checkOrder` every 3s for that order

### Receive SMS flow

- Inngest function `pollOrder` runs every 3s for each `active` order
- When `messages` arrive: insert into `received_messages`
- Supabase Realtime pushes the new row to subscribed clients (the user's order page)
- User UI shows the SMS + extracted code with copy button
- Auto-mark `status = received` after first SMS for activation mode
- For rentals, keep polling until `expires_at`

### Cancel flow

- User clicks Cancel on an active order
- Server action: only allow if `messages.count = 0` AND `created_at > now() - 2 minutes` (upstream cancel window varies — 5sim is 2 min)
- Call `provider.cancelOrder()`
- On success: `status = cancelled`, refund full amount to wallet via `wallet_transactions` credit
- Stop the Inngest poll

---

## Background jobs (Inngest)

### `poll-active-orders`
- Trigger: every 3 seconds
- For each order with `status IN ('pending', 'active')`: call provider, update DB
- Concurrency: parallelize across orders, but rate-limit per provider (5sim allows ~10 req/s on user accounts)

### `expire-orders`
- Trigger: every 60 seconds
- Find orders where `expires_at < now()` AND `status IN ('pending', 'active')`
- If no SMS received: cancel with provider, refund to wallet
- If SMS received but not finished: mark completed (no refund)

### `sync-catalog`
- Trigger: every 6 hours
- For each enabled provider, call `syncCatalog()`
- Upsert into `provider_services`
- Disable rows that disappear from upstream

### `sync-prices-frequent`
- Trigger: every 15 minutes
- For top-N (e.g., top 50) most-bought service/country combos, refresh prices
- Keeps hot inventory accurate without hammering the API

### `wallet-reconciliation`
- Trigger: daily
- Sum `wallet_transactions.amount_cents` per user, compare with `profiles.wallet_balance_cents`
- Alert on mismatch (this should never happen but bugs are bugs)

### `abuse-velocity-check`
- Trigger: every 5 minutes
- Find users with >50 orders in last hour, >20 cancels in last hour, etc.
- Insert `abuse_events`, optionally rate-limit or ban

---

## Pricing engine (`lib/pricing/calculate.ts`)

```typescript
export async function calculateRetailPrice(params: {
  serviceId: string;
  countryId: string;
  wholesaleCents: number;
}): Promise<number> {
  // Look up most-specific pricing rule
  // priority order: (service+country) > service > country > global default
  const rule = await getApplicablePricingRule(params.serviceId, params.countryId);

  const markedUp = Math.ceil(params.wholesaleCents * (1 + rule.markup_percent / 100));
  const withFee = markedUp + rule.flat_fee_cents;
  return Math.max(withFee, rule.min_retail_cents);
}
```

Default: 30% markup + 1¢ fee + 5¢ minimum.

---

## Environment variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Auth
NEXTAUTH_SECRET=

# Crypto payments
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=
CRYPTOMUS_API_KEY=
CRYPTOMUS_MERCHANT_ID=

# Upstream OTP providers
FIVESIM_API_KEY=
SMSPOOL_API_KEY=

# Email
RESEND_API_KEY=

# Inngest
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Cloudflare Turnstile
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

# Sentry
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=

# App
NEXT_PUBLIC_APP_URL=https://veridigits.com
ADMIN_EMAILS=admin@veridigits.com  # comma-separated
```

---

## Phase 1 task breakdown (suggested order for Claude Code)

Each item is a self-contained chunk a Claude Code session can pick up.

1. **Project bootstrap**
   - Init Next.js + TS + Tailwind + shadcn
   - Set up Supabase project + run initial migration with all tables above
   - Wire RLS policies

2. **Auth**
   - Email/password signup + login pages
   - `profiles` row auto-created on signup via Supabase trigger
   - Auth middleware on `(dashboard)` layout

3. **Wallet system core**
   - `lib/wallet/credit.ts`, `debit.ts`, `refund.ts` — all use Postgres `SELECT ... FOR UPDATE`
   - Wallet balance display component
   - Transactions list page

4. **Provider abstraction (5SIM only first)**
   - `lib/providers/types.ts` interface
   - `lib/providers/5sim.ts` implementation against the 5SIM REST API
   - Unit tests with mocked HTTP

5. **Catalog sync job**
   - Inngest function `sync-catalog`
   - Populate `services`, `countries`, `provider_services`
   - Admin trigger button

6. **Browse + purchase UI**
   - `/buy` — service grid + country picker
   - `/buy/[serviceSlug]/[countryCode]` — confirmation page with live price quote
   - Server action `purchase(holdToken)` with the full transactional flow

7. **Live order page**
   - `/orders/[id]` — phone number, copy button, SMS list
   - Subscribe to Supabase Realtime on `received_messages` filtered by `order_id`
   - Cancel button (with cancel-window check)

8. **Order polling job**
   - Inngest function `poll-active-orders`
   - Insert messages, update order status

9. **Order expiry job**
   - Inngest function `expire-orders`
   - Auto-cancel + refund flow

10. **NOWPayments top-up**
    - `/topup` page with amount input
    - `createInvoice` server action
    - `/api/webhooks/nowpayments` IPN handler with signature verification
    - Wallet credit on confirmed status

11. **Admin panel (basic)**
    - Users table with search, ban toggle
    - Orders table with force-cancel
    - Pricing rules CRUD
    - Provider health dashboard (last sync, account balance)

12. **Abuse + rate limits**
    - Cloudflare Turnstile on signup and topup
    - Per-IP and per-user rate limits on `/buy` (using Upstash Redis or Supabase)
    - Inngest velocity check job

13. **Marketing site**
    - Landing page (services grid, countries, pricing)
    - FAQ
    - ToS, Privacy, AUP (use lawyer-reviewed templates)

14. **Pre-launch hardening**
    - Sentry wired everywhere
    - BetterStack status page
    - Wallet reconciliation job + alerts
    - Load test purchase flow with k6

---

## Things Claude Code should ask before doing

Open these as questions, don't guess:

- Domain (check `veridigits.com`, `.io`, `.app`, `.co` availability via Cloudflare Registrar or Porkbun)
- Whether to support fiat-equivalent display in NGN/USD (probably USD-only at MVP)
- Default markup % per service category (currently 30%)
- Whether to include affiliate/referral system in Phase 1 (suggest deferring to Phase 2)
- Logo/visual identity (will need designer or AI gen pass before launch)

---

## What "done" looks like for Phase 1

- A logged-in user can: top up with USDT, see balance, buy a Telegram US number, see the SMS code arrive in real time, cancel an unused order and get a refund, see order history.
- An admin can: view all users and orders, adjust a balance, ban a user, see provider health.
- Cloudflare in front of everything, Sentry catching errors, status page live.

That's it. Don't over-build. Phase 2 hardens. Phase 3 differentiates.
