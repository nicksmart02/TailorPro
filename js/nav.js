// =============================================================
// TAILORFLOW — Navigation partagée (rendue selon le rôle)
// =============================================================
import { logout } from "./auth.js";

/**
 * Injecte la barre de navigation dans l'élément #app-nav.
 * @param {object} profile - profil courant {full_name, role}
 * @param {string} activePage - clé de la page active pour le style
 */
const PLATFORM_OWNER_EMAIL = "jahadjitse@gmail.com";

export function renderNav(profile, activePage) {
  const nav = document.getElementById("app-nav");
  if (!nav) return;

  const isPlatformOwner = profile.email === PLATFORM_OWNER_EMAIL;

  const links = [
    { key: "dashboard", href: "dashboard.html", label: "Tableau de bord", show: true },
    { key: "clients", href: "clients.html", label: "Clients", show: true },
    { key: "orders", href: "orders.html", label: "Commandes", show: true },
    { key: "invoices", href: "invoices.html", label: "Facturation", show: true },
    { key: "reports", href: "reports.html", label: "Rapports", show: true },
    { key: "settings", href: "settings.html", label: "Paramètres", show: isPlatformOwner },
  ];

  const visibleLinks = links.filter((l) => l.show);

  nav.innerHTML = `
    <div class="nav-brand">TailorFlow</div>
    <button class="nav-toggle" id="nav-toggle" aria-label="Ouvrir le menu" aria-expanded="false">☰</button>
    <div class="nav-collapsible" id="nav-collapsible">
      <ul class="nav-links">
        ${visibleLinks
          .map(
            (l) => `
          <li>
            <a href="${l.href}" class="${l.key === activePage ? "active" : ""}">${l.label}</a>
          </li>`
          )
          .join("")}
      </ul>
      <div class="nav-user">
        <span class="nav-user-name">${escapeHtml(profile.full_name)}</span>
        <span class="nav-user-role">${roleLabel(profile.role)}</span>
        <button id="logout-btn" class="btn-logout">Déconnexion</button>
      </div>
    </div>
  `;

  document.getElementById("logout-btn").addEventListener("click", logout);

  const toggleBtn = document.getElementById("nav-toggle");
  const collapsible = document.getElementById("nav-collapsible");

  toggleBtn.addEventListener("click", () => {
    const isOpen = collapsible.classList.toggle("nav-open");
    toggleBtn.setAttribute("aria-expanded", String(isOpen));
    toggleBtn.textContent = isOpen ? "✕" : "☰";
  });

  // Ferme le menu automatiquement après avoir tapé sur un lien (mobile)
  collapsible.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      collapsible.classList.remove("nav-open");
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.textContent = "☰";
    });
  });

  // Si l'utilisateur agrandit la fenêtre au-delà du seuil mobile, on réinitialise l'état
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) {
      collapsible.classList.remove("nav-open");
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.textContent = "☰";
    }
  });
}

function roleLabel(role) {
  const labels = { admin: "Administrateur", employee: "Employé", accountant: "Comptable" };
  return labels[role] || role;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
