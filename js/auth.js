// =============================================================
// TAILORFLOW — Module d'authentification
// =============================================================
import { supabase } from "./supabaseClient.js";

const PLATFORM_OWNER_EMAIL = "jahadjitse@gmail.com";

/**
 * Connecte un utilisateur avec email/mot de passe.
 * @returns {Promise<{user: object, profile: object}>}
 * @throws {Error} message d'erreur lisible pour l'utilisateur
 */
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(mapAuthError(error));
  }

  const profile = await fetchCurrentProfile();

  if (!profile.is_active) {
    await supabase.auth.signOut();
    throw new Error("Ce compte a été désactivé. Contactez un administrateur.");
  }

  return { user: data.user, profile };
}

/** Déconnecte l'utilisateur courant. */
export async function logout() {
  await supabase.auth.signOut();
  window.location.href = "login.html";
}

/**
 * Récupère la session active et le profil métier associé.
 * Redirige vers login.html si aucune session valide.
 * Vérifie aussi que l'abonnement est actif (essai ou payé) et redirige vers
 * subscription.html sinon — sauf pour le propriétaire de la plateforme et
 * sur la page subscription.html elle-même (pour éviter une boucle de redirection).
 *
 * @param {object} [options]
 * @param {boolean} [options.skipBilling] - ne pas vérifier l'abonnement (utilisé par subscription.html)
 * @returns {Promise<object>} profil (id, full_name, role, is_active, email)
 */
export async function requireAuth(options = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  try {
    const profile = await fetchCurrentProfile();
    if (!profile.is_active) {
      await supabase.auth.signOut();
      window.location.href = "login.html";
      return null;
    }

    if (!options.skipBilling && profile.email !== PLATFORM_OWNER_EMAIL) {
      const active = await isSubscriptionActive(profile.id);
      if (!active) {
        window.location.href = "subscription.html";
        return null;
      }
    }

    return profile;
  } catch (err) {
    console.error("Erreur de récupération du profil :", err);
    window.location.href = "login.html";
    return null;
  }
}

/**
 * Vérifie si l'abonnement de l'utilisateur (essai ou payé) est actuellement valide.
 * @param {string} ownerId
 * @returns {Promise<boolean>}
 */
export async function isSubscriptionActive(ownerId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, trial_ends_at, current_period_end")
    .eq("owner_id", ownerId)
    .single();

  if (error || !data) return false;

  const now = new Date();

  if (data.status === "trial") {
    return data.trial_ends_at ? new Date(data.trial_ends_at) > now : false;
  }
  if (data.status === "active") {
    return data.current_period_end ? new Date(data.current_period_end) > now : false;
  }
  return false;
}

/** Récupère le profil (table public.profiles) de l'utilisateur connecté. */
export async function fetchCurrentProfile() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Aucun utilisateur connecté.");

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active, email, establishment_name")
    .eq("id", user.id)
    .single();

  if (error) throw new Error("Impossible de charger le profil utilisateur.");
  return data;
}

/** Traduit les erreurs Supabase Auth en messages compréhensibles en français. */
function mapAuthError(error) {
  const msg = error.message || "";
  if (msg.includes("Invalid login credentials")) {
    return "Email ou mot de passe incorrect.";
  }
  if (msg.includes("Email not confirmed")) {
    return "Veuillez confirmer votre email avant de vous connecter.";
  }
  return "Une erreur est survenue lors de la connexion. Réessayez.";
}
