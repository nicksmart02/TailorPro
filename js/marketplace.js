// =============================================================
// TAILORFLOW — Marketplace : catalogues des ateliers + commande à distance
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAnyRole } from "./auth.js";
import { renderNav, renderClientNav } from "./nav.js";
import {
  escapeHtml, formatMoney, formatDate, showToast, openModal, closeModal, debounce, mapDbError, setButtonLoading,
  todayISO, telHref, whatsappHref, measurementGarmentLabel,
} from "./utils.js";

let currentProfile = null;
let isClient = false;
let allItems = [];
let establishments = {}; // owner_id -> { display_name, phone, address }
let linkedClientByOwner = {}; // owner_id -> fiche client du compte connecté
let selectedItem = null;

const container = document.getElementById("marketplace-container");
const searchInput = document.getElementById("search-input");

init();

async function init() {
  currentProfile = await requireAnyRole();
  if (!currentProfile) return;
  isClient = currentProfile.role === "client";

  if (isClient) renderClientNav(currentProfile, "marketplace");
  else renderNav(currentProfile, "marketplace");

  document.getElementById("marketplace-intro").textContent = isClient
    ? "Parcours les catalogues et commande à distance chez les ateliers où tu as déjà tes mesures."
    : "Aperçu de la marketplace telle que la voient les clients. Gère tes articles depuis « Catalogue ».";

  if (isClient) await loadLinkedEstablishments();
  await loadCatalog();

  searchInput.addEventListener("input", debounce(renderCatalog, 200));
  document.getElementById("close-order-modal").addEventListener("click", () => closeModal("order-modal"));
  document.getElementById("cancel-order-form").addEventListener("click", () => closeModal("order-modal"));
  document.getElementById("remote-order-form").addEventListener("submit", handleSubmitOrder);
  document.getElementById("order-quantity").addEventListener("input", updateOrderTotalPreview);
}

async function loadLinkedEstablishments() {
  const { data } = await supabase.from("clients").select("id, owner_id, full_name, phone").eq("user_id", currentProfile.id);
  linkedClientByOwner = Object.fromEntries((data || []).map((c) => [c.owner_id, c]));
}

async function loadCatalog() {
  const { data, error } = await supabase
    .from("catalog_items")
    .select("id, name, description, price, photo_url, owner_id, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    container.innerHTML = `<p class="error-message">Erreur de chargement du catalogue.</p>`;
    console.error(error);
    return;
  }
  allItems = data || [];

  const ownerIds = [...new Set(allItems.map((i) => i.owner_id))];
  if (ownerIds.length) {
    const { data: est } = await supabase.rpc("public_establishments", { p_ids: ownerIds });
    establishments = Object.fromEntries((est || []).map((e) => [e.id, e]));
  }
  renderCatalog();
}

function establishmentLabel(ownerId) {
  return establishments[ownerId]?.display_name || "Atelier";
}

function renderCatalog() {
  const search = searchInput.value.trim().toLowerCase();
  const filtered = allItems.filter((item) => {
    if (!establishments[item.owner_id]) return false; // atelier désactivé
    if (!search) return true;
    return [item.name, item.description, establishmentLabel(item.owner_id), establishments[item.owner_id]?.address]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(search));
  });

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">${search ? "Aucun article ne correspond à ta recherche." : "Aucun article en vitrine pour le moment."}</div>`;
    return;
  }

  const groups = {};
  for (const item of filtered) (groups[item.owner_id] ||= []).push(item);

  const focusOwner = new URLSearchParams(window.location.search).get("owner");
  const orderedOwners = Object.keys(groups).sort((a, b) => {
    if (a === focusOwner) return -1;
    if (b === focusOwner) return 1;
    const linkedA = Boolean(linkedClientByOwner[a]);
    const linkedB = Boolean(linkedClientByOwner[b]);
    if (linkedA !== linkedB) return linkedA ? -1 : 1;
    return establishmentLabel(a).localeCompare(establishmentLabel(b), "fr");
  });

  container.innerHTML = orderedOwners
    .map((ownerId) => {
      const est = establishments[ownerId] || {};
      const isLinked = isClient && Boolean(linkedClientByOwner[ownerId]);
      const isMine = !isClient && ownerId === currentProfile.id;
      const tel = telHref(est.phone);
      const wa = whatsappHref(est.phone, `Bonjour ${est.display_name || ""}, je vous contacte depuis TailorFlow.`);
      return `
      <section class="establishment-section" aria-label="${escapeHtml(est.display_name || "Atelier")}">
        <div class="establishment-header">
          <div>
            <h2>${escapeHtml(est.display_name || "Atelier")}
              ${isLinked ? '<span class="establishment-linked-badge">Tu es client ici</span>' : ""}
              ${isMine ? '<span class="establishment-linked-badge">Ton atelier</span>' : ""}
            </h2>
            ${est.address ? `<p class="text-muted text-sm">📍 ${escapeHtml(est.address)}</p>` : ""}
          </div>
          <div class="button-row">
            ${tel ? `<a class="btn btn-secondary btn-sm" href="${tel}">📞 Appeler</a>` : ""}
            ${wa ? `<a class="btn btn-secondary btn-sm" href="${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
          </div>
        </div>
        ${
          isClient && !isLinked
            ? `<p class="text-muted text-sm">Pour commander à distance chez cet atelier, fais d'abord prendre tes mesures sur place : l'atelier t'enregistrera comme client.</p>`
            : ""
        }
        <div class="catalog-grid">
          ${groups[ownerId]
            .map(
              (item) => `
            <article class="catalog-card">
              ${
                item.photo_url
                  ? `<img class="catalog-card-photo" src="${escapeHtml(item.photo_url)}" alt="${escapeHtml(item.name)}" loading="lazy" />`
                  : `<div class="catalog-card-photo-placeholder" aria-hidden="true">✂️</div>`
              }
              <div class="catalog-card-body">
                <strong>${escapeHtml(item.name)}</strong>
                ${item.description ? `<span class="text-muted text-sm">${escapeHtml(item.description)}</span>` : ""}
                <span class="catalog-card-price">${formatMoney(item.price)}</span>
                ${isLinked ? `<button class="btn btn-primary btn-sm order-item-btn" data-item-id="${item.id}" type="button">Commander</button>` : ""}
              </div>
            </article>`
            )
            .join("")}
        </div>
      </section>`;
    })
    .join("");

  container.querySelectorAll(".order-item-btn").forEach((btn) => btn.addEventListener("click", () => openOrderModal(btn.dataset.itemId)));
}

async function openOrderModal(itemId) {
  selectedItem = allItems.find((i) => i.id === itemId);
  if (!selectedItem) return;
  const clientRow = linkedClientByOwner[selectedItem.owner_id];

  document.getElementById("order-modal-title").textContent = `Commander chez ${establishmentLabel(selectedItem.owner_id)}`;
  document.getElementById("order-item-summary").innerHTML = `
    <div class="order-summary">
      ${selectedItem.photo_url ? `<img src="${escapeHtml(selectedItem.photo_url)}" alt="" class="order-summary-photo" />` : ""}
      <div>
        <strong>${escapeHtml(selectedItem.name)}</strong>
        ${selectedItem.description ? `<div class="text-muted text-sm">${escapeHtml(selectedItem.description)}</div>` : ""}
        <div class="catalog-card-price">${formatMoney(selectedItem.price)} / unité</div>
      </div>
    </div>`;

  const form = document.getElementById("remote-order-form");
  form.reset();
  form.due_date.min = todayISO(1);
  document.getElementById("order-form-error").textContent = "";

  const measurementSelect = document.getElementById("order-measurement");
  measurementSelect.innerHTML = `<option value="">Chargement...</option>`;
  const { data: measurements } = await supabase
    .from("measurements")
    .select("id, garment_type, garment_label, version, created_at")
    .eq("client_id", clientRow.id)
    .order("version", { ascending: false });

  const submitBtn = form.querySelector("button[type=submit]");
  if (!measurements?.length) {
    measurementSelect.innerHTML = `<option value="">Aucune mesure enregistrée chez cet atelier</option>`;
    submitBtn.disabled = true;
  } else {
    measurementSelect.innerHTML = measurements
      .map((m) => `<option value="${m.id}">${escapeHtml(measurementGarmentLabel(m))} — v${m.version} (${formatDate(m.created_at)})</option>`)
      .join("");
    submitBtn.disabled = false;
  }

  updateOrderTotalPreview();
  openModal("order-modal");
}

function updateOrderTotalPreview() {
  if (!selectedItem) return;
  const qty = Math.max(1, parseInt(document.getElementById("order-quantity").value, 10) || 1);
  document.getElementById("order-total-preview").textContent = `Total : ${formatMoney(selectedItem.price * qty)}`;
}

async function handleSubmitOrder(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("order-form-error");
  errorEl.textContent = "";

  const clientRow = linkedClientByOwner[selectedItem.owner_id];
  if (!form.measurement_id.value) {
    errorEl.textContent = "Sélectionne une fiche de mesure.";
    return;
  }
  const quantity = Math.max(1, parseInt(form.quantity.value, 10) || 1);

  const submitBtn = form.querySelector("button[type=submit]");
  setButtonLoading(submitBtn, true, "Envoi...");

  // Prix, statut et propriétaire sont imposés par la base (déclencheur
  // enforce_remote_order_pricing) : les valeurs envoyées ici sont indicatives.
  const { error } = await supabase.from("orders").insert({
    client_id: clientRow.id,
    measurement_id: form.measurement_id.value,
    garment_description: selectedItem.name,
    fabric: form.notes.value.trim() || null,
    catalog_item_id: selectedItem.id,
    quantity,
    unit_price: selectedItem.price,
    total_price: selectedItem.price * quantity,
    due_date: form.due_date.value,
    created_by: currentProfile.id,
  });

  setButtonLoading(submitBtn, false);

  if (error) {
    errorEl.textContent = mapDbError(error, "Erreur lors de la commande. Réessaie ou contacte ton couturier.");
    console.error(error);
    return;
  }

  closeModal("order-modal");
  showToast("Commande envoyée ! L'atelier la voit sur son tableau de bord.", "success");
  setTimeout(() => (window.location.href = "client-portal.html"), 1200);
}
