-- Familiens Madplan: opskrifter som egen fane (kogebog)
-- Kør hele filen i Supabase: SQL Editor -> New query -> indsæt -> Run. Kan køres flere gange.

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  title text not null,
  url text,
  image text,
  note text,
  servings_base int,
  items jsonb not null default '[]',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists recipes_family on public.recipes (family_id, created_at desc);

alter table public.dishes add column if not exists recipe_id uuid references public.recipes on delete set null;

-- Flyt opskrifter, der allerede ligger på madplanen eller til afstemning, over i kogebogen.
do $$
declare d record; rid uuid;
begin
  for d in select * from public.dishes
           where recipe_id is null and (url is not null or jsonb_array_length(items) > 0)
  loop
    insert into public.recipes (family_id, title, url, image, note, servings_base, items, created_by, created_at)
    values (d.family_id, d.title, d.url, d.image, d.note, d.servings_base,
            (select coalesce(jsonb_agg(i - 'off'), '[]'::jsonb) from jsonb_array_elements(d.items) i),
            d.created_by, d.created_at)
    returning id into rid;
    update public.dishes set recipe_id = rid where id = d.id;
  end loop;
end $$;

alter table public.recipes enable row level security;

drop policy if exists "se opskrifter" on public.recipes;
drop policy if exists "gem opskrift" on public.recipes;
drop policy if exists "ret opskrift" on public.recipes;
drop policy if exists "slet opskrift" on public.recipes;
create policy "se opskrifter" on public.recipes for select using (family_id = my_family());
create policy "gem opskrift" on public.recipes for insert with check (family_id = my_family() and created_by = auth.uid());
create policy "ret opskrift" on public.recipes for update using (family_id = my_family() and (is_parent() or created_by = auth.uid()));
create policy "slet opskrift" on public.recipes for delete using (family_id = my_family() and (is_parent() or created_by = auth.uid()));

do $$ begin
  alter publication supabase_realtime add table public.recipes;
exception when duplicate_object then null;
end $$;
