// =============================================================
// TAILORFLOW — Finalisation de l'espace client (après confirmation email)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { claimInviteCode, fetchCurrentProfile, homeForRole, mapAuthError } from "./auth.js";
import { setButtonLoading } from "./utils.js";

const form = document.getElementById("activate-form");
const errorEl = document.getElementById("error-message");
const submitBtn = document.getElementById("submit-btn");
const credentials = document.getElementById("credentials-fields");

const prefillCode = new URLSearchParams(window.location.search).get("code");
if (prefillCode) form.invite_code.value = prefillCode.toUpperCase();

async function activate(code) {
  setButtonLoading(submitBtn, true, "Activation...");
  try {
    await claimInviteCode(code);
    window.location.href = "client-portal.html";
  } catch (err) {
    errorEl.textContent = err.message;
    setButtonLoading(submitBtn, false);
  }
}

// Retour du lien de confirmation : la session existe déjà, inutile de redemander le mot de passe.
const { data: { session } } = await supabase.auth.getSession();
if (session) {
  credentials.hidden = true;
  form.email.required = false;
  form.password.required = false;
  const profile = await fetchCurrentProfile().catch(() => null);
  if (profile && profile.role !== "pending" && profile.role !== "client") {
    errorEl.textContent = "Ce compte est un compte couturier : utilise une autre adresse email pour ton espace client.";
  } else if (prefillCode) {
    await activate(prefillCode);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";

  if (!credentials.hidden) {
    setButtonLoading(submitBtn, true, "Connexion...");
    const { error } = await supabase.auth.signInWithPassword({
      email: form.email.value.trim(),
      password: form.password.value,
    });
    setButtonLoading(submitBtn, false);
    if (error) {
      errorEl.textContent = mapAuthError(error);
      return;
    }
  }

  const code = form.invite_code.value.trim();
  if (!code) {
    const profile = await fetchCurrentProfile().catch(() => null);
    window.location.href = homeForRole(profile?.role);
    return;
  }
  await activate(code);
});
