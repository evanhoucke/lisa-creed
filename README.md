# Liste cadeaux - Lisa Vanhoucke

Site statique (GitHub Pages) avec Supabase pour stocker les cadeaux et les participations, plus une page admin.

## 1) Créer le projet Supabase

1. Créer un projet sur [Supabase](https://supabase.com/).
2. Ouvrir `SQL Editor`.
3. Exécuter le contenu du fichier `supabase.sql`.

## 2) Configurer le frontend

1. Ouvrir `config.js`.
2. Vérifier/remplacer:
   - `supabaseUrl`
   - `supabaseAnonKey`
   - `notificationEmail` (email qui reçoit les notifications)
3. Sauvegarder.

Notification email:
- Quand une participation est enregistrée, le site envoie aussi un email via FormSubmit.
- Au premier envoi, FormSubmit demande une validation de l'adresse `notificationEmail`.

## 3) Personnaliser les cadeaux

Option A: via SQL sur Supabase (table `gifts`).
Option B: via table editor de Supabase.

Champs utiles dans `gifts`:
- `title`
- `seen_at` (affiché sous le titre: "Vu chez ...")
- `price`
- `description`
- `photo_url`
- `note`
- `is_active`
- `sort_order`

## 4) Lancer en local

Ouvrir `index.html` dans le navigateur.

## 5) Activer la page admin

1. Dans Supabase, aller dans `Authentication` > `Users`.
2. Créer un utilisateur admin (email + mot de passe).
3. Utiliser cet email/mot de passe sur `admin.html`.

La page admin permet de:
- se connecter/déconnecter
- voir le total des participations
- voir le montant cumulé
- consulter le détail des participations
- ajouter des cadeaux avec photo, description et prix approximatif
- ajouter plusieurs photos par cadeau
- modifier un cadeau existant (texte, prix, photo)
- supprimer un cadeau existant

Sur le site public:
- le montant restant est affiché pour chaque cadeau
- une participation ne peut pas dépasser le montant restant

Important:
- Le script `supabase.sql` crée le bucket `gift-photos` et les règles d'accès.
- Si tu avais déjà exécuté un ancien script, relance la version actuelle de `supabase.sql`.
- Fais un hard refresh du navigateur (`Ctrl+F5`) après mise à jour des fichiers JS.

## 6) Publier sur GitHub Pages

1. Créer un dépôt GitHub (ex: `lisa-kdo`).
2. Envoyer les fichiers:
   ```bash
   git init
   git add .
   git commit -m "Website with Supabase"
   git branch -M main
   git remote add origin git@github.com:TON-UTILISATEUR/lisa-kdo.git
   git push -u origin main
   ```
3. GitHub > `Settings` > `Pages`.
4. `Deploy from a branch`, branche `main`, dossier `/ (root)`.

Le site sera accessible à:
`https://ton-utilisateur.github.io/lisa-kdo/`

## Sécurité recommandée

- Garde la clé `service_role` secrète (ne jamais la mettre dans le site).
- Utilise uniquement la clé `anon` côté navigateur.
- Les règles RLS du fichier SQL limitent l'accès public:
  - public: lecture des cadeaux actifs + création d'une participation
  - admin authentifié: lecture de toutes les participations + gestion complète des cadeaux
