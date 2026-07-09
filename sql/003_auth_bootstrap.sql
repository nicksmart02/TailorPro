-- =============================================================
-- TAILORFLOW — BOOTSTRAP AUTH (Sprint 0)
-- A exécuter APRES 001_schema.sql et 002_rls_policies.sql
-- =============================================================

-- A chaque inscription (auth.users), on crée automatiquement une ligne
-- dans public.profiles avec le rôle par défaut 'employee'.
-- Le full_name est repris depuis les métadonnées passées au signup
-- (voir js/auth.js : options.data.full_name).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'employee'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =============================================================
-- Promotion manuelle du tout premier compte admin
-- A exécuter UNE SEULE FOIS, après la création du premier compte
-- via l'écran d'inscription ou le dashboard Supabase (Authentication > Users).
-- Remplacer l'email ci-dessous par celui du gérant de l'atelier.
-- =============================================================
-- update public.profiles set role = 'admin' where id = (
--   select id from auth.users where email = 'admin@example.com'
-- );
