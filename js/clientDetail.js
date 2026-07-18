// =============================================================
// TAILORFLOW — Fiche client détaillée
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { escapeHtml, formatDate, formatDateTime, showToast, openModal, closeModal, orderStatusBadge } from "./utils.js";

let garmentTypes = []; // chargés depuis public.garment_types (propres à l'utilisateur)

const params = new URLSearchParams(window.location.search);
const clientId = params.get("id");

let currentProfile = null;

if (!clientId) {
  window.location.href = "clients.html";
}

init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "clients");

  await loadGarmentTypes();
  populateGarmentTypeSelect();
  await loadClient();
  await loadMeasurements();
  await loadOrders();

  document.getElementById("new-measurement-btn").addEventListener("click", () => {
    document.getElementById("measurement-form").reset();
    document.getElementById("measurement-fields").innerHTML = "";
    document.getElementById("measurement-form-error").textContent = "";
    openModal("measurement-modal");
  });
  document.getElementById("close-measurement-modal").addEventListener("click", () => closeModal("measurement-modal"));
  document.getElementById("cancel-measurement-form").addEventListener("click", () => closeModal("measurement-modal"));
  document.getElementById("garment_type").addEventListener("change", renderMeasurementFields);
  document.getElementById("measurement-form").addEventListener("submit", handleCreateMeasurement);
}

async function loadGarmentTypes() {
  const { data, error } = await supabase
    .from("garment_types")
    .select("key, label, fields")
    .order("label", { ascending: true });

  if (!error && data) garmentTypes = data;
}

function populateGarmentTypeSelect() {
  const select = document.getElementById("garment_type");
  select.innerHTML =
    `<option value="">-- Choisir un type --</option>` +
    garmentTypes.map((g) => `<option value="${g.key}">${escapeHtml(g.label)}</option>`).join("") +
    `<option value="__manage__">+ Gérer les types de vêtement...</option>`;
}

function renderMeasurementFields() {
  const type = document.getElementById("garment_type").value;
  const container = document.getElementById("measurement-fields");

  if (type === "__manage__") {
    window.location.href = "garment-types.html";
    return;
  }

  const fields = garmentTypes.find((g) => g.key === type)?.fields || [];

  if (!fields.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = fields
    .map(
      (f) => `
    <div class="form-group">
      <label for="mf_${f.key}">${escapeHtml(f.label)}${f.unit ? ` (${escapeHtml(f.unit)})` : ""}</label>
      <input type="number" step="0.5" min="0" id="mf_${f.key}" name="mf_${f.key}" required />
    </div>`
    )
    .join("");
}

async function loadClient() {
  const { data, error } = await supabase.from("clients").select("*").eq("id", clientId).single();

  if (error || !data) {
    showToast("Client introuvable.", "error");
    window.location.href = "clients.html";
    return;
  }

  document.getElementById("client-name").textContent = data.full_name;
  document.getElementById("client-info").innerHTML = `
    <dt>Téléphone</dt><dd>${escapeHtml(data.phone)}</dd>
    <dt>Email</dt><dd>${escapeHtml(data.email || "—")}</dd>
    <dt>Adresse</dt><dd>${escapeHtml(data.address || "—")}</dd>
    <dt>Client depuis</dt><dd>${formatDate(data.created_at)}</dd>
  `;
  if (data.notes) {
    document.getElementById("client-notes").textContent = data.notes;
    document.getElementById("client-notes-card").style.display = "block";
  }
}

async function loadMeasurements() {
  const container = document.getElementById("measurements-list");
  const { data, error } = await supabase
    .from("measurements")
    .select("id, garment_type, values, version, created_at")
    .eq("client_id", clientId)
    .order("version", { ascending: false });

  if (error) {
    container.innerHTML = `<p class="error-message">Erreur de chargement des mesures.</p>`;
    return;
  }

  if (!data.length) {
    container.innerHTML = `<p style="color:var(--color-text-muted);">Aucune fiche de mesure enregistrée.</p>`;
    return;
  }

  container.innerHTML = data
    .map(
      (m) => `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <strong>${escapeHtml(m.garment_type)} — version ${m.version}</strong>
        <span style="color:var(--color-text-muted); font-size:0.82rem;">${formatDateTime(m.created_at)}</span>
      </div>
      <dl class="kv-list">
        ${Object.entries(m.values)
          .map(([k, v]) => `<dt>${escapeHtml(k.replace(/_/g, " "))}</dt><dd>${escapeHtml(v)} cm</dd>`)
          .join("")}
      </dl>
    </div>`
    )
    .join("");

  // Remplit aussi le sélecteur de mesures utilisé lors de la création de commande (orders.js le réutilise via l'URL)
}

async function loadOrders() {
  const container = document.getElementById("orders-list");
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, garment_description, status, due_date, total_price")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) {
    container.innerHTML = `<p class="error-message">Erreur de chargement des commandes.</p>`;
    return;
  }

  if (!data.length) {
    container.innerHTML = `<p style="color:var(--color-text-muted);">Aucune commande pour ce client.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr><th>N°</th><th>Description</th><th>Échéance</th><th>Statut</th><th></th></tr></thead>
      <tbody>
        ${data
          .map(
            (o) => `
          <tr>
            <td data-label="N°">${escapeHtml(o.order_number)}</td>
            <td data-label="Description">${escapeHtml(o.garment_description)}</td>
            <td data-label="Échéance">${formatDate(o.due_date)}</td>
            <td data-label="Statut">${orderStatusBadge(o)}</td>
            <td data-label=""><a class="link-plain" href="order-detail.html?id=${o.id}">Voir</a></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
    </div>
  `;
}

async function handleCreateMeasurement(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("measurement-form-error");
  errorEl.textContent = "";

  const type = form.garment_type.value;
  if (!type) {
    errorEl.textContent = "Veuillez choisir un type de vêtement.";
    return;
  }

  const fields = garmentTypes.find((g) => g.key === type)?.fields || [];
  const values = {};
  for (const f of fields) {
    const input = form[`mf_${f.key}`];
    values[f.key] = parseFloat(input.value);
  }

  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const { error } = await supabase.from("measurements").insert({
    client_id: clientId,
    garment_type: type,
    values,
    taken_by: currentProfile.id,
  });

  submitBtn.disabled = false;

  if (error) {
    errorEl.textContent = "Erreur lors de l'enregistrement de la mesure.";
    console.error(error);
    return;
  }

  closeModal("measurement-modal");
  showToast("Fiche de mesure enregistrée.", "success");
  await loadMeasurements();
}
