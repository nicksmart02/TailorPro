// =============================================================
// TAILORFLOW — Gestion des types de vêtements (par utilisateur)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { escapeHtml, showToast, openModal, closeModal } from "./utils.js";

let currentProfile = null;
let editingTypeId = null; // null = création, sinon id du type en cours d'édition

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
  document.getElementById("add-field-row-btn").addEventListener("click", () => addFieldRow());
  typeForm.addEventListener("submit", handleSubmitType);
}

async function loadTypes() {
  const { data, error } = await supabase
    .from("garment_types")
    .select("id, key, label, fields")
    .order("label", { ascending: true });

  if (error) {
    tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--color-danger);">Erreur de chargement.</td></tr>`;
    console.error(error);
    return;
  }

  if (!data.length) {
    tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--color-text-muted);">Aucun type pour le moment.</td></tr>`;
    return;
  }

  tableBody.innerHTML = data
    .map(
      (t) => `
    <tr>
      <td data-label="Type">${escapeHtml(t.label)}</td>
      <td data-label="Champs">${t.fields.map((f) => escapeHtml(f.label)).join(", ")}</td>
      <td data-label="" style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn btn-secondary edit-type-btn" data-id="${t.id}">Modifier</button>
        <button class="btn btn-secondary delete-type-btn" data-id="${t.id}" data-label="${escapeHtml(t.label)}">Supprimer</button>
      </td>
    </tr>`
    )
    .join("");

  document.querySelectorAll(".delete-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteType(btn.dataset.id, btn.dataset.label));
  });

  document.querySelectorAll(".edit-type-btn").forEach((btn) => {
    const type = data.find((t) => t.id === btn.dataset.id);
    btn.addEventListener("click", () => openTypeModal(type));
  });
}

/**
 * Ouvre la modale en mode création (aucun argument) ou édition
 * (en passant le type existant : { id, label, fields }).
 */
function openTypeModal(type = null) {
  typeForm.reset();
  typeFormError.textContent = "";
  fieldsRowsContainer.innerHTML = "";

  if (type) {
    editingTypeId = type.id;
    modalTitle.textContent = "Modifier le type de vêtement";
    typeForm.label.value = type.label;
    if (type.fields.length) {
      type.fields.forEach((f) => addFieldRow(f.label, f.unit));
    } else {
      addFieldRow();
    }
  } else {
    editingTypeId = null;
    modalTitle.textContent = "Nouveau type de vêtement";
    addFieldRow();
    addFieldRow();
  }

  openModal("type-modal");
}

function addFieldRow(label = "", unit = "cm") {
  const row = document.createElement("div");
  row.className = "field-row";
  row.innerHTML = `
    <input type="text" placeholder="Ex : Tour de poitrine" value="${escapeHtml(label)}" class="field-label-input" />
    <select class="field-unit-select">
      <option value="cm" ${unit === "cm" ? "selected" : ""}>cm</option>
      <option value="pouce" ${unit === "pouce" ? "selected" : ""}>pouce</option>
    </select>
    <button type="button" class="remove-field-btn" title="Retirer ce champ">&times;</button>
  `;
  row.querySelector(".remove-field-btn").addEventListener("click", () => row.remove());
  fieldsRowsContainer.appendChild(row);
}

function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // retire les accents
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

  const rows = Array.from(fieldsRowsContainer.querySelectorAll(".field-row"));
  const fields = [];
  for (const row of rows) {
    const fieldLabel = row.querySelector(".field-label-input").value.trim();
    const unit = row.querySelector(".field-unit-select").value;
    if (fieldLabel) {
      fields.push({ key: slugify(fieldLabel) || `champ_${fields.length + 1}`, label: fieldLabel, unit });
    }
  }

  if (!fields.length) {
    typeFormError.textContent = "Ajoutez au moins un champ de mesure.";
    return;
  }

  const submitBtn = typeForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  let error;
  if (editingTypeId) {
    // Édition : on ne touche pas à "key" pour ne pas casser les mesures déjà liées à ce type.
    ({ error } = await supabase.from("garment_types").update({ label, fields }).eq("id", editingTypeId));
  } else {
    const key = slugify(label);
    ({ error } = await supabase.from("garment_types").insert({ key, label, fields }));
  }

  submitBtn.disabled = false;

  if (error) {
    typeFormError.textContent = error.message.includes("duplicate")
      ? "Un type avec un nom similaire existe déjà."
      : "Erreur lors de l'enregistrement du type.";
    console.error(error);
    return;
  }

  closeModal("type-modal");
  showToast(editingTypeId ? "Type mis à jour." : "Type de vêtement créé.", "success");
  await loadTypes();
}

async function deleteType(id, label) {
  if (!confirm(`Supprimer le type "${label}" ? Les mesures déjà enregistrées avec ce type resteront inchangées.`)) return;

  const { error } = await supabase.from("garment_types").delete().eq("id", id);

  if (error) {
    showToast("Erreur lors de la suppression.", "error");
    console.error(error);
    return;
  }

  showToast("Type supprimé.", "success");
  await loadTypes();
}
