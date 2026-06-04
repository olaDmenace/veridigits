-- Published per-operator success rate from the upstream (e.g. 5SIM's `rate`
-- field), 0-100. A cold-start delivery-quality signal so routing can avoid
-- known-bad operators before we've gathered our own 7-day stats. Null when the
-- provider doesn't publish one (TextVerified real numbers, SMSPool).
alter table public.provider_services
  add column if not exists published_success_rate numeric;

comment on column public.provider_services.published_success_rate is
  'Upstream-published operator success rate, 0-100 (e.g. 5SIM prices `rate`). Null if unpublished. Cold-start signal for routing.';
