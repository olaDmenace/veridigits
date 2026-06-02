-- Defer-debit model: the wallet is charged when the first valid SMS lands,
-- not at purchase. charged_at records when that debit actually succeeded.
-- NULL on a received order = delivered-but-uncharged (surfaced for reconcile).
alter table public.orders
  add column if not exists charged_at timestamptz;

-- Find delivered-but-uncharged orders quickly (reconcile + admin).
create index if not exists orders_uncharged_received_idx
  on public.orders (status)
  where status = 'received' and charged_at is null;
