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

-- Afstemning om madplanen (samme som 004_afstemning_madplan.sql) -----------

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

-- Send madplan til afstemning (samme som 005_send_madplan.sql) -------------

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

-- Notifikationer (samme som 006_notifikationer.sql) ------------------------

create extension if not exists pg_net;

-- Indstillinger, som appen ikke kan læse.
create schema if not exists private;
create table if not exists private.config (key text primary key, value text not null);
revoke all on schema private from public, anon, authenticated;

create or replace function private.cfg(k text) returns text language sql stable as $$
  select value from private.config where key = k
$$;

-- Én række pr. telefon, der har slået notifikationer til.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  p256dh text not null,
  auth text not null,
  prefs jsonb not null default '{"list": true, "vote": true, "votes": true}',
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "egne telefoner" on public.push_subscriptions;
create policy "egne telefoner" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and family_id = my_family());

-- Hvornår familien sidst fik en besked om indkøbslisten (så den ikke bliver spammet).
alter table public.families add column if not exists last_list_push_at timestamptz;

create or replace function private.send_push(fid uuid, actor uuid, kind text, title text, body text, only_parents boolean default false)
returns void language plpgsql security definer set search_path = public, private as $$
declare subs jsonb; url text := private.cfg('push_url'); secret text := private.cfg('push_secret');
begin
  if url is null or secret is null then return; end if;
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth))), '[]')
    into subs
    from push_subscriptions s
    join members m on m.user_id = s.user_id and m.family_id = s.family_id
    where s.family_id = fid
      and s.user_id is distinct from actor
      and coalesce((s.prefs ->> kind)::boolean, true)
      and (not only_parents or m.role = 'parent');
  if jsonb_array_length(subs) = 0 then return; end if;
  perform net.http_post(
    url := url,
    body := jsonb_build_object('subscriptions', subs, 'title', title, 'body', body, 'tag', kind),
    headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', secret)
  );
exception when others then
  -- En notifikation må aldrig forhindre, at en vare eller stemme bliver gemt.
  raise warning 'push fejlede: %', sqlerrm;
end $$;

create or replace function private.member_name(uid uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from members where user_id = uid), 'Nogen')
$$;

-- Indkøbslisten: højst én besked pr. 10 minutter pr. familie.
create or replace function private.list_push_allowed(fid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update families set last_list_push_at = now()
    where id = fid and (last_list_push_at is null or last_list_push_at < now() - interval '10 minutes')
    returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function private.on_extra_added() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if private.list_push_allowed(new.family_id) then
    perform private.send_push(new.family_id, new.created_by, 'list', 'Indkøbslisten',
      private.member_name(new.created_by) || ' har tilføjet ' || new.name || ' til indkøbslisten.');
  end if;
  return new;
end $$;

create or replace function private.on_dish_planned() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.status = 'planned' and (tg_op = 'INSERT' or old.status is distinct from 'planned')
     and private.list_push_allowed(new.family_id) then
    perform private.send_push(new.family_id, auth.uid(), 'list', 'Madplanen',
      private.member_name(auth.uid()) || ' har lagt ' || new.title || ' på madplanen. Ingredienserne er på indkøbslisten.');
  end if;
  return new;
end $$;

create or replace function private.on_vote_sent() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.plan_vote_open and not coalesce(old.plan_vote_open, false) then
    perform private.send_push(new.id, auth.uid(), 'vote', 'Ny afstemning',
      private.member_name(auth.uid()) || ' har sendt ugens madplan til afstemning. Sig din mening.');
  end if;
  return new;
end $$;

create or replace function private.on_review_done() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare dislikes text;
begin
  select string_agg(d.title, ', ' order by d.plan_date nulls last) into dislikes
    from votes v join dishes d on d.id = v.dish_id
    where v.user_id = new.user_id and v.value = -1 and d.family_id = new.family_id and d.status = 'planned';
  perform private.send_push(new.family_id, new.user_id, 'votes', 'Afstemning',
    private.member_name(new.user_id) || ' har stemt: ' ||
    coalesce('ikke for ' || dislikes || '.', 'madplanen er fin.'), true);
  return new;
end $$;

drop trigger if exists push_extra_added on public.extras;
create trigger push_extra_added after insert on public.extras for each row execute function private.on_extra_added();
drop trigger if exists push_dish_planned on public.dishes;
create trigger push_dish_planned after insert or update of status on public.dishes for each row execute function private.on_dish_planned();
drop trigger if exists push_vote_sent on public.families;
create trigger push_vote_sent after update of plan_vote_open on public.families for each row execute function private.on_vote_sent();
drop trigger if exists push_review_done on public.plan_reviews;
create trigger push_review_done after insert on public.plan_reviews for each row execute function private.on_review_done();

-- Kun til opsætning: sæt adresse og hemmelig kode. Kør den én gang fra SQL Editor.
create or replace function private.set_push_config(push_url text, push_secret text) returns void
language sql security definer set search_path = private as $$
  insert into config(key, value) values ('push_url', push_url), ('push_secret', push_secret)
  on conflict (key) do update set value = excluded.value;
$$;
revoke all on function private.set_push_config(text, text) from public, anon, authenticated;
