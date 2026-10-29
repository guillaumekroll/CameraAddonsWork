# Overlay Control — overlay OBS piloté par WebSocket

## Lancer

```bash
npm install
npm start
```

- Dashboard : http://localhost:3000/
- Deck (grosses touches façon Stream Deck, tablette / téléphone) : http://localhost:3000/deck
- Overlay : http://localhost:3000/overlay

Le serveur est accessible depuis le réseau local : au démarrage, il affiche les adresses à ouvrir sur la tablette / le téléphone (ex. `http://192.168.1.x:3000/deck`).

Variables : `PORT` (défaut 3000), `HOST` (défaut `0.0.0.0` = réseau local ; `HOST=127.0.0.1` pour limiter à ce PC).

## OBS

Sources → **Navigateur** → URL `http://localhost:3000/overlay`, largeur **1920**, hauteur **1080**.

Une source par élément (pour les positionner librement dans OBS) :
`/overlay?only=timer`, `/overlay?only=mode`, `/overlay?only=message`.

## Taille du panneau

Dans le dashboard (section Style) : largeur et hauteur du panneau mode/timer en px, ou « Auto » (taille selon le contenu). En largeur fixe, le timer et le libellé rétrécissent pour tenir. L'« échelle » agit en plus, sur l'ensemble.

## Contour de l'écran

Dashboard → **Contour de l'écran** : un cadre animé autour de tout l'overlay, aux couleurs du mode actif (transition fluide au changement de mode).
- Activé / désactivé, et choix des modes où il s'affiche (ex. uniquement FOCUS TIME).
- Animation : **Flux** (lumière qui fait le tour), **Pulsation**, ou **Fixe**.
- Épaisseur (1–60 px), vitesse, halo lumineux, coins arrondis.
- Source OBS dédiée : `/overlay?only=border`. Touche « Contour écran » dans le Deck.

## Effets

Section « Effets » du dashboard :
- **Chatons / chiens** qui apparaissent au hasard (intervalle min–max en secondes, taille réglable), ou à la demande.
- **Anniversaire** : feu d'artifice, gâteaux qui surgissent de tous les côtés et au centre, bannière « JOYEUX ANNIVERSAIRE » + prénom (~13 s).
- **Feu d'artifice** seul (8 s).
- **Pluie Matrix** en continu (opacité, vitesse, couleur) ou en rafale de 9 s. Elle passe derrière le panneau.

Source OBS dédiée aux effets : `/overlay?only=fx`. Test sans dashboard : `/overlay?preview=1&fx=cat` (ou `dog`, `matrix`, `fireworks`, `birthday&name=Alice`).

Emojis animés : [Noto Emoji](https://googlefonts.github.io/noto-emoji-animation/) de Google, licence CC BY 4.0 (fichiers dans `public/assets/pets/` et `public/assets/party/`).

## Deck (tablette / téléphone)

`/deck` : grille de grosses touches (modes, timer, effets, affichage, messages enregistrés) avec retour visuel de l'état. Depuis un autre appareil du même réseau, ouvrir l'adresse affichée au démarrage (`http://<ip-du-mac>:3000/deck`). Astuce : « Ajouter à l'écran d'accueil » pour l'avoir en plein écran.

## Raccourcis du dashboard

`Espace` démarrer/pause · `R` reset timer · `1` `2` `3` `4` modes FOCUS / HELP / AFK / OPEN TO DISCUSS · `C` chaton · `D` chien · `M` rafale Matrix · `F` feu d'artifice · `Ctrl+Entrée` afficher le message.

## API HTTP (Stream Deck, scripts)

| URL | Effet |
|---|---|
| `/api/mode/focus` · `help` · `afk` · `open` | change de mode |
| `/api/timer/start` · `pause` · `toggle` · `reset` | contrôle du timer |
| `/api/timer/set?min=25` | nouvelle durée |
| `/api/timer/add?min=5` (ou `sec=-30`) | ajoute / retire du temps |
| `/api/message?text=Hello` | message (vide = efface) |
| `/api/fx/cat` · `dog` · `matrix` · `fireworks` | effet ponctuel |
| `/api/fx/birthday?name=Alice` | anniversaire |
| `/api/state` | état courant (JSON) |

## Sauvegarde de la configuration

Tous les réglages (modes, timer, styles, effets, taille du deck, messages enregistrés, prénoms d'anniversaire) sont enregistrés automatiquement dans **`data/state.json`** et rechargés au démarrage.

- Écriture atomique (fichier temporaire puis renommage) : le JSON n'est jamais à moitié écrit, même en cas de coupure.
- Sauvegarde forcée à l'arrêt (Ctrl+C, fermeture du terminal).
- À chaque démarrage, copie de sécurité dans `data/state.backup.json`. Si `state.json` est abîmé, il est mis de côté (`state.broken-….json`) et la copie de sécurité est restaurée.
- Dashboard → section **Sauvegarde** : exporter / importer la config (ou `GET` / `POST` sur `/api/config`).
- Autre emplacement : `STATE_FILE=/chemin/config.json npm start`.
