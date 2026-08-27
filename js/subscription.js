// =============================================================
// TAILORFLOW — Abonnement (espace paiement)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { escapeHtml, formatDate, formatMoney, showToast } from "./utils.js";

const PLAN_LABELS = { mensuel: "Mensuel", annuel: "Annuel" };
const STATUS_LABELS = { pending: "En attente", approved: "Validé", rejected: "Refusé" };

// Numéros marchands Mobile Money (Togo) fournis par l'atelier.
const TMONEY_MERCHANT_NUMBER = "92502272";
const FLOOZ_MERCHANT_NUMBER = "98960353";

let currentProfile = null;
let selectedPlan = null;
let selectedAmount = null;

const statusCard = document.getElementById("status-card");
const instructionsCard = document.getElementById("payment-instructions-card");
const requestForm = document.getElementById("payment-request-form");
const requestError = document.getElementById("payment-request-error");
const requestsTableBody = document.getElementById("requests-table-body");

init();

async function init() {
  // skipBilling: cette page doit rester accessible même si l'abonnement est expiré,
  // sinon l'utilisateur ne pourrait jamais revenir payer.
  currentProfile = await requireAuth({ skipBilling: true });
  if (!currentProfile) return;
  renderNav(currentProfile, "subscription");

  await loadStatus();
  await loadRequests();

  document.querySelectorAll(".select-plan-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectPlan(btn.dataset.plan));
  });

  requestForm.addEventListener("submit", handleSubmitRequest);
}

async function loadStatus() {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, plan, trial_ends_at, current_period_end")
    .eq("owner_id", currentProfile.id)
    .single();

  if (error || !data) {
    statusCard.innerHTML = `<p class="error-message">Impossible de charger le statut de l'abonnement.</p>`;
    return;
  }

  const now = new Date();
  let html = "";

  if (data.status === "trial") {
    const end = data.trial_ends_at ? new Date(data.trial_ends_at) : null;
    const stillValid = end && end > now;
    const daysLeft = end ? Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24))) : 0;
    html = stillValid
      ? `<p><span class="badge badge-in_progress">Essai gratuit</span> — il te reste <strong>${daysLeft} jour(s)</strong> (jusqu'au ${formatDate(data.trial_ends_at)}).</p>`
      : `<p><span class="badge badge-cancelled">Essai expiré</span> — ton essai gratuit s'est terminé le ${formatDate(data.trial_ends_at)}. Choisis une formule ci-dessous pour continuer à utiliser TailorFlow.</p>`;
  } else if (data.status === "active") {
    const end = data.current_period_end ? new Date(data.current_period_end) : null;
    const stillValid = end && end > now;
    html = stillValid
      ? `<p><span class="badge badge-delivered">Actif</span> — formule ${PLAN_LABELS[data.plan] || data.plan}, valable jusqu'au <strong>${formatDate(data.current_period_end)}</strong>.</p>`
      : `<p><span class="badge badge-cancelled">Expiré</span> — ton abonnement ${PLAN_LABELS[data.plan] || ""} a expiré le ${formatDate(data.current_period_end)}. Renouvelle ci-dessous pour continuer.</p>`;
  } else {
    html = `<p><span class="badge badge-cancelled">Expiré</span> — choisis une formule ci-dessous pour réactiver l'accès à l'application.</p>`;
  }

  statusCard.innerHTML = html;
}

function selectPlan(plan) {
  selectedPlan = plan;
  const card = document.querySelector(`.plan-card[data-plan="${plan}"]`);
  selectedAmount = Number(card.dataset.amount);

  document.querySelectorAll(".plan-card").forEach((c) => c.classList.remove("plan-selected"));
  card.classList.add("plan-selected");

  document.getElementById("selected-plan-label").textContent = PLAN_LABELS[plan];
  document.getElementById("selected-plan-amount").textContent = formatMoney(selectedAmount);

  // Les codes USSD sont construits ici et assignés directement aux liens tel: —
  // ils ne sont jamais affichés dans la page, seulement exécutés au clic.
  const tmoneyCode = `*145*1*1*${selectedAmount}*${TMONEY_MERCHANT_NUMBER}*1#`;
  const floozCode = `*155*1*1*${FLOOZ_MERCHANT_NUMBER}*${selectedAmount}#`;

  // IMPORTANT : le caractère "#" doit être encodé (%23) dans un href tel:,
  // sinon le navigateur (surtout sur Android) l'interprète comme un fragment
  // d'URL et le tronque avant de transmettre le numéro au composeur —
  // le code USSD arrive alors incomplet et le paiement ne se déclenche pas.
  document.getElementById("tmoney-dial-link").href = `tel:${encodeURIComponent(tmoneyCode)}`;
  document.getElementById("flooz-dial-link").href = `tel:${encodeURIComponent(floozCode)}`;

  instructionsCard.style.display = "block";
  instructionsCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleSubmitRequest(e) {
  e.preventDefault();
  requestError.textContent = "";

  if (!selectedPlan) {
    requestError.textContent = "Choisis d'abord une formule ci-dessus.";
    return;
  }

  const phone = requestForm.phone_number.value.trim();
  if (!phone) {
    requestError.textContent = "Le numéro de téléphone est requis.";
    return;
  }

  const submitBtn = requestForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const { error } = await supabase.from("payment_requests").insert({
    owner_id: currentProfile.id,
    plan: selectedPlan,
    amount: selectedAmount,
    phone_number: phone,
  });

  submitBtn.disabled = false;

  if (error) {
    requestError.textContent = "Erreur lors de l'envoi de la demande.";
    console.error(error);
    return;
  }

  showToast("Demande envoyée. Elle sera vérifiée manuellement.", "success");
  requestForm.reset();
  instructionsCard.style.display = "none";
  document.querySelectorAll(".plan-card").forEach((c) => c.classList.remove("plan-selected"));
  selectedPlan = null;
  await loadRequests();
}

async function loadRequests() {
  const { data, error } = await supabase
    .from("payment_requests")
    .select("id, plan, amount, phone_number, status, submitted_at")
    .eq("owner_id", currentProfile.id)
    .order("submitted_at", { ascending: false });

  if (error) {
    requestsTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--color-danger);">Erreur de chargement.</td></tr>`;
    return;
  }

  if (!data.length) {
    requestsTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--color-text-muted);">Aucune demande pour le moment.</td></tr>`;
    return;
  }

  const statusBadgeClass = { pending: "badge-in_progress", approved: "badge-delivered", rejected: "badge-cancelled" };

  requestsTableBody.innerHTML = data
    .map(
      (r) => `
    <tr>
      <td data-label="Date">${formatDate(r.submitted_at)}</td>
      <td data-label="Formule">${PLAN_LABELS[r.plan] || r.plan}</td>
      <td data-label="Montant">${formatMoney(r.amount)}</td>
      <td data-label="Téléphone">${escapeHtml(r.phone_number)}</td>
      <td data-label="Statut"><span class="badge ${statusBadgeClass[r.status]}">${STATUS_LABELS[r.status] || r.status}</span></td>
    </tr>`
    )
    .join("");
}
