// =============================================================
// TAILORFLOW — Configuration des champs de mesure par type de vêtement
// =============================================================
// Chaque type définit la liste des champs affichés dans le formulaire
// de mesure. Les valeurs sont stockées en jsonb (colonne `values`),
// ce qui permet d'ajouter/retirer des champs sans migration de schéma.

export const GARMENT_TYPES = {
  costume: {
    label: "Costume",
    fields: [
      { key: "tour_poitrine", label: "Tour de poitrine (cm)" },
      { key: "tour_taille", label: "Tour de taille (cm)" },
      { key: "tour_bassin", label: "Tour de bassin (cm)" },
      { key: "longueur_manche", label: "Longueur de manche (cm)" },
      { key: "longueur_veste", label: "Longueur de veste (cm)" },
      { key: "largeur_epaule", label: "Largeur d'épaule (cm)" },
      { key: "longueur_pantalon", label: "Longueur de pantalon (cm)" },
    ],
  },
  chemise: {
    label: "Chemise",
    fields: [
      { key: "tour_cou", label: "Tour de cou (cm)" },
      { key: "tour_poitrine", label: "Tour de poitrine (cm)" },
      { key: "tour_taille", label: "Tour de taille (cm)" },
      { key: "longueur_manche", label: "Longueur de manche (cm)" },
      { key: "longueur_chemise", label: "Longueur de chemise (cm)" },
      { key: "largeur_epaule", label: "Largeur d'épaule (cm)" },
    ],
  },
  robe: {
    label: "Robe",
    fields: [
      { key: "tour_poitrine", label: "Tour de poitrine (cm)" },
      { key: "tour_taille", label: "Tour de taille (cm)" },
      { key: "tour_bassin", label: "Tour de bassin (cm)" },
      { key: "longueur_robe", label: "Longueur de robe (cm)" },
      { key: "longueur_manche", label: "Longueur de manche (cm)" },
      { key: "tour_emmanchure", label: "Tour d'emmanchure (cm)" },
    ],
  },
  pantalon: {
    label: "Pantalon",
    fields: [
      { key: "tour_taille", label: "Tour de taille (cm)" },
      { key: "tour_bassin", label: "Tour de bassin (cm)" },
      { key: "longueur_pantalon", label: "Longueur (cm)" },
      { key: "tour_cuisse", label: "Tour de cuisse (cm)" },
      { key: "tour_genou", label: "Tour de genou (cm)" },
      { key: "tour_bas", label: "Tour de bas (cm)" },
    ],
  },
  boubou: {
    label: "Boubou / Tenue traditionnelle",
    fields: [
      { key: "tour_poitrine", label: "Tour de poitrine (cm)" },
      { key: "longueur_totale", label: "Longueur totale (cm)" },
      { key: "largeur_epaule", label: "Largeur d'épaule (cm)" },
      { key: "longueur_manche", label: "Longueur de manche (cm)" },
      { key: "tour_poignet", label: "Tour de poignet (cm)" },
    ],
  },
};

export function getGarmentTypeOptions() {
  return Object.entries(GARMENT_TYPES).map(([key, cfg]) => ({ key, label: cfg.label }));
}

export function getFieldsForType(type) {
  return GARMENT_TYPES[type]?.fields || [];
}
