-- =============================================================
-- TAILORFLOW — Passage en SaaS multi-tenant (espace personnel par utilisateur)
-- Déjà appliqué en base ; conservé ici pour la traçabilité du schéma.
-- =============================================================

alter table public.clients add column if not exists owner_id uuid references public.profiles(id);

update public.clients
set owner_id = coalesce(created_by, 'f59108d8-31d6-4578-98bc-68e168ddd482'::uuid)
where owner_id is null;

alter table public.clients alter column owner_id set default auth.uid();
alter table public.clients alter column owner_id set not null;

create index if not exists idx_clients_owner on public.clients (owner_id);

create or replace function public.owns_client(p_client_id uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.clients where id = p_client_id and owner_id = auth.uid());
$$;

create or replace function public.owns_order(p_order_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.orders o
    join public.clients c on c.id = o.client_id
    where o.id = p_order_id and c.owner_id = auth.uid()
  );
$$;

create or replace function public.owns_invoice(p_invoice_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.invoices i
    join public.orders o on o.id = i.order_id
    join public.clients c on c.id = o.client_id
    where i.id = p_invoice_id and c.owner_id = auth.uid()
  );
$$;

-- Politiques RLS réécrites : isolation stricte par propriétaire (voir README pour le détail)
drop policy if exists "clients_select_all_roles" on public.clients;
drop policy if exists "clients_insert_write_roles" on public.clients;
drop policy if exists "clients_update_write_roles" on public.clients;
drop policy if exists "clients_delete_admin_only" on public.clients;

create policy "clients_select_own" on public.clients for select using (owner_id = auth.uid());
create policy "clients_insert_own" on public.clients for insert with check (owner_id = auth.uid());
create policy "clients_update_own" on public.clients for update using (owner_id = auth.uid());
create policy "clients_delete_own" on public.clients for delete using (owner_id = auth.uid());

drop policy if exists "measurements_select_all_roles" on public.measurements;
drop policy if exists "measurements_insert_write_roles" on public.measurements;
drop policy if exists "measurements_delete_admin_only" on public.measurements;

create policy "measurements_select_own" on public.measurements for select using (public.owns_client(client_id));
create policy "measurements_insert_own" on public.measurements for insert with check (public.owns_client(client_id));
create policy "measurements_delete_own" on public.measurements for delete using (public.owns_client(client_id));

drop policy if exists "orders_select_all_roles" on public.orders;
drop policy if exists "orders_insert_write_roles" on public.orders;
drop policy if exists "orders_update_write_roles" on public.orders;
drop policy if exists "orders_delete_admin_only" on public.orders;

create policy "orders_select_own" on public.orders for select using (public.owns_client(client_id));
create policy "orders_insert_own" on public.orders for insert with check (public.owns_client(client_id));
create policy "orders_update_own" on public.orders for update using (public.owns_client(client_id));
create policy "orders_delete_own" on public.orders for delete using (public.owns_client(client_id));

drop policy if exists "invoices_select_all_roles" on public.invoices;
drop policy if exists "invoices_insert_billing_roles" on public.invoices;
drop policy if exists "invoices_update_billing_roles" on public.invoices;
drop policy if exists "invoices_delete_admin_only" on public.invoices;

create policy "invoices_select_own" on public.invoices for select using (public.owns_order(order_id));
create policy "invoices_insert_own" on public.invoices for insert with check (public.owns_order(order_id));
create policy "invoices_update_own" on public.invoices for update using (public.owns_order(order_id));
create policy "invoices_delete_own" on public.invoices for delete using (public.owns_order(order_id));

drop policy if exists "payments_select_all_roles" on public.payments;
drop policy if exists "payments_insert_billing_roles" on public.payments;
drop policy if exists "payments_delete_admin_only" on public.payments;

create policy "payments_select_own" on public.payments for select using (public.owns_invoice(invoice_id));
create policy "payments_insert_own" on public.payments for insert with check (public.owns_invoice(invoice_id));
create policy "payments_delete_own" on public.payments for delete using (public.owns_invoice(invoice_id));

-- PROFILES : la vue globale (Paramètres) devient réservée au propriétaire de la plateforme
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_update_own_or_admin" on public.profiles;
drop policy if exists "profiles_insert_admin_only" on public.profiles;
drop policy if exists "profiles_delete_admin_only" on public.profiles;

create policy "profiles_select_own_or_owner" on public.profiles for select using (id = auth.uid() or public.is_platform_owner());
create policy "profiles_update_own_or_owner" on public.profiles for update using (id = auth.uid() or public.is_platform_owner());
create policy "profiles_insert_owner_only" on public.profiles for insert with check (public.is_platform_owner());
create policy "profiles_delete_owner_only" on public.profiles for delete using (public.is_platform_owner());
