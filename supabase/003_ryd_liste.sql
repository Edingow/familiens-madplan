-- Familiens Madplan: ryd købte varer eller hele indkøbslisten
-- Kør hele filen i Supabase: SQL Editor -> New query -> indsæt -> Run. Kan køres flere gange.

-- names = de købte varer (navne i små bogstaver). Uden names ryddes hele listen (kun forældre).
-- Retterne bliver liggende på madplanen; deres ingredienser markeres blot som klaret.
create or replace function public.clear_list(names text[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare fid uuid := my_family();
begin
  if fid is null then raise exception 'Ikke med i en familie'; end if;
  if names is null and not is_parent() then raise exception 'Kun forældre kan rydde hele listen'; end if;

  update dishes d set items = (
    select coalesce(jsonb_agg(
      case when names is null or lower(regexp_replace(trim(i->>'name'), '\s+', ' ', 'g')) = any(names)
           then i || '{"off": true}'::jsonb else i end
      order by ord), '[]'::jsonb)
    from jsonb_array_elements(d.items) with ordinality as t(i, ord)
  )
  where d.family_id = fid and d.status = 'planned';

  delete from extras e where e.family_id = fid
    and (names is null or lower(regexp_replace(trim(e.name), '\s+', ' ', 'g')) = any(names));

  delete from checks where family_id = fid;
end $$;

grant execute on function public.clear_list(text[]) to authenticated;
