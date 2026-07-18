// =============================================================
// TAILORFLOW — Paramètres : gestion des utilisateurs
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { escapeHtml, showToast } from "./utils.js";

const ROLE_LABELS = { admin: "Administrateur", employee: "Employé", accountant: "Comptable" };
const PLATFORM_OWNER_EMAIL = "jahadjitse@gmail.com";

let currentProfile = null;

const tableBody = document.getElementById("users-table-body");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "settings");

  if (currentProfile.email !== PLATFORM_OWNER_EMAIL) {
    document.querySelector(".app-main").innerHTML = `<p class="error-message">Accès réservé au propriétaire de la plateforme.</p>`;
    return;
  }

  await loadUsers();
}

async function loadUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .order("full_name", { ascending: true });

  if (error) {
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--color-danger);">Erreur de chargement.</td></tr>`;
    console.error(error);
    return;
  }

  tableBody.innerHTML = data
    .map(
      (u) => `
    <tr data-id="${u.id}">
      <td data-label="Nom">${escapeHtml(u.full_name)}${u.id === currentProfile.id ? " <em>(vous)</em>" : ""}</td>
      <td data-label="Email">${escapeHtml(u.email || "—")}</td>
      <td data-label="Rôle">
        <select class="role-select" data-id="${u.id}" ${u.id === currentProfile.id ? "disabled" : ""}>
          ${Object.entries(ROLE_LABELS)
            .map(([key, label]) => `<option value="${key}" ${u.role === key ? "selected" : ""}>${label}</option>`)
            .join("")}
        </select>
      </td>
      <td data-label="Statut">
        <span class="badge ${u.is_active ? "badge-delivered" : "badge-cancelled"}">${u.is_active ? "Actif" : "Désactivé"}</span>
      </td>
      <td data-label="">
        <button class="btn btn-secondary toggle-active-btn" data-id="${u.id}" data-active="${u.is_active}" ${u.id === currentProfile.id ? "disabled" : ""}>
          ${u.is_active ? "Désactiver" : "Réactiver"}
        </button>
      </td>
    </tr>`
    )
    .join("");

  document.querySelectorAll(".role-select").forEach((select) => {
    select.addEventListener("change", () => updateRole(select.dataset.id, select.value));
  });

  document.querySelectorAll(".toggle-active-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleActive(btn.dataset.id, btn.dataset.active === "true"));
  });
}

async function updateRole(userId, newRole) {
  const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", userId);

  if (error) {
    showToast("Erreur lors de la mise à jour du rôle.", "error");
    console.error(error);
    return;
  }

  showToast("Rôle mis à jour.", "success");
}

async function toggleActive(userId, isCurrentlyActive) {
  const action = isCurrentlyActive ? "désactiver" : "réactiver";
  if (!confirm(`Confirmer : ${action} ce compte ?`)) return;

  const { error } = await supabase.from("profiles").update({ is_active: !isCurrentlyActive }).eq("id", userId);

  if (error) {
    showToast("Erreur lors de la mise à jour du statut.", "error");
    console.error(error);
    return;
  }

  showToast(`Compte ${isCurrentlyActive ? "désactivé" : "réactivé"}.`, "success");
  await loadUsers();
}
