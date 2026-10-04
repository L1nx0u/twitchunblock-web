// ═══════════════════════════════════════════════════════════════════════════
//  Nouveautés du site, de la plus récente à la plus ancienne. La clé suit
//  SITE_VERSION (usage.js) : à chaque nouvelle version, ajouter une entrée
//  en tête. Le site montre celles qu'on n'a pas encore vues.
// ═══════════════════════════════════════════════════════════════════════════

export const CHANGELOG = [
  {
    version: '2026.10.04c',
    items: {
      fr: [
        'Playlists des chaînes : nouvelle section sur la page streamer, avec « Tout lire » qui enchaîne les vidéos.',
        'Les highlights (vidéos des playlists) se lancent même quand Twitch refuse le jeton de lecture.',
        'Une VOD indisponible affiche « VOD introuvable » au lieu d’une fausse erreur réseau.',
      ],
      en: [
        'Channel playlists: new section on the streamer page, with “Play all” to chain the videos.',
        'Highlights (playlist videos) now play even when Twitch refuses the playback token.',
        'An unavailable VOD now says so instead of showing a misleading network error.',
      ],
      es: [
        'Listas de los canales: nueva sección en la página del streamer, con «Reproducir todo» para encadenar los vídeos.',
        'Los highlights (vídeos de las listas) se reproducen aunque Twitch rechace el token de reproducción.',
        'Un VOD no disponible lo indica en lugar de mostrar un falso error de red.',
      ],
    },
  },
  {
    version: '2026.10.04b',
    items: {
      fr: [
        'Nouvel onglet Catégories : toutes les catégories, recherche, et tes catégories suivies (bouton « Suivre »).',
        'Accueil en deux onglets : « Chaînes suivies » et « Top des lives ».',
        'Les chaînes suivies hors ligne sont listées : un clic ouvre leur page (VODs, clips).',
        'Dans le lecteur, cliquer sur le pseudo ouvre la page de la chaîne.',
      ],
      en: [
        'New Categories tab: all categories, search, and your followed categories (“Follow” button).',
        'Home split into two tabs: “Followed channels” and “Top streams”.',
        'Offline followed channels are listed: one click opens their page (VODs, clips).',
        'In the player, clicking the streamer name opens their channel page.',
      ],
      es: [
        'Nueva pestaña Categorías: todas las categorías, búsqueda y tus categorías seguidas (botón «Seguir»).',
        'Inicio en dos pestañas: «Canales seguidos» y «Top de directos».',
        'Los canales seguidos desconectados aparecen en una lista: un clic abre su página (VODs, clips).',
        'En el reproductor, hacer clic en el nombre del streamer abre su canal.',
      ],
    },
  },
  {
    version: '2026.10.04',
    items: {
      fr: [
        'Suis des chaînes sans compte Twitch : bouton « Suivre » sur leur page, elles arrivent dans « Chaînes suivies ».',
        'Accueil en liste façon Twitch ou en grille (bouton à côté de « Chaînes suivies »).',
        'Commandes des bots (Nightbot, StreamElements, Fossabot, Moobot) depuis l’en-tête du chat.',
        'Le message épinglé déplié s’affiche par-dessus le chat au lieu de le pousser.',
        'Réactions aux annonces, et cette fenêtre des nouveautés.',
      ],
      en: [
        'Follow channels without a Twitch account: “Follow” button on their page, they show up in “Followed channels”.',
        'Home as a Twitch-style list or a grid (button next to “Followed channels”).',
        'Bot commands (Nightbot, StreamElements, Fossabot, Moobot) from the chat header.',
        'An expanded pinned message now opens over the chat instead of pushing it down.',
        'React to announcements, and this “What’s new” window.',
      ],
      es: [
        'Sigue canales sin cuenta de Twitch: botón «Seguir» en su página, aparecen en «Canales seguidos».',
        'Inicio en lista al estilo Twitch o en cuadrícula (botón junto a «Canales seguidos»).',
        'Comandos de bots (Nightbot, StreamElements, Fossabot, Moobot) desde la cabecera del chat.',
        'El mensaje fijado desplegado se abre sobre el chat en lugar de empujarlo.',
        'Reacciones a los anuncios, y esta ventana de novedades.',
      ],
    },
  },
  {
    version: '2026.10.03',
    items: {
      fr: [
        'Annonces du développeur en haut de l’accueil.',
        'Top des lives dans la langue de ton appareil, réglable dans les réglages.',
        'Page /stats publique (français, anglais, espagnol).',
        'Lien vers le Discord dans le pied de page et les réglages.',
      ],
      en: [
        'Developer announcements at the top of the home page.',
        'Top streams in your device language, adjustable in settings.',
        'Public /stats page (English, French, Spanish).',
        'Discord link in the footer and settings.',
      ],
      es: [
        'Anuncios del desarrollador arriba del inicio.',
        'Top de directos en el idioma de tu dispositivo, ajustable en los ajustes.',
        'Página pública /stats (español, inglés, francés).',
        'Enlace al Discord en el pie de página y los ajustes.',
      ],
    },
  },
]
