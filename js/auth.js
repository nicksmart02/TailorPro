// =============================================================
// TAILORFLOW — Module d'authentification
// =============================================================
import { supabase } from "./supabaseClient.js";

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
 * A appeler en haut de chaque page protégée.
 * @returns {Promise<object>} profil (id, full_name, role, is_active)
 */
export async function requireAuth() {
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
    return profile;
  } catch (err) {
    console.error("Erreur de récupération du profil :", err);
    window.location.href = "login.html";
    return null;
  }
}

/** Récupère le profil (table public.profiles) de l'utilisateur connecté. */
export async function fetchCurrentProfile() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Aucun utilisateur connecté.");

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
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
