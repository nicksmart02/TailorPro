// =============================================================
// TAILORFLOW — Création de compte
// =============================================================
import { supabase } from "./supabaseClient.js";
import { mapAuthError } from "./auth.js";
import { escapeHtml, setButtonLoading } from "./utils.js";

const form = document.getElementById("signup-form");
const errorEl = document.getElementById("error-message");
const submitBtn = document.getElementById("submit-btn");
const baseUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}`;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";

  if (form.password.value !== form.password_confirm.value) {
    errorEl.textContent = "Les deux mots de passe ne correspondent pas.";
    return;
  }

  setButtonLoading(submitBtn, true, "Création...");
  const email = form.email.value.trim();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: form.password.value,
    options: {
      data: { full_name: form.full_name.value.trim() },
      emailRedirectTo: `${baseUrl}choose-role.html`,
    },
  });

  if (error) {
    errorEl.textContent = mapAuthError(error);
    setButtonLoading(submitBtn, false);
    return;
  }

  // Confirmation email désactivée : la session existe déjà.
  if (data.session) {
    window.location.href = "choose-role.html";
    return;
  }

  form.innerHTML = `
    <div class="banner banner-success">
      Compte créé ! Un email de confirmation a été envoyé à <strong>${escapeHtml(email)}</strong>.
      Clique sur le lien reçu pour activer ton compte (pense à vérifier les spams).
    </div>
    <a class="btn btn-secondary btn-block" href="login.html?email=${encodeURIComponent(email)}">Aller à la connexion</a>`;
});
