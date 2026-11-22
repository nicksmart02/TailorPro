// =============================================================
// TAILORFLOW — Portail client (multi-ateliers)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireClientAuth, relinkClientByPhone, claimInviteCode } from "./auth.js";
import { renderClientNav } from "./nav.js";
import {
  escapeHtml, formatDate, formatMoney, orderStatusBadge, invoiceStatusBadge, showToast, measurementKvHtml,
  measurementGarmentLabel, setButtonLoading, telHref, whatsappHref, tableMessageRow,
} from "./utils.js";
import { generateAndDownloadReceipt, receiptDataFromInvoice } from "./receipt.js";

let currentProfile = null;
let establishments = {};
const invoicesById = {};

init();

async function init() {
  currentProfile = await requireClientAuth();
  if (!currentProfile) return;
  renderClientNav(currentProfile, "portal");

  document.getElementById("welcome-title").textContent = `Bonjour ${currentProfile.full_name || ""}`;
  document.getElementById("profile-phone").textContent = currentProfile.phone || "non renseigné";
  document.getElementById("relink-btn").addEventListener("click", handleRelink);
  document.getElementById("invite-form").addEventListener("submit", handleClaimInvite);

  await Promise.all([loadPendingRequests(), loadEstablishments()]);
}

async function loadPendingRequests() {
  const { data } = await supabase.rpc("my_pending_link_count");
  const count = Number(data || 0);
  const el = document.getElementById("pending-links");
  el.innerHTML = count
    ? `<div class="banner banner-info">⏳ ${count} demande(s) d'accès en attente de confirmation par ${count > 1 ? "les ateliers" : "l'atelier"}.
        Tes commandes apparaîtront ici dès qu'ils auront validé.</div>`
    : "";
}

async function handleRelink(e) {
  const btn = e.currentTarget;
  setButtonLoading(btn, true, "Recherche...");
  try {
    const count = await relinkClientByPhone();
    showToast(
      count > 0
        ? "Demande envoyée : les ateliers concernés doivent confirmer que tu es bien leur client."
        : "Aucun nouvel atelier trouvé avec ton numéro. Demande à ton couturier un code d'invitation.",
      count > 0 ? "success" : "info"
    );
    await loadPendingRequests();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleClaimInvite(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("invite-error");
  errorEl.textContent = "";
  const btn = form.querySelector("button[type=submit]");
  setButtonLoading(btn, true, "Vérification...");
  try {
    await claimInviteCode(form.code.value);
    form.reset();
    showToast("Atelier ajouté à ton espace !", "success");
    await loadEstablishments();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    setButtonLoading(btn, false);
  }
}

/** Une section par atelier où le compte est rattaché. */
async function loadEstablishments() {
  const container = document.getElementById("establishments-container");
  container.innerHTML = `<p class="text-muted">Chargement...</p>`;

  const { data: clientRows, error } = await supabase
    .from("clients")
    .select("id, owner_id, full_name, phone")
    .eq("user_id", currentProfile.id)
    .order("created_at", { ascending: true });

  if (error) {
    container.innerHTML = `<p class="error-message">Erreur de chargement.</p>`;
    return;
  }

  if (!clientRows.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Aucun atelier n'est encore rattaché à ton compte.</p>
        <p class="text-sm">Saisis le code d'invitation donné par ton couturier, ou demande-lui de confirmer ta demande d'accès.</p>
        <a class="btn btn-primary" href="marketplace.html">Découvrir des couturiers</a>
      </div>`;
    return;
  }

  const ownerIds = [...new Set(clientRows.map((c) => c.owner_id))];
  const { data: est } = await supabase.rpc("public_establishments", { p_ids: ownerIds });
  establishments = Object.fromEntries((est || []).map((e) => [e.id, e]));

  container.innerHTML = clientRows
    .map((c) => {
      const e = establishments[c.owner_id] || {};
      const tel = telHref(e.phone);
      const wa = whatsappHref(e.phone, `Bonjour ${e.display_name || ""}, c'est ${currentProfile.full_name}.`);
      return `
      <section class="card establishment-section" aria-label="${escapeHtml(e.display_name || "Atelier")}">
        <div class="establishment-header">
          <div>
            <h2>${escapeHtml(e.display_name || "Atelier")}</h2>
            ${e.address ? `<p class="text-muted text-sm">📍 ${escapeHtml(e.address)}</p>` : ""}
          </div>
          <div class="button-row">
            ${tel ? `<a class="btn btn-secondary btn-sm" href="${tel}">📞 Appeler</a>` : ""}
            ${wa ? `<a class="btn btn-secondary btn-sm" href="${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
            <a class="btn btn-primary btn-sm" href="marketplace.html?owner=${c.owner_id}">Commander à distance</a>
          </div>
        </div>

        <h3>Mes commandes</h3>
        <table class="data-table">
          <thead><tr><th>N°</th><th>Article</th><th>Remise prévue</th><th>Statut</th><th>Montant</th></tr></thead>
          <tbody id="orders-${c.id}">${tableMessageRow(5, "Chargement...")}</tbody>
        </table>

        <h3>Mes factures</h3>
        <table class="data-table">
          <thead><tr><th>N°</th><th>Total</th><th>Payé</th><th>Reste</th><th>Statut</th><th></th></tr></thead>
          <tbody id="invoices-${c.id}">${tableMessageRow(6, "Chargement...")}</tbody>
        </table>

        <details class="measurements-details">
          <summary>Mes fiches de mesures</summary>
          <div id="measurements-${c.id}"></div>
        </details>
      </section>`;
    })
    .join("");

  await Promise.all(clientRows.flatMap((c) => [loadOrders(c.id), loadInvoices(c), loadMeasurements(c.id)]));
}

async function loadOrders(clientId) {
  const tbody = document.getElementById(`orders-${clientId}`);
  const { data, error } = await supabase
    .from("orders")
    .select("order_number, garment_description, quantity, due_date, status, delivered_at, total_price")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error || !data?.length) {
    tbody.innerHTML = tableMessageRow(5, "Aucune commande pour le moment.");
    return;
  }

  tbody.innerHTML = data
    .map(
      (o) => `
    <tr>
      <td data-label="N°">${escapeHtml(o.order_number)}</td>
      <td data-label="Article">${escapeHtml(o.garment_description)}${o.quantity > 1 ? ` × ${o.quantity}` : ""}</td>
      <td data-label="Remise prévue">${o.status === "delivered" ? `Remise le ${formatDate(o.delivered_at)}` : formatDate(o.due_date)}</td>
      <td data-label="Statut">${orderStatusBadge(o)}</td>
      <td data-label="Montant">${formatMoney(o.total_price)}</td>
    </tr>`
    )
    .join("");
}

async function loadInvoices(clientRow) {
  const tbody = document.getElementById(`invoices-${clientRow.id}`);
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, amount_total, amount_paid, status, issued_at, orders!inner(client_id, order_number, garment_description, fabric, quantity, unit_price, due_date)")
    .eq("orders.client_id", clientRow.id)
    .order("issued_at", { ascending: false });

  if (error || !data?.length) {
    tbody.innerHTML = tableMessageRow(6, "Aucune facture pour le moment.");
    return;
  }

  tbody.innerHTML = data
    .map((inv) => {
      invoicesById[inv.id] = { ...inv, ownerId: clientRow.owner_id, client: clientRow };
      const remaining = Math.max(0, Number(inv.amount_total) - Number(inv.amount_paid));
      return `
    <tr>
      <td data-label="N°">${escapeHtml(inv.invoice_number)}</td>
      <td data-label="Total">${formatMoney(inv.amount_total)}</td>
      <td data-label="Payé">${formatMoney(inv.amount_paid)}</td>
      <td data-label="Reste">${remaining > 0 ? `<strong class="text-warning">${formatMoney(remaining)}</strong>` : formatMoney(0)}</td>
      <td data-label="Statut">${invoiceStatusBadge(inv.status)}</td>
      <td data-label=""><button class="btn btn-ghost btn-sm receipt-btn" data-id="${inv.id}" type="button">Reçu</button></td>
    </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".receipt-btn").forEach((btn) => btn.addEventListener("click", () => downloadReceipt(btn)));
}

async function downloadReceipt(btn) {
  const inv = invoicesById[btn.dataset.id];
  if (!inv) return;
  setButtonLoading(btn, true, "...");
  try {
    const { data: payments } = await supabase
      .from("payments")
      .select("amount, payment_method, paid_at")
      .eq("invoice_id", inv.id)
      .order("paid_at");
    const e = establishments[inv.ownerId] || {};
    const data = receiptDataFromInvoice(
      { ...inv, orders: { ...inv.orders, clients: inv.client } },
      { name: e.display_name, phone: e.phone, address: e.address },
      payments || []
    );
    await generateAndDownloadReceipt(data);
  } catch (err) {
    console.error(err);
    showToast("Impossible de générer le reçu.", "error");
  } finally {
    setButtonLoading(btn, false);
  }
}

async function loadMeasurements(clientId) {
  const container = document.getElementById(`measurements-${clientId}`);
  const { data, error } = await supabase
    .from("measurements")
    .select("garment_type, garment_label, field_meta, values, version, created_at")
    .eq("client_id", clientId)
    .order("version", { ascending: false });

  if (error || !data?.length) {
    container.innerHTML = `<p class="text-muted">Aucune fiche de mesure pour le moment.</p>`;
    return;
  }

  container.innerHTML = data
    .map(
      (m) => `
    <div class="measurement-card">
      <div class="measurement-card-header">
        <strong>${escapeHtml(measurementGarmentLabel(m))} — version ${m.version}</strong>
        <span class="text-muted text-sm">${formatDate(m.created_at)}</span>
      </div>
      <dl class="kv-list kv-list-compact">${measurementKvHtml(m)}</dl>
    </div>`
    )
    .join("");
}
