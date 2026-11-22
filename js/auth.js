// =============================================================
// TAILORFLOW — Authentification, profil, garde d'accès
// =============================================================
import { supabase } from "./supabaseClient.js";
import { escapeHtml, isSchemaOutdatedError, mapDbError } from "./utils.js";

const PROFILE_COLUMNS = "id, full_name, role, is_active, email, establishment_name, establishment_phone, establishment_address, phone";

/** Page d'accueil selon le rôle. */
export function homeForRole(role) {
  if (role === "pending") return "choose-role.html";
  if (role === "client") return "client-portal.html";
  return "dashboard.html";
}

/**
 * Connecte un utilisateur avec email/mot de passe.
 * @returns {Promise<{user: object, profile: object}>}
 */
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(mapAuthError(error));

  const profile = await fetchCurrentProfile();
  if (!profile.is_active) {
    await supabase.auth.signOut();
    throw new Error("Ce compte a été désactivé. Contacte le support TailorFlow.");
  }
  return { user: data.user, profile };
}

/** Déconnecte l'utilisateur courant. */
export async function logout() {
  await supabase.auth.signOut();
  window.location.href = "login.html";
}

/** Envoie un email de réinitialisation (le lien ramène sur reset-password.html). */
export async function requestPasswordReset(email) {
  const base = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${base}reset-password.html` });
  if (error) throw new Error("Impossible d'envoyer l'email de réinitialisation. Réessaie dans quelques minutes.");
}

/** Définit un nouveau mot de passe (session de récupération active). */
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error("Impossible de mettre à jour le mot de passe.");
}

/** Récupère le profil (table public.profiles) de l'utilisateur connecté. */
export async function fetchCurrentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Aucun utilisateur connecté.");

  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).single();
  if (error) {
    const err = new Error("Impossible de charger le profil utilisateur.");
    err.cause = error;
    throw err;
  }
  return data;
}

/** Statut d'abonnement de l'utilisateur connecté (fonction SQL my_subscription). */
export async function fetchSubscription() {
  const { data, error } = await supabase.rpc("my_subscription");
  if (error) {
    const err = new Error("Impossible de charger l'abonnement.");
    err.cause = error;
    throw err;
  }
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Garde des pages de l'espace couturier.
 * Redirige vers la connexion, le choix du rôle, le portail client ou la page
 * d'abonnement selon le cas. Renvoie le profil enrichi de
 * `subscription` et `isPlatformOwner`, ou null si une redirection a lieu.
 *
 * @param {object} [options]
 * @param {boolean} [options.skipBilling] - ne pas exiger d'abonnement actif (page Abonnement)
 */
export async function requireAuth(options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
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
    if (profile.role === "pending" || profile.role === "client") {
      window.location.href = homeForRole(profile.role);
      return null;
    }

    const subscription = await fetchSubscription();
    profile.subscription = subscription || null;
    profile.isPlatformOwner = Boolean(subscription?.is_platform_owner);

    if (!options.skipBilling && !subscription?.has_access) {
      window.location.href = "subscription.html";
      return null;
    }
    return profile;
  } catch (err) {
    handleGuardError(err);
    return null;
  }
}

/** Garde des pages du portail client (rôle « client »). */
export async function requireClientAuth() {
  const { data: { session } } = await supabase.auth.getSession();
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
    if (profile.role !== "client") {
      window.location.href = homeForRole(profile.role);
      return null;
    }
    return profile;
  } catch (err) {
    handleGuardError(err);
    return null;
  }
}

/**
 * Garde « tout utilisateur connecté » (marketplace) : renvoie le profil,
 * enrichi de l'abonnement pour les couturiers.
 */
export async function requireAnyRole() {
  const { data: { session } } = await supabase.auth.getSession();
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
      const subscription = await fetchSubscription();
      profile.subscription = subscription || null;
      profile.isPlatformOwner = Boolean(subscription?.is_platform_owner);
    }
    return profile;
  } catch (err) {
    handleGuardError(err);
    return null;
  }
}

/**
 * Affiche un écran d'erreur bloquant plutôt que de rediriger vers la
 * connexion (ce qui provoquerait une boucle si la session est valide).
 */
function handleGuardError(err) {
  console.error(err);
  const cause = err?.cause;
  const outdated = isSchemaOutdatedError(cause);
  renderFatalScreen(
    outdated
      ? "La base de données doit être mise à jour (migration 023). Exécute sql/023_hardening_and_saas_v3.sql dans Supabase, puis recharge la page."
      : "Impossible de charger ton espace pour le moment. Vérifie ta connexion internet puis recharge la page."
  );
}

/** Remplace le contenu de la page par un message d'erreur et un bouton de déconnexion. */
export function renderFatalScreen(message) {
  document.body.innerHTML = `
    <div class="login-page">
      <div class="login-card" role="alert">
        <h1>TailorFlow</h1>
        <p class="subtitle">${escapeHtml(message)}</p>
        <button class="btn btn-primary btn-block" id="fatal-reload">Recharger</button>
        <button class="btn btn-secondary btn-block" id="fatal-logout" style="margin-top:8px;">Se déconnecter</button>
      </div>
    </div>`;
  document.getElementById("fatal-reload").addEventListener("click", () => window.location.reload());
  document.getElementById("fatal-logout").addEventListener("click", logout);
}

/** Choix du rôle « couturier » : essai gratuit + types de vêtements par défaut. */
export async function activateCouturierRole() {
  const { error } = await supabase.rpc("activate_couturier_role");
  if (error) throw new Error(mapDbError(error, "Impossible d'activer le rôle couturier."));
}

/**
 * Choix du rôle « client » : enregistre le téléphone et envoie une demande de
 * rattachement aux ateliers qui ont une fiche client avec ce numéro.
 * @returns {Promise<number>} nombre de demandes envoyées
 */
export async function activateClientRole(fullName, phone) {
  const { data, error } = await supabase.rpc("activate_client_role", { p_full_name: fullName, p_phone: phone });
  if (error) throw new Error(mapDbError(error, "Impossible d'activer le rôle client."));
  return data ?? 0;
}

/** Relance la recherche d'ateliers par téléphone (portail client). */
export async function relinkClientByPhone() {
  const { data, error } = await supabase.rpc("relink_client_by_phone");
  if (error) throw new Error(mapDbError(error, "Impossible de relancer la recherche."));
  return data ?? 0;
}

/** Rattache le compte client connecté à une fiche via un code d'invitation. */
export async function claimInviteCode(code) {
  const { error } = await supabase.rpc("claim_client_invite", { p_code: code.trim().toUpperCase() });
  if (error) throw new Error(mapDbError(error, "Code d'invitation invalide ou déjà utilisé."));
}

/** Traduit les erreurs Supabase Auth en français. */
export function mapAuthError(error) {
  const msg = error?.message || "";
  if (msg.includes("Invalid login credentials")) return "Email ou mot de passe incorrect.";
  if (msg.includes("Email not confirmed")) return "Confirme ton email (lien reçu par mail) avant de te connecter.";
  if (msg.includes("already registered") || msg.includes("already been registered")) return "Un compte existe déjà avec cet email.";
  if (msg.includes("Password should be")) return "Mot de passe trop faible (8 caractères minimum).";
  if (msg.toLowerCase().includes("rate limit")) return "Trop de tentatives. Patiente quelques minutes.";
  if (msg.includes("Failed to fetch")) return "Connexion impossible. Vérifie ta connexion internet.";
  return "Une erreur est survenue. Réessaie.";
}
