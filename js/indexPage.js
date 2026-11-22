// =============================================================
// TAILORFLOW — Redirection d'accueil selon la session et le rôle
// =============================================================
import { supabase } from "./supabaseClient.js";
import { fetchCurrentProfile, homeForRole } from "./auth.js";

const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  window.location.replace("login.html");
} else {
  const profile = await fetchCurrentProfile().catch(() => null);
  window.location.replace(profile ? homeForRole(profile.role) : "login.html");
}
