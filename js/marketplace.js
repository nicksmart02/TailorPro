// =============================================================
// TAILORFLOW — Marketplace : catalogues des couturiers + commande à distance
// =============================================================
import { supabase } from "./supabaseClient.js";
import { logout, fetchCurrentProfile } from "./auth.js";
import { escapeHtml, formatMoney, showToast, openModal, closeModal } from "./utils.js";

let currentProfile = null;
let allItems = []; // articles de catalogue chargés, avec établissement et lien client éventuel
let linkedClientByOwner = {}; // { owner_id: { id: clientRowId } } — établissements où le client est déjà rattaché
let selectedItem = null;

const container = document.getElementById("marketplace-container");
const searchInput = document.getElementById("search-input");

init();

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  currentProfile = await fetchCurrentProfile().catch(() => null);
  if (!currentProfile) {
    window.location.href = "login.html";
    return;
  }
  if (currentProfile.role === "pending") {
    window.location.href = "choose-role.html";
    return;
  }

  document.getElementById("logout-btn").addEventListener("click", logout);

  // Un couturier qui consulte la marketplace revient à son tableau de bord.
  if (currentProfile.role !== "client") {
    document.getElementById("back-to-portal-link").href = "dashboard.html";
    document.getElementById("back-to-portal-link").textContent = "← Tableau de bord";
  }

  if (currentProfile.role === "client") {
    await loadLinkedEstablishments();
  }

  await loadCatalog();

  searchInput.addEventListener("input", renderCatalog);
  document.getElementById("close-order-modal").addEventListener("click", () => closeModal("order-modal"));
  document.getElementById("cancel-order-form").addEventListener("click", () => closeModal("order-modal"));
  document.getElementById("remote-order-form").addEventListener("submit", handleSubmitOrder);
  document.getElementById("order-quantity").addEventListener("input", updateOrderTotalPreview);
}

/** Récupère les fiches client du client connecté, pour savoir chez qui il peut commander. */
async function loadLinkedEstablishments() {
  const { data } = await supabase.from("clients").select("id, owner_id");
  linkedClientByOwner = Object.fromEntries((data || []).map((c) => [c.owner_id, c]));
}

async function loadCatalog() {
  const { data, error } = await supabase
    .from("catalog_items")
    .select("id, name, description, price, photo_url, owner_id, profiles:owner_id ( full_name, establishment_name )")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    container.innerHTML = `<p class="error-message">Erreur de chargement du catalogue.</p>`;
    console.error(error);
    return;
  }

  allItems = data || [];
  renderCatalog();
}

function renderCatalog() {
  const search = searchInput.value.trim().toLowerCase();

  const filtered = allItems.filter((item) => {
    const establishmentName = item.profiles?.establishment_name || item.profiles?.full_name || "";
    return (
      !search ||
      item.name.toLowerCase().includes(search) ||
      establishmentName.toLowerCase().includes(search)
    );
  });

  if (!filtered.length) {
    container.innerHTML = `<p style="color:var(--color-text-muted);">Aucun article de catalogue trouvé pour le moment.</p>`;
    return;
  }

  // Regroupement par établissement (owner_id)
  const groups = {};
  for (const item of filtered) {
    if (!groups[item.owner_id]) {
      groups[item.owner_id] = {
        label: item.profiles?.establishment_name || item.profiles?.full_name || "Atelier",
        items: [],
      };
    }
    groups[item.owner_id].items.push(item);
  }

  const params = new URLSearchParams(window.location.search);
  const focusOwner = params.get("owner");

  container.innerHTML = Object.entries(groups)
    .sort(([ownerIdA], [ownerIdB]) => (ownerIdA === focusOwner ? -1 : ownerIdB === focusOwner ? 1 : 0))
    .map(([ownerId, group]) => {
      const isLinked = currentProfile.role === "client" && !!linkedClientByOwner[ownerId];
      return `
      <div class="establishment-section">
        <div class="establishment-header">
          <h2 style="margin:0;">${escapeHtml(group.label)}</h2>
          ${
            currentProfile.role === "client"
              ? isLinked
                ? `<span class="establishment-linked-badge">Tu es déjà client ici</span>`
                : `<span style="color:var(--color-text-muted); font-size:0.82rem;">Deviens client chez ce couturier pour commander à distance</span>`
              : ""
          }
        </div>
        <div class="catalog-grid">
          ${group.items
            .map(
              (item) => `
            <div class="catalog-card">
              ${
                item.photo_url
                  ? `<img class="catalog-card-photo" src="${escapeHtml(item.photo_url)}" alt="${escapeHtml(item.name)}" />`
                  : `<div class="catalog-card-photo-placeholder">✂️</div>`
              }
              <div class="catalog-card-body">
                <strong>${escapeHtml(item.name)}</strong>
                ${item.description ? `<span style="font-size:0.82rem; color:var(--color-text-muted);">${escapeHtml(item.description)}</span>` : ""}
                <span class="catalog-card-price">${formatMoney(item.price)}</span>
                ${
                  isLinked
                    ? `<button class="btn btn-primary order-item-btn" data-item-id="${item.id}" style="margin-top:8px;">Commander</button>`
                    : ""
                }
              </div>
            </div>`
            )
            .join("")}
        </div>
      </div>`;
    })
    .join("");

  container.querySelectorAll(".order-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => openOrderModal(btn.dataset.itemId));
  });
}

async function openOrderModal(itemId) {
  selectedItem = allItems.find((i) => i.id === itemId);
  if (!selectedItem) return;

  const clientRow = linkedClientByOwner[selectedItem.owner_id];
  const establishmentLabel = selectedItem.profiles?.establishment_name || selectedItem.profiles?.full_name || "cet atelier";

  document.getElementById("order-modal-title").textContent = `Commander chez ${establishmentLabel}`;
  document.getElementById("order-item-summary").innerHTML = `
    <strong>${escapeHtml(selectedItem.name)}</strong><br/>
    <span style="color:var(--color-text-muted); font-size:0.85rem;">${escapeHtml(selectedItem.description || "")}</span><br/>
    <span class="catalog-card-price">${formatMoney(selectedItem.price)} / unité</span>
  `;

  document.getElementById("remote-order-form").reset();
  document.getElementById("order-form-error").textContent = "";

  const measurementSelect = document.getElementById("order-measurement");
  measurementSelect.innerHTML = `<option value="">Chargement...</option>`;

  const { data: measurements } = await supabase
    .from("measurements")
    .select("id, garment_type, version, created_at")
    .eq("client_id", clientRow.id)
    .order("version", { ascending: false });

  if (!measurements || !measurements.length) {
    measurementSelect.innerHTML = `<option value="">Aucune mesure disponible</option>`;
  } else {
    measurementSelect.innerHTML = measurements
      .map((m) => `<option value="${m.id}">${escapeHtml(m.garment_type)} — v${m.version}</option>`)
      .join("");
  }

  updateOrderTotalPreview();
  openModal("order-modal");
}

function updateOrderTotalPreview() {
  if (!selectedItem) return;
  const qty = parseInt(document.getElementById("order-quantity").value, 10) || 1;
  document.getElementById("order-total-preview").textContent = `Total : ${formatMoney(selectedItem.price * qty)}`;
}

async function handleSubmitOrder(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("order-form-error");
  errorEl.textContent = "";

  const clientRow = linkedClientByOwner[selectedItem.owner_id];
  const measurementId = form.measurement_id.value;

  if (!measurementId) {
    errorEl.textContent = "Sélectionne une fiche de mesure.";
    return;
  }

  const quantity = parseInt(form.quantity.value, 10) || 1;
  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  // Le prix unitaire/total est ré-imposé côté base de données par le catalogue
  // (trigger enforce_remote_order_pricing) : les valeurs ci-dessous sont
  // indicatives, jamais celles réellement retenues pour la commande.
  const { error } = await supabase.from("orders").insert({
    client_id: clientRow.id,
    measurement_id: measurementId,
    garment_description: selectedItem.name,
    catalog_item_id: selectedItem.id,
    quantity,
    unit_price: selectedItem.price,
    total_price: selectedItem.price * quantity,
    due_date: form.due_date.value,
    created_by: currentProfile.id,
  });

  submitBtn.disabled = false;

  if (error) {
    errorEl.textContent = "Erreur lors de la commande. Réessaie ou contacte ton couturier.";
    console.error(error);
    return;
  }

  closeModal("order-modal");
  showToast("Commande envoyée avec succès !", "success");
}
