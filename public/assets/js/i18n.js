// ═══════════════════════════════════════════════════════════════════════════
//  Traductions. Une clé absente d'une langue retombe sur l'anglais, puis sur
//  la clé elle-même : un oubli se voit sans rien casser.
// ═══════════════════════════════════════════════════════════════════════════

const STRINGS = {
  fr: {
    nav_discover: 'Découvrir', nav_channel: 'Streamer', nav_link: 'Lien / ID',
    tagline: 'Les lives et VODs Twitch, sans abonnement.',
    login: 'Se connecter avec Twitch', logout: 'Déconnexion',
    login_prompt: 'Connecte-toi pour retrouver tes chaînes suivies et synchroniser ton historique entre tes appareils.',
    followed: 'Chaînes suivies', top: 'Top des lives', top_fr: 'France', top_world: 'Monde',
    continue_watching: 'Reprendre', recent_channels: 'Streamers récents', clear_all: 'Tout effacer',
    refresh: 'Actualiser', loading: 'Chargement…', err_loading: 'Impossible de charger.',
    no_live_followed: 'Aucune de tes chaînes n’est en live pour l’instant.',
    no_live: 'Aucun live pour le moment.',
    login_required_top: 'Connecte-toi pour afficher le top des lives.',
    session_expired: 'Session expirée, reconnecte-toi.',
    search_channel_ph: 'Nom du streamer, puis un mot-clé (ex : squeezie horreur)',
    search: 'Chercher', not_found: 'Streamer introuvable.',
    live_now: 'En direct', offline: 'Hors ligne', offline_since: 'Hors ligne depuis {t}',
    watch_live: 'Regarder le live', vods: 'Rediffusions', no_vod: 'Aucune VOD trouvée.',
    filter_none: 'Aucune VOD ne contient « {k} » dans les 100 dernières.',
    filter_count: '{n} VOD(s) pour « {k} »',
    link_title: 'Ouvrir une VOD', link_desc: 'Colle un lien twitch.tv/videos/… ou un identifiant.',
    link_ph: 'https://www.twitch.tv/videos/123456789', link_open: 'Ouvrir',
    invalid_id: 'Identifiant de VOD invalide.',
    loading_vod: 'Chargement de la VOD…', loading_live: 'Connexion au live…',
    err_vod: 'Cette VOD est indisponible.', err_live: 'Ce live est indisponible.', err_network: 'Erreur réseau.',
    viewers: 'spectateurs', latency: 'latence',
    quality: 'Qualité', speed: 'Vitesse', normal: 'Normale', auto: 'Auto',
    go_live: 'Revenir au direct', chat: 'Chat', pip: 'Image dans l’image',
    fullscreen: 'Plein écran', exit_fullscreen: 'Quitter le plein écran',
    play: 'Lecture', pause: 'Pause', mute: 'Couper le son', unmute: 'Rétablir le son',
    back10: 'Reculer de 10 s', fwd10: 'Avancer de 10 s', minimize: 'Réduire', close: 'Fermer',
    open_in: 'Ouvrir dans…', copy_link: 'Copier le lien du flux', download_m3u: 'Télécharger le .m3u',
    copied: 'Lien copié.', see_vods: 'Voir les VODs', resume_at: 'Reprise à {t}',
    // Chat
    chat_connecting: 'Connexion au chat…', chat_connected: 'Bienvenue dans le chat !',
    chat_disconnected: 'Chat déconnecté, reconnexion…',
    chat_send_ph: 'Envoyer un message', chat_readonly: 'Connecte-toi pour écrire',
    chat_rescope: 'Reconnecte-toi pour pouvoir écrire',
    chat_paused: 'Chat en pause', chat_new: '{n} nouveaux messages',
    chat_vod: 'Chat de la rediffusion', chat_vod_empty: 'Aucun message à ce moment de la VOD.',
    chat_history: 'Messages précédents', emotes: 'Emotes', emotes_channel: 'Cette chaîne', emotes_global: 'Globales',
    emote_search_ph: 'Chercher une emote', user_messages: 'Ses messages', mention: 'Mentionner', reply: 'Répondre',
    deleted: 'message supprimé', first_msg: 'Premier message', reply_to: 'En réponse à @{u}',
    chatters: 'Présents', pinned: 'Message épinglé', pinned_by: 'Épinglé par {u}',
    // Réglages
    settings: 'Réglages', language: 'Langue', account: 'Compte', playback: 'Lecture',
    proxy: 'Passer par le proxy', proxy_sub: 'Contourne les blocages. À couper pour ouvrir le flux dans VLC sans charger le serveur.',
    chat_settings: 'Chat', timestamps: 'Afficher l’heure', keep_deleted: 'Garder les messages supprimés (barrés)',
    load_history: 'Charger les messages précédents', chat_size: 'Taille du texte',
    connected_as: 'Connecté en tant que {u}', not_connected: 'Non connecté',
    about: 'À propos', about_text: 'Aucune donnée n’est revendue. L’historique reste dans ton navigateur et, si tu es connecté, dans une sauvegarde liée à ton compte.',
  },
  en: {
    nav_discover: 'Discover', nav_channel: 'Streamer', nav_link: 'Link / ID',
    tagline: 'Twitch lives and VODs, no subscription needed.',
    login: 'Log in with Twitch', logout: 'Log out',
    login_prompt: 'Log in to find your followed channels and sync your history across devices.',
    followed: 'Followed channels', top: 'Top streams', top_fr: 'France', top_world: 'World',
    continue_watching: 'Continue watching', recent_channels: 'Recent streamers', clear_all: 'Clear all',
    refresh: 'Refresh', loading: 'Loading…', err_loading: 'Couldn’t load.',
    no_live_followed: 'None of your channels are live right now.',
    no_live: 'No live streams right now.',
    login_required_top: 'Log in to see the top streams.',
    session_expired: 'Session expired, please log in again.',
    search_channel_ph: 'Streamer name, then a keyword (e.g. shroud horror)',
    search: 'Search', not_found: 'Streamer not found.',
    live_now: 'Live', offline: 'Offline', offline_since: 'Offline for {t}',
    watch_live: 'Watch live', vods: 'Past broadcasts', no_vod: 'No VODs found.',
    filter_none: 'No VOD contains “{k}” in the last 100.',
    filter_count: '{n} VOD(s) for “{k}”',
    link_title: 'Open a VOD', link_desc: 'Paste a twitch.tv/videos/… link or an ID.',
    link_ph: 'https://www.twitch.tv/videos/123456789', link_open: 'Open',
    invalid_id: 'Invalid VOD ID.',
    loading_vod: 'Loading VOD…', loading_live: 'Connecting to the live…',
    err_vod: 'This VOD is unavailable.', err_live: 'This live is unavailable.', err_network: 'Network error.',
    viewers: 'viewers', latency: 'latency',
    quality: 'Quality', speed: 'Speed', normal: 'Normal', auto: 'Auto',
    go_live: 'Back to live', chat: 'Chat', pip: 'Picture in picture',
    fullscreen: 'Fullscreen', exit_fullscreen: 'Exit fullscreen',
    play: 'Play', pause: 'Pause', mute: 'Mute', unmute: 'Unmute',
    back10: 'Back 10 s', fwd10: 'Forward 10 s', minimize: 'Minimize', close: 'Close',
    open_in: 'Open in…', copy_link: 'Copy stream link', download_m3u: 'Download .m3u',
    copied: 'Link copied.', see_vods: 'See VODs', resume_at: 'Resuming at {t}',
    chat_connecting: 'Connecting to chat…', chat_connected: 'Welcome to the chat!',
    chat_disconnected: 'Chat disconnected, reconnecting…',
    chat_send_ph: 'Send a message', chat_readonly: 'Log in to chat',
    chat_rescope: 'Log in again to be able to chat',
    chat_paused: 'Chat paused', chat_new: '{n} new messages',
    chat_vod: 'Replay chat', chat_vod_empty: 'No messages at this point of the VOD.',
    chat_history: 'Earlier messages', emotes: 'Emotes', emotes_channel: 'This channel', emotes_global: 'Global',
    emote_search_ph: 'Search emotes', user_messages: 'Their messages', mention: 'Mention', reply: 'Reply',
    deleted: 'message deleted', first_msg: 'First message', reply_to: 'Replying to @{u}',
    chatters: 'Present', pinned: 'Pinned message', pinned_by: 'Pinned by {u}',
    settings: 'Settings', language: 'Language', account: 'Account', playback: 'Playback',
    proxy: 'Use the proxy', proxy_sub: 'Gets around blocks. Turn it off to open the stream in VLC without loading the server.',
    chat_settings: 'Chat', timestamps: 'Show timestamps', keep_deleted: 'Keep deleted messages (struck through)',
    load_history: 'Load earlier messages', chat_size: 'Text size',
    connected_as: 'Logged in as {u}', not_connected: 'Not logged in',
    about: 'About', about_text: 'No data is sold. Your history stays in your browser and, if you log in, in a backup tied to your account.',
  },
  es: {
    nav_discover: 'Descubrir', nav_channel: 'Streamer', nav_link: 'Enlace / ID',
    tagline: 'Directos y VODs de Twitch, sin suscripción.',
    login: 'Iniciar sesión con Twitch', logout: 'Cerrar sesión',
    login_prompt: 'Inicia sesión para ver tus canales seguidos y sincronizar tu historial entre dispositivos.',
    followed: 'Canales seguidos', top: 'Top directos', top_fr: 'Francia', top_world: 'Mundo',
    continue_watching: 'Seguir viendo', recent_channels: 'Streamers recientes', clear_all: 'Borrar todo',
    refresh: 'Actualizar', loading: 'Cargando…', err_loading: 'No se pudo cargar.',
    no_live_followed: 'Ninguno de tus canales está en directo ahora.',
    no_live: 'No hay directos ahora.',
    login_required_top: 'Inicia sesión para ver el top de directos.',
    session_expired: 'Sesión caducada, vuelve a iniciar sesión.',
    search_channel_ph: 'Nombre del streamer y una palabra clave (ej: ibai terror)',
    search: 'Buscar', not_found: 'Streamer no encontrado.',
    live_now: 'En directo', offline: 'Desconectado', offline_since: 'Desconectado hace {t}',
    watch_live: 'Ver el directo', vods: 'Emisiones anteriores', no_vod: 'No se encontraron VODs.',
    filter_none: 'Ningún VOD contiene «{k}» en los últimos 100.',
    filter_count: '{n} VOD(s) para «{k}»',
    link_title: 'Abrir un VOD', link_desc: 'Pega un enlace twitch.tv/videos/… o un ID.',
    link_ph: 'https://www.twitch.tv/videos/123456789', link_open: 'Abrir',
    invalid_id: 'ID de VOD no válido.',
    loading_vod: 'Cargando VOD…', loading_live: 'Conectando al directo…',
    err_vod: 'Este VOD no está disponible.', err_live: 'Este directo no está disponible.', err_network: 'Error de red.',
    viewers: 'espectadores', latency: 'latencia',
    quality: 'Calidad', speed: 'Velocidad', normal: 'Normal', auto: 'Auto',
    go_live: 'Volver al directo', chat: 'Chat', pip: 'Imagen en imagen',
    fullscreen: 'Pantalla completa', exit_fullscreen: 'Salir de pantalla completa',
    play: 'Reproducir', pause: 'Pausa', mute: 'Silenciar', unmute: 'Activar sonido',
    back10: 'Retroceder 10 s', fwd10: 'Avanzar 10 s', minimize: 'Minimizar', close: 'Cerrar',
    open_in: 'Abrir en…', copy_link: 'Copiar enlace del flujo', download_m3u: 'Descargar .m3u',
    copied: 'Enlace copiado.', see_vods: 'Ver VODs', resume_at: 'Reanudando en {t}',
    chat_connecting: 'Conectando al chat…', chat_connected: '¡Bienvenido al chat!',
    chat_disconnected: 'Chat desconectado, reconectando…',
    chat_send_ph: 'Enviar un mensaje', chat_readonly: 'Inicia sesión para escribir',
    chat_rescope: 'Vuelve a iniciar sesión para poder escribir',
    chat_paused: 'Chat en pausa', chat_new: '{n} mensajes nuevos',
    chat_vod: 'Chat de la repetición', chat_vod_empty: 'No hay mensajes en este punto del VOD.',
    chat_history: 'Mensajes anteriores', emotes: 'Emotes', emotes_channel: 'Este canal', emotes_global: 'Globales',
    emote_search_ph: 'Buscar emotes', user_messages: 'Sus mensajes', mention: 'Mencionar', reply: 'Responder',
    deleted: 'mensaje eliminado', first_msg: 'Primer mensaje', reply_to: 'Respondiendo a @{u}',
    chatters: 'Presentes', pinned: 'Mensaje fijado', pinned_by: 'Fijado por {u}',
    settings: 'Ajustes', language: 'Idioma', account: 'Cuenta', playback: 'Reproducción',
    proxy: 'Usar el proxy', proxy_sub: 'Evita bloqueos. Desactívalo para abrir el flujo en VLC sin cargar el servidor.',
    chat_settings: 'Chat', timestamps: 'Mostrar la hora', keep_deleted: 'Mantener mensajes eliminados (tachados)',
    load_history: 'Cargar mensajes anteriores', chat_size: 'Tamaño del texto',
    connected_as: 'Conectado como {u}', not_connected: 'Sin conectar',
    about: 'Acerca de', about_text: 'No se vende ningún dato. Tu historial se queda en tu navegador y, si inicias sesión, en una copia ligada a tu cuenta.',
  },
}

export const LANGS = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
]

let current = 'en'

export function initLang(saved) {
  const nav = (navigator.language || 'en').slice(0, 2)
  current = STRINGS[saved] ? saved : STRINGS[nav] ? nav : 'en'
  document.documentElement.lang = current
  return current
}

export function setLang(lang) {
  if (!STRINGS[lang]) return current
  current = lang
  document.documentElement.lang = lang
  return current
}

export const lang = () => current

/** Traduit une clé, avec remplacement des `{param}`. */
export function t(key, params) {
  let s = STRINGS[current]?.[key] ?? STRINGS.en[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v)
  return s
}

/** Applique les traductions aux éléments statiques marqués `data-i18n`. */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n)
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh)
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle)
    el.setAttribute('aria-label', t(el.dataset.i18nTitle))
  }
}
