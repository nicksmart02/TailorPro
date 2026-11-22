// =============================================================
// TAILORFLOW — Reçu de facturation (PNG + gabarit imprimable PDF)
// =============================================================
// Un seul gabarit HTML sert :
//  - à la capture PNG (html2canvas, chargé en CDN par les pages appelantes)
//  - à l'impression / export PDF (invoice-detail.html)
// Le PNG et le PDF ont donc exactement le même rendu.

import { formatMoney, formatDate, escapeHtml, PAYMENT_METHOD_LABELS } from "./utils.js";

/**
 * Construit les données du reçu à partir d'une facture chargée avec sa commande et son client.
 * @param {object} invoice - { invoice_number, issued_at, amount_total, amount_paid, orders: {...} }
 * @param {object} establishment - { name, phone, address }
 * @param {Array} [payments] - paiements { amount, payment_method, paid_at }
 */
export function receiptDataFromInvoice(invoice, establishment = {}, payments = []) {
  const order = invoice.orders || {};
  const client = order.clients || {};
  return {
    establishmentName: establishment.name,
    establishmentPhone: establishment.phone,
    establishmentAddress: establishment.address,
    invoiceNumber: invoice.invoice_number,
    orderNumber: order.order_number || "—",
    issuedAt: invoice.issued_at,
    dueDate: order.due_date,
    clientName: client.full_name || "—",
    clientPhone: client.phone || "—",
    garmentDescription: order.garment_description || "—",
    fabric: order.fabric,
    quantity: order.quantity || 1,
    unitPrice: order.unit_price ?? invoice.amount_total,
    totalAmount: invoice.amount_total,
    amountPaid: invoice.amount_paid,
    payments,
  };
}

/** HTML interne du reçu (sans le conteneur de positionnement). */
export function receiptInnerHTML(data) {
  const total = Number(data.totalAmount || 0);
  const paid = Number(data.amountPaid || 0);
  const remaining = Math.max(0, total - paid);
  const isPaid = remaining <= 0;
  const row = (label, value) =>
    `<div style="display:flex; justify-content:space-between; gap:12px;"><span>${label}</span><strong style="text-align:right;">${value}</strong></div>`;

  const paymentsHtml = (data.payments || []).length
    ? `<div style="font-size:0.78rem; color:#4b5563; margin-top:8px;">
        ${data.payments
          .map((p) => row(`${formatDate(p.paid_at)} · ${escapeHtml(PAYMENT_METHOD_LABELS[p.payment_method] || p.payment_method)}`, formatMoney(p.amount)))
          .join("")}
       </div>`
    : "";

  return `
    <div style="text-align:center; margin-bottom:16px;">
      <div style="font-size:1.2rem; font-weight:700; color:#234867;">${escapeHtml(data.establishmentName || "TailorFlow")}</div>
      ${data.establishmentAddress ? `<div style="font-size:0.75rem; color:#4b5563;">${escapeHtml(data.establishmentAddress)}</div>` : ""}
      ${data.establishmentPhone ? `<div style="font-size:0.75rem; color:#4b5563;">Tél. ${escapeHtml(data.establishmentPhone)}</div>` : ""}
      <div style="font-size:0.75rem; color:#6b7280; margin-top:4px; text-transform:uppercase; letter-spacing:0.05em;">Reçu de facturation</div>
    </div>
    <div style="border-top:1px dashed #999; border-bottom:1px dashed #999; padding:12px 0; margin-bottom:12px; font-size:0.85rem; display:grid; gap:2px;">
      ${row("N° facture", escapeHtml(data.invoiceNumber))}
      ${row("N° commande", escapeHtml(data.orderNumber))}
      ${row("Date", formatDate(data.issuedAt))}
      ${row("Date de remise", formatDate(data.dueDate))}
    </div>
    <div style="font-size:0.85rem; margin-bottom:12px; display:grid; gap:2px;">
      <div><strong>Client :</strong> ${escapeHtml(data.clientName)}</div>
      <div><strong>Téléphone :</strong> ${escapeHtml(data.clientPhone)}</div>
    </div>
    <div style="font-size:0.85rem; margin-bottom:12px; display:grid; gap:2px;">
      <div><strong>Article :</strong> ${escapeHtml(data.garmentDescription)}</div>
      ${data.fabric ? `<div><strong>Tissu :</strong> ${escapeHtml(data.fabric)}</div>` : ""}
      <div><strong>Quantité :</strong> ${escapeHtml(data.quantity)}</div>
      <div><strong>Prix unitaire :</strong> ${formatMoney(data.unitPrice)}</div>
    </div>
    <div style="border-top:1px dashed #999; padding-top:10px; font-size:0.95rem; display:grid; gap:4px;">
      ${row("Total", formatMoney(total))}
      <div style="display:flex; justify-content:space-between; color:#1f9d55;"><span>Montant payé</span><strong>${formatMoney(paid)}</strong></div>
      ${paymentsHtml}
      <div style="display:flex; justify-content:space-between; font-size:1.05rem; margin-top:4px; ${isPaid ? "color:#1f9d55;" : "color:#b45309;"}">
        <span>${isPaid ? "Statut" : "Reste à payer"}</span>
        <strong>${isPaid ? "PAYÉ INTÉGRALEMENT" : formatMoney(remaining)}</strong>
      </div>
    </div>
    <div style="text-align:center; margin-top:20px; font-size:0.7rem; color:#6b7280;">
      Merci pour votre confiance · Document généré avec TailorFlow
    </div>
  `;
}

/**
 * Rend le reçu hors écran, le capture en PNG (html2canvas) et le télécharge.
 * @throws {Error} si html2canvas n'est pas disponible
 */
export async function generateAndDownloadReceipt(data) {
  if (typeof window.html2canvas !== "function") {
    throw new Error("Module de capture indisponible (html2canvas non chargé).");
  }

  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "position:fixed; top:0; left:-10000px; width:420px; background:#fff; " +
    "font-family:Arial, Helvetica, sans-serif; color:#1c1f26; padding:28px; border:1px solid #e2e4e9;";
  wrapper.innerHTML = receiptInnerHTML(data);
  document.body.appendChild(wrapper);

  try {
    const canvas = await window.html2canvas(wrapper, { scale: 2, backgroundColor: "#ffffff", logging: false });
    const link = document.createElement("a");
    link.download = `recu-${String(data.invoiceNumber || "facture").replace(/[^\w-]/g, "")}.png`;
    link.href = canvas.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    wrapper.remove();
  }
}

/** Affiche le gabarit dans un conteneur de la page (impression / export PDF). */
export function renderPrintableReceipt(containerEl, data) {
  containerEl.innerHTML = receiptInnerHTML(data);
}

/** Informations d'atelier à partir du profil couturier connecté. */
export function establishmentFromProfile(profile) {
  return {
    name: profile?.establishment_name || profile?.full_name || "TailorFlow",
    phone: profile?.establishment_phone || "",
    address: profile?.establishment_address || "",
  };
}
