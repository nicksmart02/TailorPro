// =============================================================
// TAILORFLOW — Paramètres : gestion des utilisateurs
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { escapeHtml, showToast } from "./utils.js";

const ROLE_LABELS = { admin: "Administrateur", employee: "Employé", accountant: "Comptable" };
const PLATFORM_OWNER_EMAIL = "jahadjitse@gmail.com";
const PLAN_LABELS = { mensuel: "Mensuel", annuel: "Annuel" };

let currentProfile = null;

const tableBody = document.getElementById("users-table-body");
const requestsTableBody = document.getElementById("payment-requests-table-body");

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
  await loadPaymentRequests();
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

async function loadPaymentRequests() {
  const { data, error } = await supabase
    .from("payment_requests")
    .select("id, plan, amount, phone_number, status, submitted_at, profiles!payment_requests_owner_id_fkey(full_name, email)")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (error) {
    requestsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-danger);">Erreur de chargement.</td></tr>`;
    console.error(error);
    return;
  }

  if (!data.length) {
    requestsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-text-muted);">Aucune demande en attente.</td></tr>`;
    return;
  }

  requestsTableBody.innerHTML = data
    .map(
      (r) => `
    <tr>
      <td data-label="Date">${new Date(r.submitted_at).toLocaleDateString("fr-FR")}</td>
      <td data-label="Utilisateur">${escapeHtml(r.profiles?.full_name || "—")}<br/><span style="color:var(--color-text-muted); font-size:0.8rem;">${escapeHtml(r.profiles?.email || "")}</span></td>
      <td data-label="Formule">${PLAN_LABELS[r.plan] || r.plan}</td>
      <td data-label="Montant">${new Intl.NumberFormat("fr-FR").format(r.amount)} FCFA</td>
      <td data-label="Téléphone">${escapeHtml(r.phone_number)}</td>
      <td data-label="" style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn btn-primary approve-request-btn" data-id="${r.id}">Valider</button>
        <button class="btn btn-secondary reject-request-btn" data-id="${r.id}">Refuser</button>
      </td>
    </tr>`
    )
    .join("");

  document.querySelectorAll(".approve-request-btn").forEach((btn) => {
    btn.addEventListener("click", () => approveRequest(btn.dataset.id));
  });
  document.querySelectorAll(".reject-request-btn").forEach((btn) => {
    btn.addEventListener("click", () => rejectRequest(btn.dataset.id));
  });
}

async function approveRequest(id) {
  if (!confirm("Confirmer la validation de ce paiement ? L'abonnement de l'utilisateur sera activé immédiatement.")) return;

  const { error } = await supabase.rpc("approve_payment_request", { p_request_id: id });

  if (error) {
    showToast("Erreur lors de la validation.", "error");
    console.error(error);
    return;
  }

  showToast("Paiement validé, abonnement activé.", "success");
  await loadPaymentRequests();
}

async function rejectRequest(id) {
  if (!confirm("Confirmer le refus de cette demande ?")) return;

  const { error } = await supabase.rpc("reject_payment_request", { p_request_id: id });

  if (error) {
    showToast("Erreur lors du refus.", "error");
    console.error(error);
    return;
  }

  showToast("Demande refusée.", "success");
  await loadPaymentRequests();
}
