-- =============================================================
-- TAILORFLOW — Durcissement sécurité des fonctions (007-009)
-- Déjà appliqué en base ; conservé ici pour la traçabilité du schéma.
-- =============================================================

-- 007 : search_path fixe sur toutes les fonctions (bonne pratique anti-hijacking)
alter function public.is_platform_owner() set search_path = public, pg_temp;
alter function public.is_admin() set search_path = public, pg_temp;
alter function public.current_user_role() set search_path = public, pg_temp;
alter function public.can_write_operations() set search_path = public, pg_temp;
alter function public.can_write_billing() set search_path = public, pg_temp;
alter function public.owns_client(uuid) set search_path = public, pg_temp;
alter function public.owns_order(uuid) set search_path = public, pg_temp;
alter function public.owns_invoice(uuid) set search_path = public, pg_temp;
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.set_measurement_version() set search_path = public, pg_temp;
alter function public.set_order_number() set search_path = public, pg_temp;
alter function public.set_invoice_number() set search_path = public, pg_temp;
alter function public.apply_payment_to_invoice() set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.prevent_owner_profile_deletion() set search_path = public, pg_temp;
alter function public.prevent_owner_deactivation() set search_path = public, pg_temp;
alter function public.prevent_owner_auth_deletion() set search_path = public, pg_temp;

-- 008/009 : retrait de l'exécution publique pour les fonctions internes
-- (utilisées uniquement par les politiques RLS et les triggers), tout en
-- conservant impérativement le droit d'exécution pour "authenticated"
-- (sans quoi les politiques RLS échoueraient pour tous les utilisateurs).
revoke execute on function public.is_platform_owner() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.current_user_role() from public;
revoke execute on function public.can_write_operations() from public;
revoke execute on function public.can_write_billing() from public;
revoke execute on function public.owns_client(uuid) from public;
revoke execute on function public.owns_order(uuid) from public;
revoke execute on function public.owns_invoice(uuid) from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.prevent_owner_auth_deletion() from public;

grant execute on function public.is_platform_owner() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.can_write_operations() to authenticated;
grant execute on function public.can_write_billing() to authenticated;
grant execute on function public.owns_client(uuid) to authenticated;
grant execute on function public.owns_order(uuid) to authenticated;
grant execute on function public.owns_invoice(uuid) to authenticated;
