-- =============================================================
-- TAILORFLOW — Facturation automatique, blocage remise impayée,
-- types de vêtements personnalisables (010-012)
-- Déjà appliqué en base ; conservé ici pour la traçabilité du schéma.
-- =============================================================

-- 010 : génération automatique de la facture à la création d'une commande
create or replace function public.auto_generate_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.invoices (order_id, amount_total, created_by)
  values (new.id, new.total_price, new.created_by);
  return new;
end;
$$;

drop trigger if exists trg_auto_generate_invoice on public.orders;
create trigger trg_auto_generate_invoice
after insert on public.orders
for each row execute function public.auto_generate_invoice();

-- 011 : blocage du passage au statut "remis" si la facture n'est pas payée
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
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_invoice_paid on public.orders;
create trigger trg_check_invoice_paid
before update on public.orders
for each row execute function public.check_invoice_paid_before_delivery();

-- 012 : types de vêtements personnalisables (espace par utilisateur)
create table public.garment_types (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) default auth.uid(),
  key varchar(60) not null,
  label varchar(100) not null,
  fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, key)
);

alter table public.garment_types enable row level security;

create policy "garment_types_select_own" on public.garment_types for select using (owner_id = auth.uid());
create policy "garment_types_insert_own" on public.garment_types for insert with check (owner_id = auth.uid());
create policy "garment_types_update_own" on public.garment_types for update using (owner_id = auth.uid());
create policy "garment_types_delete_own" on public.garment_types for delete using (owner_id = auth.uid());

create or replace function public.seed_default_garment_types(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.garment_types (owner_id, key, label, fields) values
  (p_owner_id, 'costume', 'Costume', '[
    {"key":"tour_cou","label":"Tour de cou","unit":"cm"},
    {"key":"tour_poitrine","label":"Tour de poitrine","unit":"cm"},
    {"key":"tour_taille","label":"Tour de taille","unit":"cm"},
    {"key":"tour_bassin","label":"Tour de bassin","unit":"cm"},
    {"key":"largeur_epaule","label":"Largeur d''épaule","unit":"cm"},
    {"key":"longueur_manche","label":"Longueur de manche","unit":"cm"},
    {"key":"longueur_veste","label":"Longueur de veste","unit":"cm"},
    {"key":"longueur_pantalon","label":"Longueur de pantalon","unit":"cm"}
  ]'::jsonb),
  (p_owner_id, 'chemise', 'Chemise', '[
    {"key":"tour_cou","label":"Tour de cou","unit":"cm"},
    {"key":"tour_poitrine","label":"Tour de poitrine","unit":"cm"},
    {"key":"tour_taille","label":"Tour de taille","unit":"cm"},
    {"key":"largeur_epaule","label":"Largeur d''épaule","unit":"cm"},
    {"key":"longueur_manche","label":"Longueur de manche","unit":"cm"},
    {"key":"tour_poignet","label":"Tour de poignet","unit":"cm"},
    {"key":"longueur_chemise","label":"Longueur de chemise","unit":"cm"}
  ]'::jsonb),
  (p_owner_id, 'robe', 'Robe', '[
    {"key":"tour_poitrine","label":"Tour de poitrine","unit":"cm"},
    {"key":"tour_taille","label":"Tour de taille","unit":"cm"},
    {"key":"tour_bassin","label":"Tour de bassin","unit":"cm"},
    {"key":"longueur_robe","label":"Longueur de robe","unit":"cm"},
    {"key":"tour_bras","label":"Tour de bras","unit":"cm"},
    {"key":"longueur_manche","label":"Longueur de manche","unit":"cm"}
  ]'::jsonb),
  (p_owner_id, 'pantalon', 'Pantalon', '[
    {"key":"tour_taille","label":"Tour de taille","unit":"cm"},
    {"key":"tour_bassin","label":"Tour de bassin","unit":"cm"},
    {"key":"tour_cuisse","label":"Tour de cuisse","unit":"cm"},
    {"key":"tour_genou","label":"Tour de genou","unit":"cm"},
    {"key":"longueur_jambe","label":"Longueur de jambe","unit":"cm"},
    {"key":"tour_bas_jambe","label":"Tour du bas de jambe","unit":"cm"}
  ]'::jsonb),
  (p_owner_id, 'veste', 'Veste', '[
    {"key":"tour_poitrine","label":"Tour de poitrine","unit":"cm"},
    {"key":"tour_taille","label":"Tour de taille","unit":"cm"},
    {"key":"largeur_epaule","label":"Largeur d''épaule","unit":"cm"},
    {"key":"longueur_manche","label":"Longueur de manche","unit":"cm"},
    {"key":"longueur_veste","label":"Longueur de veste","unit":"cm"}
  ]'::jsonb),
  (p_owner_id, 'autre', 'Autre', '[
    {"key":"mesure_1","label":"Mesure 1","unit":"cm"},
    {"key":"mesure_2","label":"Mesure 2","unit":"cm"},
    {"key":"mesure_3","label":"Mesure 3","unit":"cm"}
  ]'::jsonb)
  on conflict (owner_id, key) do nothing;
end;
$$;

revoke execute on function public.seed_default_garment_types(uuid) from public;

-- Seed pour les comptes déjà existants au moment de la migration
do $$
declare r record;
begin
  for r in select id from public.profiles loop
    perform public.seed_default_garment_types(r.id);
  end loop;
end $$;

-- Mise à jour du trigger d'inscription pour semer les types par défaut à chaque nouveau compte
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'employee',
    new.email
  );
  perform public.seed_default_garment_types(new.id);
  return new;
end;
$$;
