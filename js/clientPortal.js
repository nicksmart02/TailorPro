// =============================================================
// TAILORFLOW — Portail client (lecture seule)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireClientAuth, logout } from "./auth.js";
import { escapeHtml, formatDate, formatMoney, orderStatusBadge, invoiceStatusBadge } from "./utils.js";

let clientRecord = null; // la ligne public.clients liée à ce compte (via clients.user_id)

init();

async function init() {
  const profile = await requireClientAuth();
  if (!profile) return;

  document.getElementById("welcome-title").textContent = `Bonjour ${profile.full_name || ""}`;
  document.getElementById("logout-btn").addEventListener("click", logout);

  await loadClientRecord();
  if (!clientRecord) return; // message d'erreur déjà affiché

  document.getElementById("portal-brand").innerHTML = `TailorFlow <span class="nav-brand-establishment">— espace client</span>`;

  await loadOrders();
  await loadMeasurements();
  await loadInvoices();
}

/** Récupère la fiche client liée au compte connecté (RLS : user_id = auth.uid()). */
async function loadClientRecord() {
  const { data, error } = await supabase.from("clients").select("id, full_name").maybeSingle();

  if (error || !data) {
    document.querySelector(".app-main").innerHTML = `<p class="error-message">
      Impossible de charger ton espace. Contacte ton couturier si le problème persiste.
    </p>`;
    return;
  }
  clientRecord = data;
}

async function loadOrders() {
  const tableBody = document.getElementById("orders-table-body");
  const { data, error } = await supabase
    .from("orders")
    .select("order_number, garment_description, due_date, status, delivered_at, total_price")
    .eq("client_id", clientRecord.id)
    .order("created_at", { ascending: false });

  if (error || !data || !data.length) {
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--color-text-muted);">Aucune commande pour le moment.</td></tr>`;
    return;
  }

  tableBody.innerHTML = data
    .map(
      (o) => `
    <tr>
      <td data-label="N°">${escapeHtml(o.order_number)}</td>
      <td data-label="Description">${escapeHtml(o.garment_description)}</td>
      <td data-label="Échéance">${formatDate(o.due_date)}</td>
      <td data-label="Statut">${orderStatusBadge(o)}</td>
      <td data-label="Montant">${formatMoney(o.total_price)}</td>
    </tr>`
    )
    .join("");
}

async function loadMeasurements() {
  const container = document.getElementById("measurements-list");
  const { data, error } = await supabase
    .from("measurements")
    .select("garment_type, values, version, created_at")
    .eq("client_id", clientRecord.id)
    .order("version", { ascending: false });

  if (error || !data || !data.length) {
    container.innerHTML = `<p style="color:var(--color-text-muted);">Aucune fiche de mesure pour le moment.</p>`;
    return;
  }

  container.innerHTML = data
    .map(
      (m) => `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <strong>${escapeHtml(m.garment_type)} — version ${m.version}</strong>
        <span style="color:var(--color-text-muted); font-size:0.82rem;">${formatDate(m.created_at)}</span>
      </div>
      <dl class="kv-list">
        ${Object.entries(m.values)
          .map(([k, v]) => `<dt>${escapeHtml(k.replace(/_/g, " "))}</dt><dd>${escapeHtml(v)} cm</dd>`)
          .join("")}
      </dl>
    </div>`
    )
    .join("");
}

async function loadInvoices() {
  const tableBody = document.getElementById("invoices-table-body");
  const { data, error } = await supabase
    .from("invoices")
    .select("invoice_number, amount_total, amount_paid, status, orders!inner(client_id)")
    .eq("orders.client_id", clientRecord.id)
    .order("issued_at", { ascending: false });

  if (error || !data || !data.length) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-text-muted);">Aucune facture pour le moment.</td></tr>`;
    return;
  }

  tableBody.innerHTML = data
    .map(
      (inv) => `
    <tr>
      <td data-label="N°">${escapeHtml(inv.invoice_number)}</td>
      <td data-label="Montant total">${formatMoney(inv.amount_total)}</td>
      <td data-label="Payé">${formatMoney(inv.amount_paid)}</td>
      <td data-label="Statut">${invoiceStatusBadge(inv.status)}</td>
    </tr>`
    )
    .join("");
}
