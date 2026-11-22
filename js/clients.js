// =============================================================
// TAILORFLOW — Clients (liste, recherche, création)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import {
  debounce, escapeHtml, formatDate, showToast, openModal, closeModal, sanitizeSearchTerm,
  mapDbError, setButtonLoading, tableMessageRow, bindClickableRows,
} from "./utils.js";

const PAGE_SIZE = 15;
let currentPage = 0;
let currentSearch = "";
let currentProfile = null;

const tableBody = document.getElementById("clients-table-body");
const paginationInfo = document.getElementById("pagination-info");
const prevBtn = document.getElementById("prev-page");
const nextBtn = document.getElementById("next-page");
const searchInput = document.getElementById("search-input");
const clientForm = document.getElementById("client-form");
const formError = document.getElementById("client-form-error");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "clients");

  await loadClients();

  searchInput.addEventListener(
    "input",
    debounce(() => {
      currentSearch = sanitizeSearchTerm(searchInput.value);
      currentPage = 0;
      loadClients();
    }, 300)
  );

  prevBtn.addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage--;
      loadClients();
    }
  });
  nextBtn.addEventListener("click", () => {
    currentPage++;
    loadClients();
  });

  document.getElementById("new-client-btn").addEventListener("click", openNewClientModal);
  document.getElementById("close-client-modal").addEventListener("click", () => closeModal("client-modal"));
  document.getElementById("cancel-client-form").addEventListener("click", () => closeModal("client-modal"));
  clientForm.addEventListener("submit", handleCreateClient);

  if (new URLSearchParams(window.location.search).get("new") === "1") openNewClientModal();
}

function openNewClientModal() {
  clientForm.reset();
  formError.textContent = "";
  openModal("client-modal");
}

async function loadClients() {
  tableBody.innerHTML = tableMessageRow(5, "Chargement...");

  const from = currentPage * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("clients")
    .select("id, full_name, phone, email, created_at, user_id", { count: "exact" })
    .order("full_name", { ascending: true })
    .range(from, to);

  if (currentSearch) {
    query = query.or(`full_name.ilike.%${currentSearch}%,phone.ilike.%${currentSearch}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    tableBody.innerHTML = tableMessageRow(5, "Erreur de chargement.", "error");
    console.error(error);
    return;
  }

  if (!data.length) {
    tableBody.innerHTML = tableMessageRow(
      5,
      currentSearch ? "Aucun client ne correspond à ta recherche." : "Aucun client pour le moment. Ajoute ton premier client !"
    );
  } else {
    tableBody.innerHTML = data
      .map(
        (c) => `
      <tr class="clickable-row" data-href="client-detail.html?id=${c.id}" tabindex="0">
        <td data-label="Nom"><strong>${escapeHtml(c.full_name)}</strong></td>
        <td data-label="Téléphone">${escapeHtml(c.phone)}</td>
        <td data-label="Email">${escapeHtml(c.email || "—")}</td>
        <td data-label="Espace en ligne">${c.user_id ? '<span class="badge badge-delivered">Activé</span>' : '<span class="text-muted">—</span>'}</td>
        <td data-label="Client depuis">${formatDate(c.created_at)}</td>
      </tr>`
      )
      .join("");
    bindClickableRows(tableBody);
  }

  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  paginationInfo.textContent = `Page ${currentPage + 1} / ${totalPages} · ${total} client${total > 1 ? "s" : ""}`;
  prevBtn.disabled = currentPage === 0;
  nextBtn.disabled = currentPage >= totalPages - 1;
}

async function handleCreateClient(e) {
  e.preventDefault();
  formError.textContent = "";

  const submitBtn = clientForm.querySelector("button[type=submit]");
  setButtonLoading(submitBtn, true);

  const payload = {
    full_name: clientForm.full_name.value.trim(),
    phone: clientForm.phone.value.trim(),
    email: clientForm.email.value.trim() || null,
    address: clientForm.address.value.trim() || null,
    notes: clientForm.notes.value.trim() || null,
    created_by: currentProfile.id,
  };

  const { data, error } = await supabase.from("clients").insert(payload).select("id").single();
  setButtonLoading(submitBtn, false);

  if (error) {
    formError.textContent =
      error.code === "23505" ? "Tu as déjà un client avec ce numéro de téléphone." : mapDbError(error, "Erreur lors de la création du client.");
    console.error(error);
    return;
  }

  closeModal("client-modal");
  showToast("Client créé. Ajoute maintenant ses mesures.", "success");
  window.location.href = `client-detail.html?id=${data.id}`;
}
