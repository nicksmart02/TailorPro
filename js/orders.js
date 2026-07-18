// =============================================================
// TAILORFLOW — Module Commandes (liste + création)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { debounce, escapeHtml, formatDate, formatMoney, showToast, openModal, closeModal, orderStatusBadge } from "./utils.js";
import { generateAndDownloadReceipt } from "./receipt.js";

let currentProfile = null;
let selectedClientId = null;
let selectedClientName = "";
let selectedClientPhone = "";

const tableBody = document.getElementById("orders-table-body");
const statusFilter = document.getElementById("status-filter");
const newOrderBtn = document.getElementById("new-order-btn");
const orderForm = document.getElementById("order-form");
const formError = document.getElementById("order-form-error");

const clientSearchInput = document.getElementById("order-client-search");
const clientResultsBox = document.getElementById("order-client-results");
const selectedClientLabel = document.getElementById("selected-client-label");
const measurementSelect = document.getElementById("order-measurement");
const quantityInput = document.getElementById("order-quantity");
const unitPriceInput = document.getElementById("order-unit-price");
const totalPreview = document.getElementById("order-total-preview");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "orders");

  await loadOrders();

  statusFilter.addEventListener("change", loadOrders);

  newOrderBtn.addEventListener("click", () => {
    orderForm.reset();
    formError.textContent = "";
    selectedClientId = null;
    selectedClientLabel.textContent = "";
    measurementSelect.innerHTML = `<option value="">-- Sélectionnez d'abord un client --</option>`;
    totalPreview.textContent = "";
    openModal("order-modal");
  });
  document.getElementById("close-order-modal").addEventListener("click", () => closeModal("order-modal"));
  document.getElementById("cancel-order-form").addEventListener("click", () => closeModal("order-modal"));

  clientSearchInput.addEventListener("input", debounce(searchClients, 300));
  quantityInput.addEventListener("input", updateTotalPreview);
  unitPriceInput.addEventListener("input", updateTotalPreview);

  orderForm.addEventListener("submit", handleCreateOrder);
}

async function loadOrders() {
  tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-text-muted);">Chargement...</td></tr>`;

  let query = supabase
    .from("orders")
    .select("id, order_number, garment_description, status, due_date, total_price, clients(full_name, phone)")
    .order("due_date", { ascending: true });

  if (statusFilter.value) {
    query = query.eq("status", statusFilter.value);
  }

  const { data, error } = await query;

  if (error) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-danger);">Erreur de chargement.</td></tr>`;
    console.error(error);
    return;
  }

  if (!data.length) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-text-muted);">Aucune commande.</td></tr>`;
    return;
  }

  tableBody.innerHTML = data
    .map(
      (o) => `
    <tr class="order-row" data-id="${o.id}" style="cursor:pointer;">
      <td data-label="N° commande">${escapeHtml(o.order_number)}</td>
      <td data-label="Client">${escapeHtml(o.clients?.full_name || "—")}</td>
      <td data-label="Description">${escapeHtml(o.garment_description)}</td>
      <td data-label="Échéance">${formatDate(o.due_date)}</td>
      <td data-label="Statut">${orderStatusBadge(o)}</td>
      <td data-label="Total">${formatMoney(o.total_price)}</td>
    </tr>`
    )
    .join("");

  document.querySelectorAll(".order-row").forEach((row) => {
    row.addEventListener("click", () => {
      window.location.href = `order-detail.html?id=${row.dataset.id}`;
    });
  });
}

async function searchClients() {
  const term = clientSearchInput.value.trim();
  if (!term) {
    clientResultsBox.innerHTML = "";
    clientResultsBox.style.display = "none";
    return;
  }

  const { data, error } = await supabase
    .from("clients")
    .select("id, full_name, phone")
    .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`)
    .limit(6);

  if (error || !data.length) {
    clientResultsBox.innerHTML = `<div class="search-result-item" style="color:var(--color-text-muted);">Aucun résultat</div>`;
    clientResultsBox.style.display = "block";
    return;
  }

  clientResultsBox.innerHTML = data
    .map(
      (c) => `<div class="search-result-item" data-id="${c.id}" data-name="${escapeHtml(c.full_name)}" data-phone="${escapeHtml(c.phone)}" style="padding:8px 12px; cursor:pointer;">${escapeHtml(c.full_name)} — ${escapeHtml(c.phone)}</div>`
    )
    .join("");
  clientResultsBox.style.display = "block";

  clientResultsBox.querySelectorAll(".search-result-item[data-id]").forEach((item) => {
    item.addEventListener("click", () => selectClient(item.dataset.id, item.dataset.name, item.dataset.phone));
  });
}

async function selectClient(clientId, clientName, clientPhone) {
  selectedClientId = clientId;
  selectedClientName = clientName;
  selectedClientPhone = clientPhone;
  selectedClientLabel.textContent = `Client sélectionné : ${clientName}`;
  clientSearchInput.value = "";
  clientResultsBox.innerHTML = "";
  clientResultsBox.style.display = "none";

  const { data, error } = await supabase
    .from("measurements")
    .select("id, garment_type, version, created_at")
    .eq("client_id", clientId)
    .order("version", { ascending: false });

  if (error || !data.length) {
    measurementSelect.innerHTML = `<option value="">Aucune mesure disponible — créez-en une sur la fiche client</option>`;
    return;
  }

  measurementSelect.innerHTML = data
    .map((m) => `<option value="${m.id}">${escapeHtml(m.garment_type)} — v${m.version} (${new Date(m.created_at).toLocaleDateString("fr-FR")})</option>`)
    .join("");
}

function updateTotalPreview() {
  const qty = parseFloat(quantityInput.value) || 0;
  const price = parseFloat(unitPriceInput.value) || 0;
  totalPreview.textContent = qty && price ? `Total : ${(qty * price).toLocaleString("fr-FR")} FCFA` : "";
}

async function handleCreateOrder(e) {
  e.preventDefault();
  formError.textContent = "";

  if (!selectedClientId) {
    formError.textContent = "Veuillez sélectionner un client.";
    return;
  }
  if (!measurementSelect.value) {
    formError.textContent = "Veuillez sélectionner une fiche de mesure.";
    return;
  }

  const submitBtn = orderForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const payload = {
    client_id: selectedClientId,
    measurement_id: measurementSelect.value,
    garment_description: orderForm.garment_description.value.trim(),
    fabric: orderForm.fabric.value.trim() || null,
    quantity: parseInt(orderForm.quantity.value, 10) || 1,
    unit_price: parseFloat(orderForm.unit_price.value),
    due_date: orderForm.due_date.value,
    created_by: currentProfile.id,
  };

  const { data: newOrder, error } = await supabase
    .from("orders")
    .insert(payload)
    .select("id, order_number, garment_description, quantity, unit_price, total_price")
    .single();

  if (error) {
    submitBtn.disabled = false;
    formError.textContent = "Erreur lors de la création de la commande.";
    console.error(error);
    return;
  }

  // La facture est générée automatiquement en base (trigger). On la récupère
  // pour produire immédiatement un reçu PNG de traçabilité.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("invoice_number, amount_total, amount_paid, issued_at")
    .eq("order_id", newOrder.id)
    .single();

  submitBtn.disabled = false;
  closeModal("order-modal");
  showToast("Commande et facture créées. Génération du reçu...", "success");

  if (invoice) {
    try {
      await generateAndDownloadReceipt({
        invoiceNumber: invoice.invoice_number,
        orderNumber: newOrder.order_number,
        issuedAt: invoice.issued_at,
        clientName: selectedClientName,
        clientPhone: selectedClientPhone,
        garmentDescription: newOrder.garment_description,
        quantity: newOrder.quantity,
        unitPrice: newOrder.unit_price,
        totalAmount: newOrder.total_price,
        amountPaid: invoice.amount_paid,
      });
    } catch (receiptError) {
      console.error("Erreur lors de la génération du reçu :", receiptError);
    }
  }

  await loadOrders();
}
