// =============================================================
// TAILORFLOW — Mot de passe oublié
// =============================================================
import { requestPasswordReset } from "./auth.js";
import { setButtonLoading } from "./utils.js";

const form = document.getElementById("forgot-form");
const errorEl = document.getElementById("error-message");
const successEl = document.getElementById("success-message");
const submitBtn = document.getElementById("submit-btn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  successEl.hidden = true;
  setButtonLoading(submitBtn, true, "Envoi...");

  try {
    await requestPasswordReset(form.email.value.trim());
    successEl.textContent =
      "Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé. Vérifie ta boîte mail (et les spams).";
    successEl.hidden = false;
    form.email.disabled = true;
    submitBtn.hidden = true;
  } catch (err) {
    errorEl.textContent = err.message;
    setButtonLoading(submitBtn, false);
  }
});
