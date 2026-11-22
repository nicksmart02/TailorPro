-- =============================================================
-- TAILORFLOW — Migration 023 : sécurité, intégrité des données,
-- numérotation par atelier, administration de la plateforme.
-- =============================================================
-- À exécuter dans l'éditeur SQL Supabase APRÈS 022, en UNE seule fois,
-- AVANT de déployer la nouvelle version du frontend (v3).
--
-- Ce script est rejouable sans risque (create or replace / if not exists).
-- Il ne supprime aucune donnée métier.
--
-- Corrige notamment :
--  1. Un utilisateur pouvait modifier lui-même son rôle / statut via l'API.
--  2. N'importe qui pouvait se rattacher à la fiche client d'un inconnu
--     (et voir ses mesures, commandes, factures) en saisissant son numéro
--     de téléphone. Le rattachement par téléphone devient une DEMANDE que
--     le couturier valide en un clic. Le code d'invitation reste immédiat.
--  3. Le téléphone client était unique sur TOUTE la plateforme : deux
--     couturiers ne pouvaient pas enregistrer le même client.
--  4. L'abonnement n'était vérifié que dans le navigateur : il est
--     désormais exigé par la base pour toute écriture.
--  5. Le montant d'une demande de paiement était fixé par le navigateur.
--  6. Paiements supérieurs au solde, suppression de paiement sans recalcul,
--     modification du prix sans mise à jour de la facture, commande créée
--     directement au statut "remis" : tous bloqués côté base.
--  7. Numérotation CMD/FAC partagée entre tous les ateliers : chaque atelier
--     a désormais sa propre séquence (CMD-2026-0001, FAC-2026-0001...).
--  8. Les noms d'ateliers n'étaient pas lisibles par les clients (RLS) :
--     la marketplace et le portail affichaient "Atelier" partout.
-- =============================================================


-- -------------------------------------------------------------
-- 0. Fonctions utilitaires
-- -------------------------------------------------------------

-- Atelier actif = propriétaire de la plateforme, ou essai/abonnement en cours.
create or replace function public.workspace_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_platform_owner() or public.has_active_access(auth.uid());
$$;
revoke execute on function public.workspace_active() from public;
grant execute on function public.workspace_active() to authenticated;

-- Tarifs officiels (source de vérité côté serveur).
create or replace function public.plan_price(p_plan text)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_plan when 'mensuel' then 10000 when 'annuel' then 100000 end::numeric;
$$;

create or replace function public.plan_duration(p_plan text)
returns interval
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_plan when 'mensuel' then interval '30 days' when 'annuel' then interval '365 days' end;
$$;

-- Normalisation d'un numéro de téléphone : chiffres uniquement, sans "00"
-- initial ni indicatif pays ouest-africain (221 à 229).
create or replace function public.normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  d text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if left(d, 2) = '00' then
    d := substr(d, 3);
  end if;
  if length(d) >= 11 and left(d, 2) = '22' then
    d := substr(d, 4);
  end if;
  return nullif(d, '');
end;
$$;


-- -------------------------------------------------------------
-- 1. PROFILS : champs sensibles non modifiables via l'API
-- -------------------------------------------------------------
alter table public.profiles add column if not exists establishment_phone varchar(30);
alter table public.profiles add column if not exists establishment_address text;

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Appel direct depuis l'application (rôle "authenticated") : seuls le nom,
  -- le téléphone et les informations d'atelier sont modifiables. Les fonctions
  -- SECURITY DEFINER (choix du rôle, invitation...) ne sont pas concernées.
  if current_user in ('authenticated', 'anon') and not public.is_platform_owner() then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email
       or new.id is distinct from old.id then
      raise exception 'MODIFICATION_INTERDITE' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_update on public.profiles;
create trigger trg_guard_profile_update
before update on public.profiles
for each row execute function public.guard_profile_update();


-- -------------------------------------------------------------
-- 2. CLIENTS : téléphone unique PAR ATELIER (et non plus global)
-- -------------------------------------------------------------
alter table public.clients drop constraint if exists clients_phone_key;
create unique index if not exists idx_clients_owner_phone on public.clients (owner_id, phone);

alter table public.clients
  add column if not exists phone_normalized text
  generated always as (public.normalize_phone(phone)) stored;
create index if not exists idx_clients_phone_normalized on public.clients (phone_normalized);


-- -------------------------------------------------------------
-- 3. RATTACHEMENT CLIENT ↔ COUTURIER : demandes validées par le couturier
-- -------------------------------------------------------------
create table if not exists public.client_link_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status varchar(10) not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (client_id, user_id)
);
create index if not exists idx_link_requests_owner on public.client_link_requests (owner_id, status);
create index if not exists idx_link_requests_user on public.client_link_requests (user_id, status);

alter table public.client_link_requests enable row level security;
drop policy if exists "link_requests_select_owner" on public.client_link_requests;
create policy "link_requests_select_owner" on public.client_link_requests
  for select using (owner_id = auth.uid());
-- Aucune écriture directe : uniquement via les fonctions ci-dessous.

-- Crée une demande pour chaque fiche client (chez n'importe quel couturier)
-- portant ce numéro et pas encore liée à un compte. Fonction interne.
create or replace function public.request_client_links(p_user uuid, p_phone text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_norm text := public.normalize_phone(p_phone);
  v_count integer;
begin
  if v_norm is null or length(v_norm) < 8 then
    raise exception 'TELEPHONE_INVALIDE' using errcode = 'P0001';
  end if;

  insert into public.client_link_requests (client_id, user_id, owner_id)
  select c.id, p_user, c.owner_id
  from public.clients c
  where c.phone_normalized = v_norm
    and c.user_id is null
    and c.owner_id <> p_user
  on conflict (client_id, user_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.request_client_links(uuid, text) from public;

-- Choix du rôle "client" : enregistre le téléphone et envoie les demandes.
create or replace function public.activate_client_role(p_full_name varchar, p_phone varchar)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_norm text := public.normalize_phone(p_phone);
begin
  if v_norm is null or length(v_norm) < 8 then
    raise exception 'TELEPHONE_INVALIDE' using errcode = 'P0001';
  end if;

  update public.profiles
  set role = 'client',
      full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      phone = trim(p_phone)
  where id = auth.uid() and role = 'pending';

  if not found then
    raise exception 'ROLE_DEJA_ATTRIBUE' using errcode = 'P0001';
  end if;

  return public.request_client_links(auth.uid(), p_phone);
end;
$$;
revoke execute on function public.activate_client_role(varchar, varchar) from public;
grant execute on function public.activate_client_role(varchar, varchar) to authenticated;

-- "Rechercher mes couturiers" depuis le portail client.
create or replace function public.relink_client_by_phone()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone varchar;
begin
  select phone into v_phone from public.profiles where id = auth.uid() and role = 'client';
  if v_phone is null then
    raise exception 'TELEPHONE_INVALIDE' using errcode = 'P0001';
  end if;
  return public.request_client_links(auth.uid(), v_phone);
end;
$$;
revoke execute on function public.relink_client_by_phone() from public;
grant execute on function public.relink_client_by_phone() to authenticated;

-- Le client voit seulement le NOMBRE de demandes en attente (pas chez qui :
-- sinon saisir le numéro d'un tiers révélerait ses couturiers).
create or replace function public.my_pending_link_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer from public.client_link_requests
  where user_id = auth.uid() and status = 'pending';
$$;
revoke execute on function public.my_pending_link_count() from public;
grant execute on function public.my_pending_link_count() to authenticated;

-- Liste des demandes en attente pour le couturier connecté.
create or replace function public.pending_link_requests()
returns table (
  request_id uuid,
  client_id uuid,
  client_name text,
  client_phone text,
  requester_name text,
  requester_phone text,
  requested_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, c.id, c.full_name::text, c.phone::text, p.full_name::text, p.phone::text, r.created_at
  from public.client_link_requests r
  join public.clients c on c.id = r.client_id
  join public.profiles p on p.id = r.user_id
  where r.owner_id = auth.uid() and r.status = 'pending'
  order by r.created_at asc;
$$;
revoke execute on function public.pending_link_requests() from public;
grant execute on function public.pending_link_requests() to authenticated;

create or replace function public.approve_client_link(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select * into r from public.client_link_requests
  where id = p_request_id and owner_id = auth.uid() and status = 'pending'
  for update;
  if not found then
    raise exception 'DEMANDE_INTROUVABLE' using errcode = 'P0001';
  end if;

  update public.clients set user_id = r.user_id
  where id = r.client_id and owner_id = auth.uid() and user_id is null;
  if not found then
    raise exception 'FICHE_DEJA_LIEE' using errcode = 'P0001';
  end if;

  update public.client_link_requests set status = 'approved', reviewed_at = now() where id = p_request_id;
  update public.client_link_requests set status = 'rejected', reviewed_at = now()
  where client_id = r.client_id and status = 'pending' and id <> p_request_id;
end;
$$;
revoke execute on function public.approve_client_link(uuid) from public;
grant execute on function public.approve_client_link(uuid) to authenticated;

create or replace function public.reject_client_link(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.client_link_requests set status = 'rejected', reviewed_at = now()
  where id = p_request_id and owner_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'DEMANDE_INTROUVABLE' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.reject_client_link(uuid) from public;
grant execute on function public.reject_client_link(uuid) to authenticated;

-- Code d'invitation : ne transforme jamais un compte couturier en client.
create or replace function public.claim_client_invite(p_code varchar)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_id uuid;
  v_role text;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role is null then
    raise exception 'COMPTE_INTROUVABLE' using errcode = 'P0001';
  end if;
  if v_role not in ('pending', 'client') then
    raise exception 'COMPTE_COUTURIER' using errcode = 'P0001';
  end if;

  select id into v_client_id
  from public.clients
  where portal_invite_code = upper(trim(p_code)) and user_id is null
  for update;

  if v_client_id is null then
    raise exception 'CODE_INVALIDE' using errcode = 'P0001';
  end if;

  update public.clients set user_id = auth.uid(), portal_invite_code = null where id = v_client_id;
  update public.profiles set role = 'client' where id = auth.uid() and role::text = 'pending';
  update public.client_link_requests set status = 'rejected', reviewed_at = now()
  where client_id = v_client_id and status = 'pending';

  return true;
end;
$$;
revoke execute on function public.claim_client_invite(varchar) from public;
grant execute on function public.claim_client_invite(varchar) to authenticated;


-- -------------------------------------------------------------
-- 4. INFORMATIONS PUBLIQUES DES ATELIERS (marketplace, portail, reçus)
-- -------------------------------------------------------------
create or replace function public.public_establishments(p_ids uuid[] default null)
returns table (id uuid, display_name text, phone text, address text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id,
         coalesce(nullif(trim(p.establishment_name), ''), p.full_name)::text,
         p.establishment_phone::text,
         p.establishment_address::text
  from public.profiles p
  where p.is_active
    and p.role::text in ('couturier', 'admin', 'employee', 'accountant')
    and (p_ids is null or p.id = any(p_ids));
$$;
revoke execute on function public.public_establishments(uuid[]) from public;
grant execute on function public.public_establishments(uuid[]) to authenticated;

-- Vue inutilisée par le frontend et exposée sans RLS : retirée.
drop view if exists public.marketplace_establishments;


-- -------------------------------------------------------------
-- 5. ABONNEMENTS : statut, demandes de paiement, administration
-- -------------------------------------------------------------
alter table public.payment_requests add column if not exists operator varchar(20);
alter table public.payment_requests add column if not exists transaction_ref varchar(100);

-- Politiques réécrites intégralement (lecture seule depuis l'application ;
-- toute modification passe par des fonctions contrôlées).
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('subscriptions', 'payment_requests')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "subscriptions_select_own_or_owner" on public.subscriptions
  for select using (owner_id = auth.uid() or public.is_platform_owner());

create policy "payment_requests_select_own_or_owner" on public.payment_requests
  for select using (owner_id = auth.uid() or public.is_platform_owner());
create policy "payment_requests_insert_own" on public.payment_requests
  for insert with check (owner_id = auth.uid());

-- Le montant, le statut et le propriétaire d'une demande sont imposés par la base.
create or replace function public.guard_payment_request()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.owner_id := auth.uid();
    new.status := 'pending';
    new.submitted_at := now();
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.amount := public.plan_price(new.plan::text);
    if new.amount is null then
      raise exception 'FORMULE_INCONNUE' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.payment_requests where owner_id = new.owner_id and status = 'pending') then
      raise exception 'DEMANDE_DEJA_EN_ATTENTE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_payment_request on public.payment_requests;
create trigger trg_guard_payment_request
before insert on public.payment_requests
for each row execute function public.guard_payment_request();

-- Prolonge (ou crée) l'abonnement d'un atelier. Fonction interne.
-- Les jours d'essai ou d'abonnement restants sont conservés.
create or replace function public.extend_subscription(p_owner_id uuid, p_plan text)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_duration interval := public.plan_duration(p_plan);
  v_sub record;
  v_new_end timestamptz;
begin
  if v_duration is null then
    raise exception 'FORMULE_INCONNUE' using errcode = 'P0001';
  end if;

  select * into v_sub from public.subscriptions where owner_id = p_owner_id for update;

  if found then
    v_new_end := greatest(
      coalesce(v_sub.current_period_end, now()),
      case when v_sub.status::text = 'trial' then coalesce(v_sub.trial_ends_at, now()) else now() end,
      now()
    ) + v_duration;

    update public.subscriptions
    set plan = p_plan::subscription_plan,
        status = 'active',
        current_period_end = v_new_end,
        updated_at = now()
    where owner_id = p_owner_id;
  else
    v_new_end := now() + v_duration;
    insert into public.subscriptions (owner_id, plan, status, current_period_end)
    values (p_owner_id, p_plan::subscription_plan, 'active', v_new_end);
  end if;

  return v_new_end;
end;
$$;
revoke execute on function public.extend_subscription(uuid, text) from public;

create or replace function public.approve_payment_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request record;
begin
  if not public.is_platform_owner() then
    raise exception 'NON_AUTORISE' using errcode = '42501';
  end if;

  select * into v_request from public.payment_requests
  where id = p_request_id and status = 'pending'
  for update;
  if not found then
    raise exception 'DEMANDE_INTROUVABLE' using errcode = 'P0001';
  end if;

  perform public.extend_subscription(v_request.owner_id, v_request.plan::text);

  update public.payment_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id;
end;
$$;
revoke execute on function public.approve_payment_request(uuid) from public;
grant execute on function public.approve_payment_request(uuid) to authenticated;

create or replace function public.reject_payment_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'NON_AUTORISE' using errcode = '42501';
  end if;
  update public.payment_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'DEMANDE_INTROUVABLE' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.reject_payment_request(uuid) from public;
grant execute on function public.reject_payment_request(uuid) to authenticated;

-- Abonnement offert / encaissé hors application (espèces...) par le propriétaire.
create or replace function public.admin_grant_subscription(p_owner_id uuid, p_plan text)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'NON_AUTORISE' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_owner_id and role::text in ('couturier', 'admin', 'employee', 'accountant')) then
    raise exception 'COMPTE_INTROUVABLE' using errcode = 'P0001';
  end if;
  return public.extend_subscription(p_owner_id, p_plan);
end;
$$;
revoke execute on function public.admin_grant_subscription(uuid, text) from public;
grant execute on function public.admin_grant_subscription(uuid, text) to authenticated;

-- Statut d'abonnement de l'utilisateur connecté (une seule requête au chargement).
create or replace function public.my_subscription()
returns table (
  status text,
  plan text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  has_access boolean,
  is_platform_owner boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.status::text, s.plan::text, s.trial_ends_at, s.current_period_end,
         public.workspace_active(), public.is_platform_owner()
  from (select 1) as one
  left join public.subscriptions s on s.owner_id = auth.uid();
$$;
revoke execute on function public.my_subscription() from public;
grant execute on function public.my_subscription() to authenticated;

-- Vue d'ensemble des comptes pour le propriétaire de la plateforme.
create or replace function public.admin_accounts()
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  is_active boolean,
  establishment_name text,
  created_at timestamptz,
  subscription_status text,
  plan text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  has_access boolean,
  clients_count bigint,
  orders_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_platform_owner() then
    raise exception 'NON_AUTORISE' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name::text, p.email::text, p.role::text, p.is_active,
         p.establishment_name::text, p.created_at,
         s.status::text, s.plan::text, s.trial_ends_at, s.current_period_end,
         public.has_active_access(p.id),
         (select count(*) from public.clients c where c.owner_id = p.id),
         (select count(*) from public.orders o where o.owner_id = p.id)
  from public.profiles p
  left join public.subscriptions s on s.owner_id = p.id
  order by p.created_at desc;
end;
$$;
revoke execute on function public.admin_accounts() from public;
grant execute on function public.admin_accounts() to authenticated;

-- Choix du rôle couturier : ne recrée pas d'essai si une ligne existe déjà.
create or replace function public.activate_couturier_role()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles set role = 'couturier' where id = auth.uid() and role = 'pending';
  if not found then
    raise exception 'ROLE_DEJA_ATTRIBUE' using errcode = 'P0001';
  end if;
  perform public.seed_default_garment_types(auth.uid());
  if not exists (select 1 from public.subscriptions where owner_id = auth.uid()) then
    insert into public.subscriptions (owner_id, status, trial_ends_at)
    values (auth.uid(), 'trial', now() + interval '14 days');
  end if;
end;
$$;
revoke execute on function public.activate_couturier_role() from public;
grant execute on function public.activate_couturier_role() to authenticated;


-- -------------------------------------------------------------
-- 6. COMMANDES & FACTURES : propriétaire dénormalisé + numérotation par atelier
-- -------------------------------------------------------------
alter table public.orders add column if not exists owner_id uuid references public.profiles(id);
update public.orders o set owner_id = c.owner_id
from public.clients c where c.id = o.client_id and o.owner_id is null;
alter table public.orders alter column owner_id set not null;

alter table public.invoices add column if not exists owner_id uuid references public.profiles(id);
update public.invoices i set owner_id = o.owner_id
from public.orders o where o.id = i.order_id and i.owner_id is null;
alter table public.invoices alter column owner_id set not null;

create index if not exists idx_orders_owner_created on public.orders (owner_id, created_at desc);
create index if not exists idx_orders_owner_status_due on public.orders (owner_id, status, due_date);
create index if not exists idx_invoices_owner_issued on public.invoices (owner_id, issued_at desc);

-- Compteurs de numérotation par atelier et par année.
create table if not exists public.document_counters (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  doc_type varchar(10) not null,
  year integer not null,
  last_value integer not null default 0,
  primary key (owner_id, doc_type, year)
);
alter table public.document_counters enable row level security;
-- Aucune politique : table accessible uniquement aux fonctions internes.

-- Reprise des numéros existants (évite toute collision avec l'historique).
insert into public.document_counters (owner_id, doc_type, year, last_value)
select owner_id, 'CMD', split_part(order_number, '-', 2)::int, max(split_part(order_number, '-', 3)::int)
from public.orders
where order_number ~ '^CMD-[0-9]{4}-[0-9]+$'
group by owner_id, split_part(order_number, '-', 2)::int
on conflict (owner_id, doc_type, year)
do update set last_value = greatest(public.document_counters.last_value, excluded.last_value);

insert into public.document_counters (owner_id, doc_type, year, last_value)
select owner_id, 'FAC', split_part(invoice_number, '-', 2)::int, max(split_part(invoice_number, '-', 3)::int)
from public.invoices
where invoice_number ~ '^FAC-[0-9]{4}-[0-9]+$'
group by owner_id, split_part(invoice_number, '-', 2)::int
on conflict (owner_id, doc_type, year)
do update set last_value = greatest(public.document_counters.last_value, excluded.last_value);

create or replace function public.next_document_number(p_owner_id uuid, p_type text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_value integer;
begin
  insert into public.document_counters (owner_id, doc_type, year, last_value)
  values (p_owner_id, p_type, v_year, 1)
  on conflict (owner_id, doc_type, year)
  do update set last_value = public.document_counters.last_value + 1
  returning last_value into v_value;

  return p_type || '-' || v_year || '-' || lpad(v_value::text, 4, '0');
end;
$$;
revoke execute on function public.next_document_number(uuid, text) from public;

alter table public.orders drop constraint if exists orders_order_number_key;
create unique index if not exists idx_orders_owner_number on public.orders (owner_id, order_number);
alter table public.invoices drop constraint if exists invoices_invoice_number_key;
create unique index if not exists idx_invoices_owner_number on public.invoices (owner_id, invoice_number);

-- Contrôles à la création d'une commande (atelier lui-même OU client à distance).
create or replace function public.enforce_remote_order_pricing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_client_user uuid;
  v_measurement_client uuid;
  v_catalog_price numeric(12,2);
begin
  select owner_id, user_id into v_owner_id, v_client_user from public.clients where id = new.client_id;
  if v_owner_id is null then
    raise exception 'CLIENT_INTROUVABLE' using errcode = 'P0001';
  end if;
  new.owner_id := v_owner_id;

  select client_id into v_measurement_client from public.measurements where id = new.measurement_id;
  if v_measurement_client is distinct from new.client_id then
    raise exception 'MESURE_INVALIDE' using errcode = 'P0001';
  end if;

  -- Une commande ne peut jamais naître "remise" (la facture n'existe pas encore).
  if new.status = 'delivered' then
    raise exception 'FACTURE_NON_REGLEE' using errcode = 'P0001';
  end if;
  new.delivered_at := null;

  if v_owner_id = auth.uid() then
    return new; -- commande saisie par le couturier lui-même
  end if;

  -- Commande à distance passée par le client final.
  if v_client_user is distinct from auth.uid() then
    raise exception 'NON_AUTORISE' using errcode = '42501';
  end if;
  if new.catalog_item_id is null then
    raise exception 'ARTICLE_REQUIS' using errcode = 'P0001';
  end if;

  select price into v_catalog_price from public.catalog_items
  where id = new.catalog_item_id and owner_id = v_owner_id and is_active = true;
  if v_catalog_price is null then
    raise exception 'ARTICLE_INDISPONIBLE' using errcode = 'P0001';
  end if;

  new.unit_price := v_catalog_price;
  new.status := 'pending';
  new.created_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_enforce_remote_order_pricing on public.orders;
create trigger trg_enforce_remote_order_pricing
before insert on public.orders
for each row execute function public.enforce_remote_order_pricing();

create or replace function public.set_order_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.owner_id is null then
    select owner_id into new.owner_id from public.clients where id = new.client_id;
  end if;
  if new.order_number is null then
    new.order_number := public.next_document_number(new.owner_id, 'CMD');
  end if;
  return new;
end;
$$;

-- Total toujours recalculé côté base (jamais celui envoyé par le navigateur).
create or replace function public.compute_order_total()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.total_price := round(new.unit_price * new.quantity, 2);
  return new;
end;
$$;

drop trigger if exists trg_order_total on public.orders;
create trigger trg_order_total
before insert or update of unit_price, quantity, total_price on public.orders
for each row execute function public.compute_order_total();

-- Garde-fous sur la modification d'une commande.
create or replace function public.guard_order_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.owner_id := old.owner_id;

  if new.client_id is distinct from old.client_id then
    raise exception 'CLIENT_NON_MODIFIABLE' using errcode = 'P0001';
  end if;

  if old.status = 'delivered' and new.status is distinct from old.status then
    raise exception 'COMMANDE_DEJA_REMISE' using errcode = 'P0001';
  end if;

  if old.status in ('delivered', 'cancelled')
     and (new.unit_price is distinct from old.unit_price or new.quantity is distinct from old.quantity) then
    raise exception 'COMMANDE_VERROUILLEE' using errcode = 'P0001';
  end if;

  if new.measurement_id is distinct from old.measurement_id
     and not exists (select 1 from public.measurements m where m.id = new.measurement_id and m.client_id = new.client_id) then
    raise exception 'MESURE_INVALIDE' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_order_update on public.orders;
create trigger trg_guard_order_update
before update on public.orders
for each row execute function public.guard_order_update();

-- Passage à "remis" : facture réglée obligatoire, date de remise horodatée.
create or replace function public.check_invoice_paid_before_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice_status invoice_status;
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    select status into v_invoice_status from public.invoices where order_id = new.id;
    if v_invoice_status is null or v_invoice_status <> 'paid' then
      raise exception 'FACTURE_NON_REGLEE' using errcode = 'P0001';
    end if;
    new.delivered_at := coalesce(new.delivered_at, now());
  end if;
  return new;
end;
$$;

-- Facture générée automatiquement, échéance alignée sur la date de remise.
create or replace function public.auto_generate_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.invoices (order_id, owner_id, amount_total, created_by, due_date)
  values (new.id, new.owner_id, new.total_price, new.created_by, new.due_date);
  return new;
end;
$$;

create or replace function public.set_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.owner_id is null then
    select owner_id into new.owner_id from public.orders where id = new.order_id;
  end if;
  if new.invoice_number is null then
    new.invoice_number := public.next_document_number(new.owner_id, 'FAC');
  end if;
  return new;
end;
$$;

-- Facture synchronisée quand le prix ou la date de remise de la commande change.
create or replace function public.sync_invoice_with_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paid numeric(12,2);
begin
  if new.total_price is distinct from old.total_price then
    select amount_paid into v_paid from public.invoices where order_id = new.id;
    if coalesce(v_paid, 0) > new.total_price then
      raise exception 'TOTAL_INFERIEUR_AU_PAYE' using errcode = 'P0001';
    end if;
    update public.invoices
    set amount_total = new.total_price,
        status = case
          when amount_paid >= new.total_price then 'paid'::invoice_status
          when amount_paid > 0 then 'partial'::invoice_status
          else 'unpaid'::invoice_status
        end
    where order_id = new.id;
  end if;

  if new.due_date is distinct from old.due_date then
    update public.invoices set due_date = new.due_date where order_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_invoice_with_order on public.orders;
create trigger trg_sync_invoice_with_order
after update on public.orders
for each row execute function public.sync_invoice_with_order();

-- Suppression d'une commande : la facture (et ses paiements) suit.
alter table public.invoices drop constraint if exists invoices_order_id_fkey;
alter table public.invoices
  add constraint invoices_order_id_fkey foreign key (order_id) references public.orders(id) on delete cascade;


-- -------------------------------------------------------------
-- 7. PAIEMENTS : jamais au-delà du solde, recalcul à la suppression
-- -------------------------------------------------------------
create or replace function public.check_payment_amount()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total numeric(12,2);
  v_paid numeric(12,2);
  v_order_status order_status;
begin
  select i.amount_total, i.amount_paid, o.status
  into v_total, v_paid, v_order_status
  from public.invoices i
  join public.orders o on o.id = i.order_id
  where i.id = new.invoice_id
  for update of i;

  if v_total is null then
    raise exception 'FACTURE_INTROUVABLE' using errcode = 'P0001';
  end if;
  if v_order_status = 'cancelled' then
    raise exception 'COMMANDE_ANNULEE' using errcode = 'P0001';
  end if;
  if new.amount > v_total - v_paid then
    raise exception 'PAIEMENT_SUPERIEUR_AU_SOLDE' using errcode = 'P0001';
  end if;

  new.recorded_by := coalesce(new.recorded_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_check_payment_amount on public.payments;
create trigger trg_check_payment_amount
before insert on public.payments
for each row execute function public.check_payment_amount();

-- SECURITY INVOKER : current_user vaut "authenticated" pour un appel depuis
-- l'application (les suppressions en cascade, elles, ne sont pas bloquées).
create or replace function public.guard_payment_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') and exists (
    select 1 from public.invoices i join public.orders o on o.id = i.order_id
    where i.id = old.invoice_id and o.status = 'delivered'
  ) then
    raise exception 'COMMANDE_DEJA_REMISE' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_guard_payment_delete on public.payments;
create trigger trg_guard_payment_delete
before delete on public.payments
for each row execute function public.guard_payment_delete();

create or replace function public.apply_payment_to_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  v_total numeric(12,2);
  v_paid numeric(12,2);
begin
  select amount_total into v_total from public.invoices where id = v_invoice_id;
  if v_total is null then
    return null; -- facture supprimée en cascade
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = v_invoice_id;

  update public.invoices
  set amount_paid = v_paid,
      status = case
        when v_paid >= v_total then 'paid'::invoice_status
        when v_paid > 0 then 'partial'::invoice_status
        else 'unpaid'::invoice_status
      end
  where id = v_invoice_id;

  return null;
end;
$$;

drop trigger if exists trg_apply_payment on public.payments;
create trigger trg_apply_payment
after insert or delete on public.payments
for each row execute function public.apply_payment_to_invoice();


-- -------------------------------------------------------------
-- 8. MESURES : instantané des libellés (lisible par le client final)
-- -------------------------------------------------------------
alter table public.measurements add column if not exists garment_label varchar(100);
alter table public.measurements add column if not exists field_meta jsonb;
comment on column public.measurements.field_meta is
  'Instantané {clé: {label, unit}} des champs au moment de la prise de mesure.';


-- -------------------------------------------------------------
-- 9. RLS : isolation par propriétaire + abonnement exigé pour écrire
-- -------------------------------------------------------------
-- CLIENTS
drop policy if exists "clients_insert_own" on public.clients;
create policy "clients_insert_own" on public.clients
  for insert with check (owner_id = auth.uid() and public.workspace_active());
drop policy if exists "clients_update_own" on public.clients;
create policy "clients_update_own" on public.clients
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.workspace_active());

-- MESURES
drop policy if exists "measurements_insert_own" on public.measurements;
create policy "measurements_insert_own" on public.measurements
  for insert with check (public.owns_client(client_id) and public.workspace_active());

-- COMMANDES
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select using (owner_id = auth.uid());
drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own" on public.orders
  for insert with check (public.owns_client(client_id) and public.workspace_active());
drop policy if exists "orders_update_own" on public.orders;
create policy "orders_update_own" on public.orders
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.workspace_active());
-- Fonction SECURITY DEFINER : évite la récursion entre les politiques
-- de "orders" et celles de "invoices" (qui consultent "orders").
create or replace function public.order_has_payments(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.invoices i
    join public.payments p on p.invoice_id = i.id
    where i.order_id = p_order_id
  );
$$;
revoke execute on function public.order_has_payments(uuid) from public;
grant execute on function public.order_has_payments(uuid) to authenticated;

drop policy if exists "orders_delete_own" on public.orders;
create policy "orders_delete_own" on public.orders
  for delete using (
    owner_id = auth.uid()
    and status in ('pending', 'cancelled')
    and not public.order_has_payments(id)
  );
drop policy if exists "orders_insert_client_self" on public.orders;
create policy "orders_insert_client_self" on public.orders
  for insert with check (
    exists (
      select 1 from public.clients c
      where c.id = orders.client_id
        and c.user_id = auth.uid()
        and public.has_active_access(c.owner_id)
    )
  );

-- FACTURES : créées et mises à jour uniquement par les déclencheurs.
drop policy if exists "invoices_select_own" on public.invoices;
create policy "invoices_select_own" on public.invoices
  for select using (owner_id = auth.uid());
drop policy if exists "invoices_insert_own" on public.invoices;
drop policy if exists "invoices_update_own" on public.invoices;
drop policy if exists "invoices_delete_own" on public.invoices;

-- PAIEMENTS
drop policy if exists "payments_insert_own" on public.payments;
create policy "payments_insert_own" on public.payments
  for insert with check (public.owns_invoice(invoice_id) and public.workspace_active());

-- TYPES DE VÊTEMENTS
drop policy if exists "garment_types_insert_own" on public.garment_types;
create policy "garment_types_insert_own" on public.garment_types
  for insert with check (owner_id = auth.uid() and public.workspace_active());
drop policy if exists "garment_types_update_own" on public.garment_types;
create policy "garment_types_update_own" on public.garment_types
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.workspace_active());

-- CATALOGUE
drop policy if exists "catalog_items_insert_own" on public.catalog_items;
create policy "catalog_items_insert_own" on public.catalog_items
  for insert with check (owner_id = auth.uid() and public.workspace_active());
drop policy if exists "catalog_items_update_own" on public.catalog_items;
create policy "catalog_items_update_own" on public.catalog_items
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.workspace_active());
-- Marketplace : seuls les ateliers actifs (abonnement en cours) sont visibles.
drop policy if exists "catalog_items_select_marketplace" on public.catalog_items;
create policy "catalog_items_select_marketplace" on public.catalog_items
  for select using (is_active = true and auth.uid() is not null and public.has_active_access(owner_id));


-- -------------------------------------------------------------
-- 10. CRÉATION ATOMIQUE D'UNE COMMANDE + ACOMPTE
-- -------------------------------------------------------------
-- SECURITY INVOKER : les règles RLS ci-dessus s'appliquent normalement.
create or replace function public.create_order_with_payment(
  p_client_id uuid,
  p_measurement_id uuid,
  p_garment_description text,
  p_fabric text,
  p_quantity integer,
  p_unit_price numeric,
  p_due_date date,
  p_paid numeric default 0,
  p_payment_method payment_method default 'cash'
)
returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_invoice public.invoices;
begin
  if coalesce(p_quantity, 0) < 1 then
    raise exception 'QUANTITE_INVALIDE' using errcode = 'P0001';
  end if;
  if coalesce(p_unit_price, -1) < 0 then
    raise exception 'PRIX_INVALIDE' using errcode = 'P0001';
  end if;
  if coalesce(p_paid, 0) < 0 then
    raise exception 'PAIEMENT_INVALIDE' using errcode = 'P0001';
  end if;

  insert into public.orders (
    client_id, measurement_id, garment_description, fabric,
    quantity, unit_price, total_price, due_date, created_by
  ) values (
    p_client_id, p_measurement_id, trim(p_garment_description), nullif(trim(coalesce(p_fabric, '')), ''),
    p_quantity, p_unit_price, round(p_unit_price * p_quantity, 2), p_due_date, auth.uid()
  )
  returning * into v_order;

  select * into v_invoice from public.invoices where order_id = v_order.id;

  if coalesce(p_paid, 0) > 0 then
    insert into public.payments (invoice_id, amount, payment_method, recorded_by)
    values (v_invoice.id, p_paid, p_payment_method, auth.uid());
    select * into v_invoice from public.invoices where id = v_invoice.id;
  end if;

  return json_build_object('order', row_to_json(v_order), 'invoice', row_to_json(v_invoice));
end;
$$;
revoke execute on function public.create_order_with_payment(uuid, uuid, text, text, integer, numeric, date, numeric, payment_method) from public;
grant execute on function public.create_order_with_payment(uuid, uuid, text, text, integer, numeric, date, numeric, payment_method) to authenticated;


-- -------------------------------------------------------------
-- 11. STOCKAGE : photos de catalogue limitées à 5 Mo, images uniquement
-- -------------------------------------------------------------
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'catalog-photos';
