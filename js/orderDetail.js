// =============================================================
// TAILORFLOW — Détail d'une commande
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { escapeHtml, formatDate, formatDateTime, formatMoney, showToast, orderStatusBadge, isOrderLate } from "./utils.js";
import { generateAndDownloadReceipt } from "./receipt.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get("id");

let currentProfile = null;
let currentOrder = null;

const STATUS_FLOW = ["pending", "in_progress", "ready", "delivered"];
const STATUS_LABELS = {
  pending: "En attente",
  in_progress: "En cours",
  ready: "Prêt",
  delivered: "Remis",
  cancelled: "Annulé",
};

if (!orderId) window.location.href = "orders.html";

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "orders");

  await loadOrder();
}

async function loadOrder() {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      id, order_number, garment_description, fabric, quantity, unit_price, total_price,
      status, due_date, delivered_at, created_at,
      clients ( id, full_name, phone ),
      measurements ( id, garment_type, version, values ),
      invoices ( id, invoice_number, status, amount_total, amount_paid )
    `)
    .eq("id", orderId)
    .single();

  if (error || !data) {
    showToast("Commande introuvable.", "error");
    window.location.href = "orders.html";
    return;
  }

  currentOrder = data;
  renderOrder();
}

function renderOrder() {
  const o = currentOrder;
  document.getElementById("order-title").textContent = `Commande ${o.order_number}`;
  document.getElementById("order-status-badge").innerHTML = orderStatusBadge(o);

  document.getElementById("order-info").innerHTML = `
    <dt>Client</dt><dd><a class="link-plain" href="client-detail.html?id=${o.clients.id}">${escapeHtml(o.clients.full_name)}</a></dd>
    <dt>Téléphone</dt><dd>${escapeHtml(o.clients.phone)}</dd>
    <dt>Description</dt><dd>${escapeHtml(o.garment_description)}</dd>
    <dt>Tissu</dt><dd>${escapeHtml(o.fabric || "—")}</dd>
    <dt>Quantité</dt><dd>${o.quantity}</dd>
    <dt>Prix unitaire</dt><dd>${formatMoney(o.unit_price)}</dd>
    <dt>Total</dt><dd><strong>${formatMoney(o.total_price)}</strong></dd>
    <dt>Date de remise prévue</dt><dd>${formatDate(o.due_date)}${isOrderLate(o) ? ' <span class="badge badge-late">En retard</span>' : ""}</dd>
    <dt>Créée le</dt><dd>${formatDateTime(o.created_at)}</dd>
    ${o.delivered_at ? `<dt>Remise le</dt><dd>${formatDateTime(o.delivered_at)}</dd>` : ""}
  `;

  const m = o.measurements;
  document.getElementById("order-measurement-info").innerHTML = `
    <dt>Type de vêtement</dt><dd>${escapeHtml(m.garment_type)}</dd>
    <dt>Version</dt><dd>v${m.version}</dd>
    ${Object.entries(m.values).map(([k, v]) => `<dt>${escapeHtml(k.replace(/_/g, " "))}</dt><dd>${escapeHtml(v)} cm</dd>`).join("")}
  `;

  renderStatusActions();
  renderInvoiceSection();
}

function renderStatusActions() {
  const container = document.getElementById("status-actions");
  const card = document.getElementById("status-actions-card");

  if (currentOrder.status === "delivered" || currentOrder.status === "cancelled") {
    card.style.display = "none";
    return;
  }

  const currentIndex = STATUS_FLOW.indexOf(currentOrder.status);
  const nextStatus = STATUS_FLOW[currentIndex + 1];

  let html = "";
  if (nextStatus) {
    html += `<button class="btn btn-primary" id="advance-status-btn">Passer à "${STATUS_LABELS[nextStatus]}"</button>`;
  }
  html += `<button class="btn btn-secondary" id="cancel-order-btn">Annuler la commande</button>`;
  container.innerHTML = html;

  const advanceBtn = document.getElementById("advance-status-btn");
  if (advanceBtn) advanceBtn.addEventListener("click", () => updateStatus(nextStatus));

  document.getElementById("cancel-order-btn").addEventListener("click", () => {
    if (confirm("Confirmer l'annulation de cette commande ?")) updateStatus("cancelled");
  });
}

async function updateStatus(newStatus) {
  const payload = { status: newStatus };
  if (newStatus === "delivered") payload.delivered_at = new Date().toISOString();

  const { error } = await supabase.from("orders").update(payload).eq("id", orderId);

  if (error) {
    showToast("Erreur lors de la mise à jour du statut.", "error");
    console.error(error);
    return;
  }

  showToast("Statut mis à jour.", "success");
  await loadOrder();
}

function renderInvoiceSection() {
  const container = document.getElementById("invoice-section");
  let invoice = currentOrder.invoices;
  if (Array.isArray(invoice)) invoice = invoice.length ? invoice[0] : null;

  if (invoice) {
    container.innerHTML = `
      <p>Facture <strong>${escapeHtml(invoice.invoice_number)}</strong> —
      ${formatMoney(invoice.amount_paid)} / ${formatMoney(invoice.amount_total)} payé —
      <a class="link-plain" href="invoice-detail.html?id=${invoice.id}">Voir la facture</a></p>
    `;
    return;
  }

  container.innerHTML = `<button class="btn btn-primary" id="generate-invoice-btn">Générer la facture</button>`;
  document.getElementById("generate-invoice-btn").addEventListener("click", generateInvoice);
}

async function generateInvoice() {
  const btn = document.getElementById("generate-invoice-btn");
  btn.disabled = true;

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      order_id: orderId,
      amount_total: currentOrder.total_price,
      created_by: currentProfile.id,
    })
    .select()
    .single();

  if (error) {
    showToast("Erreur lors de la génération de la facture.", "error");
    console.error(error);
    btn.disabled = false;
    return;
  }

  showToast("Facture générée. Génération du reçu...", "success");

  // Génère et télécharge automatiquement un reçu PNG pour traçabilité.
  try {
    await generateAndDownloadReceipt({
      invoiceNumber: data.invoice_number,
      orderNumber: currentOrder.order_number,
      issuedAt: data.issued_at,
      clientName: currentOrder.clients.full_name,
      clientPhone: currentOrder.clients.phone,
      garmentDescription: currentOrder.garment_description,
      quantity: currentOrder.quantity,
      unitPrice: currentOrder.unit_price,
      totalAmount: currentOrder.total_price,
    });
  } catch (receiptError) {
    console.error("Erreur lors de la génération du reçu :", receiptError);
    // On ne bloque pas le flux : la facture existe même si le reçu échoue à se générer.
  }

  window.location.href = `invoice-detail.html?id=${data.id}`;
}
