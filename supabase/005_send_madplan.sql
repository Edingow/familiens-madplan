-- Familiens Madplan: send madplanen til afstemning, med forslag til andre retter
-- Kør hele filen i Supabase: SQL Editor -> New query -> indsæt -> Run. Kan køres flere gange.

alter table public.families add column if not exists plan_vote_open boolean not null default false;
alter table public.families add column if not exists plan_vote_sent_at timestamptz;

-- Den, der ikke synes om en ret, kan foreslå en anden fra Opskrifter.
alter table public.votes add column if not exists suggestion_recipe_id uuid references public.recipes on delete set null;

-- Hvem har kigget planen igennem i den nuværende afstemning.
create table if not exists public.plan_reviews (
  family_id uuid not null references public.families on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  reviewed_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
alter table public.plan_reviews enable row level security;
drop policy if exists "se gennemgange" on public.plan_reviews;
drop policy if exists "marker gennemgået" on public.plan_reviews;
drop policy if exists "fjern gennemgået" on public.plan_reviews;
create policy "se gennemgange" on public.plan_reviews for select using (family_id = my_family());
create policy "marker gennemgået" on public.plan_reviews for insert with check (family_id = my_family() and user_id = auth.uid());
create policy "fjern gennemgået" on public.plan_reviews for delete using (family_id = my_family() and user_id = auth.uid());

create or replace function public.send_plan_vote() returns void
language plpgsql security definer set search_path = public as $$
declare fid uuid := my_family();
begin
  if not is_parent() then raise exception 'Kun forældre kan sende madplanen til afstemning'; end if;
  delete from plan_reviews where family_id = fid;
  update families set plan_vote_open = true, plan_vote_sent_at = now() where id = fid;
end $$;

create or replace function public.close_plan_vote() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_parent() then raise exception 'Kun forældre kan lukke afstemningen'; end if;
  update families set plan_vote_open = false where id = my_family();
end $$;

-- Ny uge lukker også afstemningen.
create or replace function public.new_week() returns void
language plpgsql security definer set search_path = public as $$
declare fid uuid := my_family();
begin
  if not is_parent() then raise exception 'Kun forældre kan starte en ny uge'; end if;
  update dishes set status = 'done' where family_id = fid and status = 'planned';
  delete from extras where family_id = fid;
  delete from checks where family_id = fid;
  delete from plan_reviews where family_id = fid;
  update families set plan_vote_open = false where id = fid;
end $$;

grant execute on function public.send_plan_vote(), public.close_plan_vote(), public.new_week() to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.plan_reviews;
exception when duplicate_object then null;
end $$;
