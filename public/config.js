// Configuration du site. Vide = valeurs officielles (voir assets/js/api.js).
// En auto-hébergement (Docker), ce fichier est réécrit au démarrage du
// conteneur : voir docker/entrypoint.sh et README (section Docker).
// Clés possibles : apiUrl, twitchClientId, redirectUri, fallbackApiUrls
// (Workers de secours quand le quota du jour est atteint, README
// « Fallback Worker ») et relayUrl (relais vidéo sur un serveur à soi,
// README « Video relay »).
window.TU_CONFIG = window.TU_CONFIG || {}
