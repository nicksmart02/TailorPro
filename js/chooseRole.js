// =============================================================
// TAILORFLOW — Choix du rôle après inscription (couturier / client)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { activateCouturierRole, activateClientRole, fetchCurrentProfile, homeForRole, logout } from "./auth.js";
import { setButtonLoading } from "./utils.js";

const roleChoice = document.getElementById("role-choice");
const clientForm = document.getElementById("client-form");
const roleError = document.getElementById("role-error");

init();

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  // Rôle déjà choisi : retour direct à l'espace correspondant.
  const profile = await fetchCurrentProfile().catch(() => null);
  if (profile && profile.role !== "pending") {
    window.location.href = homeForRole(profile.role);
    return;
  }
  if (profile?.full_name) clientForm.full_name.value = profile.full_name;

  document.getElementById("choose-couturier").addEventListener("click", handleCouturier);
  document.getElementById("choose-client").addEventListener("click", () => {
    roleChoice.hidden = true;
    clientForm.hidden = false;
    clientForm.phone.focus();
  });
  document.getElementById("client-form-back").addEventListener("click", () => {
    clientForm.hidden = true;
    roleChoice.hidden = false;
  });
  document.getElementById("role-logout").addEventListener("click", logout);
  clientForm.addEventListener("submit", handleClient);
}

async function handleCouturier(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  roleError.textContent = "";
  try {
    await activateCouturierRole();
    window.location.href = "dashboard.html";
  } catch (err) {
    roleError.textContent = err.message;
    btn.disabled = false;
  }
}

async function handleClient(e) {
  e.preventDefault();
  const errorEl = document.getElementById("client-form-error");
  const submitBtn = document.getElementById("client-submit-btn");
  errorEl.textContent = "";
  setButtonLoading(submitBtn, true, "Enregistrement...");

  try {
    await activateClientRole(clientForm.full_name.value.trim(), clientForm.phone.value.trim());
    window.location.href = "client-portal.html";
  } catch (err) {
    errorEl.textContent = err.message;
    setButtonLoading(submitBtn, false);
  }
}
