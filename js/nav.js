// =============================================================
// TAILORFLOW — Barre de navigation (couturier et client)
// =============================================================
import { logout } from "./auth.js";
import { escapeHtml, daysUntil } from "./utils.js";
import { TRIAL_WARNING_DAYS } from "./config.js";

const ROLE_LABELS = {
  admin: "Administrateur",
  couturier: "Couturier",
  client: "Client",
  employee: "Couturier",
  accountant: "Couturier",
  pending: "Nouveau compte",
};

/**
 * Navigation de l'espace couturier.
 * @param {object} profile - profil enrichi par requireAuth()
 * @param {string} activePage - clé de la page active
 */
export function renderNav(profile, activePage) {
  const links = [
    { key: "dashboard", href: "dashboard.html", label: "Tableau de bord" },
    { key: "clients", href: "clients.html", label: "Clients" },
    { key: "orders", href: "orders.html", label: "Commandes" },
    { key: "invoices", href: "invoices.html", label: "Facturation" },
    { key: "reports", href: "reports.html", label: "Rapports" },
    { key: "garments", href: "garment-types.html", label: "Vêtements" },
    { key: "catalog", href: "catalog-manage.html", label: "Catalogue" },
    { key: "marketplace", href: "marketplace.html", label: "Marketplace" },
    { key: "subscription", href: "subscription.html", label: "Abonnement", hidden: profile.isPlatformOwner },
    { key: "settings", href: "settings.html", label: profile.isPlatformOwner ? "Administration" : "Paramètres" },
  ].filter((l) => !l.hidden);

  const sub = profile.subscription;
  let planBadge = "";
  if (!profile.isPlatformOwner && sub?.status === "trial") {
    const days = daysUntil(sub.trial_ends_at);
    const urgent = days <= TRIAL_WARNING_DAYS;
    planBadge = `<a class="nav-trial-badge ${urgent ? "nav-trial-badge-urgent" : ""}" href="subscription.html" title="Période d'essai">Essai : ${days} j</a>`;
  }

  mountNav({
    brand: profile.establishment_name,
    links,
    activePage,
    userName: profile.full_name,
    roleLabel: profile.isPlatformOwner ? "Propriétaire" : ROLE_LABELS[profile.role] || profile.role,
    extra: planBadge,
  });
}

/** Navigation du portail client (portail + marketplace). */
export function renderClientNav(profile, activePage) {
  mountNav({
    brand: "espace client",
    links: [
      { key: "portal", href: "client-portal.html", label: "Mon espace" },
      { key: "marketplace", href: "marketplace.html", label: "Découvrir des couturiers" },
    ],
    activePage,
    userName: profile.full_name,
    roleLabel: ROLE_LABELS.client,
    extra: "",
  });
}

function mountNav({ brand, links, activePage, userName, roleLabel, extra }) {
  const nav = document.getElementById("app-nav");
  if (!nav) return;

  const brandLabel = brand
    ? `TailorFlow <span class="nav-brand-establishment">${escapeHtml(brand)}</span>`
    : "TailorFlow";

  nav.innerHTML = `
    <a class="nav-brand" href="${links[0].href}">${brandLabel}</a>
    <button class="nav-toggle" id="nav-toggle" type="button" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="nav-collapsible">☰</button>
    <div class="nav-collapsible" id="nav-collapsible">
      <ul class="nav-links">
        ${links
          .map(
            (l) => `<li><a href="${l.href}" class="${l.key === activePage ? "active" : ""}" ${l.key === activePage ? 'aria-current="page"' : ""}>${escapeHtml(l.label)}</a></li>`
          )
          .join("")}
      </ul>
      <div class="nav-user">
        ${extra}
        <span class="nav-user-name">${escapeHtml(userName || "")}</span>
        <span class="nav-user-role">${escapeHtml(roleLabel || "")}</span>
        <button id="logout-btn" class="btn-logout" type="button">Déconnexion</button>
      </div>
    </div>
  `;

  document.getElementById("logout-btn").addEventListener("click", logout);

  const toggleBtn = document.getElementById("nav-toggle");
  const collapsible = document.getElementById("nav-collapsible");

  const setOpen = (open) => {
    collapsible.classList.toggle("nav-open", open);
    toggleBtn.setAttribute("aria-expanded", String(open));
    toggleBtn.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
    toggleBtn.textContent = open ? "✕" : "☰";
  };

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!collapsible.classList.contains("nav-open"));
  });
  collapsible.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setOpen(false)));
  document.addEventListener("click", (e) => {
    if (collapsible.classList.contains("nav-open") && !nav.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && collapsible.classList.contains("nav-open")) setOpen(false);
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1100) setOpen(false);
  });
}
