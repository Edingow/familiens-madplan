-- Familiens Madplan: database
-- Kør hele filen i Supabase: SQL Editor -> New query -> indsæt -> Run.

create extension if not exists pgcrypto;

-- Familier ---------------------------------------------------------------
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  child_code  text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  category_order text[] not null default
    '{frugt,brod,kod,mejeri,kol,kolonial,krydderi,frost,drikke,andet}',
  created_at timestamptz not null default now()
);

create table public.members (
  family_id uuid not null references public.families on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  display_name text not null,
  role text not null check (role in ('parent', 'child')),
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
create unique index members_one_family on public.members (user_id);

-- Retter: både idéer, opskrifter på afstemning og retter på madplanen ------
create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  title text not null,
  url text,
  image text,
  note text,
  servings_base int,
  servings int,
  items jsonb not null default '[]',
  status text not null check (status in ('voting', 'planned', 'done')),
  plan_date date,
  vote_deadline timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index dishes_family on public.dishes (family_id, status);

create table public.votes (
  dish_id uuid not null references public.dishes on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  value smallint not null check (value in (-1, 1)),
  primary key (dish_id, user_id)
);

-- Ekstra varer (tilføjet i hånden eller scannet) --------------------------
create table public.extras (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  name text not null,
  qty numeric,
  unit text not null default '',
  category text not null default 'andet',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

-- Flueben på indkøbslisten -------------------------------------------------
create table public.checks (
  family_id uuid not null references public.families on delete cascade,
  item_key text not null,
  checked_by uuid references auth.users on delete set null,
  checked_at timestamptz not null default now(),
  primary key (family_id, item_key)
);

-- Hjælpefunktioner -------------------------------------------------------
create or replace function public.my_family() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from members where user_id = auth.uid()
$$;

create or replace function public.is_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from members where user_id = auth.uid() and role = 'parent')
$$;

create or replace function public.create_family(family_name text, my_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception 'Ikke logget ind'; end if;
  if exists(select 1 from members where user_id = auth.uid()) then
    raise exception 'Du er allerede med i en familie';
  end if;
  insert into families(name) values (family_name) returning id into fid;
  insert into members(family_id, user_id, display_name, role) values (fid, auth.uid(), my_name, 'parent');
  return fid;
end $$;

create or replace function public.join_family(code text, my_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare f families; r text;
begin
  if auth.uid() is null then raise exception 'Ikke logget ind'; end if;
  if exists(select 1 from members where user_id = auth.uid()) then
    raise exception 'Du er allerede med i en familie';
  end if;
  select * into f from families where parent_code = upper(trim(code)) or child_code = upper(trim(code));
  if f.id is null then raise exception 'Koden findes ikke'; end if;
  r := case when f.parent_code = upper(trim(code)) then 'parent' else 'child' end;
  insert into members(family_id, user_id, display_name, role) values (f.id, auth.uid(), my_name, r);
  return f.id;
end $$;

-- "Ny uge": flyt planlagte retter til arkiv, ryd ekstra varer og flueben.
create or replace function public.new_week() returns void
language plpgsql security definer set search_path = public as $$
declare fid uuid := my_family();
begin
  if not is_parent() then raise exception 'Kun forældre kan starte en ny uge'; end if;
  update dishes set status = 'done' where family_id = fid and status = 'planned';
  delete from extras where family_id = fid;
  delete from checks where family_id = fid;
end $$;

-- Adgangsregler ----------------------------------------------------------
alter table public.families enable row level security;
alter table public.members  enable row level security;
alter table public.dishes   enable row level security;
alter table public.votes    enable row level security;
alter table public.extras   enable row level security;
alter table public.checks   enable row level security;

create policy "se egen familie" on public.families for select using (id = my_family());
create policy "forældre ændrer familie" on public.families for update using (id = my_family() and is_parent());

create policy "se familiemedlemmer" on public.members for select using (family_id = my_family());
create policy "ret eget navn" on public.members for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "se retter" on public.dishes for select using (family_id = my_family());
create policy "tilføj ret" on public.dishes for insert with check (
  family_id = my_family() and created_by = auth.uid() and (is_parent() or status = 'voting'));
create policy "forældre ændrer retter" on public.dishes for update using (family_id = my_family() and is_parent());
create policy "slet ret" on public.dishes for delete using (
  family_id = my_family() and (is_parent() or (created_by = auth.uid() and status = 'voting')));

create policy "se stemmer" on public.votes for select using (
  exists(select 1 from dishes d where d.id = dish_id and d.family_id = my_family()));
create policy "stem" on public.votes for insert with check (
  user_id = auth.uid() and exists(select 1 from dishes d where d.id = dish_id and d.family_id = my_family() and d.status = 'voting'));
create policy "skift stemme" on public.votes for update using (user_id = auth.uid())
  with check (exists(select 1 from dishes d where d.id = dish_id and d.family_id = my_family() and d.status = 'voting'));
create policy "fjern stemme" on public.votes for delete using (user_id = auth.uid());

create policy "se ekstra varer" on public.extras for select using (family_id = my_family());
create policy "tilføj ekstra vare" on public.extras for insert with check (family_id = my_family() and created_by = auth.uid());
create policy "slet ekstra vare" on public.extras for delete using (family_id = my_family() and (is_parent() or created_by = auth.uid()));

create policy "se flueben" on public.checks for select using (family_id = my_family());
create policy "sæt flueben" on public.checks for insert with check (family_id = my_family());
create policy "fjern flueben" on public.checks for delete using (family_id = my_family());

grant execute on function public.create_family(text, text), public.join_family(text, text), public.new_week() to authenticated;

-- Live opdatering mellem telefoner ----------------------------------------
alter publication supabase_realtime add table public.dishes, public.votes, public.extras, public.checks, public.members, public.families;

-- Opskrifter (samme som 002_opskrifter.sql) -----------------------------

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

-- Ryd liste (samme som 003_ryd_liste.sql) --------------------------------

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
