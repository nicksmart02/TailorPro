# Mettre la production à jour vers TailorFlow v3

Durée : environ 15 minutes. **L'ordre des étapes est important** : le nouveau
frontend appelle des fonctions SQL qui n'existent qu'après la migration 023.
(Si le code est déployé trop tôt, l'application affiche un message demandant
d'appliquer la migration, sans rien casser.)

## Étape 1 — Sauvegarder la base

Supabase → **Database → Backups** : vérifier qu'une sauvegarde récente existe
(ou lancer une sauvegarde manuelle si votre formule le permet).

## Étape 2 — Appliquer la migration 023

1. Supabase → **SQL Editor** → *New query*.
2. Copier **tout** le contenu de `sql/023_hardening_and_saas_v3.sql`, coller, **Run**.
3. Résultat attendu : `Success. No rows returned`.

La migration est rejouable : en cas de doute, la relancer ne pose aucun problème.
Elle ne supprime aucune donnée métier. Elle a été testée sur une copie du schéma
de production (toutes les migrations 001 → 022 puis 023, avec des données
existantes) : 57 vérifications sur 57 réussies.

## Étape 3 — Vérifier la configuration de l'authentification

Supabase → **Authentication → URL Configuration** :

- *Site URL* : l'adresse Vercel de l'application ;
- *Redirect URLs* : ajouter
  - `https://<votre-domaine>/choose-role.html`
  - `https://<votre-domaine>/client-activate.html`
  - `https://<votre-domaine>/reset-password.html`

(Sans cela, les liens de confirmation d'email et de mot de passe oublié
renvoient vers la page d'accueil au lieu de la bonne page.)

## Étape 4 — Déployer le code

Remplacer le contenu du dépôt **TailorPro** par le dossier `tailorflow/` de cette
version, puis :

```bash
git add -A
git commit -m "TailorFlow v3 : sécurité base de données, administration, refonte UX"
git push
```

`git add -A` prend aussi en compte la suppression de `js/measurementFields.js`
(fichier inutilisé). Vercel redéploie automatiquement.

## Étape 5 — Vérifier en ligne (5 minutes)

Faire un rechargement forcé (Ctrl + Maj + R), puis :

- [ ] Connexion avec le compte propriétaire → menu **Administration** : statistiques,
      demandes de paiement et liste des comptes s'affichent.
- [ ] Avec un compte couturier : **Paramètres** → renseigner nom, téléphone et adresse
      de l'atelier (ils apparaissent sur les reçus).
- [ ] Créer une commande avec un acompte → la facture affiche l'acompte et le reste
      à payer ; le reçu PNG se télécharge.
- [ ] Tenter « Remis » sur une commande non soldée → message **Facture non réglée**.
- [ ] Marketplace et portail client : le **nom de l'atelier** s'affiche (avant : « Atelier »).

## Ce qui change pour les utilisateurs

| Avant | Maintenant | Pourquoi |
|---|---|---|
| Un client saisissait un numéro de téléphone et voyait **immédiatement** les fiches de tous les ateliers ayant ce numéro. | Le couturier reçoit une **demande d'accès** sur son tableau de bord et la valide en un clic. Le code d'invitation reste instantané. | N'importe qui pouvait saisir le numéro d'un inconnu et voir ses mesures, commandes et factures. |
| Deux couturiers ne pouvaient pas enregistrer le même numéro client (erreur « existe déjà »). | Chaque atelier a ses propres clients, même numéro possible. | Le téléphone était unique sur toute la plateforme. |
| Numéros CMD/FAC partagés entre tous les ateliers. | Chaque atelier a sa propre numérotation (continuité garantie avec l'historique). | Un nouvel atelier commençait à CMD-2026-0347. |
| Abonnement expiré : blocage seulement dans le navigateur. | La base refuse toute écriture tant que l'abonnement n'est pas réglé (lecture conservée). | Le blocage était contournable. |
| Menu « Paramètres » du propriétaire. | Menu « Administration ». | Gestion de la plateforme regroupée. |

**À vérifier une fois** : les comptes clients rattachés **avant** cette mise à jour
par simple numéro de téléphone restent rattachés. Si un rattachement vous semble
douteux, ouvrez la fiche client concernée → « Retirer l'accès ».
