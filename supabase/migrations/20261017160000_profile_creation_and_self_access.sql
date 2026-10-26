grant select, insert on table public.profiles to authenticated;
grant update (first_name, last_name, profile_picture_url) on table public.profiles to authenticated;

alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  full_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', '')
  );
begin
  if new.email is null then
    return new;
  end if;

  insert into public.profiles (id, email, first_name, last_name, profile_picture_url)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(split_part(full_name, ' ', 1), '')
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'last_name', ''),
      case
        when position(' ' in full_name) > 0
          then nullif(substring(full_name from position(' ' in full_name) + 1), '')
        else null
      end
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

insert into public.profiles (id, email, first_name, last_name, profile_picture_url)
select
  users.id,
  users.email,
  coalesce(
    nullif(users.raw_user_meta_data ->> 'first_name', ''),
    nullif(split_part(names.full_name, ' ', 1), '')
  ),
  coalesce(
    nullif(users.raw_user_meta_data ->> 'last_name', ''),
    case
      when position(' ' in names.full_name) > 0
        then nullif(substring(names.full_name from position(' ' in names.full_name) + 1), '')
      else null
    end
  ),
  coalesce(
    nullif(users.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(users.raw_user_meta_data ->> 'picture', '')
  )
from auth.users as users
cross join lateral (
  select coalesce(
    nullif(users.raw_user_meta_data ->> 'full_name', ''),
    nullif(users.raw_user_meta_data ->> 'name', '')
  ) as full_name
) as names
where users.email is not null
on conflict (id) do nothing;
