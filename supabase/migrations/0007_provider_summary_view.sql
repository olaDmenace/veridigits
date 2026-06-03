-- Per-provider rollup for /admin/providers. The page used to fetch every
-- provider_services row and group in JS, but the API caps results at 1000 rows
-- and there are 120k+ — so providers with rows outside that window (SMSPool,
-- TextVerified) silently vanished from the summary. Aggregate in the DB instead.
create or replace view public.provider_summary as
select
  provider_slug,
  count(*)::int                                              as total_rows,
  count(*) filter (where is_enabled)::int                    as enabled_rows,
  count(*) filter (where preference_rank > 0)::int           as preferred_rows,
  max(last_synced_at)                                        as last_synced_at,
  min(wholesale_price_cents)
    filter (where wholesale_price_cents is not null)::bigint as cheapest_cents,
  coalesce(sum(recent_received_count), 0)::bigint            as received_7d,
  coalesce(sum(recent_total_count), 0)::bigint               as total_7d
from public.provider_services
group by provider_slug;
