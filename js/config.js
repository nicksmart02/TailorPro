// =============================================================
// TAILORFLOW — Configuration centrale de l'application
// =============================================================
// Toutes les valeurs « métier » modifiables sont regroupées ici.
// Les tarifs doivent rester identiques à ceux de la fonction SQL
// public.plan_price() (migration 023), qui fait foi côté serveur.
// =============================================================

export const APP_NAME = "TailorFlow";
export const CURRENCY = "FCFA";

/** Indicatif pays utilisé pour les liens WhatsApp quand le numéro n'en a pas. */
export const DEFAULT_COUNTRY_CODE = "228";

/** Formules d'abonnement proposées aux ateliers. */
export const PLANS = {
  mensuel: { label: "Mensuel", amount: 10000, periodLabel: "/mois", note: "" },
  annuel: { label: "Annuel", amount: 100000, periodLabel: "/an", note: "2 mois offerts" },
};

/**
 * Paiement Mobile Money par code USSD (Togo).
 * Les codes ne sont jamais affichés : ils sont injectés dans un lien tel:
 * au moment du clic.
 */
export const MOBILE_MONEY = {
  tmoney: {
    label: "TMoney",
    buildCode: (amount) => `*145*1*1*${amount}*92502272*1#`,
  },
  flooz: {
    label: "Flooz",
    buildCode: (amount) => `*155*1*1*98960353*${amount}#`,
  },
};

/** Nombre de jours avant la date de remise à partir duquel une commande est signalée. */
export const DELIVERY_ALERT_DAYS = 3;

/** Nombre de jours d'essai restants à partir duquel un rappel est affiché. */
export const TRIAL_WARNING_DAYS = 5;

/**
 * Contact du support (affiché sur la page Abonnement).
 * Laisser vide pour masquer. WhatsApp : numéro au format international sans "+".
 */
export const SUPPORT = {
  whatsapp: "",
  email: "",
};
