-- =============================================================
-- TAILORFLOW — Nom de l'établissement / du couturier
-- A exécuter dans l'éditeur SQL Supabase, après 017.
-- =============================================================

-- Nom affiché dans la barre de navigation ("TailorFlow {établissement}").
-- Reste optionnel : tant qu'il n'est pas renseigné, seul "TailorFlow" s'affiche.
alter table public.profiles
  add column if not exists establishment_name varchar(150);

comment on column public.profiles.establishment_name is
  'Nom du couturier ou de l''établissement, affiché dans la nav après "TailorFlow". Modifiable par l''utilisateur lui-même depuis Paramètres.';

-- Aucune politique RLS supplémentaire nécessaire : la mise à jour de son propre
-- profil est déjà couverte par la policy "profiles_update_own_or_owner"
-- (006_saas_multitenancy.sql), qui autorise id = auth.uid().
