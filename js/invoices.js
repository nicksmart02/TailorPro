// =============================================================
// TAILORFLOW — Module Facturation (liste)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { debounce, escapeHtml, formatDate, formatMoney, invoiceStatusBadge } from "./utils.js";

let currentProfile = null;
let currentSearch = "";

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
  searchInput.addEventListener(
    "input",
    debounce(() => {
      currentSearch = searchInput.value.trim();
      loadInvoices();
    }, 300)
  );
}

async function loadInvoices() {
  tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--color-text-muted);">Chargement...</td></tr>`;

  let query = supabase
    .from("invoices")
    .select(`
      id, invoice_number, amount_total, amount_paid, status, issued_at,
      orders ( order_number, garment_description, clients ( full_name, phone ) )
    `)
    .order("issued_at", { ascending: false });

  if (statusFilter.value) {
    query = query.eq("status", statusFilter.value);
  }
  if (currentSearch) {
    query = query.ilike("invoice_number", `%${currentSearch}%`);
  }

  const { data, error } = await query;

  if (error) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--color-danger);">Erreur de chargement.</td></tr>`;
    console.error(error);
    return;
  }

  // Filtre client-side additionnel par nom de client si la recherche ne matche pas le n° de facture
  let filtered = data;
  if (currentSearch && !data.length) {
    const { data: byClient } = await supabase
      .from("invoices")
      .select(`
        id, invoice_number, amount_total, amount_paid, status, issued_at,
        orders!inner ( order_number, garment_description, clients!inner ( full_name, phone ) )
      `)
      .ilike("orders.clients.full_name", `%${currentSearch}%`)
      .order("issued_at", { ascending: false });
    filtered = byClient || [];
  }

  if (!filtered.length) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--color-text-muted);">Aucune facture trouvée.</td></tr>`;
    return;
  }

  tableBody.innerHTML = filtered
    .map(
      (inv) => `
    <tr class="invoice-row" data-id="${inv.id}" style="cursor:pointer;">
      <td data-label="N° facture">${escapeHtml(inv.invoice_number)}</td>
      <td data-label="Client">${escapeHtml(inv.orders?.clients?.full_name || "—")}</td>
      <td data-label="Commande">${escapeHtml(inv.orders?.order_number || "—")}</td>
      <td data-label="Émise le">${formatDate(inv.issued_at)}</td>
      <td data-label="Total">${formatMoney(inv.amount_total)}</td>
      <td data-label="Payé">${formatMoney(inv.amount_paid)}</td>
      <td data-label="Statut">${invoiceStatusBadge(inv.status)}</td>
    </tr>`
    )
    .join("");

  document.querySelectorAll(".invoice-row").forEach((row) => {
    row.addEventListener("click", () => {
      window.location.href = `invoice-detail.html?id=${row.dataset.id}`;
    });
  });
}
