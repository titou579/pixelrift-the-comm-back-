# 🌌 PIXELRIFT

Mini battle royale 3D jouable dans le navigateur — mécanique signature : le **Rift** (mini portail qui te téléporte à courte distance, cooldown court).

## Lancer le jeu sur ton PC

```bash
npm start
```

À lancer à la racine du projet (là où se trouve ce fichier). Au premier lancement, le script installe tout seul les dépendances et crée `server/.env`. Ensuite :

- **Jeu** : http://localhost:5173
- **Amis sur le même Wi-Fi** : l'adresse `http://IP-DE-TON-PC:5173` s'affiche dans le terminal.
- Comptes créés au **premier lancement** : `titou` (administrateur), `thomas`, `hugo`, `lilou`, `matteo` — mot de passe `pixelrift` (ou celui de `server/.env`). Ensuite les mots de passe sont **hachés** dans `server/data/accounts.json` : change-les dans le jeu (**Quartier général → Compte**), ou via l'administration. Les lignes `ACCOUNT_*_PWD` du `.env` ne servent plus après la première création.
- Un match démarre quand **2 joueurs** sont dans le salon (un seul joueur peut s'entraîner sur les sphères roses de l'avenue centrale).

### Jouer avec quelqu'un qui n'est pas chez toi

L'adresse `192.168.x.x` ne marche que dans ta maison. Pour inviter un cousin ou un ami ailleurs, ouvre un **tunnel gratuit** (Cloudflare, sans compte) dans un second terminal pendant que `npm start` tourne :

```bash
cloudflared tunnel --url http://localhost:5173
```

Il affiche une adresse `https://….trycloudflare.com` à envoyer à ton ami (elle change à chaque lancement, et le jeu s'arrête pour lui quand tu fermes ton PC ou le tunnel).
**Avant de partager cette adresse, change les mots de passe dans `server/.env`** : le mot de passe local par défaut ne doit jamais être exposé sur internet.

Pas besoin de GitHub ni de Render pour jouer. Les comptes sont sauvegardés dans `server/data/players.json` sur ton PC.

## Commandes

| Touche | Action |
|---|---|
| ZQSD / flèches | Se déplacer (les marches et bordures jusqu'à 50 cm s'enjambent) |
| Espace / Shift | Sauter / courir |
| C (en courant) | Glisser : élan rapide, caméra basse, fonctionne aussi pour esquiver |
| V (maintenu) | Parler (chat vocal, volume selon la distance) |
| Clic gauche / clic droit | Tirer / viser (zoom + précision, lunette pour le sniper) |
| R | Recharger |
| 1 à 4 / molette | Changer d'arme |
| E | Rift (téléportation) |
| Tab | Scores |
| F3 | Afficher / cacher le compteur de FPS |
| Échap | Libérer la souris (menu : arsenal, crédits) |

## Skins, boutique et personnage

- **9 skins** : la *Recrue* (skin de base, gratuit), 5 variantes de couleur du mannequin (Ombre, Désert, Polaire, Écarlate, Néon) et 3 modèles 3D : *Le Civil*, *Striker*, *Soldat tactique*. Plus 5 traînées de balles.
- Ton personnage apparaît **au centre du menu** avec la première arme de ton arsenal en main ; glisse la souris dessus pour le faire tourner. Dans un salon, chaque joueur apparaît avec son skin et son arme, et les adversaires te voient avec ton skin en match.
- Les modèles fournis pesaient 25, 47 et 260 Mo : ils ont été optimisés (0,95 à 5 Mo) : textures de 1024 px, maillage nettoyé, hauteur 1,80 m, bras posés pour tenir l'arme.

## Équipes

L'hôte du salon choisit **Solo** ou **Équipes** (Alpha contre Bravo) et l'objectif (10, 15, 25 ou 40 éliminations). Chacun choisit son équipe avant de déployer. En match : pas de tir allié, alliés en vert et ennemis en rouge, apparition à l'ouest ou à l'est selon l'équipe, score d'équipe à l'écran, classement par équipe et récompenses de victoire d'équipe.

## Économie (NovaCoins, niveaux, pass)

Tout est réglé dans `server/src/economy.js` (et par l'admin pour les événements).

| Récompense de match | NovaCoins | XP |
|---|---|---|
| Participation (45 s minimum) | 25 | 100 |
| Élimination | 12 | 40 |
| Tir à la tête (bonus) | 6 | 15 |
| Victoire (solo ou équipe) | 80 | 200 |

- **Niveaux** jusqu'à 100 (600 XP pour le niveau 2, +120 XP par niveau suivant). Les skins rares et au-delà demandent un niveau minimum.
- **Quêtes** : 3 quotidiennes et 3 hebdomadaires, tirées au sort, avec NovaCoins et XP.
- **Pass de combat** : 30 paliers de 800 XP par saison, piste gratuite et piste Premium (2000 NovaCoins, récompenses récupérables rétroactivement). Skins exclusifs à certains paliers. Si tu possèdes déjà une récompense, tu reçois un remboursement partiel.
- **Prix** : 400 (commun), 900 (rare), 1800 (épique), 3500 (légendaire).

## Compte et administration

- **Compte** : changer de pseudo (3 à 16 caractères, une fois par heure) et de mot de passe (8 caractères minimum, les autres appareils sont déconnectés). Le serveur identifie les joueurs par leur session, jamais par un nom envoyé par le navigateur.
- **Administration** (compte administrateur, onglet dédié du Quartier général) :
  - *Joueurs* : créer / supprimer / suspendre un compte, réinitialiser un mot de passe, nommer un administrateur, donner ou retirer pièces, XP et objets, renommer, expulser, remettre les stats à zéro ;
  - *Boutique* : prix, rareté, niveau minimum, activation, « récompense de pass uniquement » ;
  - *Importer* : ajouter un skin 3D (.glb) avec ses crédits, ou créer une variante de couleur avec aperçu en direct ;
  - *Économie & saison* : multiplicateurs d'XP et de pièces (week-end double XP), soldes, nouvelle saison de pass, annonces ;
  - *Salons* : salons et joueurs en direct, fermeture ; *Journal* : historique des actions admin.

### Importer un skin proprement

1. Un personnage debout, de face (+Z), pieds au sol. Format `.glb`, idéalement moins de 25 Mo.
2. Pour alléger un modèle lourd (Sketchfab, scans…), si tu as Python et Pillow :
   `python tools/optimize_skin.py gros.glb leger.glb` (ajoute `--decimate 0.014 0.025` pour un scan très lourd). L'outil réduit les textures, nettoie le maillage et met le personnage à 1,80 m.
3. Quartier général → Administration → Importer, choisis le fichier, règle le prix et la rareté, **remplis les crédits** (licence CC-BY), et coche « déjà à l'échelle » si tu as utilisé l'outil.

## Interface (style « opérations spéciales »)

Menus et HUD refaits dans un style Black Ops : noir charbon, orange ambre, coins coupés, polices condensées et grain de pellicule.

- En jeu : boussole animée, viseur dynamique qui s'ouvre avec la dispersion, panneau d'armes et de munitions, vitalité segmentée avec indicateur de régénération, capacité Rift avec recharge, killfeed, bandeau « ÉLIMINATION », écran « ÉLIMINÉ » en noir et blanc avec le nom du tueur, pause avec menu et rappel des commandes, chargement avec barre segmentée.
- Les polices (Bebas Neue, Rajdhani, Share Tech Mono) sont chargées depuis Google Fonts : il faut internet. Sans connexion, des polices condensées du système les remplacent.
- Les couleurs et les polices se changent en haut de `client/src/styles/global.css` (variables `--accent`, `--font-title`…).

## Gravité lunaire

Des **disques bleus lumineux** sont répartis sur la carte (avenues, plateformes cyberpunk, camping, ferme…). Marcher dessus donne 9 s de gravité lunaire : sauts très hauts, chute lente. Les positions sont dans `PADS` (`client/src/game/mapLayout.js`), la force dans `LUNAR_*` (`player.js`).

## Chat vocal

Maintiens **V** pour parler. Le son passe directement entre les joueurs (WebRTC) et le volume baisse avec la distance (plein volume à 12 m, silence à 90 m : `VOICE_RANGE` dans `voice.js`).

- Le micro exige `http://localhost` ou une adresse **https** (le tunnel Cloudflare convient). Sur `http://192.168.x.x` on peut écouter mais pas parler.
- Si quelqu'un n'entend rien, c'est généralement un réseau qui bloque la connexion directe : il faudrait alors un serveur TURN.

## Arsenal (4 armes)

Depuis le salon (**🔫 Mon arsenal**) ou en jeu (menu Échap) : choisis 4 armes parmi 10, avec aperçu 3D et statistiques. Le choix est mémorisé sur ton navigateur.

Les tirs des autres joueurs sont visibles (traînées) et audibles (volume selon la distance).

Chaque arme a ses propres stats (dégâts, plombs, cadence, mode auto/semi/rafale, chargeur, rechargement, dispersion, portée avec perte de dégâts, tête, recul, vitesse, zoom). **Tout se règle dans `server/src/weapons.js`** : le serveur valide chaque tir (arme autorisée, cadence, portée) et calcule les dégâts lui-même.

## Régénération

Sans tirer ni être touché pendant **5 s**, tu regagnes **12 PV/s**. Réglages dans `REGEN` (`server/src/weapons.js`).

## La map (340 × 340 m)

Générée dans `client/src/game/mapLayout.js` (graine fixe : identique pour tous les joueurs) :
centre-ville en damier avec 16 blocs d'immeubles, anneau routier, parcs, base militaire (NO), quartier cyberpunk avec plateformes et escaliers (NE), ferme et champs (SO/O), camping, lac avec île et forêt (SE/E), relais routier (N) et grand parc (S).

Pour la modifier : change les zones et les quantités dans `generateMap`. Les spawns sont dans `server/src/weapons.js` (`SPAWNS`), la map les garde dégagés.

## Assets 3D et échelle

Les packs Poly Pizza n'ont pas la même échelle. `client/src/game/assetCatalog.js` donne pour chaque modèle une **taille réelle en mètres** (`h` hauteur, `len` longueur, ou `scale`) : le jeu mesure le modèle au chargement et l'ajuste tout seul. Pour ajouter un modèle :

1. copie le `.glb` dans `client/public/models/…` (nom sans espaces),
2. ajoute une ligne dans `ASSETS` (`file`, taille, `coll: 'box' | 'trunk' | 'none'`),
3. place-le dans `mapLayout.js`.

Ouvre le jeu avec `?debug` (http://localhost:5173/?debug) pour voir dans la console (F12) la taille d'origine et finale de chaque modèle.

## Performance (objectif 30 FPS)

- Les objets sont **instanciés** par carré de 100 m (très peu d'appels de dessin) et les collisions utilisent une **grille spatiale**.
- Le compteur affiche les FPS instantanés et la moyenne sur 10 s (rouge sous 30).
- Si ça rame : baisse `maxPixelRatio`, `fogFar` (`client/src/game/engine.js`) ou le nombre d'arbres dans `mapLayout.js`.

## Crédits et sécurité

- Crédits des modèles : `CREDITS.md` et écran **Crédits** du menu en jeu (licence CC-BY : la mention est obligatoire).
- Ne mets jamais de vrais mots de passe ou de tokens dans le dépôt : uniquement dans `server/.env` (ignoré par git) ou dans les variables d'environnement de Render.

## Publication en ligne (optionnel)

`render.yaml` est conservé pour un hébergement Render. La sauvegarde des comptes passe alors par un Gist GitHub **privé** (`GITHUB_TOKEN` + `GITHUB_GIST_ID`) ; en local, elle est inutile.
