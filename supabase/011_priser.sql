-- Familiens Madplan: præferencer til prissammenligning og onlinekøb (økologi, mærker, butikker)
-- Kør hele filen i Supabase: SQL Editor -> New query -> indsæt -> Run. Kan køres flere gange.

alter table public.families add column if not exists shop_prefs jsonb not null default '{}'::jsonb;
