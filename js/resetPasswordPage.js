// =============================================================
// TAILORFLOW — Nouveau mot de passe (lien reçu par email)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { updatePassword, fetchCurrentProfile, homeForRole } from "./auth.js";
import { setButtonLoading } from "./utils.js";

const form = document.getElementById("reset-form");
const errorEl = document.getElementById("error-message");
const submitBtn = document.getElementById("submit-btn");

// Le lien de l'email établit une session « recovery » (lue dans l'URL par supabase-js).
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  document.getElementById("subtitle").textContent = "";
  form.innerHTML = `
    <p class="error-message">Ce lien n'est plus valide ou a expiré.</p>
    <a class="btn btn-primary btn-block" href="forgot-password.html">Redemander un lien</a>`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";

  if (form.password.value !== form.password_confirm.value) {
    errorEl.textContent = "Les deux mots de passe ne correspondent pas.";
    return;
  }

  setButtonLoading(submitBtn, true);
  try {
    await updatePassword(form.password.value);
    const profile = await fetchCurrentProfile().catch(() => null);
    window.location.href = homeForRole(profile?.role);
  } catch (err) {
    errorEl.textContent = err.message;
    setButtonLoading(submitBtn, false);
  }
});
