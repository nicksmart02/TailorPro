// =============================================================
// TAILORFLOW — Gestion des types de vêtements (par utilisateur)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { escapeHtml, showToast, openModal, closeModal } from "./utils.js";

let currentProfile = null;

const tableBody = document.getElementById("garment-types-table-body");
const fieldsRowsContainer = document.getElementById("fields-rows");
const typeForm = document.getElementById("type-form");
const typeFormError = document.getElementById("type-form-error");

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "garments");

  await loadTypes();

  document.getElementById("new-type-btn").addEventListener("click", openNewTypeModal);
  document.getElementById("close-type-modal").addEventListener("click", () => closeModal("type-modal"));
  document.getElementById("cancel-type-form").addEventListener("click", () => closeModal("type-modal"));
  document.getElementById("add-field-row-btn").addEventListener("click", () => addFieldRow());
  typeForm.addEventListener("submit", handleCreateType);
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
      <td data-label=""><button class="btn btn-secondary delete-type-btn" data-id="${t.id}" data-label="${escapeHtml(t.label)}">Supprimer</button></td>
    </tr>`
    )
    .join("");

  document.querySelectorAll(".delete-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteType(btn.dataset.id, btn.dataset.label));
  });
}

function openNewTypeModal() {
  typeForm.reset();
  typeFormError.textContent = "";
  fieldsRowsContainer.innerHTML = "";
  addFieldRow();
  addFieldRow();
  openModal("type-modal");
}

function addFieldRow(label = "") {
  const row = document.createElement("div");
  row.className = "field-row";
  row.innerHTML = `
    <input type="text" placeholder="Ex : Tour de poitrine" value="${escapeHtml(label)}" class="field-label-input" />
    <select class="field-unit-select">
      <option value="cm">cm</option>
      <option value="pouce">pouce</option>
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

async function handleCreateType(e) {
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

  const key = slugify(label);
  const submitBtn = typeForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const { error } = await supabase.from("garment_types").insert({
    key,
    label,
    fields,
  });

  submitBtn.disabled = false;

  if (error) {
    typeFormError.textContent = error.message.includes("duplicate")
      ? "Un type avec un nom similaire existe déjà."
      : "Erreur lors de la création du type.";
    console.error(error);
    return;
  }

  closeModal("type-modal");
  showToast("Type de vêtement créé.", "success");
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
