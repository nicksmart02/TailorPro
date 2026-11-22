# TailorFlow — v3

Application SaaS de gestion d'atelier de couture : clients, mesures, commandes,
facturation automatique, reçus PNG/PDF, rapports, abonnements Mobile Money,
portail client et marketplace multi-ateliers.

> **Vous mettez à jour l'instance en production ?** Suivez [MISE-A-JOUR-V3.md](MISE-A-JOUR-V3.md)
> (la migration SQL 023 doit être appliquée **avant** de déployer ce code).
> Détail des changements : [CHANGELOG.md](CHANGELOG.md).

---

## 1. Fonctionnalités

| Espace | Ce qu'on y fait |
|---|---|
| **Couturier** | Tableau de bord (KPI, alertes de remise, commandes reçues en ligne, demandes d'accès clients), clients (recherche, fiche, modification, suppression), fiches de mesures versionnées, commandes (création avec acompte, modification, suppression, avancement par étapes, blocage « Facture non réglée »), factures (paiements, suppression d'un paiement erroné, reçu PNG, impression PDF, envoi WhatsApp), rapports (période, Excel, PDF, encaissements par moyen de paiement), types de vêtements, catalogue photo, paramètres de l'atelier, abonnement. |
| **Client final** | Portail multi-ateliers : commandes, factures (reçu téléchargeable), mesures ; ajout d'un atelier par code d'invitation ou demande par téléphone ; commande à distance depuis la marketplace au prix du catalogue. |
| **Propriétaire de la plateforme** | Administration : statistiques (ateliers, abonnés, essais, expirés, revenu mensuel récurrent), validation/refus des paiements Mobile Money, prolongation manuelle d'abonnement (+1 mois / +1 an), activation/désactivation des comptes. |

## 2. Architecture

```
Navigateur (HTML + CSS + modules ES, sans build)
      │  supabase-js (CDN, version épinglée)
      ▼
Supabase : Auth · PostgreSQL (RLS + déclencheurs + fonctions RPC) · Storage (photos)
      ▲
Vercel : hébergement statique + en-têtes de sécurité (vercel.json)
```

**Principe de sécurité : la base de données fait foi.** Toutes les règles métier
sensibles sont appliquées par PostgreSQL (politiques RLS, déclencheurs, fonctions
`SECURITY DEFINER`), jamais uniquement par le navigateur :

- isolation stricte des données par atelier (`owner_id`) ;
- abonnement actif exigé pour toute écriture (essai 14 jours puis payant) ;
- facture créée automatiquement, total recalculé, paiement plafonné au solde ;
- remise impossible tant que la facture n'est pas réglée ;
- prix d'une commande à distance imposé par le catalogue ;
- rôle, statut et email d'un compte non modifiables par l'utilisateur lui-même ;
- rattachement client ↔ atelier par code d'invitation ou validation du couturier ;
- montant d'une demande de paiement fixé par la base selon la formule.

## 3. Structure du projet

```
tailorflow/
├── *.html                  # une page par écran (voir tableau ci-dessous)
├── 404.html                # page introuvable (Vercel)
├── favicon.svg, manifest.webmanifest   # icône + installation sur téléphone
├── css/style.css           # feuille de style unique (responsive, impression)
├── js/
│   ├── config.js           # ⚙️ tarifs, codes USSD, délais d'alerte, contact support
│   ├── supabaseClient.js   # URL + clé publique du projet Supabase
│   ├── auth.js             # connexion, gardes d'accès, rôles, abonnement
│   ├── nav.js              # navigation couturier / client (menu mobile)
│   ├── utils.js            # formatage, erreurs → messages FR, modales, mesures
│   ├── receipt.js          # gabarit unique du reçu (PNG + PDF)
│   └── <page>.js           # un module par page
├── sql/                    # migrations, à exécuter dans l'ordre (voir sql/README.md)
├── tests/sql/run_tests.py  # 57 vérifications automatiques des règles SQL
└── vercel.json             # URLs propres + en-têtes de sécurité (CSP, HSTS...)
```

| Page | Rôle |
|---|---|
| `index.html` | Redirection selon la session et le rôle |
| `login`, `signup`, `forgot-password`, `reset-password` | Authentification |
| `choose-role.html` | Choix couturier / client après inscription |
| `dashboard.html` | Tableau de bord couturier |
| `clients.html`, `client-detail.html` | Clients, mesures, accès portail |
| `orders.html`, `order-detail.html` | Commandes |
| `invoices.html`, `invoice-detail.html` | Factures, paiements, reçus |
| `reports.html` | Rapports et exports |
| `garment-types.html` | Types de vêtements et champs de mesure |
| `catalog-manage.html` | Catalogue photo de l'atelier |
| `marketplace.html` | Catalogues de tous les ateliers actifs |
| `subscription.html` | Abonnement et paiement Mobile Money |
| `settings.html` | Paramètres de l'atelier / administration de la plateforme |
| `client-portal.html` | Espace du client final |
| `client-signup.html`, `client-activate.html` | Activation de l'espace client par code |

## 4. Installation d'une instance neuve

1. **Créer un projet Supabase** et noter l'URL + la clé `anon`/`publishable`
   (Project Settings → API).
2. **Exécuter les migrations** dans l'éditeur SQL, dans l'ordre indiqué par
   [sql/README.md](sql/README.md). Chaque fichier s'exécute en une fois ; les
   fichiers marqués « seul » doivent être lancés dans leur propre requête.
3. **Configurer l'authentification** (Authentication → URL Configuration) :
   - *Site URL* : l'adresse de déploiement (ex. `https://tailorflow.vercel.app`) ;
   - *Redirect URLs* : `https://<domaine>/choose-role.html`,
     `https://<domaine>/client-activate.html`, `https://<domaine>/reset-password.html`.
4. **Renseigner** `js/supabaseClient.js` (URL + clé publique) et relire `js/config.js`.
5. **Désigner le propriétaire de la plateforme** : son identifiant est figé dans
   la fonction `public.is_platform_owner()` (migration 005). Pour une autre
   instance, remplacer l'UUID par celui du compte propriétaire.
6. **Déployer** sur Vercel (import du dépôt GitHub, aucun réglage de build).

> Ne jamais ouvrir les pages en `file://` : les modules ES et les appels réseau
> seraient bloqués. En local, utiliser un serveur statique (`npx serve .`).

## 5. Configuration métier (`js/config.js`)

| Constante | Rôle |
|---|---|
| `PLANS` | Libellés et montants affichés. **Doivent rester identiques** à `public.plan_price()` (migration 023), qui fait foi. |
| `MOBILE_MONEY` | Codes USSD TMoney / Flooz (le montant de la formule y est injecté ; jamais affichés à l'écran). |
| `DELIVERY_ALERT_DAYS` | Fenêtre d'alerte avant la date de remise (3 jours). |
| `TRIAL_WARNING_DAYS` | Rappel de fin d'essai/abonnement (5 jours). |
| `SUPPORT` | WhatsApp / email du support affichés sur la page Abonnement (vide = masqué). |
| `DEFAULT_COUNTRY_CODE` | Indicatif ajouté aux liens WhatsApp (228). |

## 6. Tests

- **Règles de la base** : `tests/sql/run_tests.py` déroule toutes les migrations
  sur un PostgreSQL local, insère des données « historiques », applique 023
  (trois fois, pour vérifier qu'elle est rejouable) puis contrôle 57 règles
  (sécurité, abonnement, numérotation, paiements, commandes à distance...).
  Mode d'emploi : [tests/README.md](tests/README.md).
- **Interface** : chaque écran a été parcouru dans un navigateur (bureau et
  mobile 375 px) avec la politique de sécurité (CSP) de `vercel.json` active.

## 7. Limites connues

- Le paiement Mobile Money n'est pas vérifié automatiquement : le propriétaire
  valide chaque demande après réception des fonds (une passerelle type CinetPay
  ou PayDunya permettrait d'automatiser).
- Les alertes de remise sont affichées dans l'application (pas d'envoi SMS).
- Un navigateur ne peut pas lancer un appel USSD sans confirmation : le client
  appuie une fois sur le bouton d'appel de son téléphone.
