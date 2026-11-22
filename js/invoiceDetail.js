// =============================================================
// TAILORFLOW — Détail d'une facture (paiements, reçu PNG / PDF)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import {
  escapeHtml, formatDate, formatDateTime, formatMoney, showToast, openModal, closeModal, invoiceStatusBadge,
  PAYMENT_METHOD_LABELS, mapDbError, setButtonLoading, tableMessageRow, whatsappHref,
} from "./utils.js";
import {
  generateAndDownloadReceipt, renderPrintableReceipt, receiptDataFromInvoice, establishmentFromProfile,
} from "./receipt.js";

const params = new URLSearchParams(window.location.search);
const invoiceId = params.get("id");

let currentProfile = null;
let currentInvoice = null;
let currentPayments = [];

if (!invoiceId) window.location.href = "invoices.html";
else init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "invoices");

  await refresh();

  document.getElementById("print-invoice-btn").addEventListener("click", () => window.print());
  document.getElementById("download-receipt-btn").addEventListener("click", downloadReceipt);
  document.getElementById("new-payment-btn").addEventListener("click", openPaymentModal);
  document.getElementById("close-payment-modal").addEventListener("click", () => closeModal("payment-modal"));
  document.getElementById("cancel-payment-form").addEventListener("click", () => closeModal("payment-modal"));
  document.getElementById("pay-full-btn").addEventListener("click", () => {
    document.getElementById("payment-amount").value = remainingAmount();
  });
  document.getElementById("payment-form").addEventListener("submit", handleAddPayment);

  if (params.get("pay") === "1" && remainingAmount() > 0) openPaymentModal();
}

async function refresh() {
  const ok = await loadInvoice();
  if (!ok) return;
  await loadPayments();
  renderReceipt();
}

function remainingAmount() {
  return Math.max(0, Number(currentInvoice.amount_total) - Number(currentInvoice.amount_paid));
}

async function loadInvoice() {
  const { data, error } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, amount_total, amount_paid, status, issued_at, due_date,
      orders ( id, order_number, status, garment_description, fabric, quantity, unit_price, due_date,
               clients ( id, full_name, phone, address ) )
    `)
    .eq("id", invoiceId)
    .single();

  if (error || !data) {
    showToast("Facture introuvable.", "error");
    window.location.href = "invoices.html";
    return false;
  }

  currentInvoice = data;
  renderInvoice();
  return true;
}

function renderInvoice() {
  const inv = currentInvoice;
  const order = inv.orders || {};
  const client = order.clients || {};
  const remaining = remainingAmount();
  const cancelled = order.status === "cancelled";

  document.title = `Facture ${inv.invoice_number} — TailorFlow`;
  document.getElementById("invoice-title").textContent = `Facture ${inv.invoice_number}`;
  document.getElementById("invoice-status-badge").innerHTML =
    invoiceStatusBadge(inv.status) + (cancelled ? ' <span class="badge badge-cancelled">Commande annulée</span>' : "");

  document.getElementById("invoice-info").innerHTML = `
    <dt>Client</dt><dd><a class="link-plain" href="client-detail.html?id=${client.id || ""}">${escapeHtml(client.full_name || "—")}</a></dd>
    <dt>Téléphone</dt><dd>${escapeHtml(client.phone || "—")}</dd>
    <dt>Commande</dt><dd><a class="link-plain" href="order-detail.html?id=${order.id}">${escapeHtml(order.order_number || "—")}</a></dd>
    <dt>Description</dt><dd>${escapeHtml(order.garment_description || "—")}</dd>
    <dt>Émise le</dt><dd>${formatDate(inv.issued_at)}</dd>
    <dt>Date de remise</dt><dd>${formatDate(order.due_date)}</dd>
    <dt>Montant total</dt><dd><strong>${formatMoney(inv.amount_total)}</strong></dd>
    <dt>Montant payé</dt><dd class="text-success">${formatMoney(inv.amount_paid)}</dd>
    <dt>Reste à payer</dt><dd class="${remaining > 0 ? "text-warning" : ""}"><strong>${formatMoney(remaining)}</strong></dd>
  `;

  document.getElementById("new-payment-btn").style.display = remaining > 0 && !cancelled ? "" : "none";

  const message =
    `Bonjour ${client.full_name || ""}, voici votre facture ${inv.invoice_number} (${order.garment_description || ""}). ` +
    `Total : ${formatMoney(inv.amount_total)}, payé : ${formatMoney(inv.amount_paid)}` +
    (remaining > 0 ? `, reste à payer : ${formatMoney(remaining)}.` : ". Merci, la facture est entièrement réglée.") +
    ` ${currentProfile.establishment_name || ""}`;
  const wa = whatsappHref(client.phone, message.trim());
  const waBtn = document.getElementById("whatsapp-invoice-btn");
  waBtn.style.display = wa ? "" : "none";
  if (wa) waBtn.href = wa;
}

async function loadPayments() {
  const tbody = document.getElementById("payments-table-body");
  const { data, error } = await supabase
    .from("payments")
    .select("id, amount, payment_method, paid_at")
    .eq("invoice_id", invoiceId)
    .order("paid_at", { ascending: true });

  if (error) {
    tbody.innerHTML = tableMessageRow(4, "Erreur de chargement des paiements.", "error");
    return;
  }
  currentPayments = data || [];

  if (!currentPayments.length) {
    tbody.innerHTML = tableMessageRow(4, "Aucun paiement enregistré.");
    return;
  }

  const canDelete = currentInvoice.orders?.status !== "delivered";
  tbody.innerHTML = currentPayments
    .map(
      (p) => `
    <tr>
      <td data-label="Date">${formatDateTime(p.paid_at)}</td>
      <td data-label="Montant"><strong>${formatMoney(p.amount)}</strong></td>
      <td data-label="Moyen">${escapeHtml(PAYMENT_METHOD_LABELS[p.payment_method] || p.payment_method)}</td>
      <td data-label="">${canDelete ? `<button class="btn btn-ghost btn-sm delete-payment-btn" data-id="${p.id}" type="button" title="Supprimer ce paiement (erreur de saisie)">Supprimer</button>` : ""}</td>
    </tr>`
    )
    .join("");

  tbody.querySelectorAll(".delete-payment-btn").forEach((btn) => btn.addEventListener("click", () => deletePayment(btn.dataset.id)));
}

function receiptData() {
  return receiptDataFromInvoice(currentInvoice, establishmentFromProfile(currentProfile), currentPayments);
}

function renderReceipt() {
  // Gabarit imprimable (PDF) : même rendu que le reçu PNG, toujours à jour.
  renderPrintableReceipt(document.getElementById("print-receipt"), receiptData());
}

async function downloadReceipt(e) {
  const btn = e.currentTarget;
  setButtonLoading(btn, true, "Génération...");
  try {
    const data = receiptData();
    await generateAndDownloadReceipt(data);
  } catch (err) {
    showToast("Erreur lors de la génération du reçu.", "error");
    console.error(err);
  } finally {
    setButtonLoading(btn, false);
  }
}

function openPaymentModal() {
  const form = document.getElementById("payment-form");
  form.reset();
  document.getElementById("payment-form-error").textContent = "";
  const remaining = remainingAmount();
  form.amount.max = remaining;
  document.getElementById("remaining-balance-hint").textContent = `Solde restant : ${formatMoney(remaining)}`;
  openModal("payment-modal");
}

async function handleAddPayment(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("payment-form-error");
  errorEl.textContent = "";

  const amount = parseFloat(form.amount.value);
  const remaining = remainingAmount();

  if (!(amount > 0)) {
    errorEl.textContent = "Le montant doit être supérieur à 0.";
    return;
  }
  if (amount > remaining) {
    errorEl.textContent = `Le montant dépasse le solde restant (${formatMoney(remaining)}).`;
    return;
  }

  const submitBtn = form.querySelector("button[type=submit]");
  setButtonLoading(submitBtn, true);

  const { error } = await supabase.from("payments").insert({
    invoice_id: invoiceId,
    amount,
    payment_method: form.payment_method.value,
    recorded_by: currentProfile.id,
  });

  setButtonLoading(submitBtn, false);

  if (error) {
    errorEl.textContent = mapDbError(error, "Erreur lors de l'enregistrement du paiement.");
    console.error(error);
    return;
  }

  closeModal("payment-modal");
  showToast(amount >= remaining ? "Paiement enregistré : facture soldée." : "Paiement enregistré.", "success");
  await refresh();
}

async function deletePayment(paymentId) {
  if (!confirm("Supprimer ce paiement ? Le solde de la facture sera recalculé.")) return;
  const { error, count } = await supabase.from("payments").delete({ count: "exact" }).eq("id", paymentId);
  if (error || count === 0) {
    showToast(error ? mapDbError(error) : "Suppression impossible.", "error");
    return;
  }
  showToast("Paiement supprimé.", "success");
  await refresh();
}
