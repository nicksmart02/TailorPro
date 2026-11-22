// =============================================================
// TAILORFLOW — Client Supabase partagé
// =============================================================
// L'URL et la clé "anon"/"publishable" ne sont PAS des secrets : elles sont
// conçues pour être exposées côté navigateur. La sécurité réelle est assurée
// par les politiques RLS, déclencheurs et fonctions de la base de données
// (voir sql/, en particulier 023_hardening_and_saas_v3.sql). Ne jamais
// utiliser ici la clé "service_role" (strictement côté serveur).
//
// Projet Supabase : tailorflow (ref: tfatcqgspcziulkzaxui)
// =============================================================

const SUPABASE_URL = "https://tfatcqgspcziulkzaxui.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_68QaQUPGEbaozt1Eh_U9FQ_cXNQ2dTy";

export const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
