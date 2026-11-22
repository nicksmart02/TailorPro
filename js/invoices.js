// =============================================================
// TAILORFLOW — Facturation (liste)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import {
  debounce, escapeHtml, formatDate, formatMoney, invoiceStatusBadge, tableMessageRow, bindClickableRows,
} from "./utils.js";

let currentProfile = null;
let allInvoices = [];

const tableBody = document.getElementById("invoices-table-body");
const statusFilter = document.getElementById("status-filter");
const searchInput = document.getElementById("search-input");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "invoices");

  await loadInvoices();
  statusFilter.addEventListener("change", loadInvoices);
  searchInput.addEventListener("input", debounce(renderInvoices, 200));
}

async function loadInvoices() {
  tableBody.innerHTML = tableMessageRow(7, "Chargement...");

  let query = supabase
    .from("invoices")
    .select(`
      id, invoice_number, amount_total, amount_paid, status, issued_at,
      orders ( order_number, status, garment_description, clients ( full_name, phone ) )
    `)
    .order("issued_at", { ascending: false })
    .limit(1000);

  if (statusFilter.value === "open") {
    query = query.in("status", ["unpaid", "partial"]);
  } else if (statusFilter.value) {
    query = query.eq("status", statusFilter.value);
  }

  const { data, error } = await query;
  if (error) {
    tableBody.innerHTML = tableMessageRow(7, "Erreur de chargement.", "error");
    console.error(error);
    return;
  }
  allInvoices = data || [];
  renderInvoices();
}

function renderInvoices() {
  const term = searchInput.value.trim().toLowerCase();
  const rows = term
    ? allInvoices.filter((inv) =>
        [inv.invoice_number, inv.orders?.order_number, inv.orders?.clients?.full_name, inv.orders?.clients?.phone]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term))
      )
    : allInvoices;

  const outstanding = rows
    .filter((inv) => inv.orders?.status !== "cancelled")
    .reduce((sum, inv) => sum + Math.max(0, Number(inv.amount_total) - Number(inv.amount_paid)), 0);
  document.getElementById("invoices-summary").textContent =
    `${rows.length} facture${rows.length > 1 ? "s" : ""} · reste à encaisser : ${formatMoney(outstanding)}`;

  if (!rows.length) {
    tableBody.innerHTML = tableMessageRow(7, "Aucune facture trouvée.");
    return;
  }

  tableBody.innerHTML = rows
    .map((inv) => {
      const remaining = Math.max(0, Number(inv.amount_total) - Number(inv.amount_paid));
      const cancelled = inv.orders?.status === "cancelled";
      return `
    <tr class="clickable-row ${cancelled ? "row-muted" : ""}" data-href="invoice-detail.html?id=${inv.id}" tabindex="0">
      <td data-label="N° facture">${escapeHtml(inv.invoice_number)}</td>
      <td data-label="Client">${escapeHtml(inv.orders?.clients?.full_name || "—")}</td>
      <td data-label="Commande">${escapeHtml(inv.orders?.order_number || "—")}${cancelled ? ' <span class="badge badge-cancelled">Annulée</span>' : ""}</td>
      <td data-label="Émise le">${formatDate(inv.issued_at)}</td>
      <td data-label="Total">${formatMoney(inv.amount_total)}</td>
      <td data-label="Reste à payer">${remaining > 0 ? `<strong class="text-warning">${formatMoney(remaining)}</strong>` : formatMoney(0)}</td>
      <td data-label="Statut">${invoiceStatusBadge(inv.status)}</td>
    </tr>`;
    })
    .join("");
  bindClickableRows(tableBody);
}
