# TwitchUnblock — Web

Regarder les lives et les VODs Twitch dans le navigateur, sans abonnement, avec le vrai chat.

**Site : https://test2-fawn-eta.vercel.app**

Version web de [TwitchUnblock](https://github.com/MXFia19/TwitchUnblock), l'app iOS. Les deux partagent le même backend, un Worker Cloudflare.

---

## Fonctionnalités

### Accueil
- **Top des lives**, France ou monde, visible sans se connecter
- **Chaînes suivies** une fois connecté avec Twitch, avec les photos de profil
- **Reprendre** : les VODs commencées, avec leur barre de progression
- Temps de live et spectateurs tenus à jour en continu

### Streamer
- Recherche avec suggestions pendant la frappe
- Statut du live (titre, jeu, spectateurs, durée), ou depuis quand la chaîne est hors ligne
- Toutes les rediffusions, filtrables par mot-clé ou par date
- Streamers récents

### Lecteur
- Commandes maison, pensées pour le chat : le plein écran garde la vidéo **et** le chat, posé par-dessus
- Qualité au choix, dont « Auto » qui affiche le débit réellement utilisé
- Vitesse de lecture, ±10 s, double-tap sur mobile, raccourcis clavier
- Image dans l'image, bouton « retour au direct », latence affichée en live
- Reprise automatique des VODs là où on s'était arrêté
- Fenêtre réduite : la lecture continue pendant qu'on navigue
- « Ouvrir dans… » VLC, Outplayer, Infuse, ou copie du lien du flux

### Chat
- Connecté directement à l'IRC de Twitch, sans iframe
- Emotes Twitch, **BTTV**, **FFZ** et **7TV**, badges, couleurs de pseudo lisibles sur fond sombre
- Messages récents chargés à l'arrivée : on ne tombe jamais dans un chat vide
- **Message épinglé** en haut du chat, masquable puis réaffichable
- Écriture une fois connecté : autocomplétion des emotes et des pseudos, sélecteur d'emotes, réponses
- Fiche d'un utilisateur au clic : ses derniers messages, mentionner, répondre
- Modération respectée : messages supprimés barrés ou retirés
- Défilement en pause quand on remonte, avec un bouton « nouveaux messages »
- **Chat des VODs**, rejoué au rythme de la vidéo

### Le reste
- Français, anglais, espagnol — la langue de l'appareil par défaut
- Historique et progression synchronisés entre appareils quand on est connecté
- Interface adaptée au mobile : barre d'onglets en bas, réglages en feuille, vue paysage

---

## Structure du dépôt

```
public/              Le site, servi tel quel par Vercel (aucune compilation)
  index.html
  assets/
    styles.css
    js/
      main.js        Navigation, accueil, page streamer, réglages
      player.js      Lecteur vidéo (hls.js)
      api.js         Accès au Worker, à Helix et à GQL — configuration en tête
      i18n.js        Traductions
      store.js       Historique, progression, préférences (localStorage)
      util.js        Échappement, formats, icônes
      chat/          Chat : IRC, emotes, badges, message épinglé, replay des VODs
worker.js            Backend : Worker Cloudflare
wrangler.toml        Configuration du Worker
vercel.json          Configuration du site sur Vercel
```

Le site est en JavaScript natif (modules ES), sans framework ni étape de compilation.

---

## Comment ça marche

```
Navigateur ──► Worker Cloudflare ──► Twitch (playlists, segments vidéo)
    │
    ├──► GQL Twitch     infos publiques : lives, chaînes, VODs, chat des VODs
    ├──► Helix Twitch   compte connecté : chaînes suivies
    ├──► IRC Twitch     chat en direct (WebSocket)
    └──► BTTV / FFZ / 7TV / recent-messages   emotes et historique du chat
```

La vidéo passe toujours par le Worker : le CDN des VODs de Twitch n'accepte que les requêtes venant de `twitch.tv`, un lien direct serait bloqué par le navigateur. Le Worker sert aussi la sauvegarde de l'historique (KV Cloudflare).

---

## Configuration

Tout est en tête de `public/assets/js/api.js` :

| Constante | Rôle |
|---|---|
| `API_URL` | Adresse du Worker |
| `HELIX_CLIENT_ID` | Identifiant de l'application Twitch (connexion) |
| `REDIRECT_URI` | Adresse de retour après connexion — doit être déclarée telle quelle dans la console développeur Twitch |
| `EXTERNAL_LINKS_VIA_PROXY` | Liens donnés à VLC / Outplayer / Infuse : par le Worker (`true`) ou en direct depuis Twitch (`false`) |

---

## Déploiement

### Site (Vercel)
Chaque push sur `main` est déployé automatiquement. `vercel.json` indique de servir le dossier `public/` sans compilation.

### Worker (Cloudflare)
```bash
npx wrangler deploy
```
Le namespace KV `TWITCH_DATA` (sauvegarde de l'historique) est déclaré dans `wrangler.toml`.

### En local
```bash
cd public
python3 -m http.server 8080
# puis http://localhost:8080
```
La connexion Twitch ne fonctionne qu'à l'adresse déclarée dans `REDIRECT_URI`.

---

## Crédits

Créé par [MXFia19](https://github.com/MXFia19).

Merci à [hls.js](https://github.com/video-dev/hls.js), [BetterTTV](https://betterttv.com), [FrankerFaceZ](https://www.frankerfacez.com), [7TV](https://7tv.app), [recent-messages](https://recent-messages.robotty.de), [Lucide](https://lucide.dev) pour les icônes et [Inter](https://rsms.me/inter/) pour la police.

Projet indépendant, sans lien avec Twitch.
