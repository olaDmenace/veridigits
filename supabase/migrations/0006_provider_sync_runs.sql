-- Observability for the catalog sync: one row per provider per run, capturing
-- entries processed + any error message. Lets us diagnose provider sync
-- failures from the DB instead of digging through function logs.
create table if not exists public.provider_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider_slug text not null,
  ran_at timestamptz not null default now(),
  entries_processed int not null default 0,
  ok boolean not null default true,
  error text
);

create index if not exists provider_sync_runs_recent_idx
  on public.provider_sync_runs (ran_at desc);
