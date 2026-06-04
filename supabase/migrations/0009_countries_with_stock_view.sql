-- The /buy country list selected country_id from provider_services (120k+ rows)
-- and deduped in JS — but the API caps a plain select at 1000 rows, so only the
-- highest-volume countries' rows made the window and low-volume countries
-- (Denmark, etc.) silently vanished from the picker. Dedupe in the DB instead:
-- this returns one row per country that has any in-stock, priced, enabled
-- listing (~80-120 rows, well under the cap).
create or replace view public.countries_with_stock as
select distinct country_id
from public.provider_services
where is_enabled
  and available_count > 0
  and wholesale_price_cents is not null
  and country_id is not null;

grant select on public.countries_with_stock to anon, authenticated;
