-- =============================================================
-- TAILORFLOW — Ajout de l'email au profil (Sprint Clients/Paramètres)
-- Déjà appliqué en base ; conservé ici pour la traçabilité du schéma.
-- =============================================================

alter table public.profiles add column if not exists email varchar(150);

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'employee',
    new.email
  );
  return new;
end;
$$;
