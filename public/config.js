// Configuration du site. Ce fork parle uniquement à son propre Worker et à sa
// propre application Twitch : aucun repli sur l'infrastructure du projet
// d'origine (voir README). En auto-hébergement (Docker), ce fichier est
// réécrit au démarrage du conteneur : voir docker/entrypoint.sh.
window.TU_CONFIG = window.TU_CONFIG || {}
window.TU_CONFIG.apiUrl = 'https://api.l1nx0u.me'
window.TU_CONFIG.twitchClientId = 'fjzr1s7efdp43ra0om22g1taktj6ek'
window.TU_CONFIG.redirectUri = 'https://twitchunblock-web.vercel.app/'
// Aucun Worker de secours ni relais vidéo d'un tiers.
window.TU_CONFIG.fallbackApiUrls = []
window.TU_CONFIG.relayUrl = ''
// Ce fork ne partage pas le comptage d'usage.
window.TU_CONFIG.defaultPrefs = { shareUsage: false }
