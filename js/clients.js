// =============================================================
// TAILORFLOW — Module Clients (liste)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { debounce, escapeHtml, formatDate, showToast, openModal, closeModal } from "./utils.js";

const PAGE_SIZE = 10;
let currentPage = 0;
let currentSearch = "";
let currentProfile = null;

const tableBody = document.getElementById("clients-table-body");
const paginationInfo = document.getElementById("pagination-info");
const prevBtn = document.getElementById("prev-page");
const nextBtn = document.getElementById("next-page");
const searchInput = document.getElementById("search-input");
const newClientBtn = document.getElementById("new-client-btn");
const clientForm = document.getElementById("client-form");
const formError = document.getElementById("client-form-error");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "clients");

  await loadClients();

  searchInput.addEventListener("input", debounce(() => {
    currentSearch = searchInput.value.trim();
    currentPage = 0;
    loadClients();
  }, 300));

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

  newClientBtn.addEventListener("click", () => {
    clientForm.reset();
    formError.textContent = "";
    openModal("client-modal");
  });

  document.getElementById("close-client-modal").addEventListener("click", () => closeModal("client-modal"));
  document.getElementById("cancel-client-form").addEventListener("click", () => closeModal("client-modal"));

  clientForm.addEventListener("submit", handleCreateClient);
}

async function loadClients() {
  tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-text-muted);">Chargement...</td></tr>`;

  const from = currentPage * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("clients")
    .select("id, full_name, phone, email, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (currentSearch) {
    query = query.or(`full_name.ilike.%${currentSearch}%,phone.ilike.%${currentSearch}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-danger);">Erreur de chargement.</td></tr>`;
    console.error(error);
    return;
  }

  if (!data.length) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-text-muted);">Aucun client trouvé.</td></tr>`;
  } else {
    tableBody.innerHTML = data
      .map(
        (c) => `
      <tr class="client-row" data-id="${c.id}" style="cursor:pointer;">
        <td data-label="Nom">${escapeHtml(c.full_name)}</td>
        <td data-label="Téléphone">${escapeHtml(c.phone)}</td>
        <td data-label="Email">${escapeHtml(c.email || "—")}</td>
        <td data-label="Client depuis">${formatDate(c.created_at)}</td>
      </tr>`
      )
      .join("");

    document.querySelectorAll(".client-row").forEach((row) => {
      row.addEventListener("click", () => {
        window.location.href = `client-detail.html?id=${row.dataset.id}`;
      });
    });
  }

  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  paginationInfo.textContent = `Page ${currentPage + 1} / ${totalPages} (${total} client${total > 1 ? "s" : ""})`;
  prevBtn.disabled = currentPage === 0;
  nextBtn.disabled = currentPage >= totalPages - 1;
}

async function handleCreateClient(e) {
  e.preventDefault();
  formError.textContent = "";

  const submitBtn = clientForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const payload = {
    full_name: clientForm.full_name.value.trim(),
    phone: clientForm.phone.value.trim(),
    email: clientForm.email.value.trim() || null,
    address: clientForm.address.value.trim() || null,
    notes: clientForm.notes.value.trim() || null,
    created_by: currentProfile.id,
  };

  const { error } = await supabase.from("clients").insert(payload);

  submitBtn.disabled = false;

  if (error) {
    if (error.code === "23505") {
      formError.textContent = "Un client avec ce numéro de téléphone existe déjà.";
    } else {
      formError.textContent = "Erreur lors de la création du client.";
      console.error(error);
    }
    return;
  }

  closeModal("client-modal");
  showToast("Client créé avec succès.", "success");
  currentPage = 0;
  await loadClients();
}
