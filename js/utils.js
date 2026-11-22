// =============================================================
// TAILORFLOW — Utilitaires partagés
// =============================================================
import { CURRENCY, DEFAULT_COUNTRY_CODE } from "./config.js";

// ---------------------------------------------------------------
// Formatage
// ---------------------------------------------------------------

/** Formate un montant : « 15 000 FCFA ». */
export function formatMoney(amount) {
  const value = Number(amount || 0);
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " " + CURRENCY;
}

/** Formate une date ISO (ou AAAA-MM-JJ) en JJ/MM/AAAA, sans décalage de fuseau. */
export function formatDate(isoString) {
  if (!isoString) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoString) ? new Date(isoString + "T00:00:00") : new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR");
}

/** Formate une date + heure ISO. */
export function formatDateTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Date locale du jour au format AAAA-MM-JJ (pas de décalage UTC). */
export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Premier jour du mois courant à minuit (heure locale), en ISO. */
export function startOfMonthISO() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/** Nombre de jours entiers restants jusqu'à une date (arrondi au supérieur, min 0). */
export function daysUntil(isoString) {
  if (!isoString) return 0;
  return Math.max(0, Math.ceil((new Date(isoString) - new Date()) / 86400000));
}

// ---------------------------------------------------------------
// Sécurité / saisie
// ---------------------------------------------------------------

/** Échappe le HTML pour éviter les injections XSS lors de l'affichage de données. */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Nettoie un terme de recherche avant de l'insérer dans un filtre PostgREST
 * (les virgules, parenthèses, etc. casseraient la syntaxe de .or()).
 */
export function sanitizeSearchTerm(term) {
  return String(term || "")
    .replace(/[,()*%\\:"'.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** Anti-rebond simple pour les champs de recherche. */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Chiffres uniquement d'un numéro de téléphone. */
export function phoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/** Lien tel: cliquable (ou null si numéro vide). */
export function telHref(phone) {
  const digits = phoneDigits(phone);
  return digits ? `tel:${digits}` : null;
}

/** Lien WhatsApp (wa.me) avec message pré-rempli, indicatif ajouté si absent. */
export function whatsappHref(phone, message = "") {
  let digits = phoneDigits(phone);
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length <= 9) digits = DEFAULT_COUNTRY_CODE + digits;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${text}`;
}

// ---------------------------------------------------------------
// Erreurs base de données → messages lisibles
// ---------------------------------------------------------------

const DB_ERROR_MESSAGES = {
  FACTURE_NON_REGLEE: "Facture non réglée",
  PAIEMENT_SUPERIEUR_AU_SOLDE: "Le montant dépasse le solde restant de la facture.",
  TOTAL_INFERIEUR_AU_PAYE: "Le nouveau total est inférieur au montant déjà payé.",
  COMMANDE_DEJA_REMISE: "Cette commande a déjà été remise : elle ne peut plus être modifiée.",
  COMMANDE_VERROUILLEE: "Le prix d'une commande remise ou annulée ne peut plus être modifié.",
  COMMANDE_ANNULEE: "Cette commande est annulée : aucun paiement ne peut être enregistré.",
  CLIENT_NON_MODIFIABLE: "Le client d'une commande ne peut pas être changé.",
  MESURE_INVALIDE: "La fiche de mesure choisie n'appartient pas à ce client.",
  ARTICLE_REQUIS: "Choisis un article du catalogue.",
  ARTICLE_INDISPONIBLE: "Cet article n'est plus disponible.",
  CLIENT_INTROUVABLE: "Client introuvable.",
  DEMANDE_DEJA_EN_ATTENTE: "Tu as déjà une demande de paiement en attente de validation.",
  DEMANDE_INTROUVABLE: "Cette demande a déjà été traitée.",
  FICHE_DEJA_LIEE: "Cette fiche client est déjà liée à un autre compte.",
  CODE_INVALIDE: "Code d'invitation invalide ou déjà utilisé.",
  COMPTE_COUTURIER: "Ce compte est un compte couturier : utilise une autre adresse email pour ton espace client.",
  TELEPHONE_INVALIDE: "Numéro de téléphone invalide (8 chiffres minimum).",
  ROLE_DEJA_ATTRIBUE: "Ton espace est déjà configuré.",
  MODIFICATION_INTERDITE: "Cette modification n'est pas autorisée.",
  NON_AUTORISE: "Action non autorisée.",
  FORMULE_INCONNUE: "Formule d'abonnement inconnue.",
  QUANTITE_INVALIDE: "La quantité doit être au moins égale à 1.",
  PRIX_INVALIDE: "Le prix doit être positif.",
  PAIEMENT_INVALIDE: "Le montant payé ne peut pas être négatif.",
};

/**
 * Traduit une erreur Supabase/PostgREST en message français.
 * @param {object} error - erreur renvoyée par supabase-js
 * @param {string} fallback - message par défaut
 */
export function mapDbError(error, fallback = "Une erreur est survenue. Réessaie.") {
  if (!error) return fallback;
  const raw = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
  for (const [code, message] of Object.entries(DB_ERROR_MESSAGES)) {
    if (raw.includes(code)) return message;
  }
  if (error.code === "42501" || raw.includes("row-level security")) {
    return "Action refusée : vérifie que ton abonnement est actif.";
  }
  if (error.code === "23505") return "Cet élément existe déjà.";
  if (error.code === "23503") return "Impossible : cet élément est utilisé ailleurs (commandes, factures…).";
  if (raw.includes("Failed to fetch") || raw.includes("NetworkError")) {
    return "Connexion impossible. Vérifie ta connexion internet.";
  }
  return fallback;
}

/** Vrai si l'erreur indique qu'une fonction RPC ou une colonne n'existe pas encore (migration non appliquée). */
export function isSchemaOutdatedError(error) {
  if (!error) return false;
  const raw = `${error.code || ""} ${error.message || ""}`;
  return (
    raw.includes("PGRST202") ||
    raw.includes("PGRST204") ||
    raw.includes("42703") ||
    raw.includes("42883") ||
    raw.includes("Could not find the function")
  );
}

// ---------------------------------------------------------------
// Statuts
// ---------------------------------------------------------------

export const ORDER_STATUS_LABELS = {
  pending: "En attente",
  in_progress: "En cours",
  ready: "Prêt",
  delivered: "Remis",
  cancelled: "Annulé",
};

/** Détermine si une commande est en retard. */
export function isOrderLate(order) {
  if (!order.due_date || order.status === "delivered" || order.status === "cancelled") return false;
  return order.due_date < todayISO();
}

export function orderStatusBadge(order) {
  const late = isOrderLate(order);
  const label = late ? "En retard" : ORDER_STATUS_LABELS[order.status] || order.status;
  const cls = late ? "badge-late" : `badge-${order.status}`;
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

export const INVOICE_STATUS_LABELS = {
  unpaid: "Impayée",
  partial: "Partiellement payée",
  paid: "Payée",
};

export function invoiceStatusBadge(status) {
  return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(INVOICE_STATUS_LABELS[status] || status)}</span>`;
}

export const PAYMENT_METHOD_LABELS = {
  cash: "Espèces",
  mobile_money: "Mobile Money",
  bank_transfer: "Virement bancaire",
  card: "Carte",
};

// ---------------------------------------------------------------
// Mesures
// ---------------------------------------------------------------

function prettifyKey(key) {
  const s = String(key || "").replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Libellé lisible du type de vêtement d'une fiche de mesure.
 * Priorité : instantané enregistré avec la mesure, puis types de l'atelier, puis clé brute.
 */
export function measurementGarmentLabel(m, garmentTypes = []) {
  return m.garment_label || garmentTypes.find((g) => g.key === m.garment_type)?.label || prettifyKey(m.garment_type);
}

/** Lignes {label, value, unit} d'une fiche de mesure, dans l'ordre des champs du type. */
export function measurementRows(m, garmentTypes = []) {
  const values = m.values || {};
  const meta = m.field_meta || {};
  const typeFields = garmentTypes.find((g) => g.key === m.garment_type)?.fields || [];
  const orderedKeys = [
    ...typeFields.map((f) => f.key).filter((k) => k in values),
    ...Object.keys(values).filter((k) => !typeFields.some((f) => f.key === k)),
  ];
  return orderedKeys.map((key) => {
    const fromType = typeFields.find((f) => f.key === key);
    return {
      label: meta[key]?.label || fromType?.label || prettifyKey(key),
      unit: meta[key]?.unit ?? fromType?.unit ?? "cm",
      value: values[key],
    };
  });
}

/** HTML <dt>/<dd> d'une fiche de mesure (à placer dans un <dl class="kv-list">). */
export function measurementKvHtml(m, garmentTypes = []) {
  const rows = measurementRows(m, garmentTypes);
  if (!rows.length) return `<dt>Mesures</dt><dd>—</dd>`;
  return rows
    .map((r) => `<dt>${escapeHtml(r.label)}</dt><dd>${escapeHtml(r.value)}${r.unit ? " " + escapeHtml(r.unit) : ""}</dd>`)
    .join("");
}

// ---------------------------------------------------------------
// Interface
// ---------------------------------------------------------------

/** Affiche une notification temporaire (lue par les lecteurs d'écran). */
export function showToast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), type === "error" ? 6000 : 4000);
}

/** Met un bouton en état de chargement (désactivé + libellé temporaire). */
export function setButtonLoading(button, loading, loadingLabel = "Enregistrement...") {
  if (!button) return;
  if (loading) {
    button.dataset.originalLabel = button.dataset.originalLabel || button.textContent;
    button.textContent = loadingLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
  }
}

/** Ligne de tableau « message » (chargement, vide, erreur). */
export function tableMessageRow(colspan, message, type = "muted") {
  return `<tr class="table-message-row"><td colspan="${colspan}" class="table-message table-message-${type}">${escapeHtml(message)}</td></tr>`;
}

/** Rend cliquables (souris + clavier) les lignes <tr class="clickable-row" data-href="..."> d'un tableau. */
export function bindClickableRows(container) {
  container.querySelectorAll(".clickable-row[data-href]").forEach((row) => {
    const go = () => (window.location.href = row.dataset.href);
    row.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      go();
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });
  });
}

let modalKeyboardBound = false;

/** Ouvre une modale (élément #id déjà présent dans le DOM). */
export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add("modal-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-active");

  if (!modal.dataset.backdropBound) {
    modal.addEventListener("mousedown", (e) => {
      if (e.target === modal) closeModal(id);
    });
    modal.dataset.backdropBound = "1";
  }
  if (!modalKeyboardBound) {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const open = document.querySelectorAll(".modal-backdrop.modal-open");
      if (open.length) closeModal(open[open.length - 1].id);
    });
    modalKeyboardBound = true;
  }

  const firstField = modal.querySelector("input:not([type=hidden]):not([disabled]), select, textarea");
  if (firstField) setTimeout(() => firstField.focus(), 50);
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("modal-open");
  modal.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".modal-backdrop.modal-open")) {
    document.body.classList.remove("modal-active");
  }
}

/** Copie un texte dans le presse-papiers et affiche une confirmation. */
export async function copyToClipboard(text, successMessage = "Copié dans le presse-papiers.") {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage, "success");
  } catch {
    window.prompt("Copie ce texte :", text);
  }
}
