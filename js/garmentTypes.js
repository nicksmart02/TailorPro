// =============================================================
// TAILORFLOW — Types de vêtements (champs de mesure par atelier)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { escapeHtml, showToast, openModal, closeModal, mapDbError, setButtonLoading, tableMessageRow } from "./utils.js";

let currentProfile = null;
let types = [];
let editingTypeId = null; // null = création

const tableBody = document.getElementById("garment-types-table-body");
const fieldsRowsContainer = document.getElementById("fields-rows");
const typeForm = document.getElementById("type-form");
const typeFormError = document.getElementById("type-form-error");
const modalTitle = document.getElementById("type-modal-title");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "garments");

  await loadTypes();

  document.getElementById("new-type-btn").addEventListener("click", () => openTypeModal());
  document.getElementById("close-type-modal").addEventListener("click", () => closeModal("type-modal"));
  document.getElementById("cancel-type-form").addEventListener("click", () => closeModal("type-modal"));
  document.getElementById("add-field-row-btn").addEventListener("click", () => addFieldRow().querySelector("input").focus());
  typeForm.addEventListener("submit", handleSubmitType);
}

async function loadTypes() {
  const { data, error } = await supabase.from("garment_types").select("id, key, label, fields").order("label", { ascending: true });

  if (error) {
    tableBody.innerHTML = tableMessageRow(3, "Erreur de chargement.", "error");
    console.error(error);
    return;
  }
  types = data || [];

  if (!types.length) {
    tableBody.innerHTML = tableMessageRow(3, "Aucun type pour le moment. Crée ton premier type de vêtement.");
    return;
  }

  tableBody.innerHTML = types
    .map(
      (t) => `
    <tr>
      <td data-label="Type"><strong>${escapeHtml(t.label)}</strong></td>
      <td data-label="Champs">${t.fields.map((f) => `<span class="chip">${escapeHtml(f.label)}${f.unit ? ` (${escapeHtml(f.unit)})` : ""}</span>`).join(" ")}</td>
      <td data-label="">
        <div class="button-row button-row-end">
          <button class="btn btn-secondary btn-sm edit-type-btn" data-id="${t.id}" type="button">Modifier</button>
          <button class="btn btn-ghost btn-sm delete-type-btn" data-id="${t.id}" type="button">Supprimer</button>
        </div>
      </td>
    </tr>`
    )
    .join("");

  tableBody.querySelectorAll(".edit-type-btn").forEach((btn) =>
    btn.addEventListener("click", () => openTypeModal(types.find((t) => t.id === btn.dataset.id)))
  );
  tableBody.querySelectorAll(".delete-type-btn").forEach((btn) =>
    btn.addEventListener("click", () => deleteType(types.find((t) => t.id === btn.dataset.id)))
  );
}

/** Ouvre la modale en création (sans argument) ou en édition. */
function openTypeModal(type = null) {
  typeForm.reset();
  typeFormError.textContent = "";
  fieldsRowsContainer.innerHTML = "";

  if (type) {
    editingTypeId = type.id;
    modalTitle.textContent = `Modifier « ${type.label} »`;
    typeForm.label.value = type.label;
    (type.fields.length ? type.fields : [{}]).forEach((f) => addFieldRow(f.label, f.unit, f.key));
  } else {
    editingTypeId = null;
    modalTitle.textContent = "Nouveau type de vêtement";
    addFieldRow();
    addFieldRow();
  }
  openModal("type-modal");
}

/**
 * Ajoute une ligne de champ. `key` est conservée lors d'une modification
 * pour ne pas « perdre » le lien avec les mesures déjà enregistrées.
 */
function addFieldRow(label = "", unit = "cm", key = "") {
  const row = document.createElement("div");
  row.className = "field-row";
  row.dataset.key = key || "";
  row.innerHTML = `
    <input type="text" placeholder="Ex : Tour de poitrine" value="${escapeHtml(label)}" class="field-label-input" maxlength="60" aria-label="Nom du champ" />
    <select class="field-unit-select" aria-label="Unité">
      <option value="cm" ${unit === "cm" ? "selected" : ""}>cm</option>
      <option value="pouce" ${unit === "pouce" ? "selected" : ""}>pouce</option>
    </select>
    <button type="button" class="field-move-btn" data-dir="-1" title="Monter" aria-label="Monter ce champ">↑</button>
    <button type="button" class="remove-field-btn" title="Retirer ce champ" aria-label="Retirer ce champ">&times;</button>
  `;
  row.querySelector(".remove-field-btn").addEventListener("click", () => row.remove());
  row.querySelector(".field-move-btn").addEventListener("click", () => {
    const prev = row.previousElementSibling;
    if (prev) fieldsRowsContainer.insertBefore(row, prev);
  });
  fieldsRowsContainer.appendChild(row);
  return row;
}

function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

async function handleSubmitType(e) {
  e.preventDefault();
  typeFormError.textContent = "";

  const label = typeForm.label.value.trim();
  if (!label) {
    typeFormError.textContent = "Le nom du type est requis.";
    return;
  }

  const rows = [...fieldsRowsContainer.querySelectorAll(".field-row")].filter(
    (row) => row.querySelector(".field-label-input").value.trim()
  );
  // Les clés des champs existants sont réservées en premier : un nouveau champ ne peut pas les réutiliser.
  const usedKeys = new Set(rows.map((row) => row.dataset.key).filter(Boolean));
  const fields = [];
  for (const row of rows) {
    const fieldLabel = row.querySelector(".field-label-input").value.trim();
    let key = row.dataset.key;
    if (!key) {
      const base = slugify(fieldLabel) || "champ";
      key = base;
      let i = 2;
      while (usedKeys.has(key)) key = `${base}_${i++}`;
      usedKeys.add(key);
    }
    fields.push({ key, label: fieldLabel, unit: row.querySelector(".field-unit-select").value });
  }

  if (!fields.length) {
    typeFormError.textContent = "Ajoute au moins un champ de mesure.";
    return;
  }

  const submitBtn = typeForm.querySelector("button[type=submit]");
  setButtonLoading(submitBtn, true);

  let error;
  if (editingTypeId) {
    // La clé du type n'est jamais modifiée : les mesures existantes y restent rattachées.
    ({ error } = await supabase.from("garment_types").update({ label, fields }).eq("id", editingTypeId));
  } else {
    let key = slugify(label) || "type";
    let i = 2;
    while (types.some((t) => t.key === key)) key = `${slugify(label)}_${i++}`;
    ({ error } = await supabase.from("garment_types").insert({ key, label, fields }));
  }

  setButtonLoading(submitBtn, false);

  if (error) {
    typeFormError.textContent = mapDbError(error, "Erreur lors de l'enregistrement du type.");
    console.error(error);
    return;
  }

  closeModal("type-modal");
  showToast(editingTypeId ? "Type mis à jour." : "Type de vêtement créé.", "success");
  await loadTypes();
}

async function deleteType(type) {
  if (!type) return;
  if (!confirm(`Supprimer le type « ${type.label} » ?\nLes mesures déjà enregistrées avec ce type restent intactes et lisibles.`)) return;

  const { error } = await supabase.from("garment_types").delete().eq("id", type.id);
  if (error) {
    showToast(mapDbError(error, "Erreur lors de la suppression."), "error");
    return;
  }
  showToast("Type supprimé.", "success");
  await loadTypes();
}
