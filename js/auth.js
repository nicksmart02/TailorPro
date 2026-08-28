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
 * Envoie un email de réinitialisation de mot de passe.
 * Le lien reçu par email ramène l'utilisateur sur reset-password.html.
 */
export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}reset-password.html`,
  });
  if (error) throw new Error("Impossible d'envoyer l'email de réinitialisation.");
}

/**
 * Définit un nouveau mot de passe. A appeler depuis reset-password.html,
 * une fois la session de récupération établie (lien cliqué depuis l'email).
 */
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error("Impossible de mettre à jour le mot de passe.");
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

    // Un compte tout juste créé n'a pas encore choisi son rôle.
    if (profile.role === "pending") {
      window.location.href = "choose-role.html";
      return null;
    }

    // Un compte client n'a rien à faire sur l'espace couturier.
    if (profile.role === "client") {
      window.location.href = "client-portal.html";
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
 * Variante de requireAuth pour les pages du portail client : exige une
 * session valide avec le rôle "client", sans vérification d'abonnement
 * (l'abonnement concerne l'atelier du couturier, pas le client final).
 * Redirige vers login.html si non connecté, ou vers dashboard.html si
 * connecté mais avec un autre rôle (couturier/admin).
 */
export async function requireClientAuth() {
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

    if (profile.role === "pending") {
      window.location.href = "choose-role.html";
      return null;
    }

    if (profile.role !== "client") {
      window.location.href = "dashboard.html";
      return null;
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
    .select("id, full_name, role, is_active, email, establishment_name, phone")
    .eq("id", user.id)
    .single();

  if (error) throw new Error("Impossible de charger le profil utilisateur.");
  return data;
}

/**
 * Active le rôle "couturier" pour le compte courant (essai gratuit + types
 * de vêtements par défaut créés côté base de données).
 */
export async function activateCouturierRole() {
  const { error } = await supabase.rpc("activate_couturier_role");
  if (error) throw new Error("Impossible d'activer le rôle couturier.");
}

/**
 * Active le rôle "client" pour le compte courant, et rattache automatiquement
 * toutes les fiches client existantes (chez n'importe quel couturier) partageant
 * ce numéro de téléphone.
 * @returns {Promise<number>} nombre de couturiers rattachés automatiquement
 */
export async function activateClientRole(fullName, phone) {
  const { data, error } = await supabase.rpc("activate_client_role", {
    p_full_name: fullName,
    p_phone: phone,
  });
  if (error) throw new Error("Impossible d'activer le rôle client.");
  return data ?? 0;
}

/**
 * Relance une recherche de rattachement par téléphone pour un compte client
 * déjà actif (utile si un couturier l'a ajouté comme client après coup).
 * @returns {Promise<number>} nombre de nouveaux couturiers rattachés
 */
export async function relinkClientByPhone() {
  const { data, error } = await supabase.rpc("relink_client_by_phone");
  if (error) throw new Error(error.message || "Impossible de relancer la recherche.");
  return data ?? 0;
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
