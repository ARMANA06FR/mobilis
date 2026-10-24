# Inventaire du logement (PWA)

Application d'inventaire pour logement en location courte durée : articles, catégories libres, photos multiples,
descriptif du commerçant, prix, quantité, lieu d'achat, lien, recherche par mot-clé et contrôle de départ des locataires.

## Mise en ligne sur GitHub Pages
1. Créez un dépôt GitHub (ex. `inventaire-logement`).
2. Envoyez-y tous les fichiers de ce dossier à la racine (Add file > Upload files).
3. Settings > Pages > Source : « Deploy from a branch », branche `main`, dossier `/ (root)` > Save.
4. L'adresse sera `https://VOTRE-PSEUDO.github.io/inventaire-logement/` (1 à 2 minutes).
5. Ouvrez-la sur le téléphone avec Chrome, menu ⋮ > « Installer l'application ».

## Important
- Les données (articles, photos) restent dans le navigateur de l'appareil, pas dans le dépôt GitHub : vos photos ne sont donc pas publiques.
- Réglages > « Sauvegarder » produit un fichier .json complet (photos incluses) : à faire régulièrement, et pour copier l'inventaire sur un autre appareil.
- Pour publier une mise à jour du code, changez `VERSION` dans `sw.js` (ex. `inventaire-v2`).
