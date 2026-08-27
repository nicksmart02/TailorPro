// =============================================================
// TAILORFLOW — Tableau de bord (KPI réels)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { formatMoney, formatDate, escapeHtml, orderStatusBadge } from "./utils.js";

const ALERT_WINDOW_DAYS = 3; // fenêtre d'alerte : commandes à remettre dans les 3 prochains jours
const RECENT_LIMIT = 5; // nombre de lignes affichées dans les listes "dernières / derniers"

init();

async function init() {
  const profile = await requireAuth();
  if (!profile) return;
  renderNav(profile, "dashboard");
  await loadKpis();
  await loadDeliveryAlerts();
  await loadRecentOrders();
  await loadRecentClients();
}

async function loadKpis() {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  // Commandes en cours (pending + in_progress + ready)
  const { count: inProgressCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "in_progress", "ready"]);

  // Commandes en retard
  const { count: lateCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .lt("due_date", today)
    .in("status", ["pending", "in_progress", "ready"]);

  // Chiffre d'affaires du mois (factures émises ce mois-ci)
  const { data: invoicesThisMonth } = await supabase
    .from("invoices")
    .select("amount_total")
    .gte("issued_at", firstOfMonth);

  const revenue = (invoicesThisMonth || []).reduce((sum, inv) => sum + Number(inv.amount_total), 0);

  // Factures impayées ou partielles
  const { count: unpaidCount } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .in("status", ["unpaid", "partial"]);

  document.getElementById("kpi-in-progress").textContent = inProgressCount ?? "—";
  document.getElementById("kpi-late").textContent = lateCount ?? "—";
  document.getElementById("kpi-revenue").textContent = formatMoney(revenue);
  document.getElementById("kpi-unpaid").textContent = unpaidCount ?? "—";
}

/**
 * Alerte en approche de livraison : commandes non remises/non annulées dont
 * la date de remise tombe aujourd'hui ou dans les prochains jours (fenêtre
 * définie par ALERT_WINDOW_DAYS), ainsi que celles déjà en retard.
 *
 * Note de transparence : il n'existe pas d'envoi SMS/email réel branché à ce
 * stade — cette alerte est affichée dans l'application (au chargement du
 * tableau de bord), pas envoyée à distance.
 */
async function loadDeliveryAlerts() {
  const container = document.getElementById("delivery-alerts");
  const today = new Date();
  const windowEnd = new Date();
  windowEnd.setDate(today.getDate() + ALERT_WINDOW_DAYS);

  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, garment_description, due_date, clients(full_name)")
    .in("status", ["pending", "in_progress", "ready"])
    .lte("due_date", windowEnd.toISOString().slice(0, 10))
    .order("due_date", { ascending: true });

  if (error || !data || !data.length) {
    container.innerHTML = "";
    return;
  }

  const todayStr = today.toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="alert-banner">
      <div class="alert-banner-title">⚠️ ${data.length} commande(s) à surveiller (livraison proche ou dépassée)</div>
      ${data
        .map((o) => {
          const isLate = o.due_date < todayStr;
          return `
        <div class="alert-item">
          <span>${escapeHtml(o.clients?.full_name || "—")} — ${escapeHtml(o.garment_description)} (${escapeHtml(o.order_number)})</span>
          <span>
            <a class="link-plain" href="order-detail.html?id=${o.id}">${isLate ? "En retard depuis" : "À remettre le"} ${formatDate(o.due_date)}</a>
          </span>
        </div>`;
        })
        .join("")}
    </div>
  `;
}

/** Liste des commandes les plus récentes, tous statuts confondus. */
async function loadRecentOrders() {
  const tableBody = document.getElementById("recent-orders-table-body");

  const { data, error } = await supabase
    .from("orders")
    .select("id, garment_description, due_date, status, delivered_at, clients(full_name)")
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);

  if (error) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-danger);">Erreur de chargement.</td></tr>`;
    console.error(error);
    return;
  }

  if (!data || !data.length) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-text-muted);">Aucune commande pour le moment.</td></tr>`;
    return;
  }

  tableBody.innerHTML = data
    .map(
      (o) => `
    <tr class="clickable-row" data-id="${o.id}">
      <td data-label="Client">${escapeHtml(o.clients?.full_name || "—")}</td>
      <td data-label="Vêtement">${escapeHtml(o.garment_description)}</td>
      <td data-label="Échéance">${formatDate(o.due_date)}</td>
      <td data-label="Statut">${orderStatusBadge(o)}</td>
    </tr>`
    )
    .join("");

  tableBody.querySelectorAll(".clickable-row").forEach((row) => {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      window.location.href = `order-detail.html?id=${row.dataset.id}`;
    });
  });
}

/** Liste des clients ajoutés le plus récemment. */
async function loadRecentClients() {
  const tableBody = document.getElementById("recent-clients-table-body");

  const { data, error } = await supabase
    .from("clients")
    .select("id, full_name, phone, created_at")
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);

  if (error) {
    tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--color-danger);">Erreur de chargement.</td></tr>`;
    console.error(error);
    return;
  }

  if (!data || !data.length) {
    tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--color-text-muted);">Aucun client pour le moment.</td></tr>`;
    return;
  }

  tableBody.innerHTML = data
    .map(
      (c) => `
    <tr class="clickable-row" data-id="${c.id}">
      <td data-label="Nom">${escapeHtml(c.full_name)}</td>
      <td data-label="Téléphone">${escapeHtml(c.phone)}</td>
      <td data-label="Ajouté le">${formatDate(c.created_at)}</td>
    </tr>`
    )
    .join("");

  tableBody.querySelectorAll(".clickable-row").forEach((row) => {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      window.location.href = `client-detail.html?id=${row.dataset.id}`;
    });
  });
}
