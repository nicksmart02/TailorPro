// =============================================================
// TAILORFLOW — Choix de rôle après inscription (couturier / client)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { activateCouturierRole, activateClientRole } from "./auth.js";

const { data: { session } } = await supabase.auth.getSession();
if (!session) window.location.href = "login.html";

const roleChoice = document.getElementById("role-choice");
const clientForm = document.getElementById("client-form");
const roleError = document.getElementById("role-error");

document.getElementById("choose-couturier").addEventListener("click", async (e) => {
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
});

document.getElementById("choose-client").addEventListener("click", () => {
  roleChoice.style.display = "none";
  clientForm.style.display = "block";
});

document.getElementById("client-form-back").addEventListener("click", () => {
  clientForm.style.display = "none";
  roleChoice.style.display = "block";
});

clientForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("client-form-error");
  const submitBtn = document.getElementById("client-submit-btn");
  errorEl.textContent = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "Recherche en cours...";

  try {
    const linkedCount = await activateClientRole(
      clientForm.full_name.value.trim(),
      clientForm.phone.value.trim()
    );

    if (linkedCount > 0) {
      sessionStorage.setItem("tf_just_linked_count", String(linkedCount));
    }

    window.location.href = "client-portal.html";
  } catch (err) {
    errorEl.textContent = err.message;
    submitBtn.disabled = false;
    submitBtn.textContent = "Continuer";
  }
});
