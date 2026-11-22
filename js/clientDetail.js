// =============================================================
// TAILORFLOW — Fiche client
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import {
  escapeHtml, formatDate, formatDateTime, formatMoney, showToast, openModal, closeModal, orderStatusBadge,
  measurementGarmentLabel, measurementKvHtml, mapDbError, setButtonLoading, telHref, whatsappHref,
  copyToClipboard, tableMessageRow, bindClickableRows,
} from "./utils.js";

const params = new URLSearchParams(window.location.search);
const clientId = params.get("id");

let currentProfile = null;
let currentClient = null;
let garmentTypes = [];

if (!clientId) window.location.href = "clients.html";
else init();

async function init() {
  currentProfile = await requireAuth();
  if (!currentProfile) return;
  renderNav(currentProfile, "clients");

  await loadGarmentTypes();
  const ok = await loadClient();
  if (!ok) return;

  await Promise.all([loadPortalAccess(), loadMeasurements(), loadOrders()]);

  document.getElementById("edit-client-btn").addEventListener("click", openEditModal);
  document.getElementById("close-edit-modal").addEventListener("click", () => closeModal("edit-modal"));
  document.getElementById("cancel-edit-form").addEventListener("click", () => closeModal("edit-modal"));
  document.getElementById("edit-form").addEventListener("submit", handleSaveClient);
  document.getElementById("delete-client-btn").addEventListener("click", handleDeleteClient);

  document.getElementById("new-measurement-btn").addEventListener("click", openMeasurementModal);
  document.getElementById("close-measurement-modal").addEventListener("click", () => closeModal("measurement-modal"));
  document.getElementById("cancel-measurement-form").addEventListener("click", () => closeModal("measurement-modal"));
  document.getElementById("garment_type").addEventListener("change", renderMeasurementFields);
  document.getElementById("measurement-form").addEventListener("submit", handleCreateMeasurement);
}

// ---------------------------------------------------------------
// Client
// ---------------------------------------------------------------

async function loadClient() {
  const { data, error } = await supabase.from("clients").select("*").eq("id", clientId).single();
  if (error || !data) {
    showToast("Client introuvable.", "error");
    window.location.href = "clients.html";
    return false;
  }
  currentClient = data;
  renderClient();
  return true;
}

function renderClient() {
  const c = currentClient;
  document.title = `${c.full_name} — TailorFlow`;
  document.getElementById("client-name").textContent = c.full_name;
  document.getElementById("client-info").innerHTML = `
    <dt>Téléphone</dt><dd>${escapeHtml(c.phone)}</dd>
    <dt>Email</dt><dd>${escapeHtml(c.email || "—")}</dd>
    <dt>Adresse</dt><dd>${escapeHtml(c.address || "—")}</dd>
    <dt>Client depuis</dt><dd>${formatDate(c.created_at)}</dd>
  `;

  const notesCard = document.getElementById("client-notes-card");
  notesCard.style.display = c.notes ? "block" : "none";
  document.getElementById("client-notes").textContent = c.notes || "";

  const tel = telHref(c.phone);
  const wa = whatsappHref(c.phone, `Bonjour ${c.full_name},`);
  document.getElementById("client-contact-actions").innerHTML = `
    ${tel ? `<a class="btn btn-secondary btn-sm" href="${tel}">📞 Appeler</a>` : ""}
    ${wa ? `<a class="btn btn-secondary btn-sm" href="${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
    <a class="btn btn-primary btn-sm" href="orders.html?new=1&client=${c.id}">+ Nouvelle commande</a>
  `;
}

function openEditModal() {
  const form = document.getElementById("edit-form");
  const c = currentClient;
  form.full_name.value = c.full_name || "";
  form.phone.value = c.phone || "";
  form.email.value = c.email || "";
  form.address.value = c.address || "";
  form.notes.value = c.notes || "";
  document.getElementById("edit-form-error").textContent = "";
  openModal("edit-modal");
}

async function handleSaveClient(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("edit-form-error");
  const submitBtn = form.querySelector("button[type=submit]");
  errorEl.textContent = "";
  setButtonLoading(submitBtn, true);

  const { data, error } = await supabase
    .from("clients")
    .update({
      full_name: form.full_name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim() || null,
      address: form.address.value.trim() || null,
      notes: form.notes.value.trim() || null,
    })
    .eq("id", clientId)
    .select("*")
    .single();

  setButtonLoading(submitBtn, false);

  if (error) {
    errorEl.textContent = error.code === "23505" ? "Tu as déjà un autre client avec ce numéro." : mapDbError(error);
    return;
  }

  currentClient = data;
  renderClient();
  closeModal("edit-modal");
  showToast("Fiche client mise à jour.", "success");
}

async function handleDeleteClient() {
  if (!confirm(`Supprimer définitivement la fiche de ${currentClient.full_name} ainsi que ses mesures ?\nCette action est irréversible.`)) return;

  const { error } = await supabase.from("clients").delete().eq("id", clientId);
  if (error) {
    showToast(
      error.code === "23503" ? "Ce client a des commandes : il ne peut pas être supprimé (historique de facturation)." : mapDbError(error),
      "error"
    );
    return;
  }
  showToast("Client supprimé.", "success");
  window.location.href = "clients.html";
}

// ---------------------------------------------------------------
// Espace client en ligne (portail)
// ---------------------------------------------------------------

async function loadPortalAccess() {
  const container = document.getElementById("portal-access");
  const c = currentClient;

  if (c.user_id) {
    container.innerHTML = `
      <div class="portal-row">
        <div>
          <span class="badge badge-delivered">Espace client activé</span>
          <p class="text-muted text-sm">Ce client consulte ses mesures, commandes et factures, et peut commander à distance depuis ton catalogue.</p>
        </div>
        <button class="btn btn-secondary btn-sm" id="revoke-access-btn" type="button">Retirer l'accès</button>
      </div>`;
    document.getElementById("revoke-access-btn").addEventListener("click", revokeAccess);
    return;
  }

  // Demandes de rattachement en attente pour cette fiche.
  const { data: requests } = await supabase.rpc("pending_link_requests");
  const mine = (requests || []).filter((r) => r.client_id === clientId);

  container.innerHTML = `
    ${mine
      .map(
        (r) => `
      <div class="banner banner-info">
        <span><strong>${escapeHtml(r.requester_name)}</strong> (${escapeHtml(r.requester_phone || "—")}) demande l'accès à cette fiche.</span>
        <span class="list-item-actions">
          <button class="btn btn-primary btn-sm link-approve" data-id="${r.request_id}" type="button">Valider</button>
          <button class="btn btn-secondary btn-sm link-reject" data-id="${r.request_id}" type="button">Refuser</button>
        </span>
      </div>`
      )
      .join("")}
    <div class="portal-row">
      <div>
        <span class="text-muted">Ce client n'a pas encore d'espace en ligne.</span>
        <p class="text-muted text-sm">Génère un code d'invitation et envoie-le-lui : il pourra suivre ses commandes et commander à distance.</p>
      </div>
      <button class="btn btn-secondary btn-sm" id="generate-invite-btn" type="button">${c.portal_invite_code ? "Nouveau code" : "Générer un accès"}</button>
    </div>
    <div id="portal-invite-result"></div>`;

  container.querySelectorAll(".link-approve").forEach((b) => b.addEventListener("click", () => reviewLink(b.dataset.id, true)));
  container.querySelectorAll(".link-reject").forEach((b) => b.addEventListener("click", () => reviewLink(b.dataset.id, false)));
  document.getElementById("generate-invite-btn").addEventListener("click", handleGenerateInvite);

  if (c.portal_invite_code) showInviteResult(c.portal_invite_code);
}

async function reviewLink(requestId, approve) {
  const { error } = await supabase.rpc(approve ? "approve_client_link" : "reject_client_link", { p_request_id: requestId });
  if (error) {
    showToast(mapDbError(error), "error");
    return;
  }
  showToast(approve ? "Accès validé." : "Demande refusée.", "success");
  await loadClient();
  await loadPortalAccess();
}

async function revokeAccess() {
  if (!confirm("Retirer l'accès en ligne de ce client ? Il ne verra plus ses commandes chez toi.")) return;
  const { data, error } = await supabase.from("clients").update({ user_id: null }).eq("id", clientId).select("*").single();
  if (error) {
    showToast(mapDbError(error), "error");
    return;
  }
  currentClient = data;
  showToast("Accès retiré.", "success");
  await loadPortalAccess();
}

function inviteLink(code) {
  const base = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}`;
  return `${base}client-signup.html?code=${encodeURIComponent(code)}`;
}

function showInviteResult(code) {
  const link = inviteLink(code);
  const atelier = currentProfile.establishment_name || "ton couturier";
  const message = `Bonjour ${currentClient.full_name}, ${atelier} t'invite à suivre tes commandes en ligne sur TailorFlow. Active ton espace ici : ${link} (code : ${code})`;
  const wa = whatsappHref(currentClient.phone, message);

  document.getElementById("portal-invite-result").innerHTML = `
    <div class="invite-box">
      <p class="text-sm">Code d'invitation (valable jusqu'à utilisation) :</p>
      <p class="invite-code">${escapeHtml(code)}</p>
      <p class="text-sm text-muted invite-link">${escapeHtml(link)}</p>
      <div class="button-row">
        <button class="btn btn-secondary btn-sm" id="copy-invite-btn" type="button">Copier le lien</button>
        ${wa ? `<a class="btn btn-primary btn-sm" href="${wa}" target="_blank" rel="noopener">Envoyer par WhatsApp</a>` : ""}
      </div>
    </div>`;
  document.getElementById("copy-invite-btn").addEventListener("click", () => copyToClipboard(link, "Lien d'invitation copié."));
}

async function handleGenerateInvite(e) {
  const btn = e.currentTarget;
  setButtonLoading(btn, true, "Génération...");
  const { data, error } = await supabase.rpc("generate_client_invite", { p_client_id: clientId });
  setButtonLoading(btn, false);

  if (error) {
    showToast(mapDbError(error, "Erreur lors de la génération de l'accès."), "error");
    return;
  }
  currentClient.portal_invite_code = data;
  showInviteResult(data);
  showToast("Code d'invitation généré.", "success");
}

// ---------------------------------------------------------------
// Mesures
// ---------------------------------------------------------------

async function loadGarmentTypes() {
  const { data, error } = await supabase.from("garment_types").select("key, label, fields").order("label", { ascending: true });
  if (!error && data) garmentTypes = data;

  const select = document.getElementById("garment_type");
  select.innerHTML =
    `<option value="">-- Choisir un type --</option>` +
    garmentTypes.map((g) => `<option value="${escapeHtml(g.key)}">${escapeHtml(g.label)}</option>`).join("");
}

function openMeasurementModal() {
  document.getElementById("measurement-form").reset();
  document.getElementById("measurement-fields").innerHTML = "";
  document.getElementById("measurement-form-error").textContent = "";
  document.getElementById("no-garment-types").style.display = garmentTypes.length ? "none" : "block";
  openModal("measurement-modal");
}

function renderMeasurementFields() {
  const type = document.getElementById("garment_type").value;
  const container = document.getElementById("measurement-fields");
  const fields = garmentTypes.find((g) => g.key === type)?.fields || [];

  container.innerHTML = fields
    .map(
      (f) => `
    <div class="form-group">
      <label for="mf_${escapeHtml(f.key)}">${escapeHtml(f.label)}${f.unit ? ` (${escapeHtml(f.unit)})` : ""}</label>
      <input type="number" inputmode="decimal" step="0.1" min="0" max="500" id="mf_${escapeHtml(f.key)}" name="mf_${escapeHtml(f.key)}" required />
    </div>`
    )
    .join("");
}

async function loadMeasurements() {
  const container = document.getElementById("measurements-list");
  const { data, error } = await supabase
    .from("measurements")
    .select("id, garment_type, garment_label, field_meta, values, version, created_at")
    .eq("client_id", clientId)
    .order("version", { ascending: false });

  if (error) {
    container.innerHTML = `<p class="error-message">Erreur de chargement des mesures.</p>`;
    return;
  }
  if (!data.length) {
    container.innerHTML = `<div class="empty-state">Aucune fiche de mesure. Prends les mesures du client pour pouvoir créer une commande.</div>`;
    return;
  }

  container.innerHTML = data
    .map(
      (m, index) => `
    <div class="card measurement-card">
      <div class="measurement-card-header">
        <strong>${escapeHtml(measurementGarmentLabel(m, garmentTypes))} — version ${m.version}
          ${index === 0 ? '<span class="badge badge-in_progress">Plus récente</span>' : ""}</strong>
        <span class="text-muted text-sm">${formatDateTime(m.created_at)}</span>
      </div>
      <dl class="kv-list kv-list-compact">${measurementKvHtml(m, garmentTypes)}</dl>
      <div class="button-row">
        <a class="btn btn-secondary btn-sm" href="orders.html?new=1&client=${clientId}&measurement=${m.id}">Commander avec cette mesure</a>
      </div>
    </div>`
    )
    .join("");
}

async function handleCreateMeasurement(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("measurement-form-error");
  errorEl.textContent = "";

  const type = form.garment_type.value;
  const garment = garmentTypes.find((g) => g.key === type);
  if (!garment) {
    errorEl.textContent = "Choisis un type de vêtement.";
    return;
  }

  const values = {};
  const fieldMeta = {};
  for (const f of garment.fields) {
    const raw = form[`mf_${f.key}`]?.value;
    const num = parseFloat(String(raw).replace(",", "."));
    if (Number.isNaN(num)) {
      errorEl.textContent = `Valeur manquante : ${f.label}.`;
      return;
    }
    values[f.key] = num;
    fieldMeta[f.key] = { label: f.label, unit: f.unit || "cm" };
  }

  const submitBtn = form.querySelector("button[type=submit]");
  setButtonLoading(submitBtn, true);

  const { error } = await supabase.from("measurements").insert({
    client_id: clientId,
    garment_type: type,
    garment_label: garment.label,
    field_meta: fieldMeta,
    values,
    taken_by: currentProfile.id,
  });

  setButtonLoading(submitBtn, false);

  if (error) {
    errorEl.textContent = mapDbError(error, "Erreur lors de l'enregistrement de la mesure.");
    console.error(error);
    return;
  }

  closeModal("measurement-modal");
  showToast("Fiche de mesure enregistrée.", "success");
  await loadMeasurements();
}

// ---------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------

async function loadOrders() {
  const tbody = document.getElementById("orders-table-body");
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, garment_description, status, due_date, total_price, invoices(amount_paid)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) {
    tbody.innerHTML = tableMessageRow(5, "Erreur de chargement des commandes.", "error");
    return;
  }
  if (!data.length) {
    tbody.innerHTML = tableMessageRow(5, "Aucune commande pour ce client.");
    return;
  }

  tbody.innerHTML = data
    .map((o) => {
      const inv = Array.isArray(o.invoices) ? o.invoices[0] : o.invoices;
      return `
      <tr class="clickable-row" data-href="order-detail.html?id=${o.id}" tabindex="0">
        <td data-label="N°">${escapeHtml(o.order_number)}</td>
        <td data-label="Description">${escapeHtml(o.garment_description)}</td>
        <td data-label="Échéance">${formatDate(o.due_date)}</td>
        <td data-label="Statut">${orderStatusBadge(o)}</td>
        <td data-label="Payé / Total">${formatMoney(inv?.amount_paid || 0)} / ${formatMoney(o.total_price)}</td>
      </tr>`;
    })
    .join("");
  bindClickableRows(tbody);
}
