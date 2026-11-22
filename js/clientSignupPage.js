// =============================================================
// TAILORFLOW — Activation de l'espace client via un code d'invitation
// =============================================================
import { supabase } from "./supabaseClient.js";
import { claimInviteCode, mapAuthError } from "./auth.js";
import { escapeHtml, setButtonLoading } from "./utils.js";

const form = document.getElementById("client-signup-form");
const errorEl = document.getElementById("error-message");
const submitBtn = document.getElementById("submit-btn");
const baseUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}`;

const prefillCode = new URLSearchParams(window.location.search).get("code");
if (prefillCode) form.invite_code.value = prefillCode.toUpperCase();

// Déjà connecté : l'activation se fait sur la page dédiée (sans recréer de compte).
const { data: { session } } = await supabase.auth.getSession();
if (session) {
  window.location.replace(`client-activate.html${prefillCode ? `?code=${encodeURIComponent(prefillCode)}` : ""}`);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  setButtonLoading(submitBtn, true, "Activation...");

  const code = form.invite_code.value.trim().toUpperCase();
  const email = form.email.value.trim();

  const { data, error } = await supabase.auth.signUp({
    email,
    password: form.password.value,
    options: {
      data: { full_name: form.full_name.value.trim() },
      emailRedirectTo: `${baseUrl}client-activate.html?code=${encodeURIComponent(code)}`,
    },
  });

  if (error) {
    errorEl.textContent = mapAuthError(error);
    setButtonLoading(submitBtn, false);
    return;
  }

  // Confirmation email activée : pas encore de session, l'activation se fera au retour du lien.
  if (!data.session) {
    form.innerHTML = `
      <div class="banner banner-success">
        Compte créé ! Confirme ton adresse <strong>${escapeHtml(email)}</strong> via le lien reçu par email :
        ton espace sera activé automatiquement au retour.
      </div>`;
    return;
  }

  try {
    await claimInviteCode(code);
    window.location.href = "client-portal.html";
  } catch (err) {
    errorEl.textContent = `${err.message} Ton compte est créé : demande un nouveau code à ton couturier.`;
    setButtonLoading(submitBtn, false);
  }
});
