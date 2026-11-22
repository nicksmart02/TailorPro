# Journal des changements

## v3.0 — novembre 2026

### Sécurité (corrigé dans la base de données — migration 023)

- **Fuite de données par numéro de téléphone** : le choix du rôle « client »
  rattachait automatiquement le compte à toutes les fiches portant le numéro
  saisi, sans vérification. Le rattachement devient une demande validée par le
  couturier ; le client ne voit que le nombre de demandes en attente.
- **Élévation de privilèges** : un utilisateur pouvait modifier son propre rôle,
  son statut ou son email via l'API. Bloqué par un déclencheur.
- **Abonnement contournable** : l'expiration n'était vérifiée que dans le
  navigateur. Toute écriture (clients, mesures, commandes, paiements, catalogue,
  types) exige désormais un essai ou un abonnement actif.
- **Montant de paiement falsifiable** : le montant d'une demande d'abonnement
  venait du navigateur. Il est imposé par la base (`plan_price`) ; une seule
  demande en attente à la fois ; politiques des tables d'abonnement réécrites
  (aucune modification directe possible).
- **Factures modifiables à la main** : un atelier pouvait passer une facture en
  « payée » sans paiement et contourner « Facture non réglée ». Les factures ne
  sont plus modifiables que par les déclencheurs.
- **Commande créée directement au statut « remis »** : refusée.
- **Commande à distance** : statut, créateur et prix forcés côté base ; la mesure
  doit appartenir au client ; l'atelier doit être actif.
- **Code d'invitation** : ne peut plus transformer un compte couturier en client.
- Vue `marketplace_establishments` (exposée sans RLS, inutilisée) supprimée.
- Bucket photos : 5 Mo maximum, images JPEG/PNG/WebP uniquement.
- Frontend : en-têtes HTTP renforcés (Content-Security-Policy, HSTS,
  Permissions-Policy), scripts en ligne déplacés dans des fichiers, version de
  supabase-js épinglée (2.119.2), échappement HTML renforcé (guillemets),
  filtres de recherche nettoyés (injection de syntaxe PostgREST).

### Intégrité des données

- Téléphone client unique **par atelier** (et non plus sur toute la plateforme).
- Numérotation CMD / FAC **par atelier et par année**, reprise sans collision
  depuis les numéros existants.
- Total de commande toujours recalculé par la base ; facture synchronisée quand
  le prix, la quantité ou la date de remise changent ; total inférieur au déjà
  payé refusé.
- Paiement supérieur au solde refusé ; suppression d'un paiement → facture
  recalculée ; paiements et prix verrouillés une fois la commande remise.
- Création de commande + acompte atomique (`create_order_with_payment`).
- Abonnement : les jours d'essai restants sont conservés lors du paiement ;
  validation d'un paiement même si la ligne d'abonnement manquait.
- Mesures : libellés et unités enregistrés avec chaque fiche (lisibles par le
  client et inchangés si le type de vêtement est modifié ensuite).
- Tables d'abonnement (créées hors dépôt) reconstituées dans `012b` : une
  installation neuve déroule désormais toutes les migrations sans erreur.

### Corrections de bugs

- Marketplace et portail client affichaient « Atelier » au lieu du nom de
  l'atelier (profils illisibles à cause de la RLS) → fonction `public_establishments`.
- La page Catalogue d'un couturier affichait aussi les articles des autres ateliers.
- Les mesures s'affichaient avec leurs clés techniques (« tour cou ») et l'unité
  « cm » forcée → libellés et unités réels.
- Modifier un libellé de champ dans un type de vêtement changeait sa clé et
  « perdait » le lien avec les mesures existantes → clés conservées.
- Boucle de redirection possible entre la connexion et une page protégée en cas
  d'erreur réseau → écran d'erreur avec « Recharger » / « Se déconnecter ».
- Dates décalées d'un jour selon le fuseau (dates « AAAA-MM-JJ » lues en UTC).
- Variable CSS `--color-bg-alt` utilisée mais jamais définie ; liens stylés en
  bouton soulignés ; bannières dont le texte était éclaté.
- KPI « factures impayées » et chiffre d'affaires comptaient les commandes annulées.

### Nouvelles fonctionnalités

- **Administration de la plateforme** : statistiques (ateliers, abonnés, essais,
  expirés, revenu mensuel récurrent), liste des comptes avec abonnement et
  activité, prolongation manuelle (+1 mois / +1 an), validation des paiements
  avec opérateur et référence de transaction.
- **Tableau de bord** : rappel de fin d'essai, demandes d'accès clients à
  valider, commandes reçues en ligne, indicateur « Encaissé ce mois ».
- **Clients** : modification et suppression de la fiche, colonne « espace en
  ligne », invitation copiable ou envoyée par WhatsApp, retrait de l'accès,
  « Commander avec cette mesure ».
- **Commandes** : recherche, filtres « en cours » et « en retard », modification
  (description, mesure, tissu, quantité, prix, date), suppression d'une commande
  sans paiement, frise d'avancement, « Prévenir le client » par WhatsApp quand
  la commande est prête, moyen de paiement de l'acompte.
- **Factures** : colonne « reste à payer », bouton « Tout le solde », suppression
  d'un paiement erroné, envoi du récapitulatif par WhatsApp, reçu avec le nom,
  l'adresse et le téléphone de l'atelier et l'historique des paiements.
- **Rapports** : raccourcis de période, encaissements de la période par moyen de
  paiement, option d'inclure les commandes annulées, export Excel enrichi.
- **Abonnement** : formules et codes USSD centralisés dans `js/config.js`,
  choix de l'opérateur, référence de transaction, suivi de la demande en cours.
- **Catalogue** : compression automatique des grandes photos, retrait de photo,
  nettoyage du stockage lors du remplacement ou de la suppression.
- **Portail client** : ajout d'un atelier par code, reçus téléchargeables,
  contact de l'atelier (appel / WhatsApp), mesures repliables.
- **Paramètres** : téléphone et adresse de l'atelier.
- Application installable sur téléphone (manifeste + icône), page 404.

### Expérience utilisateur

- Refonte de la feuille de style : en-tête fixe, menu mobile (fermeture au clic
  extérieur et avec Échap), tableaux en cartes sur mobile, modales en feuille
  basse sur mobile, indicateurs sur 2 colonnes, états vides, focus visible.
- Modales accessibles (rôle `dialog`, Échap, clic sur le fond), notifications
  annoncées aux lecteurs d'écran, lignes de tableau navigables au clavier.
- Messages d'erreur de la base traduits en français clair.
- Confirmation du mot de passe à l'inscription ; liens de confirmation d'email
  qui ramènent directement sur la bonne page.
