// =============================================================
// TAILORFLOW — Génération de reçu (PNG) pour traçabilité
// =============================================================
// Utilisé à chaque génération de facture : produit une image PNG
// du reçu, téléchargée automatiquement, conservée comme preuve.
// Nécessite html2canvas (chargé en CDN dans la page appelante).

import { formatMoney, formatDate, escapeHtml } from "./utils.js";

/**
 * Construit le HTML du reçu et le rend hors-écran, capture en PNG,
 * déclenche le téléchargement, puis nettoie le DOM.
 * @param {object} data { invoiceNumber, clientName, clientPhone, orderNumber, garmentDescription, quantity, unitPrice, totalAmount, issuedAt }
 */
export async function generateAndDownloadReceipt(data) {
  const container = buildReceiptElement(data);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff" });
    const link = document.createElement("a");
    link.download = `recu-${data.invoiceNumber}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } finally {
    document.body.removeChild(container);
  }
}

function buildReceiptElement(data) {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:fixed; top:-9999px; left:-9999px; width:420px; background:#fff; font-family:Arial, sans-serif; color:#1c1f26; padding:28px; border:1px solid #e2e4e9;";

  wrapper.innerHTML = `
    <div style="text-align:center; margin-bottom:18px;">
      <div style="font-size:1.2rem; font-weight:700; color:#234867;">TailorFlow</div>
      <div style="font-size:0.75rem; color:#6b7280;">Reçu de facturation</div>
    </div>
    <div style="border-top:1px dashed #999; border-bottom:1px dashed #999; padding:12px 0; margin-bottom:12px; font-size:0.85rem;">
      <div style="display:flex; justify-content:space-between;"><span>N° facture</span><strong>${escapeHtml(data.invoiceNumber)}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>N° commande</span><strong>${escapeHtml(data.orderNumber)}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>Date</span><strong>${formatDate(data.issuedAt)}</strong></div>
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
    <div style="border-top:1px dashed #999; padding-top:10px; display:flex; justify-content:space-between; font-size:1rem;">
      <strong>Total</strong><strong>${formatMoney(data.totalAmount)}</strong>
    </div>
    <div style="text-align:center; margin-top:20px; font-size:0.7rem; color:#6b7280;">
      Document généré automatiquement — TailorFlow
    </div>
  `;

  return wrapper;
}
