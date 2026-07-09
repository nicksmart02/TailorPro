// =============================================================
// TAILORFLOW — Client Supabase partagé
// =============================================================
// L'URL et la clé "anon" ne sont PAS des secrets : elles sont
// conçues pour être exposées côté navigateur. La sécurité réelle
// est assurée par les politiques RLS définies en base de données
// (voir sql/002_rls_policies.sql). Ne jamais utiliser ici la clé
// "service_role" (celle-ci doit rester strictement côté serveur).
//
// TODO (à faire avant le déploiement) :
//   1. Créer le projet Supabase "tailorflow".
//   2. Remplacer SUPABASE_URL et SUPABASE_ANON_KEY ci-dessous
//      par les valeurs de Project Settings > API.
// =============================================================

const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_PUBLIC_KEY";

export const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
