-- Routing preference tier for invisible multi-provider auto-routing.
-- Higher rank = preferred. Default 0 = no preference (cheapest-reliable, the
-- prior behavior). Set per provider_services row (e.g. WhatsApp/Google rows on
-- a high-success provider) to make that provider primary, with automatic
-- fallback to the next tier when it's out of stock.
alter table public.provider_services
  add column if not exists preference_rank int not null default 0;
