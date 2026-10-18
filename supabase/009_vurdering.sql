-- Familiens Madplan: AI-vurdering af ugens madplan
-- Kør hele filen i Supabase: SQL Editor -> New query -> indsæt -> Run. Kan køres flere gange.

alter table public.families add column if not exists plan_assessment jsonb;
alter table public.families add column if not exists plan_assessed_at timestamptz;
