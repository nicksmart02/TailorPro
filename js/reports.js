// =============================================================
// TAILORFLOW — Rapports & extraction de la facturation
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { escapeHtml, formatDate, formatMoney, invoiceStatusBadge } from "./utils.js";

let currentProfile = null;
let currentRows = [];

const fromDateInput = document.getElementById("from-date");
const toDateInput = document.getElementById("to-date");
const statusFilter = document.getElementById("status-filter");
const tableBody = document.getElementById("report-table-body");
const summaryEl = document.getElementById("report-summary");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "reports");

  if (!["admin", "accountant"].includes(currentProfile.role)) {
    document.querySelector(".app-main").innerHTML = `<p class="error-message">Accès réservé aux administrateurs et comptables.</p>`;
    return;
  }

  setDefaultDateRange();
  await loadReport();

  document.getElementById("apply-filters-btn").addEventListener("click", loadReport);
  document.getElementById("export-excel-btn").addEventListener("click", exportExcel);
  document.getElementById("export-pdf-btn").addEventListener("click", () => window.print());
}

function setDefaultDateRange() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  fromDateInput.value = firstOfMonth.toISOString().slice(0, 10);
  toDateInput.value = now.toISOString().slice(0, 10);
}

async function loadReport() {
  tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-text-muted);">Chargement...</td></tr>`;

  let query = supabase
    .from("invoices")
    .select(`
      id, invoice_number, amount_total, amount_paid, status, issued_at,
      orders ( order_number, clients ( full_name ) )
    `)
    .order("issued_at", { ascending: false });

  if (fromDateInput.value) query = query.gte("issued_at", fromDateInput.value);
  if (toDateInput.value) query = query.lte("issued_at", toDateInput.value + "T23:59:59");
  if (statusFilter.value) query = query.eq("status", statusFilter.value);

  const { data, error } = await query;

  if (error) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-danger);">Erreur de chargement.</td></tr>`;
    console.error(error);
    return;
  }

  currentRows = data || [];
  renderSummary();
  renderTable();
}

function renderSummary() {
  const totalInvoices = currentRows.length;
  const totalAmount = currentRows.reduce((sum, r) => sum + Number(r.amount_total), 0);
  const totalPaid = currentRows.reduce((sum, r) => sum + Number(r.amount_paid), 0);
  const totalOutstanding = totalAmount - totalPaid;

  summaryEl.innerHTML = `
    <div><div class="kpi-label">Factures</div><div class="kpi-value">${totalInvoices}</div></div>
    <div><div class="kpi-label">Total facturé</div><div class="kpi-value">${formatMoney(totalAmount)}</div></div>
    <div><div class="kpi-label">Total encaissé</div><div class="kpi-value" style="color:var(--color-success);">${formatMoney(totalPaid)}</div></div>
    <div><div class="kpi-label">Solde restant</div><div class="kpi-value" style="color:var(--color-warning);">${formatMoney(totalOutstanding)}</div></div>
  `;
}

function renderTable() {
  if (!currentRows.length) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-text-muted);">Aucune facture sur cette période.</td></tr>`;
    return;
  }

  tableBody.innerHTML = currentRows
    .map((inv) => {
      const remaining = inv.amount_total - inv.amount_paid;
      return `
      <tr>
        <td>${escapeHtml(inv.invoice_number)}</td>
        <td>${escapeHtml(inv.orders?.clients?.full_name || "—")}</td>
        <td>${escapeHtml(inv.orders?.order_number || "—")}</td>
        <td>${formatDate(inv.issued_at)}</td>
        <td>${formatMoney(inv.amount_total)}</td>
        <td>${formatMoney(inv.amount_paid)}</td>
        <td>${formatMoney(remaining)}</td>
        <td>${invoiceStatusBadge(inv.status)}</td>
      </tr>`;
    })
    .join("");
}

function exportExcel() {
  if (!currentRows.length) return;

  const STATUS_LABELS = { unpaid: "Impayée", partial: "Partielle", paid: "Payée" };

  const rows = currentRows.map((inv) => ({
    "N° facture": inv.invoice_number,
    Client: inv.orders?.clients?.full_name || "",
    Commande: inv.orders?.order_number || "",
    "Émise le": formatDate(inv.issued_at),
    "Montant total": Number(inv.amount_total),
    "Montant payé": Number(inv.amount_paid),
    "Solde restant": Number(inv.amount_total) - Number(inv.amount_paid),
    Statut: STATUS_LABELS[inv.status] || inv.status,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Facturation");

  const period = `${fromDateInput.value}_au_${toDateInput.value}`;
  XLSX.writeFile(workbook, `tailorflow-facturation-${period}.xlsx`);
}
