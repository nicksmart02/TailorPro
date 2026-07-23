-- =============================================================
-- TAILORFLOW — Compléments système d'abonnement + nettoyage (016-017)
-- Déjà appliqué en base ; conservé ici pour la traçabilité du schéma.
-- =============================================================

-- 016 : ajout des valeurs d'énum manquantes + complément des policies/fonctions
-- (l'état trouvé en base avait déjà table/types/policies partiels issus d'un
-- travail précédent ; ce correctif complète sans tout recréer)
alter type subscription_status add value if not exists 'pending';
alter type subscription_status add value if not exists 'cancelled';

alter table public.subscriptions add column if not exists requested_at timestamptz;
alter table public.subscriptions add column if not exists confirmed_at timestamptz;
alter table public.subscriptions add column if not exists confirmed_by uuid references public.profiles(id);
alter table public.subscriptions add column if not exists payment_reference varchar(100);

drop policy if exists "subscriptions_insert_own_pending" on public.subscriptions;
create policy "subscriptions_insert_own_pending"
on public.subscriptions for insert
with check (owner_id = auth.uid() and status = 'pending');

create or replace function public.has_active_access(p_owner_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.subscriptions
    where owner_id = p_owner_id
      and (
        (status = 'trial' and trial_ends_at > now())
        or (status = 'active' and current_period_end > now())
      )
  );
$$;

revoke execute on function public.has_active_access(uuid) from public;
grant execute on function public.has_active_access(uuid) to authenticated;

-- 017 : nettoyage — le montant payé initial à la commande est géré par le
-- frontend (insertion explicite d'un paiement après création de la facture,
-- voir js/orders.js). La colonne initial_paid_amount ajoutée par erreur dans
-- une tentative précédente était redondante et jamais alimentée : retirée.
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

alter table public.orders drop column if exists initial_paid_amount;
