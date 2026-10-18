-- Familiens Madplan: gem opskrifter direkte fra Safari, Instagram og TikTok via en iOS-genvej
-- Kør hele filen i Supabase: SQL Editor -> New query -> indsæt -> Run. Kan køres flere gange.

-- Hver person får sin egen delekode, som genvejen bruger i stedet for at logge ind.
alter table public.members add column if not exists share_key text unique;

create or replace function public.my_share_key(renew boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  select share_key into k from members where user_id = auth.uid();
  if not found then raise exception 'Ikke med i en familie'; end if;
  if k is null or renew then
    -- gen_random_uuid findes altid; to af dem giver en lang, tilfældig kode.
    k := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    update members set share_key = k where user_id = auth.uid();
  end if;
  return k;
end $$;
grant execute on function public.my_share_key(boolean) to authenticated;

-- Kaldes af serveren med delekoden. Børns opskrifter bliver forslag.
create or replace function public.save_shared_recipe(key text, title text, url text, image text, servings int, items jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare m members;
begin
  if key is null or length(key) < 20 then raise exception 'Ugyldig delekode'; end if;
  select * into m from members where share_key = key;
  if m.user_id is null then raise exception 'Ugyldig delekode'; end if;
  insert into recipes (family_id, title, url, image, servings_base, items, created_by, suggested)
  values (m.family_id, coalesce(nullif(trim(title), ''), 'Opskrift'), url, image, servings,
          coalesce(items, '[]'::jsonb), m.user_id, m.role = 'child');
  return m.display_name;
end $$;
grant execute on function public.save_shared_recipe(text, text, text, text, int, jsonb) to anon, authenticated;
