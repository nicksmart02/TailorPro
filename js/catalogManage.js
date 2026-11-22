// =============================================================
// TAILORFLOW — Mon catalogue (articles + photos) côté couturier
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { escapeHtml, formatMoney, showToast, openModal, closeModal, mapDbError, setButtonLoading } from "./utils.js";

const BUCKET = "catalog-photos";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 1600; // les photos plus grandes sont réduites avant envoi (économie de data mobile)
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

let currentProfile = null;
let items = [];
let editingItem = null;
let selectedPhotoFile = null;
let removePhoto = false;

const grid = document.getElementById("catalog-items-grid");
const itemForm = document.getElementById("item-form");
const photoInput = document.getElementById("item-photo");
const photoPreview = document.getElementById("item-photo-preview");
const removePhotoBtn = document.getElementById("remove-photo-btn");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "catalog");

  await loadItems();

  document.getElementById("new-item-btn").addEventListener("click", () => openItemModal());
  document.getElementById("close-item-modal").addEventListener("click", () => closeModal("item-modal"));
  document.getElementById("cancel-item-form").addEventListener("click", () => closeModal("item-modal"));
  photoInput.addEventListener("change", handlePhotoSelected);
  removePhotoBtn.addEventListener("click", () => {
    selectedPhotoFile = null;
    removePhoto = true;
    photoInput.value = "";
    showPreview(null);
  });
  itemForm.addEventListener("submit", handleSubmitItem);
}

async function loadItems() {
  grid.innerHTML = `<p class="text-muted">Chargement...</p>`;
  const { data, error } = await supabase
    .from("catalog_items")
    .select("id, name, description, price, photo_url, is_active")
    .eq("owner_id", currentProfile.id)
    .order("created_at", { ascending: false });

  if (error) {
    grid.innerHTML = `<p class="error-message">Erreur de chargement.</p>`;
    return;
  }
  items = data || [];
  document.getElementById("catalog-count").textContent =
    `${items.length} article${items.length > 1 ? "s" : ""} · ${items.filter((i) => i.is_active).length} visible(s) dans la marketplace`;

  if (!items.length) {
    grid.innerHTML = `<div class="empty-state">Aucun article pour le moment. Ajoute ton premier modèle avec une photo : il sera visible par tes clients dans la marketplace.</div>`;
    return;
  }

  grid.innerHTML = items
    .map(
      (item) => `
    <article class="catalog-card ${item.is_active ? "" : "catalog-card-inactive"}">
      ${
        item.photo_url
          ? `<img class="catalog-card-photo" src="${escapeHtml(item.photo_url)}" alt="${escapeHtml(item.name)}" loading="lazy" />`
          : `<div class="catalog-card-photo-placeholder" aria-hidden="true">✂️</div>`
      }
      <div class="catalog-card-body">
        <strong>${escapeHtml(item.name)}</strong>
        ${item.description ? `<span class="text-muted text-sm">${escapeHtml(item.description)}</span>` : ""}
        <span class="catalog-card-price">${formatMoney(item.price)}</span>
        <span><span class="badge ${item.is_active ? "badge-delivered" : "badge-cancelled"}">${item.is_active ? "Visible" : "Masqué"}</span></span>
        <div class="button-row">
          <button class="btn btn-secondary btn-sm edit-item-btn" data-id="${item.id}" type="button">Modifier</button>
          <button class="btn btn-ghost btn-sm delete-item-btn" data-id="${item.id}" type="button" aria-label="Supprimer ${escapeHtml(item.name)}">Supprimer</button>
        </div>
      </div>
    </article>`
    )
    .join("");

  grid.querySelectorAll(".edit-item-btn").forEach((btn) =>
    btn.addEventListener("click", () => openItemModal(items.find((i) => i.id === btn.dataset.id)))
  );
  grid.querySelectorAll(".delete-item-btn").forEach((btn) =>
    btn.addEventListener("click", () => deleteItem(items.find((i) => i.id === btn.dataset.id)))
  );
}

function showPreview(src) {
  photoPreview.hidden = !src;
  removePhotoBtn.hidden = !src;
  if (src) photoPreview.src = src;
  else photoPreview.removeAttribute("src");
}

function openItemModal(item = null) {
  editingItem = item;
  selectedPhotoFile = null;
  removePhoto = false;
  itemForm.reset();
  document.getElementById("item-form-error").textContent = "";
  document.getElementById("item-modal-title").textContent = item ? "Modifier l'article" : "Nouvel article";

  if (item) {
    itemForm.name.value = item.name;
    itemForm.description.value = item.description || "";
    itemForm.price.value = item.price;
    itemForm.is_active.checked = item.is_active;
  }
  showPreview(item?.photo_url || null);
  openModal("item-modal");
}

async function handlePhotoSelected() {
  const errorEl = document.getElementById("item-form-error");
  errorEl.textContent = "";
  const file = photoInput.files?.[0];
  if (!file) return;

  if (!ACCEPTED_TYPES.includes(file.type)) {
    errorEl.textContent = "Format non accepté : utilise une photo JPG, PNG ou WebP.";
    photoInput.value = "";
    return;
  }

  try {
    selectedPhotoFile = await shrinkImage(file);
  } catch {
    selectedPhotoFile = file;
  }
  if (selectedPhotoFile.size > MAX_UPLOAD_BYTES) {
    errorEl.textContent = "La photo dépasse 5 Mo même après compression.";
    selectedPhotoFile = null;
    photoInput.value = "";
    return;
  }
  removePhoto = false;
  showPreview(URL.createObjectURL(selectedPhotoFile));
}

/** Réduit une image trop grande (JPEG qualité 0,85) ; renvoie le fichier d'origine sinon. */
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1024 * 1024) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** Chemin de stockage à partir de l'URL publique (pour supprimer l'ancienne photo). */
function storagePathFromUrl(url) {
  const marker = `/object/public/${BUCKET}/`;
  const i = url ? url.indexOf(marker) : -1;
  return i >= 0 ? decodeURIComponent(url.slice(i + marker.length).split("?")[0]) : null;
}

async function removeStoredPhoto(url) {
  const path = storagePathFromUrl(url);
  if (path && path.startsWith(`${currentProfile.id}/`)) {
    await supabase.storage.from(BUCKET).remove([path]);
  }
}

async function uploadPhoto(file) {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${currentProfile.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type, cacheControl: "31536000" });
  if (error) throw new Error("Erreur lors de l'envoi de la photo. Vérifie ta connexion.");
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function handleSubmitItem(e) {
  e.preventDefault();
  const errorEl = document.getElementById("item-form-error");
  errorEl.textContent = "";

  const price = parseFloat(itemForm.price.value);
  if (Number.isNaN(price) || price < 0) {
    errorEl.textContent = "Indique un prix valide.";
    return;
  }

  const submitBtn = document.getElementById("item-submit-btn");
  setButtonLoading(submitBtn, true);

  const oldPhotoUrl = editingItem?.photo_url || null;
  let newPhotoUrl = oldPhotoUrl;

  try {
    if (selectedPhotoFile) newPhotoUrl = await uploadPhoto(selectedPhotoFile);
    else if (removePhoto) newPhotoUrl = null;

    const payload = {
      name: itemForm.name.value.trim(),
      description: itemForm.description.value.trim() || null,
      price,
      photo_url: newPhotoUrl,
      is_active: itemForm.is_active.checked,
    };

    const { error } = editingItem
      ? await supabase.from("catalog_items").update(payload).eq("id", editingItem.id)
      : await supabase.from("catalog_items").insert(payload);

    if (error) {
      if (selectedPhotoFile && newPhotoUrl) await removeStoredPhoto(newPhotoUrl);
      throw new Error(mapDbError(error, "Erreur lors de l'enregistrement de l'article."));
    }

    if (oldPhotoUrl && oldPhotoUrl !== newPhotoUrl) await removeStoredPhoto(oldPhotoUrl);

    closeModal("item-modal");
    showToast(editingItem ? "Article mis à jour." : "Article ajouté au catalogue.", "success");
    await loadItems();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

async function deleteItem(item) {
  if (!item || !confirm(`Supprimer l'article « ${item.name} » du catalogue ?`)) return;

  const { error } = await supabase.from("catalog_items").delete().eq("id", item.id);
  if (error) {
    showToast(
      error.code === "23503"
        ? "Cet article a déjà été commandé : masque-le plutôt (décoche « Visible »)."
        : mapDbError(error, "Erreur lors de la suppression."),
      "error"
    );
    return;
  }
  if (item.photo_url) await removeStoredPhoto(item.photo_url);
  showToast("Article supprimé.", "success");
  await loadItems();
}
