-- =============================================================
-- TAILORFLOW — Protection du compte propriétaire de la plateforme
-- Déjà appliqué en base ; conservé ici pour la traçabilité du schéma.
-- =============================================================
-- L'id ci-dessous correspond à jahadjitse@gmail.com (compte fondateur).

create or replace function public.is_platform_owner()
returns boolean
language sql
security definer
stable
as $$
  select auth.uid() = 'f59108d8-31d6-4578-98bc-68e168ddd482'::uuid;
$$;

create or replace function public.prevent_owner_profile_deletion()
returns trigger
language plpgsql
as $$
begin
  if old.id = 'f59108d8-31d6-4578-98bc-68e168ddd482'::uuid then
    raise exception 'Ce compte est protégé et ne peut pas être supprimé.';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_protect_owner_profile on public.profiles;
create trigger trg_protect_owner_profile
before delete on public.profiles
for each row execute function public.prevent_owner_profile_deletion();

create or replace function public.prevent_owner_deactivation()
returns trigger
language plpgsql
as $$
begin
  if old.id = 'f59108d8-31d6-4578-98bc-68e168ddd482'::uuid and new.is_active = false then
    raise exception 'Ce compte est protégé et ne peut pas être désactivé.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_owner_deactivation on public.profiles;
create trigger trg_protect_owner_deactivation
before update on public.profiles
for each row execute function public.prevent_owner_deactivation();

create or replace function public.prevent_owner_auth_deletion()
returns trigger
language plpgsql
security definer
as $$
begin
  if old.id = 'f59108d8-31d6-4578-98bc-68e168ddd482'::uuid then
    raise exception 'Ce compte est protégé et ne peut pas être supprimé.';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_protect_owner_auth on auth.users;
create trigger trg_protect_owner_auth
before delete on auth.users
for each row execute function public.prevent_owner_auth_deletion();
