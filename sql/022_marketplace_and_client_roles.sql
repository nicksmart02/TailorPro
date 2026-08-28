-- =============================================================
-- TAILORFLOW — Marketplace multi-couturiers : choix de rôle différé,
-- rattachement client par téléphone, catalogue avec photos, commande
-- à distance avec intégrité de prix garantie côté base de données.
-- Déjà appliqué en base ; conservé ici pour la traçabilité du schéma.
-- =============================================================

-- ---------- 022a : nouvelle valeur d'énum (transaction isolée requise) ----------
alter type user_role add value if not exists 'pending';

-- ---------- 022b : inscription neutre + activation différée du rôle ----------
alter table public.profiles add column if not exists phone varchar(30);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'pending', new.email);
  return new;
end;
$$;

create or replace function public.activate_couturier_role()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles set role = 'couturier' where id = auth.uid() and role = 'pending';
  if not found then
    raise exception 'Rôle déjà attribué ou compte introuvable.';
  end if;
  perform public.seed_default_garment_types(auth.uid());
  insert into public.subscriptions (owner_id, status, trial_ends_at)
  values (auth.uid(), 'trial', now() + interval '14 days');
end;
$$;
revoke execute on function public.activate_couturier_role() from public;
grant execute on function public.activate_couturier_role() to authenticated;

create or replace function public.activate_client_role(p_full_name varchar, p_phone varchar)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_linked_count integer;
begin
  update public.profiles
  set role = 'client', full_name = coalesce(nullif(trim(p_full_name), ''), full_name), phone = trim(p_phone)
  where id = auth.uid() and role = 'pending';
  if not found then
    raise exception 'Rôle déjà attribué ou compte introuvable.';
  end if;
  update public.clients set user_id = auth.uid() where phone = trim(p_phone) and user_id is null;
  get diagnostics v_linked_count = row_count;
  return v_linked_count;
end;
$$;
revoke execute on function public.activate_client_role(varchar, varchar) from public;
grant execute on function public.activate_client_role(varchar, varchar) to authenticated;

create or replace function public.relink_client_by_phone()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_phone varchar; v_linked_count integer;
begin
  select phone into v_phone from public.profiles where id = auth.uid() and role = 'client';
  if v_phone is null then
    raise exception 'Aucun numéro de téléphone enregistré sur ce compte.';
  end if;
  update public.clients set user_id = auth.uid() where phone = v_phone and user_id is null;
  get diagnostics v_linked_count = row_count;
  return v_linked_count;
end;
$$;
revoke execute on function public.relink_client_by_phone() from public;
grant execute on function public.relink_client_by_phone() to authenticated;

-- ---------- 022c : un client peut être lié à PLUSIEURS couturiers ----------
drop index if exists idx_clients_user_id;
create index if not exists idx_clients_user_id on public.clients (user_id) where user_id is not null;

-- ---------- 022d : catalogue (marketplace) + permission de commande à distance ----------
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) default auth.uid(),
  name varchar(150) not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  photo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_catalog_items_owner on public.catalog_items (owner_id);
create index idx_catalog_items_active on public.catalog_items (is_active);
create trigger trg_catalog_items_updated_at before update on public.catalog_items
for each row execute function public.set_updated_at();

alter table public.catalog_items enable row level security;
create policy "catalog_items_select_own" on public.catalog_items for select using (owner_id = auth.uid());
create policy "catalog_items_insert_own" on public.catalog_items for insert with check (owner_id = auth.uid());
create policy "catalog_items_update_own" on public.catalog_items for update using (owner_id = auth.uid());
create policy "catalog_items_delete_own" on public.catalog_items for delete using (owner_id = auth.uid());
create policy "catalog_items_select_marketplace" on public.catalog_items
for select using (is_active = true and auth.uid() is not null);

create or replace view public.marketplace_establishments as
select distinct p.id as owner_id, coalesce(p.establishment_name, p.full_name) as display_name
from public.profiles p
join public.catalog_items c on c.owner_id = p.id
where c.is_active = true;

create policy "orders_insert_client_self" on public.orders
for insert with check (
  exists (select 1 from public.clients c where c.id = orders.client_id and c.user_id = auth.uid())
);

-- ---------- 022e : intégrité des prix pour les commandes à distance ----------
alter table public.orders add column if not exists catalog_item_id uuid references public.catalog_items(id);

create or replace function public.enforce_remote_order_pricing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_owner_id uuid; v_catalog_price numeric(12,2);
begin
  select owner_id into v_owner_id from public.clients where id = new.client_id;

  if v_owner_id = auth.uid() then
    return new; -- commande passée par le couturier lui-même : comportement historique inchangé
  end if;

  if new.catalog_item_id is null then
    raise exception 'Une commande à distance doit référencer un article du catalogue.';
  end if;

  select price into v_catalog_price from public.catalog_items
  where id = new.catalog_item_id and owner_id = v_owner_id and is_active = true;

  if v_catalog_price is null then
    raise exception 'Article de catalogue introuvable ou inactif.';
  end if;

  new.unit_price := v_catalog_price;
  new.total_price := v_catalog_price * new.quantity;
  return new;
end;
$$;

drop trigger if exists trg_enforce_remote_order_pricing on public.orders;
create trigger trg_enforce_remote_order_pricing before insert on public.orders
for each row execute function public.enforce_remote_order_pricing();

-- ---------- 022f : bucket de stockage public pour les photos de catalogue ----------
insert into storage.buckets (id, name, public) values ('catalog-photos', 'catalog-photos', true) on conflict (id) do nothing;

create policy "catalog_photos_public_read" on storage.objects for select using (bucket_id = 'catalog-photos');
create policy "catalog_photos_owner_insert" on storage.objects for insert
with check (bucket_id = 'catalog-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "catalog_photos_owner_update" on storage.objects for update
using (bucket_id = 'catalog-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "catalog_photos_owner_delete" on storage.objects for delete
using (bucket_id = 'catalog-photos' and (storage.foldername(name))[1] = auth.uid()::text);
