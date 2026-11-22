-- =============================================================
-- TAILORFLOW — Tables d'abonnement (reconstitution documentaire)
-- =============================================================
-- Ces tables ont été créées en base lors d'une session antérieure sans que
-- le script ne soit versionné dans le dépôt. Ce fichier les reconstitue à
-- partir de leur usage dans le code (js/subscription.js, js/settings.js,
-- migrations 013 à 017) afin qu'une installation neuve puisse dérouler
-- toutes les migrations dans l'ordre.
--
-- Il est IDEMPOTENT : sur la base de production (où les tables existent
-- déjà), il ne modifie rien.
-- =============================================================

-- Les valeurs 'pending' et 'cancelled' (ajoutées en production par 016) sont
-- incluses d'emblée : sur une base neuve, 016 n'a alors plus rien à ajouter et
-- peut s'exécuter d'un bloc (Postgres refuse d'utiliser une valeur d'enum
-- ajoutée dans la même transaction).
do $$ begin
  create type subscription_status as enum ('trial', 'active', 'expired', 'pending', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_plan as enum ('mensuel', 'annuel');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_request_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,
  plan subscription_plan,
  status subscription_status not null default 'trial',
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  plan subscription_plan not null,
  amount numeric(12,2) not null,
  phone_number varchar(30) not null,
  status payment_request_status not null default 'pending',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz
);

alter table public.subscriptions enable row level security;
alter table public.payment_requests enable row level security;

-- Politiques minimales (elles sont redéfinies proprement par la migration 023).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscriptions') then
    create policy "subscriptions_select_own" on public.subscriptions
      for select using (owner_id = auth.uid() or public.is_platform_owner());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_requests') then
    create policy "payment_requests_select_own" on public.payment_requests
      for select using (owner_id = auth.uid() or public.is_platform_owner());
    create policy "payment_requests_insert_own" on public.payment_requests
      for insert with check (owner_id = auth.uid());
  end if;
end $$;
