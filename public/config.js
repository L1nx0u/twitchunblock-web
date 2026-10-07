// Configuration du site. Vide = valeurs officielles (voir assets/js/api.js).
// En auto-hébergement (Docker), ce fichier est réécrit au démarrage du
// conteneur : voir docker/entrypoint.sh et README (section Docker).
// Clés possibles : apiUrl, twitchClientId, redirectUri, et fallbackApiUrls
// (Workers de secours quand le quota du jour est atteint, README
// « Fallback Worker »).
//
// Ce fork utilise sa propre application Twitch : la connexion revient sur
// CE site, pas sur celui d'origine. La vidéo passe toujours par le Worker
// officiel (apiUrl non renseigné) tant que le backend à soi n'est pas
// déployé (README, « Your own backend »).
window.TU_CONFIG = window.TU_CONFIG || {}
window.TU_CONFIG.twitchClientId = 'fjzr1s7efdp43ra0om22g1taktj6ek'
window.TU_CONFIG.redirectUri = 'https://twitchunblock-web.vercel.app/'
