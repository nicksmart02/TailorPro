-- =============================================================
-- TAILORFLOW — Système d'abonnement payant (013-014)
-- Déjà appliqué en base ; conservé ici pour la traçabilité du schéma.
-- =============================================================
-- Note : les tables subscriptions/payment_requests et leurs enums
-- (subscription_status, subscription_plan, payment_request_status)
-- ont été créées lors d'une session de travail antérieure ; ce fichier
-- documente la finalisation du câblage (essai gratuit, validation
-- manuelle des paiements par le propriétaire de la plateforme).

-- Essai gratuit de 14 jours à l'inscription (mise à jour du trigger existant)
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

  insert into public.subscriptions (owner_id, status, trial_ends_at)
  values (new.id, 'trial', now() + interval '14 days');

  return new;
end;
$$;

-- Validation d'une demande de paiement (réservée au propriétaire de la plateforme)
create or replace function public.approve_payment_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request record;
  v_duration interval;
  v_current_end timestamptz;
begin
  if not public.is_platform_owner() then
    raise exception 'NON_AUTORISE';
  end if;

  select * into v_request from public.payment_requests where id = p_request_id and status = 'pending';
  if v_request is null then
    raise exception 'DEMANDE_INTROUVABLE';
  end if;

  v_duration := case v_request.plan when 'mensuel' then interval '30 days' else interval '365 days' end;

  select current_period_end into v_current_end from public.subscriptions where owner_id = v_request.owner_id;

  update public.subscriptions
  set plan = v_request.plan,
      status = 'active',
      current_period_end = greatest(coalesce(v_current_end, now()), now()) + v_duration,
      updated_at = now()
  where owner_id = v_request.owner_id;

  update public.payment_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id;
end;
$$;

revoke execute on function public.approve_payment_request(uuid) from public;
grant execute on function public.approve_payment_request(uuid) to authenticated;

-- Rejet d'une demande de paiement (réservé au propriétaire de la plateforme)
create or replace function public.reject_payment_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'NON_AUTORISE';
  end if;

  update public.payment_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id and status = 'pending';
end;
$$;

revoke execute on function public.reject_payment_request(uuid) from public;
grant execute on function public.reject_payment_request(uuid) to authenticated;
