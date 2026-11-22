// =============================================================
// TAILORFLOW — Rapports & extraction de la facturation
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import {
  escapeHtml, formatDate, formatMoney, invoiceStatusBadge, INVOICE_STATUS_LABELS, todayISO, tableMessageRow,
  PAYMENT_METHOD_LABELS, showToast,
} from "./utils.js";

let currentProfile = null;
let currentRows = [];
let currentPayments = [];

const fromDateInput = document.getElementById("from-date");
const toDateInput = document.getElementById("to-date");
const statusFilter = document.getElementById("status-filter");
const includeCancelled = document.getElementById("include-cancelled");
const tableBody = document.getElementById("report-table-body");
const summaryEl = document.getElementById("report-summary");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "reports");

  setRange("month");
  await loadReport();

  document.getElementById("report-filters").addEventListener("submit", (e) => {
    e.preventDefault();
    loadReport();
  });
  document.querySelectorAll("[data-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      setRange(btn.dataset.range);
      loadReport();
    })
  );
  document.getElementById("export-excel-btn").addEventListener("click", exportExcel);
  document.getElementById("export-pdf-btn").addEventListener("click", () => window.print());
}

function setRange(range) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  let from;
  if (range === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (range === "last-month") {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    toDateInput.value = iso(new Date(now.getFullYear(), now.getMonth(), 0));
    fromDateInput.value = iso(from);
    return;
  } else if (range === "year") from = new Date(now.getFullYear(), 0, 1);
  else from = new Date(now.getFullYear(), now.getMonth(), 1);
  fromDateInput.value = iso(from);
  toDateInput.value = todayISO();
}

/** Bornes de la période en ISO (heure locale → UTC). */
function periodBounds() {
  const from = fromDateInput.value ? new Date(fromDateInput.value + "T00:00:00").toISOString() : null;
  const to = toDateInput.value ? new Date(toDateInput.value + "T23:59:59.999").toISOString() : null;
  return { from, to };
}

async function loadReport() {
  tableBody.innerHTML = tableMessageRow(8, "Chargement...");
  const { from, to } = periodBounds();

  if (from && to && from > to) {
    tableBody.innerHTML = tableMessageRow(8, "La date de début doit précéder la date de fin.", "error");
    return;
  }

  let query = supabase
    .from("invoices")
    .select(`
      id, invoice_number, amount_total, amount_paid, status, issued_at,
      orders!inner ( order_number, status, garment_description, clients ( full_name, phone ) )
    `)
    .order("issued_at", { ascending: false })
    .limit(5000);

  if (from) query = query.gte("issued_at", from);
  if (to) query = query.lte("issued_at", to);
  if (statusFilter.value) query = query.eq("status", statusFilter.value);
  if (!includeCancelled.checked) query = query.neq("orders.status", "cancelled");

  let paymentsQuery = supabase.from("payments").select("amount, payment_method, paid_at").limit(10000);
  if (from) paymentsQuery = paymentsQuery.gte("paid_at", from);
  if (to) paymentsQuery = paymentsQuery.lte("paid_at", to);

  const [{ data, error }, payments] = await Promise.all([query, paymentsQuery]);

  if (error) {
    tableBody.innerHTML = tableMessageRow(8, "Erreur de chargement.", "error");
    console.error(error);
    return;
  }

  currentRows = data || [];
  currentPayments = payments.data || [];
  renderSummary();
  renderTable();
}

function renderSummary() {
  const totalAmount = currentRows.reduce((sum, r) => sum + Number(r.amount_total), 0);
  const totalPaid = currentRows.reduce((sum, r) => sum + Number(r.amount_paid), 0);
  const cashed = currentPayments.reduce((sum, p) => sum + Number(p.amount), 0);

  const byMethod = {};
  for (const p of currentPayments) byMethod[p.payment_method] = (byMethod[p.payment_method] || 0) + Number(p.amount);
  const methodsHtml = Object.entries(byMethod)
    .map(([m, v]) => `<span class="chip">${escapeHtml(PAYMENT_METHOD_LABELS[m] || m)} : ${formatMoney(v)}</span>`)
    .join(" ");

  summaryEl.innerHTML = `
    <div class="kpi-grid kpi-grid-compact">
      <div><div class="kpi-label">Factures émises</div><div class="kpi-value">${currentRows.length}</div></div>
      <div><div class="kpi-label">Total facturé</div><div class="kpi-value">${formatMoney(totalAmount)}</div></div>
      <div><div class="kpi-label">Payé sur ces factures</div><div class="kpi-value text-success">${formatMoney(totalPaid)}</div></div>
      <div><div class="kpi-label">Reste à encaisser</div><div class="kpi-value text-warning">${formatMoney(totalAmount - totalPaid)}</div></div>
      <div><div class="kpi-label">Encaissements de la période</div><div class="kpi-value text-success">${formatMoney(cashed)}</div></div>
    </div>
    ${methodsHtml ? `<div class="chip-row">${methodsHtml}</div>` : ""}
    <p class="print-only text-sm">Période du ${formatDate(fromDateInput.value)} au ${formatDate(toDateInput.value)} — ${escapeHtml(currentProfile.establishment_name || "")}</p>
  `;
}

function renderTable() {
  if (!currentRows.length) {
    tableBody.innerHTML = tableMessageRow(8, "Aucune facture sur cette période.");
    return;
  }

  tableBody.innerHTML = currentRows
    .map((inv) => {
      const remaining = Number(inv.amount_total) - Number(inv.amount_paid);
      return `
      <tr>
        <td data-label="N° facture"><a class="link-plain" href="invoice-detail.html?id=${inv.id}">${escapeHtml(inv.invoice_number)}</a></td>
        <td data-label="Client">${escapeHtml(inv.orders?.clients?.full_name || "—")}</td>
        <td data-label="Commande">${escapeHtml(inv.orders?.order_number || "—")}</td>
        <td data-label="Émise le">${formatDate(inv.issued_at)}</td>
        <td data-label="Total">${formatMoney(inv.amount_total)}</td>
        <td data-label="Payé">${formatMoney(inv.amount_paid)}</td>
        <td data-label="Solde">${formatMoney(remaining)}</td>
        <td data-label="Statut">${invoiceStatusBadge(inv.status)}</td>
      </tr>`;
    })
    .join("");
}

function exportExcel() {
  if (!currentRows.length) {
    showToast("Aucune donnée à exporter sur cette période.", "info");
    return;
  }
  if (typeof window.XLSX === "undefined") {
    showToast("Module Excel indisponible. Vérifie ta connexion puis recharge la page.", "error");
    return;
  }

  const rows = currentRows.map((inv) => ({
    "N° facture": inv.invoice_number,
    Client: inv.orders?.clients?.full_name || "",
    Téléphone: inv.orders?.clients?.phone || "",
    Commande: inv.orders?.order_number || "",
    Article: inv.orders?.garment_description || "",
    "Émise le": formatDate(inv.issued_at),
    "Montant total": Number(inv.amount_total),
    "Montant payé": Number(inv.amount_paid),
    "Solde restant": Number(inv.amount_total) - Number(inv.amount_paid),
    Statut: INVOICE_STATUS_LABELS[inv.status] || inv.status,
    "Commande annulée": inv.orders?.status === "cancelled" ? "Oui" : "",
  }));

  const worksheet = window.XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [14, 24, 14, 14, 24, 12, 14, 14, 14, 18, 10].map((wch) => ({ wch }));
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "Facturation");
  window.XLSX.writeFile(workbook, `tailorflow-facturation-${fromDateInput.value}_au_${toDateInput.value}.xlsx`);
}
