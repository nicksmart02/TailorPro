// =============================================================
// TAILORFLOW — Page de connexion
// =============================================================
import { supabase } from "./supabaseClient.js";
import { login, fetchCurrentProfile, homeForRole } from "./auth.js";
import { setButtonLoading } from "./utils.js";

const form = document.getElementById("login-form");
const errorEl = document.getElementById("error-message");
const submitBtn = document.getElementById("submit-btn");

// Déjà connecté (ou retour d'un lien de confirmation email) : redirection directe.
const { data: { session } } = await supabase.auth.getSession();
if (session) {
  const profile = await fetchCurrentProfile().catch(() => null);
  if (profile) window.location.replace(homeForRole(profile.role));
}

const params = new URLSearchParams(window.location.search);
if (params.get("email")) form.email.value = params.get("email");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  setButtonLoading(submitBtn, true, "Connexion...");

  try {
    const { profile } = await login(form.email.value.trim(), form.password.value);
    window.location.href = homeForRole(profile.role);
  } catch (err) {
    errorEl.textContent = err.message;
    setButtonLoading(submitBtn, false);
  }
});
