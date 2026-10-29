# Overlay Control — overlay OBS piloté par WebSocket

## Lancer

```bash
npm install
npm start
```

- Dashboard : http://localhost:3000/
- Overlay : http://localhost:3000/overlay

Variables : `PORT` (défaut 3000), `HOST` (défaut `127.0.0.1` ; mettre `0.0.0.0` pour piloter depuis un autre appareil du réseau, ex. tablette).

## OBS

Sources → **Navigateur** → URL `http://localhost:3000/overlay`, largeur **1920**, hauteur **1080**.

Une source par élément (pour les positionner librement dans OBS) :
`/overlay?only=timer`, `/overlay?only=mode`, `/overlay?only=message`.

## Taille du panneau

Dans le dashboard (section Style) : largeur et hauteur du panneau mode/timer en px, ou « Auto » (taille selon le contenu). En largeur fixe, le timer et le libellé rétrécissent pour tenir. L'« échelle » agit en plus, sur l'ensemble.

## Effets

Section « Effets » du dashboard :
- **Chatons / chiens** qui apparaissent au hasard (intervalle min–max en secondes, taille réglable), ou à la demande.
- **Pluie Matrix** en continu (opacité, vitesse, couleur) ou en rafale de 9 s. Elle passe derrière le panneau.

Source OBS dédiée aux effets : `/overlay?only=fx`. Test sans dashboard : `/overlay?preview=1&fx=cat` (ou `dog`, `matrix`).

Emojis animés : [Noto Emoji](https://googlefonts.github.io/noto-emoji-animation/) de Google, licence CC BY 4.0 (fichiers dans `public/assets/pets/`).

## Raccourcis du dashboard

`Espace` démarrer/pause · `R` reset timer · `1` `2` `3` `4` modes FOCUS / HELP / AFK / OPEN TO DISCUSS · `C` chaton · `D` chien · `M` rafale Matrix · `Ctrl+Entrée` afficher le message.

## API HTTP (Stream Deck, scripts)

| URL | Effet |
|---|---|
| `/api/mode/focus` · `help` · `afk` · `open` | change de mode |
| `/api/timer/start` · `pause` · `toggle` · `reset` | contrôle du timer |
| `/api/timer/set?min=25` | nouvelle durée |
| `/api/timer/add?min=5` (ou `sec=-30`) | ajoute / retire du temps |
| `/api/message?text=Hello` | message (vide = efface) |
| `/api/fx/cat` · `dog` · `matrix` | effet ponctuel |
| `/api/state` | état courant (JSON) |

L'état est sauvegardé dans `data/state.json` et rechargé au démarrage.
