-- =============================================================
-- TAILORFLOW — Rôles : Administrateur / Couturier / Client (1/2)
-- A exécuter dans l'éditeur SQL Supabase, après 018, EN PREMIER
-- ET SEUL dans sa propre requête (Postgres exige que les nouvelles
-- valeurs d'enum soient validées avant d'être utilisées).
-- =============================================================

-- Modèle final : "admin" = propriétaire unique de la plateforme (déjà géré par
-- is_platform_owner(), id figé) ; "couturier" = gérant d'atelier (ex "employee") ;
-- "client" = compte du client final, accès en lecture seule à son propre espace.
alter type user_role add value if not exists 'couturier';
alter type user_role add value if not exists 'client';
