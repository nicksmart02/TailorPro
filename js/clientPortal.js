// =============================================================
// TAILORFLOW — Portail client (multi-couturiers)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireClientAuth, logout, relinkClientByPhone } from "./auth.js";
import { escapeHtml, formatDate, formatMoney, orderStatusBadge, invoiceStatusBadge, showToast } from "./utils.js";

init();

async function init() {
  const profile = await requireClientAuth();
  if (!profile) return;

  document.getElementById("welcome-title").textContent = `Bonjour ${profile.full_name || ""}`;
  document.getElementById("portal-brand").innerHTML = `TailorFlow <span class="nav-brand-establishment">— espace client</span>`;
  document.getElementById("logout-btn").addEventListener("click", logout);
  document.getElementById("relink-btn").addEventListener("click", handleRelink);

  const justLinked = sessionStorage.getItem("tf_just_linked_count");
  if (justLinked && Number(justLinked) > 0) {
    document.getElementById("portal-message").textContent =
      `${justLinked} couturier(s) trouvé(s) et rattaché(s) à ton compte !`;
    sessionStorage.removeItem("tf_just_linked_count");
  }

  await loadEstablishments();
}

async function handleRelink() {
  const btn = document.getElementById("relink-btn");
  btn.disabled = true;
  btn.textContent = "Recherche...";

  try {
    const count = await relinkClientByPhone();
    showToast(count > 0 ? `${count} nouveau(x) couturier(s) trouvé(s) !` : "Aucun nouveau couturier trouvé.", count > 0 ? "success" : "info");
    if (count > 0) await loadEstablishments();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔎 Rechercher mes couturiers";
  }
}

/**
 * Charge toutes les fiches client (une par couturier) liées à ce compte,
 * et affiche une section par établissement.
 */
async function loadEstablishments() {
  const container = document.getElementById("establishments-container");
  container.innerHTML = `<p style="color:var(--color-text-muted);">Chargement...</p>`;

  const { data: clientRows, error } = await supabase
    .from("clients")
    .select("id, owner_id")
    .order("created_at", { ascending: false });

  if (error) {
    container.innerHTML = `<p class="error-message">Erreur de chargement.</p>`;
    return;
  }

  if (!clientRows.length) {
    container.innerHTML = `
      <div class="card" style="text-align:center; padding:32px;">
        <p style="color:var(--color-text-muted); margin-bottom:16px;">
          Aucun couturier n'est encore rattaché à ton compte.
        </p>
        <a class="btn btn-primary" href="marketplace.html">Découvrir des couturiers</a>
      </div>`;
    return;
  }

  // Récupère le nom d'établissement de chaque couturier concerné.
  const ownerIds = [...new Set(clientRows.map((c) => c.owner_id))];
  const { data: owners } = await supabase
    .from("profiles")
    .select("id, full_name, establishment_name")
    .in("id", ownerIds);

  const ownerLabel = Object.fromEntries(
    (owners || []).map((o) => [o.id, o.establishment_name || o.full_name || "Atelier"])
  );

  container.innerHTML = "";
  for (const clientRow of clientRows) {
    const section = document.createElement("div");
    section.className = "establishment-section card";
    section.innerHTML = `
      <div class="establishment-header">
        <h2 style="margin:0;">${escapeHtml(ownerLabel[clientRow.owner_id] || "Atelier")}</h2>
        <a class="btn btn-secondary" href="marketplace.html?owner=${clientRow.owner_id}">Commander à distance</a>
      </div>
      <h3 style="margin-top:20px;">Commandes</h3>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>N°</th><th>Description</th><th>Échéance</th><th>Statut</th><th>Montant</th></tr></thead>
          <tbody id="orders-${clientRow.id}"></tbody>
        </table>
      </div>
      <h3 style="margin-top:24px;">Fiches de mesures</h3>
      <div id="measurements-${clientRow.id}"></div>
      <h3 style="margin-top:24px;">Factures</h3>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>N°</th><th>Montant total</th><th>Payé</th><th>Statut</th></tr></thead>
          <tbody id="invoices-${clientRow.id}"></tbody>
        </table>
      </div>
    `;
    container.appendChild(section);

    loadOrders(clientRow.id);
    loadMeasurements(clientRow.id);
    loadInvoices(clientRow.id);
  }
}

async function loadOrders(clientId) {
  const tableBody = document.getElementById(`orders-${clientId}`);
  const { data, error } = await supabase
    .from("orders")
    .select("order_number, garment_description, due_date, status, delivered_at, total_price")
    .eq("client_id", clientId)
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

async function loadMeasurements(clientId) {
  const container = document.getElementById(`measurements-${clientId}`);
  const { data, error } = await supabase
    .from("measurements")
    .select("garment_type, values, version, created_at")
    .eq("client_id", clientId)
    .order("version", { ascending: false });

  if (error || !data || !data.length) {
    container.innerHTML = `<p style="color:var(--color-text-muted);">Aucune fiche de mesure pour le moment.</p>`;
    return;
  }

  container.innerHTML = data
    .map(
      (m) => `
    <div class="card" style="margin-bottom:12px; background:var(--color-bg);">
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

async function loadInvoices(clientId) {
  const tableBody = document.getElementById(`invoices-${clientId}`);
  const { data, error } = await supabase
    .from("invoices")
    .select("invoice_number, amount_total, amount_paid, status, orders!inner(client_id)")
    .eq("orders.client_id", clientId)
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
