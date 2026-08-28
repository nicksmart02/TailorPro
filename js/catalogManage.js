// =============================================================
// TAILORFLOW — Gestion du catalogue (photos + articles), côté couturier
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { escapeHtml, formatMoney, showToast, openModal, closeModal } from "./utils.js";

let currentProfile = null;
let editingItemId = null;
let selectedPhotoFile = null;
let currentPhotoUrl = null;

const grid = document.getElementById("catalog-items-grid");
const itemForm = document.getElementById("item-form");
const photoInput = document.getElementById("item-photo");
const photoPreview = document.getElementById("item-photo-preview");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "catalog");

  await loadItems();

  document.getElementById("new-item-btn").addEventListener("click", openNewItemModal);
  document.getElementById("close-item-modal").addEventListener("click", () => closeModal("item-modal"));
  document.getElementById("cancel-item-form").addEventListener("click", () => closeModal("item-modal"));
  photoInput.addEventListener("change", handlePhotoPreview);
  itemForm.addEventListener("submit", handleSubmitItem);
}

async function loadItems() {
  grid.innerHTML = `<p style="color:var(--color-text-muted);">Chargement...</p>`;

  const { data, error } = await supabase
    .from("catalog_items")
    .select("id, name, description, price, photo_url, is_active")
    .order("created_at", { ascending: false });

  if (error) {
    grid.innerHTML = `<p class="error-message">Erreur de chargement.</p>`;
    return;
  }

  if (!data.length) {
    grid.innerHTML = `<p style="color:var(--color-text-muted);">Aucun article pour le moment. Ajoute ton premier article de catalogue !</p>`;
    return;
  }

  grid.innerHTML = data
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
        <span class="badge ${item.is_active ? "badge-delivered" : "badge-cancelled"}">${item.is_active ? "Visible" : "Masqué"}</span>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn btn-secondary edit-item-btn" data-id="${item.id}" style="flex:1;">Modifier</button>
          <button class="btn btn-secondary delete-item-btn" data-id="${item.id}" data-name="${escapeHtml(item.name)}">🗑</button>
        </div>
      </div>
    </div>`
    )
    .join("");

  grid.querySelectorAll(".edit-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => openEditItemModal(btn.dataset.id, data));
  });
  grid.querySelectorAll(".delete-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteItem(btn.dataset.id, btn.dataset.name));
  });
}

function openNewItemModal() {
  editingItemId = null;
  currentPhotoUrl = null;
  selectedPhotoFile = null;
  itemForm.reset();
  document.getElementById("item-form-error").textContent = "";
  document.getElementById("item-modal-title").textContent = "Nouvel article";
  photoPreview.style.display = "none";
  openModal("item-modal");
}

function openEditItemModal(itemId, allItems) {
  const item = allItems.find((i) => i.id === itemId);
  if (!item) return;

  editingItemId = itemId;
  currentPhotoUrl = item.photo_url;
  selectedPhotoFile = null;
  itemForm.reset();
  document.getElementById("item-form-error").textContent = "";
  document.getElementById("item-modal-title").textContent = "Modifier l'article";
  itemForm.name.value = item.name;
  itemForm.description.value = item.description || "";
  itemForm.price.value = item.price;
  itemForm.is_active.checked = item.is_active;

  if (item.photo_url) {
    photoPreview.src = item.photo_url;
    photoPreview.style.display = "block";
  } else {
    photoPreview.style.display = "none";
  }

  openModal("item-modal");
}

function handlePhotoPreview() {
  const file = photoInput.files?.[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    document.getElementById("item-form-error").textContent = "L'image dépasse 5 Mo.";
    photoInput.value = "";
    return;
  }

  selectedPhotoFile = file;
  photoPreview.src = URL.createObjectURL(file);
  photoPreview.style.display = "block";
}

async function uploadPhotoIfNeeded() {
  if (!selectedPhotoFile) return currentPhotoUrl;

  const ext = selectedPhotoFile.name.split(".").pop();
  const path = `${currentProfile.id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("catalog-photos")
    .upload(path, selectedPhotoFile, { upsert: false });

  if (uploadError) throw new Error("Erreur lors de l'envoi de la photo.");

  const { data } = supabase.storage.from("catalog-photos").getPublicUrl(path);
  return data.publicUrl;
}

async function handleSubmitItem(e) {
  e.preventDefault();
  const errorEl = document.getElementById("item-form-error");
  errorEl.textContent = "";

  const submitBtn = document.getElementById("item-submit-btn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Enregistrement...";

  try {
    const photoUrl = await uploadPhotoIfNeeded();

    const payload = {
      name: itemForm.name.value.trim(),
      description: itemForm.description.value.trim() || null,
      price: parseFloat(itemForm.price.value),
      photo_url: photoUrl,
      is_active: itemForm.is_active.checked,
    };

    const { error } = editingItemId
      ? await supabase.from("catalog_items").update(payload).eq("id", editingItemId)
      : await supabase.from("catalog_items").insert(payload);

    if (error) throw new Error("Erreur lors de l'enregistrement de l'article.");

    closeModal("item-modal");
    showToast(editingItemId ? "Article mis à jour." : "Article ajouté au catalogue.", "success");
    await loadItems();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Enregistrer";
  }
}

async function deleteItem(id, name) {
  if (!confirm(`Supprimer l'article "${name}" du catalogue ?`)) return;

  const { error } = await supabase.from("catalog_items").delete().eq("id", id);

  if (error) {
    showToast("Erreur lors de la suppression.", "error");
    return;
  }

  showToast("Article supprimé.", "success");
  await loadItems();
}
