// =============================================================
// TAILORFLOW — Tableau de bord
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import {
  formatMoney, formatDate, escapeHtml, orderStatusBadge, todayISO, startOfMonthISO,
  daysUntil, showToast, mapDbError, tableMessageRow, telHref, bindClickableRows,
} from "./utils.js";
import { DELIVERY_ALERT_DAYS, TRIAL_WARNING_DAYS } from "./config.js";

const RECENT_LIMIT = 5;
let currentProfile = null;

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "dashboard");

  document.getElementById("dashboard-greeting").textContent =
    `Bonjour ${currentProfile.full_name || ""} — voici l'activité de ${currentProfile.establishment_name || "ton atelier"}.`;

  renderSubscriptionBanner();
  renderSetupHint();

  await Promise.all([
    loadKpis(),
    loadLinkRequests(),
    loadRemoteOrders(),
    loadDeliveryAlerts(),
    loadRecentOrders(),
    loadRecentClients(),
  ]);
}

/** Rappel de fin d'essai / d'abonnement. */
function renderSubscriptionBanner() {
  const sub = currentProfile.subscription;
  const el = document.getElementById("subscription-banner");
  if (!sub || currentProfile.isPlatformOwner) return;

  let html = "";
  if (sub.status === "trial") {
    const days = daysUntil(sub.trial_ends_at);
    if (days <= TRIAL_WARNING_DAYS) {
      html = `<span>Ton essai gratuit se termine dans <strong>${days} jour(s)</strong> (le ${formatDate(sub.trial_ends_at)}).</span>
        <a class="btn btn-primary btn-sm" href="subscription.html">Choisir une formule</a>`;
    }
  } else if (sub.status === "active") {
    const days = daysUntil(sub.current_period_end);
    if (days <= TRIAL_WARNING_DAYS) {
      html = `<span>Ton abonnement expire dans <strong>${days} jour(s)</strong> (le ${formatDate(sub.current_period_end)}).</span>
        <a class="btn btn-primary btn-sm" href="subscription.html">Renouveler</a>`;
    }
  }
  if (html) {
    el.innerHTML = `<div class="banner banner-warning">${html}</div>`;
  }
}

/** Invite à compléter les informations de l'atelier (affichées sur les reçus). */
function renderSetupHint() {
  if (currentProfile.establishment_name && currentProfile.establishment_phone) return;
  document.getElementById("setup-hint").innerHTML = `
    <div class="banner banner-info">
      <span>Complète le nom et le téléphone de ton atelier : ils apparaissent sur tes reçus et dans la marketplace.</span>
      <a class="btn btn-secondary btn-sm" href="settings.html">Compléter</a>
    </div>`;
}

async function loadKpis() {
  const today = todayISO();
  const monthStart = startOfMonthISO();

  const [inProgress, late, invoicesThisMonth, paymentsThisMonth, unpaid] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending", "in_progress", "ready"]),
    supabase.from("orders").select("id", { count: "exact", head: true }).lt("due_date", today).in("status", ["pending", "in_progress", "ready"]),
    supabase.from("invoices").select("amount_total, orders!inner(status)").gte("issued_at", monthStart).neq("orders.status", "cancelled"),
    supabase.from("payments").select("amount").gte("paid_at", monthStart),
    supabase.from("invoices").select("id, orders!inner(status)", { count: "exact", head: true }).in("status", ["unpaid", "partial"]).neq("orders.status", "cancelled"),
  ]);

  const revenue = (invoicesThisMonth.data || []).reduce((sum, inv) => sum + Number(inv.amount_total), 0);
  const cashed = (paymentsThisMonth.data || []).reduce((sum, p) => sum + Number(p.amount), 0);

  document.getElementById("kpi-in-progress").textContent = inProgress.count ?? "—";
  document.getElementById("kpi-late").textContent = late.count ?? "—";
  document.getElementById("kpi-revenue").textContent = invoicesThisMonth.error ? "—" : formatMoney(revenue);
  document.getElementById("kpi-cashed").textContent = paymentsThisMonth.error ? "—" : formatMoney(cashed);
  document.getElementById("kpi-unpaid").textContent = unpaid.count ?? "—";
}

/** Demandes de rattachement de clients (portail client) à valider. */
async function loadLinkRequests() {
  const container = document.getElementById("link-requests");
  const { data, error } = await supabase.rpc("pending_link_requests");
  if (error || !data?.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="card card-highlight">
      <h2 class="card-title">Demandes d'accès à l'espace client (${data.length})</h2>
      <p class="text-muted text-sm">Ces personnes ont créé un compte client avec un numéro enregistré chez toi.
        Valide uniquement si tu reconnais ton client : il verra ses mesures, commandes et factures.</p>
      <div class="list">
        ${data
          .map(
            (r) => `
          <div class="list-item" data-request="${r.request_id}">
            <div>
              <strong>${escapeHtml(r.requester_name)}</strong> (${escapeHtml(r.requester_phone || "—")})
              <div class="text-muted text-sm">souhaite accéder à la fiche
                <a class="link-plain" href="client-detail.html?id=${r.client_id}">${escapeHtml(r.client_name)}</a> — ${escapeHtml(r.client_phone)}</div>
            </div>
            <div class="list-item-actions">
              <button class="btn btn-primary btn-sm approve-link-btn" data-id="${r.request_id}">Valider</button>
              <button class="btn btn-secondary btn-sm reject-link-btn" data-id="${r.request_id}">Refuser</button>
            </div>
          </div>`
          )
          .join("")}
      </div>
    </div>`;

  container.querySelectorAll(".approve-link-btn").forEach((btn) =>
    btn.addEventListener("click", () => reviewLinkRequest(btn.dataset.id, true))
  );
  container.querySelectorAll(".reject-link-btn").forEach((btn) =>
    btn.addEventListener("click", () => reviewLinkRequest(btn.dataset.id, false))
  );
}

async function reviewLinkRequest(requestId, approve) {
  const fn = approve ? "approve_client_link" : "reject_client_link";
  const { error } = await supabase.rpc(fn, { p_request_id: requestId });
  if (error) {
    showToast(mapDbError(error), "error");
    return;
  }
  showToast(approve ? "Accès validé : le client voit maintenant son espace." : "Demande refusée.", "success");
  await loadLinkRequests();
}

/** Commandes passées à distance par des clients (marketplace), encore en attente. */
async function loadRemoteOrders() {
  const container = document.getElementById("remote-orders");
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, garment_description, quantity, total_price, due_date, created_at, clients(full_name, phone)")
    .not("catalog_item_id", "is", null)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !data?.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="card card-highlight">
      <h2 class="card-title">🛍️ Commandes reçues en ligne (${data.length})</h2>
      <div class="list">
        ${data
          .map((o) => {
            const tel = telHref(o.clients?.phone);
            return `
          <div class="list-item">
            <div>
              <strong>${escapeHtml(o.clients?.full_name || "—")}</strong> — ${escapeHtml(o.garment_description)} × ${o.quantity}
              <div class="text-muted text-sm">${escapeHtml(o.order_number)} · ${formatMoney(o.total_price)} · souhaitée pour le ${formatDate(o.due_date)}</div>
            </div>
            <div class="list-item-actions">
              ${tel ? `<a class="btn btn-secondary btn-sm" href="${tel}">Appeler</a>` : ""}
              <a class="btn btn-primary btn-sm" href="order-detail.html?id=${o.id}">Ouvrir</a>
            </div>
          </div>`;
          })
          .join("")}
      </div>
    </div>`;
}

/** Commandes à remettre bientôt ou déjà en retard. */
async function loadDeliveryAlerts() {
  const container = document.getElementById("delivery-alerts");
  const windowEnd = todayISO(DELIVERY_ALERT_DAYS);

  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, garment_description, due_date, status, clients(full_name)")
    .in("status", ["pending", "in_progress", "ready"])
    .lte("due_date", windowEnd)
    .order("due_date", { ascending: true });

  if (error || !data?.length) {
    container.innerHTML = "";
    return;
  }

  const today = todayISO();
  container.innerHTML = `
    <div class="alert-banner" role="region" aria-label="Alertes de livraison">
      <div class="alert-banner-title">⚠️ ${data.length} commande(s) à surveiller (remise proche ou dépassée)</div>
      ${data
        .map((o) => {
          const isLate = o.due_date < today;
          const isToday = o.due_date === today;
          const when = isLate ? `En retard depuis le ${formatDate(o.due_date)}` : isToday ? "À remettre aujourd'hui" : `À remettre le ${formatDate(o.due_date)}`;
          return `
        <div class="alert-item">
          <span>${escapeHtml(o.clients?.full_name || "—")} — ${escapeHtml(o.garment_description)} (${escapeHtml(o.order_number)})</span>
          <a class="link-plain ${isLate ? "text-danger" : ""}" href="order-detail.html?id=${o.id}">${when}</a>
        </div>`;
        })
        .join("")}
    </div>`;
}

async function loadRecentOrders() {
  const tableBody = document.getElementById("recent-orders-table-body");
  const { data, error } = await supabase
    .from("orders")
    .select("id, garment_description, due_date, status, clients(full_name)")
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);

  if (error) {
    tableBody.innerHTML = tableMessageRow(4, "Erreur de chargement.", "error");
    return;
  }
  if (!data.length) {
    tableBody.innerHTML = tableMessageRow(4, "Aucune commande pour le moment.");
    return;
  }

  tableBody.innerHTML = data
    .map(
      (o) => `
    <tr class="clickable-row" data-href="order-detail.html?id=${o.id}" tabindex="0">
      <td data-label="Client">${escapeHtml(o.clients?.full_name || "—")}</td>
      <td data-label="Vêtement">${escapeHtml(o.garment_description)}</td>
      <td data-label="Échéance">${formatDate(o.due_date)}</td>
      <td data-label="Statut">${orderStatusBadge(o)}</td>
    </tr>`
    )
    .join("");
  bindClickableRows(tableBody);
}

async function loadRecentClients() {
  const tableBody = document.getElementById("recent-clients-table-body");
  const { data, error } = await supabase
    .from("clients")
    .select("id, full_name, phone, created_at")
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);

  if (error) {
    tableBody.innerHTML = tableMessageRow(3, "Erreur de chargement.", "error");
    return;
  }
  if (!data.length) {
    tableBody.innerHTML = tableMessageRow(3, "Aucun client pour le moment.");
    return;
  }

  tableBody.innerHTML = data
    .map(
      (c) => `
    <tr class="clickable-row" data-href="client-detail.html?id=${c.id}" tabindex="0">
      <td data-label="Nom">${escapeHtml(c.full_name)}</td>
      <td data-label="Téléphone">${escapeHtml(c.phone)}</td>
      <td data-label="Ajouté le">${formatDate(c.created_at)}</td>
    </tr>`
    )
    .join("");
  bindClickableRows(tableBody);
}
