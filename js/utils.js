// =============================================================
// TAILORFLOW — Utilitaires partagés
// =============================================================

/** Formate un montant en devise (FCFA par défaut, ajustable). */
export function formatMoney(amount) {
  const value = Number(amount || 0);
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " FCFA";
}

/** Formate une date ISO en JJ/MM/AAAA. */
export function formatDate(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return d.toLocaleDateString("fr-FR");
}

/** Formate une date + heure ISO. */
export function formatDateTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Anti-rebond simple pour les champs de recherche. */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Echappe le HTML pour éviter les injections XSS lors de l'affichage de données. */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

/** Détermine si une commande est en retard. */
export function isOrderLate(order) {
  if (!order.due_date || order.status === "delivered" || order.status === "cancelled") return false;
  return new Date(order.due_date) < new Date(new Date().toDateString());
}

const STATUS_LABELS = {
  pending: "En attente",
  in_progress: "En cours",
  ready: "Prêt",
  delivered: "Remis",
  cancelled: "Annulé",
};

export function orderStatusBadge(order) {
  const late = isOrderLate(order);
  const label = late ? "En retard" : STATUS_LABELS[order.status] || order.status;
  const cls = late ? "badge-late" : `badge-${order.status}`;
  return `<span class="badge ${cls}">${label}</span>`;
}

const INVOICE_STATUS_LABELS = {
  unpaid: "Impayée",
  partial: "Partiellement payée",
  paid: "Payée",
};

export function invoiceStatusBadge(status) {
  return `<span class="badge badge-${status}">${INVOICE_STATUS_LABELS[status] || status}</span>`;
}

/** Affiche un toast de notification en bas à droite. */
export function showToast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = "position:fixed; bottom:20px; right:20px; display:flex; flex-direction:column; gap:8px; z-index:1000;";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  const colors = { info: "#2f5d8a", success: "#1f9d55", error: "#dc2626" };
  toast.style.cssText = `background:${colors[type] || colors.info}; color:#fff; padding:12px 18px; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15); font-size:0.9rem; max-width:320px;`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

/** Ouvre une modale générique (attend un élément #<id> déjà présent dans le DOM). */
export function openModal(id) {
  document.getElementById(id).classList.add("modal-open");
}

export function closeModal(id) {
  document.getElementById(id).classList.remove("modal-open");
}
