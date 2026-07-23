// =============================================================
// TAILORFLOW — Génération de reçu (PNG + gabarit imprimable PDF)
// =============================================================
// Un seul gabarit HTML sert à la fois :
//  - à la capture PNG hors-écran (html2canvas) juste après facturation
//  - à l'affichage imprimable dans invoice-detail.html (export PDF navigateur)
// Nécessite html2canvas (chargé en CDN dans les pages appelantes) pour le PNG.

import { formatMoney, formatDate, escapeHtml } from "./utils.js";

/**
 * Construit le HTML interne du reçu (sans le conteneur de positionnement).
 * @param {object} data { invoiceNumber, clientName, clientPhone, orderNumber,
 *   garmentDescription, quantity, unitPrice, totalAmount, amountPaid, issuedAt, dueDate }
 */
export function receiptInnerHTML(data) {
  const remaining = Math.max(0, (data.totalAmount || 0) - (data.amountPaid || 0));
  const isPaid = remaining <= 0;

  return `
    <div style="text-align:center; margin-bottom:18px;">
      <div style="font-size:1.2rem; font-weight:700; color:#234867;">TailorFlow</div>
      <div style="font-size:0.75rem; color:#6b7280;">Reçu de facturation</div>
    </div>
    <div style="border-top:1px dashed #999; border-bottom:1px dashed #999; padding:12px 0; margin-bottom:12px; font-size:0.85rem;">
      <div style="display:flex; justify-content:space-between;"><span>N° facture</span><strong>${escapeHtml(data.invoiceNumber)}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>N° commande</span><strong>${escapeHtml(data.orderNumber)}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>Date</span><strong>${formatDate(data.issuedAt)}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>Date de remise</span><strong>${formatDate(data.dueDate)}</strong></div>
    </div>
    <div style="font-size:0.85rem; margin-bottom:12px;">
      <div><strong>Client :</strong> ${escapeHtml(data.clientName)}</div>
      <div><strong>Téléphone :</strong> ${escapeHtml(data.clientPhone)}</div>
    </div>
    <div style="font-size:0.85rem; margin-bottom:12px;">
      <div><strong>Article :</strong> ${escapeHtml(data.garmentDescription)}</div>
      <div><strong>Quantité :</strong> ${data.quantity}</div>
      <div><strong>Prix unitaire :</strong> ${formatMoney(data.unitPrice)}</div>
    </div>
    <div style="border-top:1px dashed #999; padding-top:10px; font-size:0.95rem;">
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Total</span><strong>${formatMoney(data.totalAmount)}</strong></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px; color:#1f9d55;"><span>Montant payé</span><strong>${formatMoney(data.amountPaid || 0)}</strong></div>
      <div style="display:flex; justify-content:space-between; font-size:1.05rem; ${isPaid ? "" : "color:#d97706;"}">
        <span>${isPaid ? "Statut" : "Reste à payer"}</span>
        <strong>${isPaid ? "PAYÉ INTÉGRALEMENT" : formatMoney(remaining)}</strong>
      </div>
    </div>
    <div style="text-align:center; margin-top:20px; font-size:0.7rem; color:#6b7280;">
      Document généré automatiquement — TailorFlow
    </div>
  `;
}

/**
 * Rend le reçu hors-écran, le capture en PNG via html2canvas et déclenche
 * le téléchargement, puis nettoie le DOM.
 */
export async function generateAndDownloadReceipt(data) {
  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "position:fixed; top:-9999px; left:-9999px; width:420px; background:#fff; " +
    "font-family:Arial, sans-serif; color:#1c1f26; padding:28px; border:1px solid #e2e4e9;";
  wrapper.innerHTML = receiptInnerHTML(data);
  document.body.appendChild(wrapper);

  try {
    const canvas = await html2canvas(wrapper, { scale: 2, backgroundColor: "#ffffff" });
    const link = document.createElement("a");
    link.download = `recu-${data.invoiceNumber}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } finally {
    document.body.removeChild(wrapper);
  }
}

/**
 * Affiche le même gabarit dans un conteneur visible de la page (utilisé pour
 * l'impression / export PDF), afin que le PDF ait exactement le même rendu
 * que le reçu PNG généré à la facturation.
 */
export function renderPrintableReceipt(containerEl, data) {
  containerEl.innerHTML = receiptInnerHTML(data);
}
