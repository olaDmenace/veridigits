-- ============================================================
-- Migration: MTN MoMo (Ghana) as a second provider on fiat_payments
--
-- Korapay uses a redirect checkout; MTN MoMo uses a direct RequestToPay
-- (push a PIN prompt to the payer's phone, then poll/callback for status).
-- Both still land on fiat_payments with the locked USD-cents-to-credit.
-- ============================================================

alter table public.fiat_payments
  add column provider text not null default 'korapay'
  check (provider in ('korapay','mtn_momo'));

-- MTN's X-Reference-Id (a UUID we generate per RequestToPay). Used to poll the
-- transaction status and to correlate the (unauthenticated) MTN callback.
alter table public.fiat_payments
  add column momo_reference_id text;

create index fiat_payments_momo_ref_idx
  on public.fiat_payments (momo_reference_id)
  where momo_reference_id is not null;
