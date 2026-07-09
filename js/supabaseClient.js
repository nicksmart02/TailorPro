// =============================================================
// TAILORFLOW — Client Supabase partagé
// =============================================================
// L'URL et la clé "anon"/"publishable" ne sont PAS des secrets : elles sont
// conçues pour être exposées côté navigateur. La sécurité réelle
// est assurée par les politiques RLS définies en base de données
// (voir sql/002_rls_policies.sql). Ne jamais utiliser ici la clé
// "service_role" (celle-ci doit rester strictement côté serveur).
//
// Projet Supabase : tailorflow (ref: tfatcqgspcziulkzaxui)
// =============================================================

const SUPABASE_URL = "https://tfatcqgspcziulkzaxui.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_68QaQUPGEbaozt1Eh_U9FQ_cXNQ2dTy";

export const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
