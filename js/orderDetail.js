// =============================================================
// TAILORFLOW — Détail d'une commande
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import {
  escapeHtml, formatDate, formatDateTime, formatMoney, showToast, orderStatusBadge, isOrderLate,
  invoiceStatusBadge, measurementGarmentLabel, measurementKvHtml, mapDbError, openModal, closeModal,
  setButtonLoading, ORDER_STATUS_LABELS, telHref, whatsappHref,
} from "./utils.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get("id");

const STATUS_FLOW = ["pending", "in_progress", "ready", "delivered"];

let currentProfile = null;
let currentOrder = null;
let garmentTypes = [];

if (!orderId) window.location.href = "orders.html";
else init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "orders");

  const { data: types } = await supabase.from("garment_types").select("key, label, fields");
  garmentTypes = types || [];

  await loadOrder();

  document.getElementById("edit-order-btn").addEventListener("click", openEditModal);
  document.getElementById("close-edit-modal").addEventListener("click", () => closeModal("edit-modal"));
  document.getElementById("cancel-edit-form").addEventListener("click", () => closeModal("edit-modal"));
  document.getElementById("edit-form").addEventListener("submit", handleSaveOrder);
  document.getElementById("delete-order-btn").addEventListener("click", handleDeleteOrder);
}

async function loadOrder() {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      id, order_number, garment_description, fabric, quantity, unit_price, total_price,
      status, due_date, delivered_at, created_at, created_by, catalog_item_id,
      clients ( id, full_name, phone ),
      measurements ( id, garment_type, garment_label, field_meta, version, values ),
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

function invoiceOf(order) {
  return Array.isArray(order.invoices) ? order.invoices[0] || null : order.invoices;
}

function renderOrder() {
  const o = currentOrder;
  const locked = o.status === "delivered" || o.status === "cancelled";
  document.title = `Commande ${o.order_number} — TailorFlow`;
  document.getElementById("order-title").textContent = `Commande ${o.order_number}`;
  document.getElementById("order-status-badge").innerHTML =
    orderStatusBadge(o) + (o.catalog_item_id ? ' <span class="badge badge-online">Commande en ligne</span>' : "");

  document.getElementById("edit-order-btn").style.display = locked ? "none" : "";
  document.getElementById("delete-order-btn").style.display =
    (o.status === "pending" || o.status === "cancelled") && !(invoiceOf(o)?.amount_paid > 0) ? "" : "none";

  const tel = telHref(o.clients?.phone);
  document.getElementById("order-info").innerHTML = `
    <dt>Client</dt><dd><a class="link-plain" href="client-detail.html?id=${o.clients.id}">${escapeHtml(o.clients.full_name)}</a></dd>
    <dt>Téléphone</dt><dd>${tel ? `<a class="link-plain" href="${tel}">${escapeHtml(o.clients.phone)}</a>` : "—"}</dd>
    <dt>Description</dt><dd>${escapeHtml(o.garment_description)}</dd>
    <dt>Tissu / précisions</dt><dd>${escapeHtml(o.fabric || "—")}</dd>
    <dt>Quantité</dt><dd>${o.quantity}</dd>
    <dt>Prix unitaire</dt><dd>${formatMoney(o.unit_price)}</dd>
    <dt>Total</dt><dd><strong>${formatMoney(o.total_price)}</strong></dd>
    <dt>Date de remise prévue</dt><dd>${formatDate(o.due_date)}${isOrderLate(o) ? ' <span class="badge badge-late">En retard</span>' : ""}</dd>
    <dt>Créée le</dt><dd>${formatDateTime(o.created_at)}</dd>
    ${o.delivered_at ? `<dt>Remise le</dt><dd>${formatDateTime(o.delivered_at)}</dd>` : ""}
  `;

  const m = o.measurements;
  document.getElementById("order-measurement-info").innerHTML = m
    ? `<dt>Type de vêtement</dt><dd>${escapeHtml(measurementGarmentLabel(m, garmentTypes))} (v${m.version})</dd>${measurementKvHtml(m, garmentTypes)}`
    : `<dt>Mesure</dt><dd>—</dd>`;

  renderStatusActions();
  renderInvoiceSection();
}

function renderStatusActions() {
  const card = document.getElementById("status-actions-card");
  const container = document.getElementById("status-actions");
  const o = currentOrder;

  if (o.status === "delivered" || o.status === "cancelled") {
    card.style.display = "none";
    return;
  }
  card.style.display = "";

  // Frise des étapes
  const currentIndex = STATUS_FLOW.indexOf(o.status);
  document.getElementById("status-steps").innerHTML = STATUS_FLOW.map(
    (s, i) => `<li class="${i < currentIndex ? "step-done" : i === currentIndex ? "step-current" : ""}">${ORDER_STATUS_LABELS[s]}</li>`
  ).join("");

  const nextStatus = STATUS_FLOW[currentIndex + 1];
  const invoice = invoiceOf(o);
  const unpaid = !invoice || invoice.status !== "paid";

  let html = "";
  if (nextStatus) {
    html += `<button class="btn btn-primary" id="advance-status-btn" type="button">Passer à « ${ORDER_STATUS_LABELS[nextStatus]} »</button>`;
  }
  if (nextStatus === "delivered" && unpaid && invoice) {
    html += `<a class="btn btn-secondary" href="invoice-detail.html?id=${invoice.id}&pay=1">Encaisser le solde</a>`;
  }
  if (o.status === "ready") {
    const wa = whatsappHref(
      o.clients?.phone,
      `Bonjour ${o.clients?.full_name}, votre commande ${o.order_number} (${o.garment_description}) est prête. ` +
        (unpaid && invoice ? `Reste à payer : ${formatMoney(invoice.amount_total - invoice.amount_paid)}. ` : "") +
        `${currentProfile.establishment_name || ""}`
    );
    if (wa) html += `<a class="btn btn-secondary" href="${wa}" target="_blank" rel="noopener">💬 Prévenir le client</a>`;
  }
  html += `<button class="btn btn-danger-outline" id="cancel-order-btn" type="button">Annuler la commande</button>`;
  container.innerHTML = html;

  document.getElementById("advance-status-btn")?.addEventListener("click", (e) => updateStatus(nextStatus, e.currentTarget));
  document.getElementById("cancel-order-btn").addEventListener("click", (e) => {
    if (confirm("Confirmer l'annulation de cette commande ?")) updateStatus("cancelled", e.currentTarget);
  });
}

async function updateStatus(newStatus, button) {
  // Pré-vérification immédiate ; la garantie réelle reste le déclencheur en base.
  if (newStatus === "delivered") {
    const invoice = invoiceOf(currentOrder);
    if (!invoice || invoice.status !== "paid") {
      showToast("Facture non réglée", "error");
      return;
    }
  }

  setButtonLoading(button, true, "Mise à jour...");
  const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", orderId);
  setButtonLoading(button, false);

  if (error) {
    showToast(mapDbError(error, "Erreur lors de la mise à jour du statut."), "error");
    console.error(error);
    return;
  }

  showToast(`Statut : ${ORDER_STATUS_LABELS[newStatus]}.`, "success");
  await loadOrder();
}

function renderInvoiceSection() {
  const container = document.getElementById("invoice-section");
  const invoice = invoiceOf(currentOrder);

  if (!invoice) {
    container.innerHTML = `<p class="text-muted">Facture en cours de génération… Recharge la page dans un instant.</p>`;
    return;
  }

  const remaining = Math.max(0, invoice.amount_total - invoice.amount_paid);
  container.innerHTML = `
    <div class="invoice-summary">
      <div>
        <div class="text-muted text-sm">Facture</div>
        <strong>${escapeHtml(invoice.invoice_number)}</strong> ${invoiceStatusBadge(invoice.status)}
      </div>
      <div><div class="text-muted text-sm">Payé</div><strong class="text-success">${formatMoney(invoice.amount_paid)}</strong></div>
      <div><div class="text-muted text-sm">Reste à payer</div><strong class="${remaining > 0 ? "text-warning" : ""}">${formatMoney(remaining)}</strong></div>
      <a class="btn btn-secondary" href="invoice-detail.html?id=${invoice.id}">Voir la facture</a>
    </div>`;
}

// ---------------------------------------------------------------
// Modification / suppression
// ---------------------------------------------------------------

async function openEditModal() {
  const form = document.getElementById("edit-form");
  const o = currentOrder;
  form.garment_description.value = o.garment_description;
  form.fabric.value = o.fabric || "";
  form.quantity.value = o.quantity;
  form.unit_price.value = o.unit_price;
  form.due_date.value = o.due_date;
  document.getElementById("edit-form-error").textContent = "";

  const { data: measurements } = await supabase
    .from("measurements")
    .select("id, garment_type, garment_label, version, created_at")
    .eq("client_id", o.clients.id)
    .order("version", { ascending: false });
  form.measurement_id.innerHTML = (measurements || [])
    .map(
      (m) =>
        `<option value="${m.id}" ${m.id === o.measurements?.id ? "selected" : ""}>${escapeHtml(measurementGarmentLabel(m, garmentTypes))} — v${m.version} (${formatDate(m.created_at)})</option>`
    )
    .join("");

  const paid = invoiceOf(o)?.amount_paid || 0;
  document.getElementById("edit-paid-hint").textContent = paid > 0 ? `Déjà payé : ${formatMoney(paid)} — le nouveau total ne peut pas être inférieur.` : "";
  openModal("edit-modal");
}

async function handleSaveOrder(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("edit-form-error");
  const submitBtn = form.querySelector("button[type=submit]");
  errorEl.textContent = "";

  const quantity = parseInt(form.quantity.value, 10);
  const unitPrice = parseFloat(form.unit_price.value);
  if (!quantity || quantity < 1 || Number.isNaN(unitPrice) || unitPrice < 0) {
    errorEl.textContent = "Quantité et prix doivent être valides.";
    return;
  }

  setButtonLoading(submitBtn, true);
  const { error } = await supabase
    .from("orders")
    .update({
      garment_description: form.garment_description.value.trim(),
      fabric: form.fabric.value.trim() || null,
      quantity,
      unit_price: unitPrice,
      due_date: form.due_date.value,
      measurement_id: form.measurement_id.value,
    })
    .eq("id", orderId);
  setButtonLoading(submitBtn, false);

  if (error) {
    errorEl.textContent = mapDbError(error, "Erreur lors de l'enregistrement.");
    console.error(error);
    return;
  }

  closeModal("edit-modal");
  showToast("Commande mise à jour (facture synchronisée).", "success");
  await loadOrder();
}

async function handleDeleteOrder() {
  if (!confirm(`Supprimer définitivement la commande ${currentOrder.order_number} et sa facture ?`)) return;

  const { error, count } = await supabase.from("orders").delete({ count: "exact" }).eq("id", orderId);
  if (error || count === 0) {
    showToast(error ? mapDbError(error) : "Suppression impossible : la commande a déjà des paiements ou a avancé.", "error");
    return;
  }
  showToast("Commande supprimée.", "success");
  window.location.href = "orders.html";
}
