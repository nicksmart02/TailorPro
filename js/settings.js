// =============================================================
// TAILORFLOW — Paramètres de l'atelier + administration de la plateforme
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import {
  escapeHtml, showToast, formatDate, formatMoney, mapDbError, setButtonLoading, tableMessageRow, daysUntil,
  debounce,
} from "./utils.js";
import { PLANS } from "./config.js";

const ROLE_LABELS = {
  admin: "Propriétaire",
  couturier: "Couturier",
  client: "Client",
  pending: "Sans rôle",
  employee: "Couturier",
  accountant: "Couturier",
};
const SUB_LABELS = { trial: "Essai", active: "Actif", expired: "Expiré", pending: "En attente", cancelled: "Annulé" };
const OPERATOR_LABELS = { tmoney: "TMoney", flooz: "Flooz" };

let currentProfile = null;
let accounts = [];

init();

async function init() {
  currentProfile = await requireAuth({ skipBilling: true });
  if (!currentProfile) return;
  renderNav(currentProfile, "settings");

  fillProfileForm();
  document.getElementById("profile-settings-form").addEventListener("submit", handleSaveProfile);

  if (!currentProfile.isPlatformOwner) return;

  document.getElementById("owner-only-settings").hidden = false;
  document.getElementById("accounts-search").addEventListener("input", debounce(renderAccounts, 200));
  document.getElementById("accounts-filter").addEventListener("change", renderAccounts);
  await Promise.all([loadAccounts(), loadPaymentRequests()]);
}

// ---------------------------------------------------------------
// Mon atelier
// ---------------------------------------------------------------

function fillProfileForm() {
  const form = document.getElementById("profile-settings-form");
  form.establishment_name.value = currentProfile.establishment_name || "";
  form.establishment_phone.value = currentProfile.establishment_phone || "";
  form.establishment_address.value = currentProfile.establishment_address || "";
  form.full_name.value = currentProfile.full_name || "";
  document.getElementById("account-email").textContent = currentProfile.email || "—";
}

async function handleSaveProfile(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("profile-settings-error");
  errorEl.textContent = "";

  const fullName = form.full_name.value.trim();
  if (!fullName) {
    errorEl.textContent = "Ton nom est requis.";
    return;
  }

  const payload = {
    full_name: fullName,
    establishment_name: form.establishment_name.value.trim() || null,
    establishment_phone: form.establishment_phone.value.trim() || null,
    establishment_address: form.establishment_address.value.trim() || null,
  };

  const submitBtn = form.querySelector("button[type=submit]");
  setButtonLoading(submitBtn, true);
  const { error } = await supabase.from("profiles").update(payload).eq("id", currentProfile.id);
  setButtonLoading(submitBtn, false);

  if (error) {
    errorEl.textContent = mapDbError(error, "Erreur lors de l'enregistrement.");
    console.error(error);
    return;
  }

  Object.assign(currentProfile, payload);
  renderNav(currentProfile, "settings");
  showToast("Informations de l'atelier enregistrées.", "success");
}

// ---------------------------------------------------------------
// Administration (propriétaire de la plateforme)
// ---------------------------------------------------------------

async function loadAccounts() {
  const tbody = document.getElementById("accounts-table-body");
  tbody.innerHTML = tableMessageRow(6, "Chargement...");

  const { data, error } = await supabase.rpc("admin_accounts");
  if (error) {
    tbody.innerHTML = tableMessageRow(6, mapDbError(error, "Erreur de chargement."), "error");
    console.error(error);
    return;
  }
  accounts = data || [];
  renderStats();
  renderAccounts();
}

function renderStats() {
  const tailors = accounts.filter((a) => ["couturier", "employee", "accountant"].includes(a.role));
  const clients = accounts.filter((a) => a.role === "client");
  const active = tailors.filter((a) => a.subscription_status === "active" && a.has_access);
  const trial = tailors.filter((a) => a.subscription_status === "trial" && a.has_access);
  const expired = tailors.filter((a) => !a.has_access);
  const mrr = active.reduce((sum, a) => sum + (a.plan === "annuel" ? PLANS.annuel.amount / 12 : PLANS.mensuel.amount), 0);

  document.getElementById("platform-stats").innerHTML = `
    <div class="card kpi-card"><div class="kpi-label">Ateliers</div><div class="kpi-value">${tailors.length}</div></div>
    <div class="card kpi-card"><div class="kpi-label">Abonnés actifs</div><div class="kpi-value text-success">${active.length}</div></div>
    <div class="card kpi-card"><div class="kpi-label">En essai</div><div class="kpi-value">${trial.length}</div></div>
    <div class="card kpi-card"><div class="kpi-label">Expirés</div><div class="kpi-value text-danger">${expired.length}</div></div>
    <div class="card kpi-card"><div class="kpi-label">Comptes clients</div><div class="kpi-value">${clients.length}</div></div>
    <div class="card kpi-card"><div class="kpi-label">Revenu mensuel récurrent</div><div class="kpi-value">${formatMoney(Math.round(mrr))}</div></div>
  `;
}

function subscriptionCell(a) {
  if (a.role === "admin") return '<span class="badge badge-delivered">Illimité</span>';
  if (!["couturier", "employee", "accountant"].includes(a.role)) return '<span class="text-muted">—</span>';
  if (!a.subscription_status) return '<span class="badge badge-cancelled">Aucun</span>';

  const end = a.subscription_status === "trial" ? a.trial_ends_at : a.current_period_end;
  const label = SUB_LABELS[a.subscription_status] || a.subscription_status;
  const cls = a.has_access ? (a.subscription_status === "trial" ? "badge-in_progress" : "badge-delivered") : "badge-cancelled";
  const detail = end ? (a.has_access ? `jusqu'au ${formatDate(end)} (${daysUntil(end)} j)` : `depuis le ${formatDate(end)}`) : "";
  return `<span class="badge ${cls}">${escapeHtml(a.has_access ? label : "Expiré")}${a.plan ? " · " + escapeHtml(PLANS[a.plan]?.label || a.plan) : ""}</span>
    <div class="text-muted text-sm">${detail}</div>`;
}

function renderAccounts() {
  const tbody = document.getElementById("accounts-table-body");
  const term = document.getElementById("accounts-search").value.trim().toLowerCase();
  const filter = document.getElementById("accounts-filter").value;

  const rows = accounts.filter((a) => {
    if (term && ![a.full_name, a.email, a.establishment_name].filter(Boolean).some((v) => v.toLowerCase().includes(term))) return false;
    if (filter === "tailors") return ["couturier", "employee", "accountant", "admin"].includes(a.role);
    if (filter === "clients") return a.role === "client";
    if (filter === "expired") return ["couturier", "employee", "accountant"].includes(a.role) && !a.has_access;
    if (filter === "pending") return a.role === "pending";
    return true;
  });

  if (!rows.length) {
    tbody.innerHTML = tableMessageRow(6, "Aucun compte.");
    return;
  }

  tbody.innerHTML = rows
    .map((a) => {
      const isSelf = a.id === currentProfile.id;
      const isTailor = ["couturier", "employee", "accountant"].includes(a.role);
      return `
    <tr>
      <td data-label="Compte">
        <strong>${escapeHtml(a.establishment_name || a.full_name)}</strong>${isSelf ? " <em>(vous)</em>" : ""}
        <div class="text-muted text-sm">${escapeHtml(a.full_name)} · ${escapeHtml(a.email || "—")}</div>
      </td>
      <td data-label="Rôle">${escapeHtml(ROLE_LABELS[a.role] || a.role)}<div class="text-muted text-sm">inscrit le ${formatDate(a.created_at)}</div></td>
      <td data-label="Abonnement">${subscriptionCell(a)}</td>
      <td data-label="Activité">${isTailor ? `${a.clients_count} clients · ${a.orders_count} commandes` : "—"}</td>
      <td data-label="Statut"><span class="badge ${a.is_active ? "badge-delivered" : "badge-cancelled"}">${a.is_active ? "Actif" : "Désactivé"}</span></td>
      <td data-label="">
        <div class="button-row button-row-end">
          ${isTailor ? `<button class="btn btn-secondary btn-sm grant-btn" data-id="${a.id}" data-plan="mensuel" type="button">+1 mois</button>
          <button class="btn btn-secondary btn-sm grant-btn" data-id="${a.id}" data-plan="annuel" type="button">+1 an</button>` : ""}
          ${isSelf || a.role === "admin" ? "" : `<button class="btn btn-ghost btn-sm toggle-active-btn" data-id="${a.id}" data-active="${a.is_active}" type="button">${a.is_active ? "Désactiver" : "Réactiver"}</button>`}
        </div>
      </td>
    </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".grant-btn").forEach((btn) => btn.addEventListener("click", () => grantSubscription(btn)));
  tbody.querySelectorAll(".toggle-active-btn").forEach((btn) =>
    btn.addEventListener("click", () => toggleActive(btn.dataset.id, btn.dataset.active === "true"))
  );
}

async function grantSubscription(btn) {
  const account = accounts.find((a) => a.id === btn.dataset.id);
  const plan = PLANS[btn.dataset.plan];
  if (!confirm(`Ajouter ${btn.dataset.plan === "annuel" ? "1 an" : "1 mois"} d'abonnement (${plan.label}) à « ${account.establishment_name || account.full_name} » ?\nÀ utiliser pour un paiement reçu hors application (espèces...) ou un geste commercial.`)) return;

  setButtonLoading(btn, true, "...");
  const { data, error } = await supabase.rpc("admin_grant_subscription", { p_owner_id: account.id, p_plan: btn.dataset.plan });
  setButtonLoading(btn, false);
  if (error) {
    showToast(mapDbError(error), "error");
    return;
  }
  showToast(`Abonnement prolongé jusqu'au ${formatDate(data)}.`, "success");
  await loadAccounts();
}

async function toggleActive(userId, isCurrentlyActive) {
  const action = isCurrentlyActive ? "désactiver" : "réactiver";
  if (!confirm(`Confirmer : ${action} ce compte ?`)) return;

  const { error } = await supabase.from("profiles").update({ is_active: !isCurrentlyActive }).eq("id", userId);
  if (error) {
    showToast(mapDbError(error, "Erreur lors de la mise à jour du statut."), "error");
    return;
  }
  showToast(`Compte ${isCurrentlyActive ? "désactivé" : "réactivé"}.`, "success");
  await loadAccounts();
}

async function loadPaymentRequests() {
  const tbody = document.getElementById("payment-requests-table-body");
  const { data, error } = await supabase
    .from("payment_requests")
    .select("id, plan, amount, phone_number, operator, transaction_ref, status, submitted_at, profiles!payment_requests_owner_id_fkey(full_name, email, establishment_name)")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (error) {
    tbody.innerHTML = tableMessageRow(6, "Erreur de chargement.", "error");
    console.error(error);
    return;
  }

  document.getElementById("pending-requests-count").textContent = data.length ? `(${data.length})` : "";

  if (!data.length) {
    tbody.innerHTML = tableMessageRow(6, "Aucune demande en attente.");
    return;
  }

  tbody.innerHTML = data
    .map(
      (r) => `
    <tr>
      <td data-label="Date">${formatDate(r.submitted_at)}</td>
      <td data-label="Atelier">${escapeHtml(r.profiles?.establishment_name || r.profiles?.full_name || "—")}
        <div class="text-muted text-sm">${escapeHtml(r.profiles?.email || "")}</div></td>
      <td data-label="Formule">${escapeHtml(PLANS[r.plan]?.label || r.plan)} · <strong>${formatMoney(r.amount)}</strong></td>
      <td data-label="Paiement">${escapeHtml(OPERATOR_LABELS[r.operator] || r.operator || "—")} · ${escapeHtml(r.phone_number)}
        ${r.transaction_ref ? `<div class="text-muted text-sm">Réf. ${escapeHtml(r.transaction_ref)}</div>` : ""}</td>
      <td data-label="">
        <div class="button-row button-row-end">
          <button class="btn btn-primary btn-sm approve-request-btn" data-id="${r.id}" type="button">Valider</button>
          <button class="btn btn-secondary btn-sm reject-request-btn" data-id="${r.id}" type="button">Refuser</button>
        </div>
      </td>
    </tr>`
    )
    .join("");

  tbody.querySelectorAll(".approve-request-btn").forEach((btn) => btn.addEventListener("click", () => reviewRequest(btn.dataset.id, true)));
  tbody.querySelectorAll(".reject-request-btn").forEach((btn) => btn.addEventListener("click", () => reviewRequest(btn.dataset.id, false)));
}

async function reviewRequest(id, approve) {
  const message = approve
    ? "Confirmer la validation ? Vérifie d'abord que l'argent a bien été reçu sur ton compte Mobile Money. L'abonnement sera activé immédiatement."
    : "Confirmer le refus de cette demande ?";
  if (!confirm(message)) return;

  const { error } = await supabase.rpc(approve ? "approve_payment_request" : "reject_payment_request", { p_request_id: id });
  if (error) {
    showToast(mapDbError(error), "error");
    return;
  }
  showToast(approve ? "Paiement validé, abonnement activé." : "Demande refusée.", "success");
  await Promise.all([loadPaymentRequests(), loadAccounts()]);
}
