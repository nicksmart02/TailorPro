-- =============================================================
-- TAILORFLOW — Rôles : Administrateur / Couturier / Client (2/2)
-- A exécuter APRES 019_roles_enum.sql, dans une nouvelle requête.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Migration des comptes existants + défaut des nouvelles inscriptions
-- -------------------------------------------------------------
-- Tout compte "employee"/"accountant" devient "couturier". Le seul "admin"
-- reste le propriétaire de plateforme (déjà distinct via is_platform_owner()).
update public.profiles set role = 'couturier' where role in ('employee', 'accountant');

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
    'couturier',
    new.email
  );
  return new;
end;
$$;

-- -------------------------------------------------------------
-- 2) Lien entre une fiche client (public.clients) et un compte de connexion
-- -------------------------------------------------------------
alter table public.clients add column if not exists user_id uuid references public.profiles(id);
alter table public.clients add column if not exists portal_invite_code varchar(12);

create unique index if not exists idx_clients_user_id on public.clients (user_id) where user_id is not null;
create unique index if not exists idx_clients_invite_code on public.clients (portal_invite_code) where portal_invite_code is not null;

comment on column public.clients.user_id is 'Compte auth du client final (portail), une fois son accès activé.';
comment on column public.clients.portal_invite_code is 'Code à usage unique généré par le couturier pour activer le portail client ; effacé une fois utilisé.';

-- -------------------------------------------------------------
-- 3) Fonctions : génération d'invitation + activation par le client
-- -------------------------------------------------------------

-- Le couturier (propriétaire de la fiche client) génère un code d'invitation.
create or replace function public.generate_client_invite(p_client_id uuid)
returns varchar
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code varchar(12);
begin
  if not exists (select 1 from public.clients where id = p_client_id and owner_id = auth.uid()) then
    raise exception 'Accès refusé.';
  end if;

  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  update public.clients set portal_invite_code = v_code where id = p_client_id;

  return v_code;
end;
$$;

revoke execute on function public.generate_client_invite(uuid) from public;
grant execute on function public.generate_client_invite(uuid) to authenticated;

-- Le client, une fois son compte Supabase Auth créé, "consomme" le code pour lier
-- son compte à sa fiche client existante et se voir attribuer le rôle 'client'.
create or replace function public.claim_client_invite(p_code varchar)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_id uuid;
begin
  select id into v_client_id
  from public.clients
  where portal_invite_code = upper(p_code) and user_id is null;

  if v_client_id is null then
    raise exception 'Code d''invitation invalide ou déjà utilisé.';
  end if;

  update public.clients
  set user_id = auth.uid(), portal_invite_code = null
  where id = v_client_id;

  update public.profiles set role = 'client' where id = auth.uid();

  return true;
end;
$$;

revoke execute on function public.claim_client_invite(varchar) from public;
grant execute on function public.claim_client_invite(varchar) to authenticated;

-- -------------------------------------------------------------
-- 4) RLS : accès en lecture seule du client à son propre espace
-- -------------------------------------------------------------
create policy "clients_select_self" on public.clients
for select using (user_id = auth.uid());

create policy "measurements_select_self" on public.measurements
for select using (exists (
  select 1 from public.clients c where c.id = measurements.client_id and c.user_id = auth.uid()
));

create policy "orders_select_self" on public.orders
for select using (exists (
  select 1 from public.clients c where c.id = orders.client_id and c.user_id = auth.uid()
));

create policy "invoices_select_self" on public.invoices
for select using (exists (
  select 1 from public.orders o
  join public.clients c on c.id = o.client_id
  where o.id = invoices.order_id and c.user_id = auth.uid()
));

create policy "payments_select_self" on public.payments
for select using (exists (
  select 1 from public.invoices i
  join public.orders o on o.id = i.order_id
  join public.clients c on c.id = o.client_id
  where i.id = payments.invoice_id and c.user_id = auth.uid()
));

-- Un client peut lire son propre profil (déjà couvert par la policy
-- "profiles_select_own_or_owner" existante : id = auth.uid()).
