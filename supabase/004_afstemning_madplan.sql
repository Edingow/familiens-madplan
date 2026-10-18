-- Familiens Madplan: afstemning om selve madplanen, og børnenes forslag i Opskrifter
-- Kør hele filen i Supabase: SQL Editor -> New query -> indsæt -> Run. Kan køres flere gange.

-- En markering betyder "ikke for mig" med en valgfri kort kommentar.
alter table public.votes add column if not exists comment text;
alter table public.votes drop constraint if exists votes_comment_length;
alter table public.votes add constraint votes_comment_length check (comment is null or char_length(comment) <= 200);

drop policy if exists "stem" on public.votes;
drop policy if exists "skift stemme" on public.votes;
create policy "stem" on public.votes for insert with check (
  user_id = auth.uid() and exists(select 1 from dishes d where d.id = dish_id and d.family_id = my_family() and d.status in ('planned', 'voting')));
create policy "skift stemme" on public.votes for update using (user_id = auth.uid())
  with check (exists(select 1 from dishes d where d.id = dish_id and d.family_id = my_family() and d.status in ('planned', 'voting')));

-- Børnenes forslag ligger i Opskrifter med et mærke, indtil en forælder har taget stilling.
alter table public.recipes add column if not exists suggested boolean not null default false;

-- Gamle afstemninger om enkelte retter bliver til forslag i Opskrifter.
update public.recipes r set suggested = true
  where exists(select 1 from public.dishes d where d.recipe_id = r.id and d.status = 'voting');
insert into public.recipes (family_id, title, url, image, note, servings_base, items, created_by, created_at, suggested)
  select family_id, title, url, image, note, servings_base, items, created_by, created_at, true
  from public.dishes where status = 'voting' and recipe_id is null;
delete from public.dishes where status = 'voting';
