-- ============================================================
-- Migration: Korapay (NGN) top-ups
--
-- Adds a parallel payments table for Naira top-ups via Korapay,
-- and extends wallet_transactions.reference_type to point at it.
--
-- Architecture: wallet stays USD-cents internally. Korapay charges the
-- customer in NGN; we lock an FX rate at quote time, store the resulting
-- USD-cents amount on the ngn_payments row, and credit that exact amount
-- on webhook confirmation regardless of where the spot rate moves to.
-- ============================================================

-- 1) Extend wallet_transactions.reference_type to allow 'ngn_payment'.
--
-- Drop the existing CHECK constraint by name (created without explicit name
-- in 0001 → Postgres auto-names it wallet_transactions_reference_type_check).
alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_reference_type_check;

alter table public.wallet_transactions
  add constraint wallet_transactions_reference_type_check
  check (reference_type in ('crypto_payment','ngn_payment','order','manual'));

-- 2) Create ngn_payments table.
create table public.ngn_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Our internal reference, passed to Korapay as `reference`.
  reference text not null unique,
  -- Korapay's own reference (returned in initialize response + webhook).
  -- Often equal to our reference but stored separately for audit.
  korapay_reference text,
  -- The amount the customer pays Korapay, in naira (integer, no decimals).
  amount_ngn bigint not null check (amount_ngn > 0),
  -- The USD-cents we will credit on confirmation, locked at quote time.
  amount_usd_cents_credited bigint not null check (amount_usd_cents_credited > 0),
  -- The FX rate we used at quote time: ngn-per-usd. Stored for audit.
  fx_rate_ngn_per_usd numeric(12,4) not null,
  status text not null check (status in ('pending','success','failed','expired')),
  checkout_url text,
  webhook_payload jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index ngn_payments_user_idx on public.ngn_payments (user_id, created_at desc);
create index ngn_payments_reference_idx on public.ngn_payments (reference);

-- RLS — users read own rows, service role writes.
alter table public.ngn_payments enable row level security;

create policy ngn_payments_select_own on public.ngn_payments
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
