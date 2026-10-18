-- Familiens Madplan: kalorier og fremgangsmåde på opskrifter, og faste varer til indkøbslisten
-- Kør hele filen i Supabase: SQL Editor -> New query -> indsæt -> Run. Kan køres flere gange.

alter table public.recipes add column if not exists kcal_per_serving int;
alter table public.recipes add column if not exists instructions text;
alter table public.dishes add column if not exists kcal_per_serving int;

-- Lister med faste varer, fx "Ugens faste" og "Weekend".
create table if not exists public.shopping_templates (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  name text not null,
  items jsonb not null default '[]',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
alter table public.shopping_templates enable row level security;
drop policy if exists "se faste varer" on public.shopping_templates;
drop policy if exists "ret faste varer" on public.shopping_templates;
create policy "se faste varer" on public.shopping_templates for select using (family_id = my_family());
create policy "ret faste varer" on public.shopping_templates for all
  using (family_id = my_family() and is_parent()) with check (family_id = my_family() and is_parent());

do $$ begin
  alter publication supabase_realtime add table public.shopping_templates;
exception when duplicate_object then null;
end $$;

-- Delingen fra iOS-genvejen gemmer nu også kalorier og fremgangsmåde.
drop function if exists public.save_shared_recipe(text, text, text, text, int, jsonb);
create or replace function public.save_shared_recipe(key text, title text, url text, image text, servings int, items jsonb,
  kcal int default null, instructions text default null)
returns text language plpgsql security definer set search_path = public as $$
declare m members;
begin
  if key is null or length(key) < 20 then raise exception 'Ugyldig delekode'; end if;
  select * into m from members where share_key = key;
  if m.user_id is null then raise exception 'Ugyldig delekode'; end if;
  insert into recipes (family_id, title, url, image, servings_base, items, created_by, suggested, kcal_per_serving, instructions)
  values (m.family_id, coalesce(nullif(trim(title), ''), 'Opskrift'), url, image, servings,
          coalesce(items, '[]'::jsonb), m.user_id, m.role = 'child', kcal, instructions);
  return m.display_name;
end $$;
grant execute on function public.save_shared_recipe(text, text, text, text, int, jsonb, int, text) to anon, authenticated;
