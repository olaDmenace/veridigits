-- Veridigits initial schema
-- All money stored as cents (bigint). All ids are uuid. timestamps are timestamptz.

set check_function_bodies = off;

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  wallet_balance_cents bigint not null default 0,
  is_admin boolean not null default false,
  is_banned boolean not null default false,
  total_spent_cents bigint not null default 0,
  total_topped_up_cents bigint not null default 0,
  referral_code text unique,
  referred_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint wallet_balance_non_negative check (wallet_balance_cents >= 0)
);

create index profiles_referred_by_idx on public.profiles (referred_by) where referred_by is not null;

-- Auto-create profile row on auth.users insert
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper for RLS — returns true if the calling user is an admin.
-- security definer so it can read profiles without recursing through RLS.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ============================================================
-- WALLET TRANSACTIONS (append-only ledger)
-- ============================================================
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents bigint not null,
  type text not null check (type in ('topup','purchase','refund','bonus','adjustment')),
  reference_type text check (reference_type in ('crypto_payment','order','manual')),
  reference_id uuid,
  balance_after_cents bigint not null,
  note text,
  created_at timestamptz not null default now()
);

create index wallet_tx_user_created_idx on public.wallet_transactions (user_id, created_at desc);
create index wallet_tx_reference_idx on public.wallet_transactions (reference_type, reference_id) where reference_id is not null;

-- ============================================================
-- SERVICES catalog
-- ============================================================
create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  icon_url text,
  is_enabled boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create index services_enabled_order_idx on public.services (display_order) where is_enabled;

-- ============================================================
-- COUNTRIES
-- ============================================================
create table public.countries (
  id uuid primary key default gen_random_uuid(),
  iso_code text unique not null,
  name text not null,
  flag_emoji text,
  is_enabled boolean not null default true
);

create index countries_enabled_idx on public.countries (iso_code) where is_enabled;

-- ============================================================
-- PROVIDER_SERVICES — mapping + cached pricing/availability
-- ============================================================
create table public.provider_services (
  id uuid primary key default gen_random_uuid(),
  provider_slug text not null,
  service_id uuid references public.services(id) on delete cascade,
  country_id uuid references public.countries(id) on delete cascade,
  upstream_service_code text not null,
  upstream_country_code text not null,
  upstream_operator text,
  wholesale_price_cents bigint,
  available_count int,
  last_synced_at timestamptz,
  is_enabled boolean not null default true,
  unique (provider_slug, service_id, country_id, upstream_operator)
);

create index provider_services_lookup_idx on public.provider_services (service_id, country_id) where is_enabled;
create index provider_services_provider_idx on public.provider_services (provider_slug);

-- ============================================================
-- PRICING_RULES — markup overrides
-- Resolution: most-specific match wins, then by priority desc.
-- ============================================================
create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.services(id) on delete cascade,
  country_id uuid references public.countries(id) on delete cascade,
  markup_percent numeric(5,2) not null default 30.00,
  flat_fee_cents int not null default 1,
  min_retail_cents int not null default 5,
  priority int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index pricing_rules_lookup_idx on public.pricing_rules (service_id, country_id) where is_active;

-- Seed a global default rule (service_id null, country_id null).
insert into public.pricing_rules (service_id, country_id, markup_percent, flat_fee_cents, min_retail_cents, priority)
values (null, null, 30.00, 1, 5, 0);

-- ============================================================
-- ORDERS
-- ============================================================
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  service_id uuid references public.services(id),
  country_id uuid references public.countries(id),
  provider_slug text not null,
  upstream_order_id text not null,
  phone_number text not null,
  wholesale_paid_cents bigint not null,
  retail_charged_cents bigint not null,
  mode text not null check (mode in ('activation','rental')),
  status text not null check (status in ('pending','active','received','completed','cancelled','expired','refunded')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz
);

create index orders_user_created_idx on public.orders (user_id, created_at desc);
create index orders_active_expiring_idx on public.orders (status, expires_at) where status in ('pending','active');
create index orders_upstream_lookup_idx on public.orders (provider_slug, upstream_order_id);

-- ============================================================
-- RECEIVED_MESSAGES
-- ============================================================
create table public.received_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sender text,
  content text not null,
  extracted_code text,
  received_at timestamptz not null default now()
);

create index received_messages_order_idx on public.received_messages (order_id, received_at desc);

-- ============================================================
-- CRYPTO_PAYMENTS
-- ============================================================
create table public.crypto_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('nowpayments','cryptomus')),
  external_id text not null,
  amount_usd_cents bigint not null,
  crypto_currency text,
  crypto_amount text,
  status text not null check (status in ('waiting','confirming','confirmed','failed','expired')),
  webhook_payload jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (provider, external_id)
);

create index crypto_payments_user_idx on public.crypto_payments (user_id, created_at desc);

-- ============================================================
-- ABUSE_EVENTS
-- ============================================================
create table public.abuse_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('velocity','rapid_cancel','suspicious_pattern')),
  details jsonb,
  action_taken text check (action_taken in ('none','rate_limit','ban')),
  created_at timestamptz not null default now()
);

create index abuse_events_user_idx on public.abuse_events (user_id, created_at desc) where user_id is not null;

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================
alter table public.profiles            enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.services            enable row level security;
alter table public.countries           enable row level security;
alter table public.provider_services   enable row level security;
alter table public.pricing_rules       enable row level security;
alter table public.orders              enable row level security;
alter table public.received_messages   enable row level security;
alter table public.crypto_payments     enable row level security;
alter table public.abuse_events        enable row level security;

-- profiles: user reads own row; user updates own row but cannot change admin/banned/balance fields;
-- admins can read all.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and is_admin = (select is_admin from public.profiles where id = auth.uid())
    and is_banned = (select is_banned from public.profiles where id = auth.uid())
    and wallet_balance_cents = (select wallet_balance_cents from public.profiles where id = auth.uid())
    and total_spent_cents = (select total_spent_cents from public.profiles where id = auth.uid())
    and total_topped_up_cents = (select total_topped_up_cents from public.profiles where id = auth.uid())
  );

-- wallet_transactions: user reads own; only service role can write.
create policy wallet_tx_select_own on public.wallet_transactions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- services / countries / provider_services: public read on enabled rows.
create policy services_public_read on public.services
  for select to anon, authenticated
  using (is_enabled or public.is_admin());

create policy countries_public_read on public.countries
  for select to anon, authenticated
  using (is_enabled or public.is_admin());

create policy provider_services_public_read on public.provider_services
  for select to anon, authenticated
  using (is_enabled or public.is_admin());

-- pricing_rules: admin only.
create policy pricing_rules_admin_all on public.pricing_rules
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- orders: user reads own; admin reads all; writes via service role.
create policy orders_select_own on public.orders
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- received_messages: user reads if they own the order.
create policy received_messages_select_own on public.received_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = received_messages.order_id
        and (o.user_id = auth.uid() or public.is_admin())
    )
  );

-- crypto_payments: user reads own; writes via service role.
create policy crypto_payments_select_own on public.crypto_payments
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- abuse_events: admin only.
create policy abuse_events_admin_read on public.abuse_events
  for select to authenticated
  using (public.is_admin());

-- ============================================================
-- WALLET LEDGER FUNCTION
-- Single atomic op: locks the profile row, validates, inserts ledger entry, updates balance.
-- Positive amount = credit (topup, refund, bonus). Negative amount = debit (purchase).
-- Raises 'insufficient_balance' when a debit would push balance below zero.
-- ============================================================
create function public.wallet_apply(
  p_user_id uuid,
  p_amount_cents bigint,
  p_type text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_note text default null
)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_balance bigint;
  v_new_balance bigint;
  v_tx public.wallet_transactions;
begin
  if p_type not in ('topup','purchase','refund','bonus','adjustment') then
    raise exception 'invalid wallet transaction type: %', p_type;
  end if;

  -- Lock the wallet row for the duration of this transaction.
  select wallet_balance_cents
    into v_current_balance
    from public.profiles
    where id = p_user_id
    for update;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  v_new_balance := v_current_balance + p_amount_cents;

  if v_new_balance < 0 then
    raise exception 'insufficient_balance' using errcode = '23514';
  end if;

  insert into public.wallet_transactions
    (user_id, amount_cents, type, reference_type, reference_id, balance_after_cents, note)
  values
    (p_user_id, p_amount_cents, p_type, p_reference_type, p_reference_id, v_new_balance, p_note)
  returning * into v_tx;

  update public.profiles
     set wallet_balance_cents   = v_new_balance,
         total_topped_up_cents  = total_topped_up_cents
                                  + case when p_type = 'topup' and p_amount_cents > 0
                                         then p_amount_cents else 0 end,
         total_spent_cents      = total_spent_cents
                                  + case when p_type = 'purchase' and p_amount_cents < 0
                                         then -p_amount_cents else 0 end
   where id = p_user_id;

  return v_tx;
end;
$$;

revoke all on function public.wallet_apply from public, anon, authenticated;

-- ============================================================
-- REALTIME
-- received_messages must publish so the dashboard can subscribe.
-- ============================================================
alter publication supabase_realtime add table public.received_messages;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.wallet_transactions;
alter publication supabase_realtime add table public.profiles;
