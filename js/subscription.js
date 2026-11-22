// =============================================================
// TAILORFLOW — Abonnement (espace paiement Mobile Money)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import {
  escapeHtml, formatDate, formatMoney, showToast, daysUntil, mapDbError, setButtonLoading, tableMessageRow,
} from "./utils.js";
import { PLANS, MOBILE_MONEY, SUPPORT } from "./config.js";

const REQUEST_STATUS = {
  pending: { label: "En attente de validation", cls: "badge-in_progress" },
  approved: { label: "Validé", cls: "badge-delivered" },
  rejected: { label: "Refusé", cls: "badge-cancelled" },
};

let currentProfile = null;
let selectedPlan = null;
let selectedOperator = null;
let hasPendingRequest = false;

const instructionsCard = document.getElementById("payment-instructions-card");
const requestForm = document.getElementById("payment-request-form");
const requestError = document.getElementById("payment-request-error");

init();

async function init() {
  // Page accessible même abonnement expiré (sinon impossible de payer).
  currentProfile = await requireAuth({ skipBilling: true });
  if (!currentProfile) return;

  if (currentProfile.isPlatformOwner) {
    window.location.href = "settings.html";
    return;
  }

  renderNav(currentProfile, "subscription");
  renderPlans();
  renderSupport();
  renderStatus();
  await loadRequests();

  requestForm.addEventListener("submit", handleSubmitRequest);
  document.getElementById("cancel-payment-btn").addEventListener("click", resetSelection);

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  document.getElementById("desktop-hint").hidden = isMobile;
}

function renderStatus() {
  const statusCard = document.getElementById("status-card");
  const sub = currentProfile.subscription;

  if (!sub || !sub.status) {
    statusCard.innerHTML = `<p><span class="badge badge-cancelled">Aucun abonnement</span> Choisis une formule ci-dessous pour activer ton atelier.</p>`;
    return;
  }

  const planLabel = PLANS[sub.plan]?.label || "";
  if (sub.has_access && sub.status === "trial") {
    const days = daysUntil(sub.trial_ends_at);
    statusCard.innerHTML = `<p><span class="badge badge-in_progress">Essai gratuit</span>
      Il te reste <strong>${days} jour(s)</strong> d'essai (jusqu'au ${formatDate(sub.trial_ends_at)}).
      En payant maintenant, ces jours restants sont conservés.</p>`;
  } else if (sub.has_access) {
    statusCard.innerHTML = `<p><span class="badge badge-delivered">Actif</span>
      Formule ${escapeHtml(planLabel)}, valable jusqu'au <strong>${formatDate(sub.current_period_end)}</strong>
      (${daysUntil(sub.current_period_end)} jour(s)). Tu peux renouveler à l'avance : la durée s'ajoute.</p>`;
  } else {
    const end = sub.status === "trial" ? sub.trial_ends_at : sub.current_period_end;
    statusCard.innerHTML = `<div class="banner banner-danger">
      <span><strong>Accès suspendu</strong> — ${sub.status === "trial" ? "ton essai gratuit" : "ton abonnement"} a expiré${end ? ` le ${formatDate(end)}` : ""}.
      Tes données sont conservées : choisis une formule pour retrouver l'accès.</span></div>`;
  }
}

function renderPlans() {
  document.getElementById("plans-grid").innerHTML = Object.entries(PLANS)
    .map(
      ([key, plan]) => `
    <div class="card plan-card" data-plan="${key}">
      <div class="plan-name">${escapeHtml(plan.label)}</div>
      <div class="plan-price">${formatMoney(plan.amount)}<span class="plan-period">${escapeHtml(plan.periodLabel)}</span></div>
      ${plan.note ? `<div class="plan-note">${escapeHtml(plan.note)}</div>` : '<div class="plan-note">&nbsp;</div>'}
      <button type="button" class="btn btn-primary btn-block select-plan-btn" data-plan="${key}">Choisir</button>
    </div>`
    )
    .join("");

  document.querySelectorAll(".select-plan-btn").forEach((btn) => btn.addEventListener("click", () => selectPlan(btn.dataset.plan)));
}

function renderSupport() {
  const parts = [];
  if (SUPPORT.whatsapp) parts.push(`<a class="link-plain" href="https://wa.me/${encodeURIComponent(SUPPORT.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (SUPPORT.email) parts.push(`<a class="link-plain" href="mailto:${encodeURIComponent(SUPPORT.email)}">${escapeHtml(SUPPORT.email)}</a>`);
  const el = document.getElementById("support-line");
  if (parts.length) el.innerHTML = `Une question sur ton paiement ? Contacte-nous : ${parts.join(" · ")}`;
}

function selectPlan(planKey) {
  if (hasPendingRequest) {
    showToast("Tu as déjà une demande en attente de validation.", "info");
    return;
  }
  selectedPlan = planKey;
  selectedOperator = null;
  const plan = PLANS[planKey];

  document.querySelectorAll(".plan-card").forEach((c) => c.classList.toggle("plan-selected", c.dataset.plan === planKey));
  document.getElementById("selected-plan-label").textContent = `${plan.label} — ${formatMoney(plan.amount)}`;

  // Les codes USSD sont construits ici puis injectés dans les liens tel: — jamais affichés.
  // Le caractère # est encodé (%23) : sinon Android le traite comme une ancre et tronque le code.
  document.getElementById("operator-buttons").innerHTML = Object.entries(MOBILE_MONEY)
    .map(
      ([key, op]) =>
        `<a class="btn btn-operator btn-operator-${key}" data-operator="${key}" href="tel:${encodeURIComponent(op.buildCode(plan.amount))}">📱 Payer avec ${escapeHtml(op.label)}</a>`
    )
    .join("");
  document.querySelectorAll("[data-operator]").forEach((link) =>
    link.addEventListener("click", () => {
      selectedOperator = link.dataset.operator;
      requestForm.operator.value = selectedOperator;
    })
  );

  requestForm.reset();
  requestError.textContent = "";
  instructionsCard.hidden = false;
  instructionsCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetSelection() {
  selectedPlan = null;
  selectedOperator = null;
  instructionsCard.hidden = true;
  document.querySelectorAll(".plan-card").forEach((c) => c.classList.remove("plan-selected"));
}

async function handleSubmitRequest(e) {
  e.preventDefault();
  requestError.textContent = "";

  if (!selectedPlan) {
    requestError.textContent = "Choisis d'abord une formule.";
    return;
  }
  const phone = requestForm.phone_number.value.trim();
  if (phone.replace(/\D/g, "").length < 8) {
    requestError.textContent = "Indique le numéro Mobile Money utilisé (8 chiffres minimum).";
    return;
  }
  const operator = requestForm.operator.value;
  if (!operator) {
    requestError.textContent = "Indique l'opérateur utilisé (TMoney ou Flooz).";
    return;
  }

  const submitBtn = requestForm.querySelector("button[type=submit]");
  setButtonLoading(submitBtn, true, "Envoi...");

  // Le montant est recalculé par la base à partir de la formule (il ne peut pas être falsifié).
  const { error } = await supabase.from("payment_requests").insert({
    owner_id: currentProfile.id,
    plan: selectedPlan,
    amount: PLANS[selectedPlan].amount,
    phone_number: phone,
    operator,
    transaction_ref: requestForm.transaction_ref.value.trim() || null,
  });

  setButtonLoading(submitBtn, false);

  if (error) {
    requestError.textContent = mapDbError(error, "Erreur lors de l'envoi de la demande.");
    console.error(error);
    return;
  }

  showToast("Demande envoyée. Ton abonnement sera activé dès la vérification du paiement.", "success");
  resetSelection();
  await loadRequests();
}

async function loadRequests() {
  const tbody = document.getElementById("requests-table-body");
  const { data, error } = await supabase
    .from("payment_requests")
    .select("id, plan, amount, phone_number, operator, status, submitted_at, reviewed_at")
    .eq("owner_id", currentProfile.id)
    .order("submitted_at", { ascending: false });

  if (error) {
    tbody.innerHTML = tableMessageRow(5, "Erreur de chargement.", "error");
    return;
  }

  hasPendingRequest = data.some((r) => r.status === "pending");
  document.getElementById("pending-request-banner").hidden = !hasPendingRequest;

  if (!data.length) {
    tbody.innerHTML = tableMessageRow(5, "Aucune demande pour le moment.");
    return;
  }

  tbody.innerHTML = data
    .map((r) => {
      const st = REQUEST_STATUS[r.status] || { label: r.status, cls: "" };
      return `
    <tr>
      <td data-label="Date">${formatDate(r.submitted_at)}</td>
      <td data-label="Formule">${escapeHtml(PLANS[r.plan]?.label || r.plan)}</td>
      <td data-label="Montant">${formatMoney(r.amount)}</td>
      <td data-label="Paiement">${escapeHtml(MOBILE_MONEY[r.operator]?.label || r.operator || "—")} · ${escapeHtml(r.phone_number)}</td>
      <td data-label="Statut"><span class="badge ${st.cls}">${escapeHtml(st.label)}</span></td>
    </tr>`;
    })
    .join("");
}
