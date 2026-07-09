// =============================================================
// TAILORFLOW — Navigation partagée (rendue selon le rôle)
// =============================================================
import { logout } from "./auth.js";

/**
 * Injecte la barre de navigation dans l'élément #app-nav.
 * @param {object} profile - profil courant {full_name, role}
 * @param {string} activePage - clé de la page active pour le style
 */
export function renderNav(profile, activePage) {
  const nav = document.getElementById("app-nav");
  if (!nav) return;

  const links = [
    { key: "dashboard", href: "dashboard.html", label: "Tableau de bord", roles: ["admin", "employee", "accountant"] },
    { key: "clients", href: "clients.html", label: "Clients", roles: ["admin", "employee", "accountant"] },
    { key: "orders", href: "orders.html", label: "Commandes", roles: ["admin", "employee", "accountant"] },
    { key: "invoices", href: "invoices.html", label: "Facturation", roles: ["admin", "employee", "accountant"] },
    { key: "reports", href: "reports.html", label: "Rapports", roles: ["admin", "accountant"] },
    { key: "settings", href: "settings.html", label: "Paramètres", roles: ["admin"] },
  ];

  const visibleLinks = links.filter((l) => l.roles.includes(profile.role));

  nav.innerHTML = `
    <div class="nav-brand">TailorFlow</div>
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
  `;

  document.getElementById("logout-btn").addEventListener("click", logout);
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
