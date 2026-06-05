-- ============================================================
-- Migration: generalize ngn_payments -> fiat_payments
--
-- Adds multi-currency local-rail top-ups (NGN today, GHS for Ghana, more
-- later) on a single table. The wallet stays USD-cents internally; each row
-- still locks the FX rate + USD-cents-to-credit at quote time, and the
-- Korapay webhook credits that exact amount on confirmation.
--
-- Safe on existing data: this is a rename + add-column, not a rebuild. All
-- existing rows are NGN and get currency='NGN' via the column default.
-- ============================================================

-- 1) Allow 'fiat_payment' as a wallet reference_type (keep 'ngn_payment' so
--    historical ledger rows stay valid).
alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_reference_type_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_reference_type_check
  check (reference_type in
    ('crypto_payment','ngn_payment','fiat_payment','order','manual'));

-- 2) Rename the table and its currency-specific columns.
alter table public.ngn_payments rename to fiat_payments;
alter table public.fiat_payments rename column amount_ngn to amount_local;
alter table public.fiat_payments
  rename column fx_rate_ngn_per_usd to fx_rate_local_per_usd;

-- 3) Add the currency discriminator (existing rows backfill to NGN).
alter table public.fiat_payments
  add column currency text not null default 'NGN'
  check (currency in ('NGN','GHS'));

-- 4) Tidy index + policy names to match the new table name (cosmetic; the
--    objects themselves carried over with the rename).
alter index if exists ngn_payments_user_idx rename to fiat_payments_user_idx;
alter index if exists ngn_payments_reference_idx
  rename to fiat_payments_reference_idx;
alter policy ngn_payments_select_own on public.fiat_payments
  rename to fiat_payments_select_own;
