-- Familiens Madplan: notifikationer på telefonen
-- Kør hele filen i Supabase: SQL Editor -> New query -> indsæt -> Run. Kan køres flere gange.
-- Bagefter skal adresse og hemmelig kode sættes med set_push_config (se README).

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
