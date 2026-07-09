-- =============================================================
-- TAILORFLOW — SCHEMA INITIAL (Sprint 0)
-- A exécuter dans l'éditeur SQL de Supabase (projet TailorFlow)
-- =============================================================

-- ---------- EXTENSIONS ----------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------- ENUMS ----------
create type user_role as enum ('admin', 'employee', 'accountant');
create type order_status as enum ('pending', 'in_progress', 'ready', 'delivered', 'cancelled');
create type invoice_status as enum ('unpaid', 'partial', 'paid');
create type payment_method as enum ('cash', 'mobile_money', 'bank_transfer', 'card');

-- =============================================================
-- 1. PROFILES (lié à auth.users géré par Supabase Auth)
-- =============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name varchar(150) not null,
  role user_role not null default 'employee',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Profil métier lié à chaque utilisateur Supabase Auth (rôle, statut).';

-- Fonction générique de mise à jour du champ updated_at (utilisée par plusieurs triggers ci-dessous)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Fonction utilitaire : rôle de l'utilisateur courant (SECURITY DEFINER pour éviter la récursion RLS)
create or replace function public.current_user_role()
returns user_role
language sql
security definer
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.can_write_operations()
returns boolean language sql security definer stable as $$
  select coalesce((select role in ('admin','employee') from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.can_write_billing()
returns boolean language sql security definer stable as $$
  select coalesce((select role in ('admin','accountant') from public.profiles where id = auth.uid()), false);
$$;

-- =============================================================
-- 2. CLIENTS
-- =============================================================
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name varchar(150) not null,
  phone varchar(30) not null unique,
  email varchar(150),
  address text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_clients_full_name on public.clients (full_name);
create index idx_clients_phone on public.clients (phone);

-- =============================================================
-- 3. MEASUREMENTS (fiches de mesures versionnées)
-- =============================================================
create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  garment_type varchar(50) not null,
  values jsonb not null,
  version integer not null,
  taken_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (client_id, version)
);

create index idx_measurements_client on public.measurements (client_id, version desc);

-- Auto-incrément de la version par client
create or replace function public.set_measurement_version()
returns trigger language plpgsql as $$
begin
  select coalesce(max(version), 0) + 1 into new.version
  from public.measurements where client_id = new.client_id;
  return new;
end;
$$;

create trigger trg_measurement_version
before insert on public.measurements
for each row execute function public.set_measurement_version();

-- =============================================================
-- 4. ORDERS (commandes)
-- =============================================================
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number varchar(20) unique,
  client_id uuid not null references public.clients(id),
  measurement_id uuid not null references public.measurements(id),
  garment_description text not null,
  fabric varchar(100),
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total_price numeric(12,2) not null check (total_price >= 0),
  status order_status not null default 'pending',
  due_date date not null,
  delivered_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_orders_status_due on public.orders (status, due_date);
create index idx_orders_client on public.orders (client_id);

-- Génération du numéro de commande : CMD-AAAA-XXXX
create sequence if not exists orders_seq;

create or replace function public.set_order_number()
returns trigger language plpgsql as $$
begin
  if new.order_number is null then
    new.order_number := 'CMD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('orders_seq')::text, 4, '0');
  end if;
  if new.total_price is null then
    new.total_price := new.unit_price * new.quantity;
  end if;
  return new;
end;
$$;

create trigger trg_order_number
before insert on public.orders
for each row execute function public.set_order_number();

create trigger trg_order_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- =============================================================
-- 5. INVOICES (factures)
-- =============================================================
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number varchar(20) unique,
  order_id uuid not null unique references public.orders(id),
  amount_total numeric(12,2) not null,
  amount_paid numeric(12,2) not null default 0,
  status invoice_status not null default 'unpaid',
  issued_at timestamptz not null default now(),
  due_date date,
  created_by uuid references public.profiles(id)
);

create index idx_invoices_status on public.invoices (status);

create sequence if not exists invoices_seq;

create or replace function public.set_invoice_number()
returns trigger language plpgsql as $$
begin
  if new.invoice_number is null then
    new.invoice_number := 'FAC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoices_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger trg_invoice_number
before insert on public.invoices
for each row execute function public.set_invoice_number();

-- =============================================================
-- 6. PAYMENTS
-- =============================================================
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  payment_method payment_method not null,
  paid_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id)
);

create index idx_payments_invoice on public.payments (invoice_id);

-- Mise à jour automatique du statut/montant payé de la facture après paiement
create or replace function public.apply_payment_to_invoice()
returns trigger language plpgsql as $$
declare
  v_total numeric(12,2);
  v_paid numeric(12,2);
begin
  select amount_total into v_total from public.invoices where id = new.invoice_id;
  select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = new.invoice_id;

  update public.invoices
  set amount_paid = v_paid,
      status = case
        when v_paid >= v_total then 'paid'::invoice_status
        when v_paid > 0 then 'partial'::invoice_status
        else 'unpaid'::invoice_status
      end
  where id = new.invoice_id;

  return new;
end;
$$;

create trigger trg_apply_payment
after insert on public.payments
for each row execute function public.apply_payment_to_invoice();

-- =============================================================
-- 7. AUDIT LOGS
-- =============================================================
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action varchar(100) not null,
  entity varchar(50) not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- =============================================================
-- 8. TRIGGERS updated_at RESTANTS (clients, profiles)
-- =============================================================
create trigger trg_clients_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
