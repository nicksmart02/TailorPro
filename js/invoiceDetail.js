// =============================================================
// TAILORFLOW — Détail d'une facture
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import {
  escapeHtml, formatDate, formatDateTime, formatMoney,
  showToast, openModal, closeModal, invoiceStatusBadge,
} from "./utils.js";
import { generateAndDownloadReceipt } from "./receipt.js";

const PAYMENT_METHOD_LABELS = {
  cash: "Espèces",
  mobile_money: "Mobile Money",
  bank_transfer: "Virement bancaire",
  card: "Carte",
};

const params = new URLSearchParams(window.location.search);
const invoiceId = params.get("id");

let currentProfile = null;
let currentInvoice = null;

if (!invoiceId) window.location.href = "invoices.html";

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "invoices");

  await loadInvoice();
  await loadPayments();

  document.getElementById("print-invoice-btn").addEventListener("click", () => window.print());
  document.getElementById("download-receipt-btn").addEventListener("click", downloadReceipt);

  document.getElementById("new-payment-btn").addEventListener("click", () => {
    document.getElementById("payment-form").reset();
    document.getElementById("payment-form-error").textContent = "";
    const remaining = currentInvoice.amount_total - currentInvoice.amount_paid;
    document.getElementById("remaining-balance-hint").textContent = `Solde restant : ${formatMoney(remaining)}`;
    openModal("payment-modal");
  });
  document.getElementById("close-payment-modal").addEventListener("click", () => closeModal("payment-modal"));
  document.getElementById("cancel-payment-form").addEventListener("click", () => closeModal("payment-modal"));
  document.getElementById("payment-form").addEventListener("submit", handleAddPayment);
}

async function loadInvoice() {
  const { data, error } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, amount_total, amount_paid, status, issued_at, due_date,
      orders ( id, order_number, garment_description, quantity, unit_price, clients ( id, full_name, phone, address ) )
    `)
    .eq("id", invoiceId)
    .single();

  if (error || !data) {
    showToast("Facture introuvable.", "error");
    window.location.href = "invoices.html";
    return;
  }

  currentInvoice = data;
  renderInvoice();
}

function renderInvoice() {
  const inv = currentInvoice;
  document.getElementById("invoice-title").textContent = `Facture ${inv.invoice_number}`;
  document.getElementById("invoice-status-badge").innerHTML = invoiceStatusBadge(inv.status);

  const remaining = inv.amount_total - inv.amount_paid;

  document.getElementById("invoice-info").innerHTML = `
    <dt>Client</dt><dd><a class="link-plain" href="client-detail.html?id=${inv.orders?.clients?.id || ""}">${escapeHtml(inv.orders?.clients?.full_name || "—")}</a></dd>
    <dt>Téléphone</dt><dd>${escapeHtml(inv.orders?.clients?.phone || "—")}</dd>
    <dt>Commande</dt><dd><a class="link-plain" href="order-detail.html?id=${inv.orders?.id}">${escapeHtml(inv.orders?.order_number || "—")}</a></dd>
    <dt>Description</dt><dd>${escapeHtml(inv.orders?.garment_description || "—")}</dd>
    <dt>Émise le</dt><dd>${formatDate(inv.issued_at)}</dd>
    <dt>Montant total</dt><dd><strong>${formatMoney(inv.amount_total)}</strong></dd>
    <dt>Montant payé</dt><dd>${formatMoney(inv.amount_paid)}</dd>
    <dt>Solde restant</dt><dd>${formatMoney(remaining)}</dd>
  `;
}

async function loadPayments() {
  const container = document.getElementById("payments-list");
  const { data, error } = await supabase
    .from("payments")
    .select("id, amount, payment_method, paid_at")
    .eq("invoice_id", invoiceId)
    .order("paid_at", { ascending: false });

  if (error) {
    container.innerHTML = `<p class="error-message">Erreur de chargement des paiements.</p>`;
    return;
  }

  if (!data.length) {
    container.innerHTML = `<p style="color:var(--color-text-muted);">Aucun paiement enregistré.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr><th>Date</th><th>Montant</th><th>Moyen de paiement</th></tr></thead>
      <tbody>
        ${data
          .map(
            (p) => `
          <tr>
            <td>${formatDateTime(p.paid_at)}</td>
            <td>${formatMoney(p.amount)}</td>
            <td>${PAYMENT_METHOD_LABELS[p.payment_method] || p.payment_method}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
    </div>
  `;
}

async function downloadReceipt() {
  const inv = currentInvoice;
  try {
    await generateAndDownloadReceipt({
      invoiceNumber: inv.invoice_number,
      orderNumber: inv.orders?.order_number || "—",
      issuedAt: inv.issued_at,
      clientName: inv.orders?.clients?.full_name || "—",
      clientPhone: inv.orders?.clients?.phone || "—",
      garmentDescription: inv.orders?.garment_description || "—",
      quantity: inv.orders?.quantity || 1,
      unitPrice: inv.orders?.unit_price || inv.amount_total,
      totalAmount: inv.amount_total,
    });
  } catch (err) {
    showToast("Erreur lors de la génération du reçu.", "error");
    console.error(err);
  }
}

async function handleAddPayment(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("payment-form-error");
  errorEl.textContent = "";

  const amount = parseFloat(form.amount.value);
  const remaining = currentInvoice.amount_total - currentInvoice.amount_paid;

  if (amount <= 0) {
    errorEl.textContent = "Le montant doit être supérieur à 0.";
    return;
  }
  if (amount > remaining) {
    errorEl.textContent = `Le montant dépasse le solde restant (${formatMoney(remaining)}).`;
    return;
  }

  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const { error } = await supabase.from("payments").insert({
    invoice_id: invoiceId,
    amount,
    payment_method: form.payment_method.value,
    recorded_by: currentProfile.id,
  });

  submitBtn.disabled = false;

  if (error) {
    errorEl.textContent = "Erreur lors de l'enregistrement du paiement.";
    console.error(error);
    return;
  }

  closeModal("payment-modal");
  showToast("Paiement enregistré.", "success");
  await loadInvoice();
  await loadPayments();
}
