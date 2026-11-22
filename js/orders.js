// =============================================================
// TAILORFLOW — Commandes (liste + création)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import {
  debounce, escapeHtml, formatDate, formatMoney, showToast, openModal, closeModal, orderStatusBadge,
  sanitizeSearchTerm, mapDbError, setButtonLoading, tableMessageRow, bindClickableRows, todayISO,
  isOrderLate, measurementGarmentLabel,
} from "./utils.js";
import { generateAndDownloadReceipt, establishmentFromProfile } from "./receipt.js";

let currentProfile = null;
let allOrders = [];
let selectedClient = null; // { id, full_name, phone }

const tableBody = document.getElementById("orders-table-body");
const statusFilter = document.getElementById("status-filter");
const searchInput = document.getElementById("search-input");
const orderForm = document.getElementById("order-form");
const formError = document.getElementById("order-form-error");
const clientSearchInput = document.getElementById("order-client-search");
const clientResultsBox = document.getElementById("order-client-results");
const selectedClientLabel = document.getElementById("selected-client-label");
const measurementSelect = document.getElementById("order-measurement");
const quantityInput = document.getElementById("order-quantity");
const unitPriceInput = document.getElementById("order-unit-price");
const paidInput = document.getElementById("order-paid");
const totalPreview = document.getElementById("order-total-preview");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "orders");

  const params = new URLSearchParams(window.location.search);
  if (params.get("status")) statusFilter.value = params.get("status");

  await loadOrders();

  statusFilter.addEventListener("change", loadOrders);
  searchInput.addEventListener("input", debounce(renderOrders, 200));

  document.getElementById("new-order-btn").addEventListener("click", () => openNewOrderModal());
  document.getElementById("close-order-modal").addEventListener("click", () => closeModal("order-modal"));
  document.getElementById("cancel-order-form").addEventListener("click", () => closeModal("order-modal"));

  clientSearchInput.addEventListener("input", debounce(searchClients, 250));
  clientSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideClientResults();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-wrapper")) hideClientResults();
  });
  [quantityInput, unitPriceInput, paidInput].forEach((el) => el.addEventListener("input", updateTotalPreview));
  orderForm.addEventListener("submit", handleCreateOrder);

  // Ouverture directe depuis la fiche client ou le tableau de bord.
  if (params.get("new") === "1") {
    await openNewOrderModal(params.get("client"), params.get("measurement"));
  }
}

// ---------------------------------------------------------------
// Liste
// ---------------------------------------------------------------

async function loadOrders() {
  tableBody.innerHTML = tableMessageRow(6, "Chargement...");

  let query = supabase
    .from("orders")
    .select("id, order_number, garment_description, status, due_date, total_price, catalog_item_id, clients(full_name, phone), invoices(status, amount_paid)")
    .order("due_date", { ascending: true })
    .limit(1000);

  const status = statusFilter.value;
  if (status === "late") {
    query = query.in("status", ["pending", "in_progress", "ready"]).lt("due_date", todayISO());
  } else if (status === "open") {
    query = query.in("status", ["pending", "in_progress", "ready"]);
  } else if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    tableBody.innerHTML = tableMessageRow(6, "Erreur de chargement.", "error");
    console.error(error);
    return;
  }
  allOrders = data || [];
  renderOrders();
}

function renderOrders() {
  const term = searchInput.value.trim().toLowerCase();
  const rows = term
    ? allOrders.filter((o) =>
        [o.order_number, o.garment_description, o.clients?.full_name, o.clients?.phone]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term))
      )
    : allOrders;

  document.getElementById("orders-count").textContent = `${rows.length} commande${rows.length > 1 ? "s" : ""}`;

  if (!rows.length) {
    tableBody.innerHTML = tableMessageRow(6, term || statusFilter.value ? "Aucune commande ne correspond aux filtres." : "Aucune commande pour le moment.");
    return;
  }

  tableBody.innerHTML = rows
    .map((o) => {
      const inv = Array.isArray(o.invoices) ? o.invoices[0] : o.invoices;
      return `
    <tr class="clickable-row ${isOrderLate(o) ? "row-late" : ""}" data-href="order-detail.html?id=${o.id}" tabindex="0">
      <td data-label="N° commande">${escapeHtml(o.order_number)}${o.catalog_item_id ? ' <span class="badge badge-online" title="Commande passée en ligne">En ligne</span>' : ""}</td>
      <td data-label="Client">${escapeHtml(o.clients?.full_name || "—")}</td>
      <td data-label="Description">${escapeHtml(o.garment_description)}</td>
      <td data-label="Échéance">${formatDate(o.due_date)}</td>
      <td data-label="Statut">${orderStatusBadge(o)}</td>
      <td data-label="Payé / Total">${formatMoney(inv?.amount_paid || 0)} / ${formatMoney(o.total_price)}</td>
    </tr>`;
    })
    .join("");
  bindClickableRows(tableBody);
}

// ---------------------------------------------------------------
// Création
// ---------------------------------------------------------------

async function openNewOrderModal(clientId = null, measurementId = null) {
  orderForm.reset();
  formError.textContent = "";
  selectedClient = null;
  selectedClientLabel.textContent = "";
  measurementSelect.innerHTML = `<option value="">-- Sélectionne d'abord un client --</option>`;
  totalPreview.textContent = "";
  orderForm.due_date.min = todayISO();
  hideClientResults();
  openModal("order-modal");

  if (clientId) {
    const { data } = await supabase.from("clients").select("id, full_name, phone").eq("id", clientId).single();
    if (data) await selectClient(data, measurementId);
  }
}

function hideClientResults() {
  clientResultsBox.innerHTML = "";
  clientResultsBox.style.display = "none";
}

async function searchClients() {
  const term = sanitizeSearchTerm(clientSearchInput.value);
  if (!term) {
    hideClientResults();
    return;
  }

  const { data, error } = await supabase
    .from("clients")
    .select("id, full_name, phone")
    .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`)
    .order("full_name")
    .limit(8);

  if (error || !data.length) {
    clientResultsBox.innerHTML = `<div class="search-result-item search-result-empty">Aucun résultat — <a class="link-plain" href="clients.html?new=1">créer ce client</a></div>`;
    clientResultsBox.style.display = "block";
    return;
  }

  clientResultsBox.innerHTML = data
    .map(
      (c, i) =>
        `<button type="button" class="search-result-item" data-index="${i}">${escapeHtml(c.full_name)} <span class="text-muted">— ${escapeHtml(c.phone)}</span></button>`
    )
    .join("");
  clientResultsBox.style.display = "block";
  clientResultsBox.querySelectorAll("button.search-result-item").forEach((item) => {
    item.addEventListener("click", () => selectClient(data[Number(item.dataset.index)]));
  });
}

async function selectClient(client, preselectMeasurementId = null) {
  selectedClient = client;
  selectedClientLabel.textContent = `Client sélectionné : ${client.full_name} (${client.phone})`;
  clientSearchInput.value = "";
  hideClientResults();

  measurementSelect.innerHTML = `<option value="">Chargement...</option>`;
  const [{ data: measurements, error }, { data: types }] = await Promise.all([
    supabase
      .from("measurements")
      .select("id, garment_type, garment_label, version, created_at")
      .eq("client_id", client.id)
      .order("version", { ascending: false }),
    supabase.from("garment_types").select("key, label"),
  ]);

  if (error || !measurements.length) {
    measurementSelect.innerHTML = `<option value="">Aucune mesure — crée-la depuis la fiche client</option>`;
    formError.innerHTML = `Ce client n'a pas encore de fiche de mesure. <a class="link-plain" href="client-detail.html?id=${client.id}">Ouvrir sa fiche</a>`;
    return;
  }
  formError.textContent = "";

  measurementSelect.innerHTML = measurements
    .map(
      (m) =>
        `<option value="${m.id}" ${m.id === preselectMeasurementId ? "selected" : ""}>${escapeHtml(measurementGarmentLabel(m, types || []))} — v${m.version} (${formatDate(m.created_at)})</option>`
    )
    .join("");

  const desc = orderForm.garment_description;
  if (!desc.value) {
    const chosen = measurements.find((m) => m.id === measurementSelect.value) || measurements[0];
    desc.value = measurementGarmentLabel(chosen, types || []);
  }
}

function updateTotalPreview() {
  const qty = parseInt(quantityInput.value, 10) || 0;
  const price = parseFloat(unitPriceInput.value) || 0;
  const paid = parseFloat(paidInput.value) || 0;
  if (!qty || !price) {
    totalPreview.textContent = "";
    return;
  }
  const total = qty * price;
  totalPreview.textContent = `Total : ${formatMoney(total)}${paid > 0 ? ` · Reste à payer : ${formatMoney(Math.max(0, total - paid))}` : ""}`;
}

async function handleCreateOrder(e) {
  e.preventDefault();
  formError.textContent = "";

  if (!selectedClient) {
    formError.textContent = "Sélectionne un client.";
    return;
  }
  if (!measurementSelect.value) {
    formError.textContent = "Sélectionne une fiche de mesure.";
    return;
  }

  const quantity = parseInt(orderForm.quantity.value, 10) || 1;
  const unitPrice = parseFloat(orderForm.unit_price.value);
  const paid = parseFloat(orderForm.paid.value) || 0;
  const total = quantity * unitPrice;

  if (Number.isNaN(unitPrice) || unitPrice < 0) {
    formError.textContent = "Indique un prix unitaire valide.";
    return;
  }
  if (paid < 0 || paid > total) {
    formError.textContent = "Le montant payé doit être compris entre 0 et le total de la commande.";
    return;
  }

  const submitBtn = orderForm.querySelector("button[type=submit]");
  setButtonLoading(submitBtn, true, "Création...");

  const { data, error } = await supabase.rpc("create_order_with_payment", {
    p_client_id: selectedClient.id,
    p_measurement_id: measurementSelect.value,
    p_garment_description: orderForm.garment_description.value.trim(),
    p_fabric: orderForm.fabric.value.trim() || null,
    p_quantity: quantity,
    p_unit_price: unitPrice,
    p_due_date: orderForm.due_date.value,
    p_paid: paid,
    p_payment_method: orderForm.payment_method.value,
  });

  setButtonLoading(submitBtn, false);

  if (error) {
    formError.textContent = mapDbError(error, "Erreur lors de la création de la commande.");
    console.error(error);
    return;
  }

  const { order, invoice } = data;
  closeModal("order-modal");
  showToast(`Commande ${order.order_number} et facture ${invoice.invoice_number} créées.`, "success");

  if (orderForm.download_receipt.checked) {
    try {
      await generateAndDownloadReceipt({
        ...establishmentData(),
        invoiceNumber: invoice.invoice_number,
        orderNumber: order.order_number,
        issuedAt: invoice.issued_at,
        dueDate: order.due_date,
        clientName: selectedClient.full_name,
        clientPhone: selectedClient.phone,
        garmentDescription: order.garment_description,
        fabric: order.fabric,
        quantity: order.quantity,
        unitPrice: order.unit_price,
        totalAmount: order.total_price,
        amountPaid: invoice.amount_paid,
        payments: paid > 0 ? [{ amount: paid, payment_method: orderForm.payment_method.value, paid_at: new Date().toISOString() }] : [],
      });
      // Laisse le navigateur démarrer le téléchargement avant de changer de page.
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (receiptError) {
      console.error(receiptError);
      showToast("Commande créée, mais le reçu n'a pas pu être généré. Tu peux le télécharger depuis la facture.", "error");
    }
  }

  window.location.href = `order-detail.html?id=${order.id}`;
}

function establishmentData() {
  const est = establishmentFromProfile(currentProfile);
  return { establishmentName: est.name, establishmentPhone: est.phone, establishmentAddress: est.address };
}
