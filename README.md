# TailorFlow — Sprint 0 (Fondations)

Application de gestion d'atelier de couture : clients, mesures, commandes, facturation.

## Stack
- Frontend : HTML/CSS/JS vanilla (ES modules), déployé en statique sur **Vercel**.
- Backend : aucun serveur applicatif — **Supabase** (PostgreSQL + Auth + RLS) sert directement le frontend.
- Sécurité : Row Level Security (RLS) PostgreSQL, pas de logique d'autorisation côté client.

## Mise en place (à faire une seule fois)

1. **Créer le projet Supabase**
   - Aller sur https://supabase.com → New project → nommer `tailorflow`.
   - Noter l'URL du projet et la clé `anon public` (Project Settings → API).

2. **Exécuter les scripts SQL dans l'éditeur SQL Supabase, dans l'ordre :**
   - `sql/001_schema.sql` — tables, triggers, séquences.
   - `sql/002_rls_policies.sql` — politiques de sécurité par rôle.
   - `sql/003_auth_bootstrap.sql` — création automatique du profil à l'inscription.

3. **Configurer le client**
   - Ouvrir `js/supabaseClient.js` et remplacer `SUPABASE_URL` et `SUPABASE_ANON_KEY`
     par les valeurs de votre projet.

4. **Créer le premier compte administrateur**
   - Aller dans Supabase → Authentication → Users → Add user (email + mot de passe),
     ou s'inscrire depuis l'application une fois la page d'inscription ajoutée (Sprint 1).
   - Exécuter la requête de promotion en admin (voir le bas de `003_auth_bootstrap.sql`),
     en remplaçant l'email par celui du compte créé.

5. **Tester en local**
   - Ouvrir `login.html` via un serveur statique local (ex. extension "Live Server" de VS Code,
     ou `npx serve .`). Ne pas ouvrir le fichier directement en `file://` (les ES modules
     et les appels réseau seront bloqués par le navigateur).

## Structure du projet

```
tailorflow/
├── index.html          # Redirection selon état de session
├── login.html          # Page de connexion
├── dashboard.html       # Tableau de bord (KPI branchés au Sprint 2)
├── css/
│   └── style.css       # Styles partagés
├── js/
│   ├── supabaseClient.js  # Configuration du client Supabase
│   ├── auth.js            # login, logout, requireAuth, fetchCurrentProfile
│   └── nav.js             # Navigation dynamique selon le rôle
├── sql/
│   ├── 001_schema.sql
│   ├── 002_rls_policies.sql
│   └── 003_auth_bootstrap.sql
└── vercel.json           # Configuration de déploiement
```

## Modèle SaaS multi-tenant (depuis la migration 006)

TailorFlow fonctionne comme un SaaS : **chaque utilisateur inscrit dispose de son propre
espace personnel isolé**. Toutes les données (clients, mesures, commandes, factures,
paiements) sont rattachées au créateur via `clients.owner_id`, et les politiques RLS
garantissent qu'un utilisateur ne voit et ne modifie jamais les données d'un autre.

Le champ `role` (admin/employé/comptable) est conservé dans `profiles` à titre
informatif mais **ne restreint plus les actions** : chaque utilisateur a le plein
contrôle de son propre espace.

**Propriétaire de la plateforme** : le compte `jahadjitse@gmail.com` est le seul à
voir l'onglet "Paramètres" (gestion de l'ensemble des comptes du SaaS) et est protégé
contre toute suppression ou désactivation (triggers SQL, migration 005).

## Prochaine étape (Sprint 1 — à valider avant de démarrer)
- Module **Clients** : liste (recherche, pagination), création, fiche client, modification.
- Ajout de la page `clients.html` + `js/clients.js`.
