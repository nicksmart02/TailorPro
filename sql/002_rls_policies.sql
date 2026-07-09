-- =============================================================
-- TAILORFLOW — ROW LEVEL SECURITY (Sprint 0)
-- A exécuter APRES 001_schema.sql
-- =============================================================

-- ---------- Activation RLS sur toutes les tables métier ----------
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.measurements enable row level security;
alter table public.orders enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.audit_logs enable row level security;

-- =============================================================
-- PROFILES
-- Chaque utilisateur voit son propre profil ; l'admin voit tout le monde.
-- =============================================================
create policy "profiles_select_own_or_admin"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy "profiles_update_own_or_admin"
on public.profiles for update
using (id = auth.uid() or public.is_admin());

create policy "profiles_insert_admin_only"
on public.profiles for insert
with check (public.is_admin());

create policy "profiles_delete_admin_only"
on public.profiles for delete
using (public.is_admin());

-- =============================================================
-- CLIENTS
-- Lecture : tous les rôles authentifiés (admin, employee, accountant)
-- Ecriture : admin + employee uniquement
-- =============================================================
create policy "clients_select_all_roles"
on public.clients for select
using (auth.uid() is not null);

create policy "clients_insert_write_roles"
on public.clients for insert
with check (public.can_write_operations());

create policy "clients_update_write_roles"
on public.clients for update
using (public.can_write_operations());

create policy "clients_delete_admin_only"
on public.clients for delete
using (public.is_admin());

-- =============================================================
-- MEASUREMENTS
-- Mêmes règles que clients (données opérationnelles)
-- =============================================================
create policy "measurements_select_all_roles"
on public.measurements for select
using (auth.uid() is not null);

create policy "measurements_insert_write_roles"
on public.measurements for insert
with check (public.can_write_operations());

create policy "measurements_delete_admin_only"
on public.measurements for delete
using (public.is_admin());

-- Note : pas d'update sur measurements (immuable, on crée une nouvelle version à la place)

-- =============================================================
-- ORDERS
-- Lecture : tous ; Ecriture : admin + employee
-- =============================================================
create policy "orders_select_all_roles"
on public.orders for select
using (auth.uid() is not null);

create policy "orders_insert_write_roles"
on public.orders for insert
with check (public.can_write_operations());

create policy "orders_update_write_roles"
on public.orders for update
using (public.can_write_operations());

create policy "orders_delete_admin_only"
on public.orders for delete
using (public.is_admin());

-- =============================================================
-- INVOICES
-- Lecture : tous ; Ecriture : admin + accountant
-- =============================================================
create policy "invoices_select_all_roles"
on public.invoices for select
using (auth.uid() is not null);

create policy "invoices_insert_billing_roles"
on public.invoices for insert
with check (public.can_write_billing());

create policy "invoices_update_billing_roles"
on public.invoices for update
using (public.can_write_billing());

create policy "invoices_delete_admin_only"
on public.invoices for delete
using (public.is_admin());

-- =============================================================
-- PAYMENTS
-- Lecture : tous ; Ecriture : admin + accountant
-- =============================================================
create policy "payments_select_all_roles"
on public.payments for select
using (auth.uid() is not null);

create policy "payments_insert_billing_roles"
on public.payments for insert
with check (public.can_write_billing());

create policy "payments_delete_admin_only"
on public.payments for delete
using (public.is_admin());

-- Note : pas d'update sur payments (immuable ; un correctif se fait via un nouveau paiement/avoir)

-- =============================================================
-- AUDIT LOGS
-- Lecture : admin uniquement ; Ecriture : tout utilisateur authentifié (insertion de son propre log)
-- =============================================================
create policy "audit_logs_select_admin_only"
on public.audit_logs for select
using (public.is_admin());

create policy "audit_logs_insert_authenticated"
on public.audit_logs for insert
with check (auth.uid() is not null);
