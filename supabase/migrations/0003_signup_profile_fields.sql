-- Signup profile fields: display name + username, and metadata-driven profile creation.
-- Referral is CAPTURE-ONLY: we resolve an entered code to referred_by, but build no
-- crediting/payout logic (the referral system remains dormant by product decision).

set check_function_bodies = off;

-- ============================================================
-- New profile columns
-- ============================================================
alter table public.profiles
  add column if not exists display_name text,
  add column if not exists username text;

-- Usernames are unique case-insensitively; display_name is free-form and optional.
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username))
  where username is not null;

-- ============================================================
-- Username availability check (anon-callable, RLS-safe)
-- The signup form needs to check availability before the user has a session,
-- so this is security definer and returns only a boolean (no row leakage).
-- ============================================================
create or replace function public.username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles
    where lower(username) = lower(trim(candidate))
  );
$$;

grant execute on function public.username_available(text) to anon, authenticated;

-- ============================================================
-- Populate the profile from auth metadata on signup.
-- raw_user_meta_data is set via supabase.auth.signUp({ options: { data } }).
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name  text;
  v_username      text;
  v_referral_code text;
  v_referred_by   uuid;
begin
  v_display_name  := nullif(trim(new.raw_user_meta_data->>'display_name'), '');
  v_username      := nullif(trim(new.raw_user_meta_data->>'username'), '');
  v_referral_code := nullif(trim(new.raw_user_meta_data->>'referral_code'), '');

  -- Capture-only: link to the referrer if their code matches an existing profile.
  -- No wallet credit, no payout — the referral system is intentionally dormant.
  if v_referral_code is not null then
    select id into v_referred_by
      from public.profiles
      where lower(referral_code) = lower(v_referral_code)
      limit 1;
  end if;

  insert into public.profiles (id, display_name, username, referred_by)
    values (new.id, v_display_name, v_username, v_referred_by);
  return new;
end;
$$;
