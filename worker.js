const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

// Headers pour RÉPONDRE à votre site web
const RESPONSE_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cache-Control, Range, Authorization',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range'
};

// Headers pour ATTAQUER Twitch et Luminous incognito
const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv'
};

// Formats Twitch : tout paramètre qui finit dans une requête GQL ou une
// adresse est vérifié d'abord. Avant, `name` était collé tel quel dans le
// texte de la requête GQL — un guillemet suffisait à en réécrire le contenu.
const LOGIN_RE = /^[a-zA-Z0-9_]{1,25}$/;
const VOD_ID_RE = /^\d{1,20}$/;
const CURSOR_RE = /^[A-Za-z0-9+/=_-]{1,500}$/;

const QUALITY_ORDER = ['chunked', 'source', '1080p60', '1080p30', '720p60', '720p30', '480p30', '360p30', '160p30', 'audio_only'];

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") return new Response(null, { headers: RESPONSE_HEADERS });

        const url = new URL(request.url);
        const workerOrigin = url.origin; 
        
        try {
            switch (url.pathname) {
                case '/': return new Response("Twitch Proxy - Anti 403 Ready", { headers: RESPONSE_HEADERS });
                case '/api/get-live': return await handleGetLive(url, workerOrigin);
                case '/api/get-channel-videos': return await handleGetVideos(url);
                case '/api/get-m3u8': return await handleGetM3U8(url, workerOrigin);
                case '/api/proxy': return await handleProxy(url, request);
                
                // Routes Sync (Sauvegarde Cloud)
                case '/api/sync/get': return await handleSyncGet(url, request, env);
                case '/api/sync/post': return await handleSyncPost(request, env);

                // Comptage d'utilisation (app iOS et site)
                case '/api/ping': return await handlePing(request, env);
                case '/api/stats': return await cachedStats(request, env, ctx);

                // Outils d'administration (compte du propriétaire uniquement)
                case '/api/admin/me': return await handleAdminMe(request);
                case '/api/admin/usage': return await handleAdminUsage(request, env);
                case '/api/admin/usage/delete': return await handleAdminUsageDelete(request, env);
                case '/api/admin/sync/delete': return await handleAdminSyncDelete(request, env);

                // Annonces affichées dans l'app (lecture publique, écriture admin)
                case '/api/announcement': return await handleAnnouncementGet(env);
                case '/api/announcement/react': return await handleAnnouncementReact(request, env);
                case '/api/admin/announcement': return await handleAdminAnnouncement(request, env);
                
                default: return new Response("Not Found", { status: 404, headers: RESPONSE_HEADERS });
            }
        } catch (e) {
            // Pas de message interne renvoyé au client : seulement dans les logs.
            console.error(e);
            return new Response(JSON.stringify({ error: "Erreur interne" }), { status: 500, headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } });
        }
    }
};

// --- SYSTÈME DE SYNCHRONISATION CLOUD (KV) ---
// ── Authentification de la sauvegarde ─────────────────────────────────────
// Avant, il suffisait de connaître l'identifiant Twitch de quelqu'un — il est
// public — pour lire ou écraser son historique. Chaque requête doit
// maintenant présenter le jeton Twitch de l'utilisateur (en-tête
// `Authorization: Bearer …`), que Twitch confirme, et il doit appartenir à
// l'identifiant visé.
//
// Twitch demande de toute façon de valider un jeton au moins toutes les
// heures. Le résultat est gardé en mémoire 30 minutes (au mieux : chaque
// instance du Worker a la sienne), pour ne pas appeler Twitch à chaque
// requête.
const tokenCache = new Map();   // empreinte du jeton → { userId, login, until }
async function tokenUserId(request) {
    return (await tokenIdentity(request))?.userId ?? null;
}

/** Compte Twitch du jeton présenté (`Authorization: Bearer …`), ou null. */
async function tokenIdentity(request) {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^(Bearer|OAuth)\s+/i, '').trim();
    if (!token || token.length > 200) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const hit = tokenCache.get(key);
    if (hit && hit.until > Date.now()) return hit;
    const res = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } });
    if (!res.ok) { tokenCache.delete(key); return null; }
    const v = await res.json();
    const userId = v && v.user_id ? String(v.user_id) : null;
    if (!userId) return null;
    if (tokenCache.size > 500) tokenCache.clear();
    const entry = { userId, login: String(v.login || '').toLowerCase(), until: Date.now() + 30 * 60 * 1000 };
    tokenCache.set(key, entry);
    return entry;
}

async function authorizeSync(request, userId) {
    if (!/^\d{1,20}$/.test(userId)) return jsonError("User ID invalide", 400);
    const owner = await tokenUserId(request);
    if (!owner) return jsonError("Jeton Twitch manquant ou expiré", 401);
    if (owner !== userId) return jsonError("Ce jeton n'appartient pas à cet utilisateur", 403);
    return null;
}

async function handleSyncGet(url, request, env) {
    if (!env.TWITCH_DATA) return jsonError("Erreur Serveur: KV 'TWITCH_DATA' non lié au Worker.", 500);
    const userId = String(url.searchParams.get('userId') || '');
    const denied = await authorizeSync(request, userId);
    if (denied) return denied;

    const data = await env.TWITCH_DATA.get(`user_${userId}`, { type: "json" });
    return jsonResponse(data || { history: [], progress: {} });
}

async function handleSyncPost(request, env) {
    if (request.method !== 'POST') return jsonError("Method Not Allowed", 405);
    if (!env.TWITCH_DATA) return jsonError("Erreur Serveur: KV 'TWITCH_DATA' non lié au Worker.", 500);

    // Taille bornée : une sauvegarde normale pèse quelques kilo-octets.
    const raw = await request.text();
    if (raw.length > SYNC_MAX_BYTES) return jsonError("Sauvegarde trop volumineuse", 413);
    let body;
    try { body = JSON.parse(raw); } catch (e) { return jsonError("JSON invalide", 400); }
    if (!body || typeof body !== 'object') return jsonError("JSON invalide", 400);
    const userId = String(body.userId || '');
    const denied = await authorizeSync(request, userId);
    if (denied) return denied;

    // L'app iOS et le site écrivent tous deux ici. Remplacer bêtement l'objet
    // laissait chacun effacer ce que l'autre avait envoyé ; on fusionne :
    //   • historique : celui du client fait foi (il a déjà fusionné le serveur
    //     à l'ouverture, et c'est lui qui connaît les suppressions) ;
    //   • progression : pour chaque VOD, la position la plus avancée ;
    //   • champ absent de l'envoi : on garde celui du serveur.
    const key = `user_${userId}`;
    const incoming = body.data || {};
    const current = (await env.TWITCH_DATA.get(key, { type: 'json' })) || {};
    const progress = { ...(current.progress || {}) };
    for (const [id, t] of Object.entries(incoming.progress || {})) {
        const v = Number(t);
        if (/^\d+$/.test(id) && Number.isFinite(v) && v > (Number(progress[id]) || 0)) progress[id] = Math.round(v);
    }
    // Progression bornée aux VODs les plus récentes (les identifiants Twitch
    // croissent avec le temps) : la fusion « garder le plus avancé » ne
    // retirait jamais rien, l'objet grossissait sans fin.
    const ids = Object.keys(progress);
    if (ids.length > SYNC_MAX_PROGRESS) {
        ids.sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1));
        for (const id of ids.slice(SYNC_MAX_PROGRESS)) delete progress[id];
    }
    const next = {
        history: Array.isArray(incoming.history) ? incoming.history.slice(0, 50).map(cleanHistoryItem).filter(Boolean) : (current.history || []),
        progress
    };

    // Rien de neuf : pas d'écriture. Le palier gratuit du KV n'en offre
    // que 1 000 par jour, contre 100 000 lectures.
    const before = JSON.stringify({ history: current.history || [], progress: current.progress || {} });
    const after = JSON.stringify(next);
    if (before === after) return jsonResponse({ success: true, unchanged: true });

    await env.TWITCH_DATA.put(key, after);
    return jsonResponse({ success: true });
}

const SYNC_MAX_BYTES = 256 * 1024;
const SYNC_MAX_PROGRESS = 500;
// Seuls les champs connus, en texte de longueur raisonnable : la sauvegarde
// ne doit pas servir à stocker n'importe quoi.
function cleanHistoryItem(it) {
    if (!it || typeof it !== 'object') return null;
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    const term = str(it.term, 100);
    if (!term || (it.type !== 'vod' && it.type !== 'channel')) return null;
    const out = { term, type: it.type, display: str(it.display, 300) || term };
    const thumb = str(it.thumb, 500); if (thumb && /^https:\/\//.test(thumb)) out.thumb = thumb;
    const avatar = str(it.avatar, 500); if (avatar && /^https:\/\//.test(avatar)) out.avatar = avatar;
    const streamer = str(it.streamer, 50); if (streamer) out.streamer = streamer;
    const addedAt = Number(it.addedAt); if (Number.isFinite(addedAt) && addedAt > 0) out.addedAt = addedAt;
    return out;
}

// --- HANDLERS CLASSIQUES ---
async function handleGetVideos(url) {
    const name = (url.searchParams.get('name') || '').trim();
    const cursor = url.searchParams.get('cursor') || null;
    if (!LOGIN_RE.test(name)) return jsonError("Nom invalide", 400);
    if (cursor && !CURSOR_RE.test(cursor)) return jsonError("Curseur invalide", 400);

    const query = `query($login: String!, $after: Cursor) { user(login: $login) { profileImageURL(width: 70) videos(first: 100, type: ARCHIVE, sort: TIME, after: $after) { edges { node { id, title, publishedAt, lengthSeconds, viewCount, previewThumbnailURL(height: 180, width: 320) } } pageInfo { hasNextPage, endCursor } } } }`;
    
    try {
        const data = await twitchGQL(query, { login: name.toLowerCase(), after: cursor });
        const user = data.data.user;
        if (!user || !user.videos) return jsonError("Aucune vidéo", 404);
        
        return jsonResponse({ 
            videos: user.videos.edges.map(e => e.node), 
            pagination: user.videos.pageInfo,
            avatar: user.profileImageURL
        });
    } catch (e) { console.error(e); return jsonError("Twitch injoignable", 502); }
}

async function handleGetLive(url, workerOrigin) {
    const login = (url.searchParams.get('name') || '').trim().toLowerCase();
    if (!LOGIN_RE.test(login)) return jsonError("Nom invalide", 400);
    const useProxy = true; // On force toujours le proxy pour les Lives (CORS)
    
    let m3u8Content = "";
    let masterUrl = "";

    try {
        // --- TENTATIVE 1 : Luminous API (Filtre Anti-Pub) ---
        const resLuminous = await fetch(`https://as.luminous.dev/live/${login}?allow_source=true`, { headers: getRequestHeaders(login) });
        if (resLuminous.ok) {
            m3u8Content = await resLuminous.text();
            masterUrl = resLuminous.url;
        } else {
            throw new Error("Luminous down");
        }
    } catch(e) {
        // --- TENTATIVE 2 : Plan de Secours Officiel Twitch ---
        try {
            const token = await getAccessToken(login, true); if (!token) return jsonError("Offline", 404);
            const resUsher = await fetch(`https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?allow_source=true&allow_audio_only=true&allow_spectre=true&player=twitchweb&playlist_include_framerate=true&segment_preference=4&sig=${encodeURIComponent(token.signature)}&token=${encodeURIComponent(token.value)}`, { headers: REQUEST_HEADERS });
            if (!resUsher.ok) throw new Error("Stream introuvable");
            m3u8Content = await resUsher.text();
            masterUrl = resUsher.url;
        } catch(err) {
            return jsonError("Offline ou introuvable", 404);
        }
    }

    // Découpage du fichier M3U8 avec notre Proxy
    const links = parseAndProxyM3U8(m3u8Content, masterUrl, workerOrigin, false, useProxy);
    
    // Récupération des infos du stream (Titre, Jeu, Avatar) pour un bel affichage
    try {
        const meta = await twitchGQL(`query($login: String!) { user(login: $login) { profileImageURL(width: 70) broadcastSettings { title game { displayName } } } }`, { login });
        const info = meta.data?.user?.broadcastSettings, avatar = meta.data?.user?.profileImageURL;
        return jsonResponse({ links, best: links["Source"] || links["Auto"], title: info?.title || "Live", game: info?.game?.displayName || "", thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg`, avatar: avatar || "" });
    } catch(e) {
        // Si l'API GQL bug, on renvoie la vidéo quand même
        return jsonResponse({ links, best: links["Source"] || links["Auto"], title: "Live", game: "", thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg`, avatar: "" });
    }
}

async function handleGetM3U8(url, workerOrigin) {
    const vodId = url.searchParams.get('id') || ''; if (!VOD_ID_RE.test(vodId)) return jsonError("ID invalide", 400);
    const useProxy = url.searchParams.get('proxy') !== 'false';
    
    // --- 1. Tentative Normale ---
    try {
        const token = await getAccessToken(vodId, false);
        if (token) {
            const res = await fetch(`https://usher.ttvnw.net/vod/${vodId}.m3u8?nauth=${encodeURIComponent(token.value)}&nauthsig=${encodeURIComponent(token.signature)}&allow_source=true&player_backend=mediaplayer`, { headers: REQUEST_HEADERS });
            if (res.ok) { 
                const links = parseAndProxyM3U8(await res.text(), res.url, workerOrigin, true, useProxy); 
                return jsonResponse({ links, best: links["Source"] || links["Auto"] }); 
            }
        }
    } catch (e) {}
    
    // --- 2. Plan de Secours ---
    try {
        const data = await twitchGQL(`query($id: ID!) { video(id: $id) { seekPreviewsURL } }`, { id: vodId }); const seekUrl = data.data?.video?.seekPreviewsURL;
        if (seekUrl) {
            const rawLinks = await storyboardHack(seekUrl);
            if (Object.keys(rawLinks).length > 0) {
                let finalLinks = {}; 
                finalLinks["Auto"] = useProxy ? `${workerOrigin}/api/proxy?url=${encodeURIComponent(Object.values(rawLinks)[0])}&isVod=true` : Object.values(rawLinks)[0];
                
                ['Source', '1080p60', '1080p30', '720p60', '720p30', '480p30', '360p30', '160p30', 'audio_only'].forEach(key => { 
                    Object.keys(rawLinks).forEach(k => { 
                        if (k.toLowerCase().includes(key.toLowerCase())) { 
                            finalLinks[k] = useProxy ? `${workerOrigin}/api/proxy?url=${encodeURIComponent(rawLinks[k])}&isVod=true` : rawLinks[k]; 
                            delete rawLinks[k]; 
                        } 
                    }); 
                });
                return jsonResponse({ links: finalLinks, best: finalLinks["Source"] || finalLinks["Auto"], info: "Backup" });
            }
        }
    } catch (e) {}
    return jsonError("VOD introuvable", 404);
}

// --- LE PROXY ---
// Hôtes que le proxy accepte de relayer : Twitch (playlists, segments,
// VODs) et Luminous. Sans cette liste, /api/proxy relayait n'importe quelle
// adresse — un proxy ouvert à tout Internet, aux frais du Worker.
const PROXY_HOSTS = ['ttvnw.net', 'jtvnw.net', 'twitch.tv', 'cloudfront.net', 'luminous.dev', 'twitchcdn.net'];
function proxyAllowed(target) {
    try {
        const u = new URL(target);
        if (u.protocol !== 'https:') return false;
        if (!PROXY_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) return false;
        // N'importe qui peut héberger des fichiers sur cloudfront.net : on n'y
        // accepte que les dossiers de VOD Twitch (« <empreinte>_<chaîne>_… »).
        if (u.hostname.endsWith('.cloudfront.net')) return /^\/[0-9a-f]{20}_/.test(u.pathname);
        return true;
    } catch (e) { return false; }
}

async function handleProxy(url, request) {
    const target = url.searchParams.get('url'); if (!target) return new Response("URL manquante", { status: 400, headers: RESPONSE_HEADERS });
    if (!proxyAllowed(target)) return new Response("Hôte non autorisé", { status: 403, headers: RESPONSE_HEADERS });
    const isVod = url.searchParams.get('isVod') === 'true', workerOrigin = url.origin;

    let fetchHeaders = { ...REQUEST_HEADERS };
    if (request.headers.get("Range")) fetchHeaders["Range"] = request.headers.get("Range");

    const res = await fetch(target, { headers: fetchHeaders });
    const newHeaders = new Headers(res.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Expose-Headers", "*");
    newHeaders.delete("Set-Cookie");

    // Playlist reconnue à son type, pas seulement à son extension : celles
    // de Luminous (« /live/<chaîne>?allow_source=true ») et les variantes
    // qu'elles listent (« …playlist.ttvnw.net/v1/playlist/… ») n'ont pas de
    // « .m3u8 ». Non reconnues, elles passaient sans réécriture.
    const type = res.headers.get('content-type') || '';
    if (target.includes('.m3u8') || /mpegurl/i.test(type)) {
        newHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
        const finalUrl = res.url, base = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
        const proxyUrl = (full) => `${workerOrigin}/api/proxy?url=${encodeURIComponent(full)}&isVod=${isVod}`;
        // Une sous-playlist passe TOUJOURS par le proxy : ses jetons sont liés
        // à l'adresse IP qui l'a demandée — celle du Worker ou de Luminous —,
        // et le navigateur s'y faisait refuser (403). Les segments d'un
        // direct, eux, partent en direct : leur CDN accepte tout le monde.
        const isPlaylistUrl = (full) => full.includes('.m3u8') || /(^|\.)playlist\.ttvnw\.net\//.test(new URL(full).hostname + '/') || /luminous\.dev$/.test(new URL(full).hostname);
        const proxify = (u, playlist) => {
            const full = u.startsWith('http') ? u : new URL(u, base).href;
            return (isVod || playlist || isPlaylistUrl(full)) ? proxyUrl(full) : full;
        };
        let nextIsPlaylist = false;
        const newText = (await res.text()).split('\n').map(l => {
            const line = l.trim(); if (!line) return line;
            if (line.startsWith('#')) {
                // La ligne qui suit EXT-X-STREAM-INF est une sous-playlist.
                if (line.startsWith('#EXT-X-STREAM-INF')) nextIsPlaylist = true;
                const tagIsPlaylist = line.startsWith('#EXT-X-MEDIA') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF');
                // Balises avec une adresse (EXT-X-MAP du fMP4, EXT-X-KEY,
                // pistes audio EXT-X-MEDIA…).
                return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${proxify(u, tagIsPlaylist)}"`);
            }
            const out = proxify(line, nextIsPlaylist);
            nextIsPlaylist = false;
            return out;
        }).join('\n');
        return new Response(newText, { status: res.status, headers: newHeaders });
    }
    return new Response(res.body, { status: res.status, headers: newHeaders });
}

// --- FONCTIONS UTILITAIRES ---
function parseAndProxyM3U8(content, master, workerOrigin, isVod, useProxy = true) { 
    const lines = content.split('\n'); const proxyBase = `${workerOrigin}/api/proxy?url=`; let unsorted = {}, last = ""; 
    lines.forEach(l => { 
        if (l.includes('VIDEO="')) { try { let n = l.split('VIDEO="')[1].split('"')[0]; if (n === 'chunked') n = 'Source'; last = n; } catch(e) {} } 
        else if (l.startsWith('http') && last) { unsorted[last] = useProxy ? `${proxyBase}${encodeURIComponent(l)}&isVod=${isVod}` : l; last = ""; } 
    }); 
    let sorted = {}; sorted["Auto"] = useProxy ? `${proxyBase}${encodeURIComponent(master)}&isVod=${isVod}` : master; 
    ['Source', '1080p60', '1080p30', '720p60', '720p30', '480p30', '360p30', '160p30', 'audio_only'].forEach(key => { Object.keys(unsorted).forEach(k => { if (k.toLowerCase().includes(key.toLowerCase())) { sorted[k] = unsorted[k]; delete unsorted[k]; } }); }); Object.assign(sorted, unsorted); return sorted; 
}

async function twitchGQL(query, variables = {}) {
    const res = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json', 'User-Agent': REQUEST_HEADERS['User-Agent'], 'Device-ID': 'MkMq8a9' + Math.random().toString(36).substring(2, 15) },
        body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error(`GQL ${res.status}`);
    return await res.json();
}

async function getAccessToken(id, isLive) {
    const query = isLive 
        ? `query($id: String!) { streamPlaybackAccessToken(channelName: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`
        : `query($id: ID!) { videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`;
    const data = await twitchGQL(query, { id });
    return isLive ? data.data?.streamPlaybackAccessToken : data.data?.videoPlaybackAccessToken;
}

async function storyboardHack(seekUrl) {
    try {
        const parts = seekUrl.split('/');
        const storyIndex = parts.indexOf('storyboards');
        if (storyIndex === -1) return {};
        const hash = parts[storyIndex - 1]; 
        const root = `https://${new URL(seekUrl).host}/${hash}`;

        let found = {};
        await Promise.all(QUALITY_ORDER.map(async q => {
            const u = `${root}/${q}/index-dvr.m3u8`;
            const res = await fetch(u, { method: 'HEAD', headers: REQUEST_HEADERS });
            if (res.status === 200) found[q] = u;
        }));
        return found;
    } catch(e) { return {}; }
}

// En-têtes pour Luminous : un Referer pointant sur la chaîne demandée.
// La fonction était appelée sans exister : l'appel levait une ReferenceError,
// avalée par le catch, et la route servait toujours le flux Twitch officiel,
// avec les publicités — Luminous n'était jamais réellement essayé.
function getRequestHeaders(login) {
    return { ...REQUEST_HEADERS, 'Referer': `https://www.twitch.tv/${login}` };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Comptage d'utilisation — app iOS et site.
//
//  Une clé par installation (app) ou par navigateur (site) : `usage_<uuid>`,
//  valeur vide, tout dans les métadonnées. Stocké : un identifiant tiré au
//  hasard, des dates (sans l'heure), une version, la plateforme. Pas
//  d'adresse IP, pas d'en-tête, rien du compte Twitch. Les clés expirent
//  seules au bout de 35 jours. Préfixe `usage_` : aucune collision avec la
//  sauvegarde (`user_`).
// ═══════════════════════════════════════════════════════════════════════════
const USAGE_PREFIX = 'usage_';
const USAGE_ACCOUNT_PREFIX = 'usage_a_';
/** Comptes Twitch administrateurs (ID numérique : le pseudo peut changer). mxfia19 */
const ADMIN_IDS = ['839837720'];
const USAGE_RETENTION_DAYS = 35;
const PLATFORMS = ['ios', 'web'];
// Le site officiel : un ping « web » venu d'ailleurs (copie locale, tests,
// préversions) n'est pas compté. L'app iOS n'envoie pas d'en-tête Origin.
const USAGE_ORIGINS = ['https://test2-fawn-eta.vercel.app'];
// Navigateurs automatisés et robots qui exécutent le JavaScript.
const BOT_UA = /headless|bot\b|crawler|spider|slurp|playwright|puppeteer|selenium|phantomjs|lighthouse|preview/i;

// POST /api/ping — { id, version, platform } enregistre ; { id, forget: true } efface.
async function handlePing(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.TWITCH_DATA) return jsonError("KV 'TWITCH_DATA' non lié au Worker.", 500);
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }

    // Chaque ping est une écriture KV (1 000 par jour en gratuit) : une même
    // adresse ne peut pas en enchaîner des centaines. Compté en mémoire
    // seulement, jamais stocké.
    if (pingFlood(request.headers.get('CF-Connecting-IP') || '')) return jsonError('Trop de requêtes', 429);

    // Bruit écarté sans erreur (le client n'a rien à corriger) : robots et
    // navigateurs automatisés, et pings « web » hors du site officiel.
    const origin = request.headers.get('Origin');
    const ua = request.headers.get('User-Agent') || '';
    if (BOT_UA.test(ua) || (origin && !USAGE_ORIGINS.includes(origin))) {
        return jsonResponse({ ok: true, ignored: true });
    }

    // Uniquement des UUID : pas question de laisser écrire des clés libres.
    const id = String(body.id || '');
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return jsonError('ID invalide', 400);

    // Connecté à Twitch : on compte le COMPTE (un seul, quel que soit le
    // nombre d'appareils ou de navigateurs), clé `usage_a_<id Twitch>`.
    // Sinon l'identifiant aléatoire de l'appareil, clé `usage_<uuid>`.
    const who = request.headers.get('Authorization') ? await tokenIdentity(request) : null;
    const anonKey = USAGE_PREFIX + id;
    const key = who ? USAGE_ACCOUNT_PREFIX + who.userId : anonKey;

    if (body.forget === true) {
        await env.TWITCH_DATA.delete(anonKey);
        if (who) await env.TWITCH_DATA.delete(key);
        return jsonResponse({ ok: true, forgotten: true });
    }

    const day = new Date().toISOString().slice(0, 10);
    const platform = PLATFORMS.includes(body.platform) ? body.platform : 'ios';
    const version = String(body.version || '?').slice(0, 16);
    let prev = {};
    try { prev = (await env.TWITCH_DATA.getWithMetadata(key)).metadata || {}; } catch (e) {}

    // Première connexion sur cet appareil : l'historique anonyme est repris
    // par le compte, puis effacé (sinon la même personne compterait deux fois).
    if (who) {
        let anon = null;
        try { anon = (await env.TWITCH_DATA.getWithMetadata(anonKey)).metadata; } catch (e) {}
        if (anon) {
            if (!prev.first || (anon.first && anon.first < prev.first)) prev.first = anon.first;
            prev.days = Math.max(prev.days || 0, anon.days || 0);
            if (anon.last && (!prev.last || anon.last > prev.last)) prev.last = anon.last;
            // Les plateformes vues anonymement restent acquises au compte.
            const seen = new Set([...(prev.ps ? String(prev.ps).split(',') : (prev.p ? [prev.p] : [])), ...(anon.ps ? String(anon.ps).split(',') : (anon.p ? [anon.p] : []))]);
            prev.ps = [...seen].filter((x) => PLATFORMS.includes(x)).sort().join(',');
            await env.TWITCH_DATA.delete(anonKey);
        }
    }

    const platforms = [...new Set([...(prev.ps ? String(prev.ps).split(',') : (prev.p ? [prev.p] : [])), platform])].filter((x) => PLATFORMS.includes(x)).sort().join(',');
    const days = prev.last === day ? (prev.days || 1) : (prev.days || 0) + 1;
    const meta = { first: prev.first || day, last: day, days, v: version, p: platform, ps: platforms };
    if (who) { meta.k = 'a'; meta.l = who.login.slice(0, 25); }

    // Rien de neuf aujourd'hui : pas d'écriture (1 000 par jour en gratuit).
    if (prev.last === day && prev.v === version && prev.ps === platforms && (!who || prev.l === meta.l)) {
        return jsonResponse({ ok: true, days, unchanged: true });
    }
    await env.TWITCH_DATA.put(key, '', { expirationTtl: 60 * 60 * 24 * USAGE_RETENTION_DAYS, metadata: meta });
    return jsonResponse({ ok: true, days, account: Boolean(who) });
}

const pingHits = new Map();   // adresse → { n, until } (mémoire de l'instance)
function pingFlood(ip) {
    const now = Date.now();
    const hit = pingHits.get(ip);
    if (!hit || hit.until < now) {
        if (pingHits.size > 5000) pingHits.clear();
        pingHits.set(ip, { n: 1, until: now + 60 * 60 * 1000 });
        return false;
    }
    return ++hit.n > 10;
}

// Les statistiques parcourent toutes les clés (list() : 1 000 par jour en
// gratuit). Mises en cache une minute, pour qu'une page rechargée en boucle
// ne vide pas le quota.
// (Cache API inopérant sur workers.dev : cache en mémoire de l'instance.)
let statsCache = null;   // { body, until }
async function cachedStats(request, env, ctx) {
    if (statsCache && statsCache.until > Date.now()) {
        return new Response(statsCache.body, { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    const res = await handleStats(env);
    if (res.ok) statsCache = { body: await res.clone().text(), until: Date.now() + 60 * 1000 };
    return res;
}

// GET /api/stats — compteurs agrégés, au total et par plateforme.
async function handleStats(env) {
    if (!env.TWITCH_DATA) return jsonError("KV 'TWITCH_DATA' non lié au Worker.", 500);
    const todayMs = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const blank = () => ({ today: 0, week: 0, month: 0, known: 0, returning: 0 });
    const total = blank();
    const kinds = { accounts: blank(), anonymous: blank() };
    const platforms = Object.fromEntries(PLATFORMS.map((p) => [p, blank()]));
    const versions = {};
    const loyalty = { once: 0, few: 0, regular: 0, daily: 0 };
    let returning = 0, totalDays = 0, oldestFirst = null, cursor;
    // Série des 30 derniers jours : nouveaux (premier jour vu) et vus pour la
    // dernière fois ce jour-là, par plateforme.
    const dayKey = (offset) => new Date(todayMs - offset * 86400000).toISOString().slice(0, 10);
    const daily = {};
    for (let i = 29; i >= 0; i--) daily[dayKey(i)] = { date: dayKey(i), newIos: 0, newWeb: 0, lastIos: 0, lastWeb: 0 };

    // list() renvoie les métadonnées sans lecture par clé ; 1000 clés par page.
    do {
        const page = await env.TWITCH_DATA.list({ prefix: USAGE_PREFIX, limit: 1000, cursor });
        for (const key of page.keys) {
            const meta = key.metadata || {};
            const then = Date.parse((meta.last || '') + 'T00:00:00Z');
            const age = Number.isNaN(then) ? Infinity : Math.floor((todayMs - then) / 86400000);
            // Une seule plateforme par identifiant : utilisé sur l'app ET le
            // site, il compte comme iOS (l'app est le vrai signe d'adoption).
            const plats = meta.ps ? String(meta.ps).split(',') : [meta.p || 'ios'];
            const plat = plats.includes('ios') || !plats.includes('web') ? 'ios' : 'web';
            const buckets = [platforms[plat]];
            const kind = meta.k === 'a' ? kinds.accounts : kinds.anonymous;
            for (const c of [total, kind, ...buckets]) {
                c.known++;
                if (age === 0) c.today++;
                if (age <= 7) c.week++;
                if (age <= 30) c.month++;
            }
            if (age <= 30) { const v = `${meta.p || 'ios'} ${meta.v || '?'}`; versions[v] = (versions[v] || 0) + 1; }
            const d = meta.days || 1;
            totalDays += d;
            if (d >= 2) { returning++; kind.returning++; for (const b of buckets) b.returning++; }
            if (d === 1) loyalty.once++; else if (d < 7) loyalty.few++; else if (d < 30) loyalty.regular++; else loyalty.daily++;
            if (meta.first && (!oldestFirst || meta.first < oldestFirst)) oldestFirst = meta.first;
            const p = plat === 'web' ? 'Web' : 'Ios';
            if (daily[meta.first]) daily[meta.first]['new' + p]++;
            if (daily[meta.last]) daily[meta.last]['last' + p]++;
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    const payload = {
        ...total, platforms, accounts: kinds.accounts, anonymous: kinds.anonymous, returning, loyalty,
        avgDays: total.known ? Math.round((totalDays / total.known) * 10) / 10 : 0,
        oldestFirst,
        versions: Object.entries(versions).map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count),
        daily: Object.values(daily),
        generatedAt: new Date().toISOString()
    };
    // no-store : sinon « Actualiser » pourrait resservir les mêmes chiffres.
    return new Response(JSON.stringify(payload), { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function jsonResponse(obj) { return new Response(JSON.stringify(obj), { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } }); }
function jsonError(msg, status) { return new Response(JSON.stringify({ error: msg }), { status, headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } }); }

// ═══════════════════════════════════════════════════════════════════════════
//  Administration : réservé aux comptes de ADMIN_IDS (jeton Twitch vérifié).
// ═══════════════════════════════════════════════════════════════════════════
async function requireAdmin(request) {
    const who = await tokenIdentity(request);
    if (!who) return { denied: jsonError('Jeton Twitch manquant ou expiré', 401) };
    if (!ADMIN_IDS.includes(who.userId)) return { denied: jsonError('Réservé au propriétaire', 403) };
    return { who };
}

// GET /api/admin/me — suis-je administrateur ?
async function handleAdminMe(request) {
    const who = await tokenIdentity(request);
    return jsonResponse({ login: who?.login ?? null, admin: Boolean(who && ADMIN_IDS.includes(who.userId)) });
}

async function listUsage(env) {
    const out = [];
    let cursor;
    do {
        const page = await env.TWITCH_DATA.list({ prefix: USAGE_PREFIX, limit: 1000, cursor });
        out.push(...page.keys);
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
}

// GET /api/admin/usage — le détail : comptes (avec pseudo) et anonymes.
async function handleAdminUsage(request, env) {
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    const keys = await listUsage(env);
    const entries = keys.map(({ name, metadata: m = {} }) => ({
        key: name,
        kind: m.k === 'a' ? 'account' : 'anonymous',
        login: m.l || null,
        platforms: m.ps || m.p || 'ios',
        version: m.v || '?',
        first: m.first || null,
        last: m.last || null,
        days: m.days || 1,
    })).sort((a, b) => String(b.last).localeCompare(String(a.last)));
    return new Response(JSON.stringify({ entries }), { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// POST /api/admin/usage/delete — { target: 'key'|'anon'|'anon-web'|'once'|'all', key? }
async function handleAdminUsageDelete(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const target = String(body.target || '');
    const keys = await listUsage(env);
    const match = {
        key: (k) => k.name === body.key,
        anon: (k) => k.metadata?.k !== 'a',
        'anon-web': (k) => k.metadata?.k !== 'a' && (k.metadata?.ps || k.metadata?.p) === 'web',
        once: (k) => (k.metadata?.days || 1) <= 1,
        all: () => true,
    }[target];
    if (!match) return jsonError('Cible inconnue', 400);
    if (target === 'key' && !String(body.key || '').startsWith(USAGE_PREFIX)) return jsonError('Clé invalide', 400);
    // Chaque suppression compte comme une écriture KV : plafonnée par appel.
    const doomed = keys.filter(match).slice(0, 500);
    for (const k of doomed) await env.TWITCH_DATA.delete(k.name);
    statsCache = null;
    return jsonResponse({ ok: true, deleted: doomed.length, remaining: keys.filter(match).length - doomed.length });
}

// POST /api/admin/sync/delete — { login } : efface la sauvegarde d'un compte.
async function handleAdminSyncDelete(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const login = String(body.login || '').trim().toLowerCase();
    if (!LOGIN_RE.test(login)) return jsonError('Nom invalide', 400);
    const d = await twitchGQL('query($l: String!) { user(login: $l) { id } }', { l: login });
    const id = d?.data?.user?.id;
    if (!id) return jsonError('Compte introuvable', 404);
    const existed = Boolean(await env.TWITCH_DATA.get(`user_${id}`));
    if (existed) await env.TWITCH_DATA.delete(`user_${id}`);
    return jsonResponse({ ok: true, existed });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Annonces : un message du développeur affiché dans l'app pendant une durée
//  choisie. Une seule annonce à la fois, clé KV `announcement`, qui expire
//  d'elle-même (expirationTtl) : rien à nettoyer.
// ═══════════════════════════════════════════════════════════════════════════
const ANNOUNCEMENT_KEY = 'announcement';
let announcementCache = null;   // { value, until } — l'app la relit à chaque ouverture

async function readAnnouncement(env) {
    if (announcementCache && announcementCache.until > Date.now()) return announcementCache.value;
    let value = null;
    try { value = await env.TWITCH_DATA.get(ANNOUNCEMENT_KEY, 'json'); } catch (e) {}
    if (value && !(value.until > Date.now())) value = null;
    announcementCache = { value, until: Date.now() + 60 * 1000 };
    return value;
}

// GET /api/announcement — { announcement: null | { id, title, message, link, until } }
async function handleAnnouncementGet(env) {
    if (!env.TWITCH_DATA) return jsonResponse({ announcement: null });
    return new Response(JSON.stringify({ announcement: await readAnnouncement(env) }), {
        headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
}

// GET : annonce en cours. POST { title, message, link?, hours } : publier.
// POST { edit: true, …, keepUntil?, renotify? } : modifier l'annonce en cours
// (même identifiant : qui l'a fermée ne la revoit pas, sauf `renotify`).
// POST { clear: true } : retirer.
async function handleAdminAnnouncement(request, env) {
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    if (request.method === 'GET') {
        const announcement = await readAnnouncement(env);
        return jsonResponse({ announcement, reactions: announcement ? await countReactions(env, announcement.id) : null });
    }
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    announcementCache = null;
    if (body.clear === true) {
        await env.TWITCH_DATA.delete(ANNOUNCEMENT_KEY);
        return jsonResponse({ ok: true, announcement: null });
    }
    const title = String(body.title || '').trim().slice(0, 80);
    const message = String(body.message || '').trim().slice(0, 500);
    if (!title && !message) return jsonError('Titre ou message requis', 400);
    let link = String(body.link || '').trim().slice(0, 300);
    if (link && !/^https:\/\/[^\s]+$/i.test(link)) return jsonError('Lien : https:// uniquement', 400);
    let prev = null;
    if (body.edit === true) {
        try { prev = await env.TWITCH_DATA.get(ANNOUNCEMENT_KEY, 'json'); } catch (e) {}
        if (!prev || !(prev.until > Date.now())) return jsonError('Aucune annonce en cours à modifier', 404);
    }
    let ttl;
    if (prev && body.keepUntil === true) {
        ttl = Math.max(60, Math.round((prev.until - Date.now()) / 1000));
    } else {
        const hours = Math.min(24 * 30, Math.max(1 / 60, Number(body.hours) || 24));
        ttl = Math.round(hours * 3600);
    }
    const announcement = {
        id: prev && body.renotify !== true ? prev.id : Date.now().toString(36),
        title, message, link: link || null,
        until: prev && body.keepUntil === true ? prev.until : Date.now() + ttl * 1000,
        createdAt: prev ? prev.createdAt : Date.now(),
        ...(prev ? { editedAt: Date.now() } : {}),
    };
    // expirationTtl : 60 s minimum chez Cloudflare.
    await env.TWITCH_DATA.put(ANNOUNCEMENT_KEY, JSON.stringify(announcement), { expirationTtl: Math.max(60, ttl) });
    return jsonResponse({ ok: true, announcement });
}

// ── Réactions aux annonces ───────────────────────────────────────────────
// Une réaction par appareil (identifiant aléatoire de l'app ou du site),
// modifiable ou retirable. Clé `annr_<annonce>_<appareil>`, l'emoji en
// métadonnées : le décompte (réservé à l'admin) se fait avec list(), sans
// lecture par clé. Les clés expirent une semaine après l'annonce.
const REACTIONS = ['👍', '❤️', '🔥', '😂', '👎'];
const REACTION_PREFIX = 'annr_';
const reactHits = new Map();   // adresse → { n, until } (mémoire de l'instance)

async function handleAnnouncementReact(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.TWITCH_DATA) return jsonError("KV 'TWITCH_DATA' non lié au Worker.", 500);
    const ua = request.headers.get('User-Agent') || '';
    if (BOT_UA.test(ua)) return jsonResponse({ ok: true, ignored: true });
    // Chaque réaction est une écriture KV : 30 par heure et par adresse.
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const now = Date.now();
    const hit = reactHits.get(ip);
    if (!hit || hit.until < now) {
        if (reactHits.size > 5000) reactHits.clear();
        reactHits.set(ip, { n: 1, until: now + 60 * 60 * 1000 });
    } else if (++hit.n > 30) return jsonError('Trop de requêtes', 429);

    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const device = String(body.id || '');
    if (!/^[0-9a-fA-F-]{36}$/.test(device)) return jsonError('ID invalide', 400);
    const current = await readAnnouncement(env);
    if (!current || current.id !== String(body.announcementId || '')) return jsonError('Annonce terminée', 410);
    const emoji = body.emoji == null ? null : String(body.emoji);
    if (emoji !== null && !REACTIONS.includes(emoji)) return jsonError('Réaction inconnue', 400);

    const key = `${REACTION_PREFIX}${current.id}_${device.toLowerCase()}`;
    if (emoji === null) await env.TWITCH_DATA.delete(key);
    else {
        const ttl = Math.max(60, Math.round((current.until - now) / 1000) + 7 * 86400);
        await env.TWITCH_DATA.put(key, '', { expirationTtl: ttl, metadata: { e: emoji } });
    }
    return jsonResponse({ ok: true, emoji });
}

async function countReactions(env, announcementId) {
    const counts = Object.fromEntries(REACTIONS.map((e) => [e, 0]));
    let cursor, total = 0;
    do {
        const page = await env.TWITCH_DATA.list({ prefix: `${REACTION_PREFIX}${announcementId}_`, limit: 1000, cursor });
        for (const k of page.keys) {
            const e = k.metadata?.e;
            if (e in counts) { counts[e]++; total++; }
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return { counts, total };
}
