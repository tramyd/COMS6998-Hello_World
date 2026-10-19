create table if not exists public.superadmins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.superadmins enable row level security;

revoke all on table public.superadmins from anon, authenticated;
grant select on table public.superadmins to authenticated;

drop policy if exists "Superadmins can read their own access row" on public.superadmins;
create policy "Superadmins can read their own access row"
  on public.superadmins
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on table public.profiles, public.posts, public.post_votes to authenticated;
grant update (caption) on table public.posts to authenticated;

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.post_votes enable row level security;

drop policy if exists "Superadmins can read all profiles" on public.profiles;
create policy "Superadmins can read all profiles"
  on public.profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.superadmins
      where user_id = (select auth.uid())
    )
  );

drop policy if exists "Superadmins can read all posts" on public.posts;
create policy "Superadmins can read all posts"
  on public.posts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.superadmins
      where user_id = (select auth.uid())
    )
  );

drop policy if exists "Superadmins can update post captions" on public.posts;
create policy "Superadmins can update post captions"
  on public.posts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.superadmins
      where user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.superadmins
      where user_id = (select auth.uid())
    )
  );

drop policy if exists "Superadmins can read all post votes" on public.post_votes;
create policy "Superadmins can read all post votes"
  on public.post_votes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.superadmins
      where user_id = (select auth.uid())
    )
  );
