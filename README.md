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

## Liste d'envie et remplissage automatique (nouveau)
- Nouvel onglet « Liste d'envie » (à côté de « Contrôle ») : articles à acheter pour le logement, avec photos, pièces, prix estimé, lien, total estimé. Coché « acheté », un article passe à l'inventaire en un geste.
- Le fichier `worker.js` (fourni à part) se colle dans un Worker Cloudflare gratuit : c'est le « relais » qui lit les pages des magasins.
- Réglages > « Remplissage automatique » : coller l'adresse du relais (`https://….workers.dev`), puis « Enregistrer et tester ».
- Dans un formulaire : coller un lien dans « Lien vers l'article » remplit nom, prix, photo, descriptif, magasin et catégorie.
- Android : application installée, « Partager » depuis le navigateur ou l'application d'un magasin > « Inventaire du logement ».
- `VERSION` dans `sw.js` : `inventaire-v8`.
