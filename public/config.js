// Configuration du site. Vide = valeurs officielles (voir assets/js/api.js).
// En auto-hébergement (Docker), ce fichier est réécrit au démarrage du
// conteneur : voir docker/entrypoint.sh et README (section Docker).
// Clés possibles : apiUrl, twitchClientId, redirectUri, fallbackApiUrls
// (Workers de secours quand le quota du jour est atteint) et relayUrl
// (relais vidéo sur un serveur à soi, s'il existe un jour).
//
// Ce fork a son Worker à lui (apiUrl) et sa propre application Twitch :
// la vidéo comme la connexion passent par ses serveurs, pas ceux d'origine.
window.TU_CONFIG = window.TU_CONFIG || {}
window.TU_CONFIG.apiUrl = 'https://twitchunblock.ewaldruf11.workers.dev'
window.TU_CONFIG.twitchClientId = 'fjzr1s7efdp43ra0om22g1taktj6ek'
window.TU_CONFIG.redirectUri = 'https://twitchunblock-web.vercel.app/'
