-- Familiens Madplan: næringsindhold fra Frida (protein, fedt, kulhydrat m.m.)
-- Kør hele filen i Supabase: SQL Editor -> New query -> indsæt -> Run. Kan køres flere gange.

alter table public.recipes add column if not exists nutrition jsonb;
alter table public.dishes add column if not exists nutrition jsonb;

drop function if exists public.save_shared_recipe(text, text, text, text, int, jsonb, int, text);
create or replace function public.save_shared_recipe(key text, title text, url text, image text, servings int, items jsonb,
  kcal int default null, instructions text default null, nutrition jsonb default null)
returns text language plpgsql security definer set search_path = public as $$
declare m members;
begin
  if key is null or length(key) < 20 then raise exception 'Ugyldig delekode'; end if;
  select * into m from members where share_key = key;
  if m.user_id is null then raise exception 'Ugyldig delekode'; end if;
  insert into recipes (family_id, title, url, image, servings_base, items, created_by, suggested, kcal_per_serving, instructions, nutrition)
  values (m.family_id, coalesce(nullif(trim(title), ''), 'Opskrift'), url, image, servings,
          coalesce(items, '[]'::jsonb), m.user_id, m.role = 'child', kcal, instructions, nutrition);
  return m.display_name;
end $$;
grant execute on function public.save_shared_recipe(text, text, text, text, int, jsonb, int, text, jsonb) to anon, authenticated;
