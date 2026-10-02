const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

// Headers pour RÉPONDRE à votre site web
const RESPONSE_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cache-Control, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range'
};

// Headers pour ATTAQUER Twitch et Luminous incognito
const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv'
};

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
                case '/api/sync/get': return await handleSyncGet(url, env);
                case '/api/sync/post': return await handleSyncPost(request, env);

                // Comptage d'utilisation (app iOS et site)
                case '/api/ping': return await handlePing(request, env);
                case '/api/stats': return await handleStats(env);
                
                default: return new Response("Not Found", { status: 404, headers: RESPONSE_HEADERS });
            }
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } });
        }
    }
};

// --- SYSTÈME DE SYNCHRONISATION CLOUD (KV) ---
async function handleSyncGet(url, env) {
    if (!env.TWITCH_DATA) return jsonError("Erreur Serveur: KV 'TWITCH_DATA' non lié au Worker.", 500);
    const userId = url.searchParams.get('userId');
    if (!userId) return jsonError("User ID manquant", 400);

    const data = await env.TWITCH_DATA.get(`user_${userId}`, { type: "json" });
    return jsonResponse(data || { history: [], progress: {} });
}

async function handleSyncPost(request, env) {
    if (request.method !== 'POST') return jsonError("Method Not Allowed", 405);
    if (!env.TWITCH_DATA) return jsonError("Erreur Serveur: KV 'TWITCH_DATA' non lié au Worker.", 500);
    
    try {
        const body = await request.json();
        const userId = body.userId;
        if (!userId) return jsonError("User ID manquant", 400);
        
        await env.TWITCH_DATA.put(`user_${userId}`, JSON.stringify(body.data));
        return jsonResponse({ success: true });
    } catch (e) {
        return jsonError("JSON invalide", 400);
    }
}

// --- HANDLERS CLASSIQUES ---
async function handleGetVideos(url) {
    const name = url.searchParams.get('name');
    const cursor = url.searchParams.get('cursor');
    if (!name) return jsonError("Nom manquant");

    const query = `query { user(login: "${name}") { profileImageURL(width: 70) videos(first: 100, type: ARCHIVE, sort: TIME${cursor ? `, after: "${cursor}"` : ""}) { edges { node { id, title, publishedAt, lengthSeconds, viewCount, previewThumbnailURL(height: 180, width: 320) } } pageInfo { hasNextPage, endCursor } } } }`;
    
    try {
        const data = await twitchGQL(query);
        const user = data.data.user;
        if (!user || !user.videos) return jsonError("Aucune vidéo", 404);
        
        return jsonResponse({ 
            videos: user.videos.edges.map(e => e.node), 
            pagination: user.videos.pageInfo,
            avatar: user.profileImageURL
        });
    } catch (e) { return jsonError(e.message, 500); }
}

async function handleGetLive(url, workerOrigin) {
    const name = url.searchParams.get('name'); if (!name) return jsonError("Nom manquant"); const login = name.trim().toLowerCase();
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
            const resUsher = await fetch(`https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?allow_source=true&allow_audio_only=true&allow_spectre=true&player=twitchweb&playlist_include_framerate=true&segment_preference=4&sig=${token.signature}&token=${encodeURIComponent(token.value)}`, { headers: REQUEST_HEADERS });
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
        const meta = await twitchGQL(`query { user(login: "${login}") { profileImageURL(width: 70) broadcastSettings { title game { displayName } } } }`);
        const info = meta.data?.user?.broadcastSettings, avatar = meta.data?.user?.profileImageURL;
        return jsonResponse({ links, best: links["Source"] || links["Auto"], title: info?.title || "Live", game: info?.game?.displayName || "", thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg`, avatar: avatar || "" });
    } catch(e) {
        // Si l'API GQL bug, on renvoie la vidéo quand même
        return jsonResponse({ links, best: links["Source"] || links["Auto"], title: "Live", game: "", thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg`, avatar: "" });
    }
}

async function handleGetM3U8(url, workerOrigin) {
    const vodId = url.searchParams.get('id'); if (!vodId) return jsonError("ID manquant");
    const useProxy = url.searchParams.get('proxy') !== 'false';
    
    // --- 1. Tentative Normale ---
    try {
        const token = await getAccessToken(vodId, false);
        if (token) {
            const res = await fetch(`https://usher.ttvnw.net/vod/${vodId}.m3u8?nauth=${token.value}&nauthsig=${token.signature}&allow_source=true&player_backend=mediaplayer`, { headers: REQUEST_HEADERS });
            if (res.ok) { 
                const links = parseAndProxyM3U8(await res.text(), res.url, workerOrigin, true, useProxy); 
                return jsonResponse({ links, best: links["Source"] || links["Auto"] }); 
            }
        }
    } catch (e) {}
    
    // --- 2. Plan de Secours ---
    try {
        const data = await twitchGQL(`query { video(id: "${vodId}") { seekPreviewsURL } }`); const seekUrl = data.data?.video?.seekPreviewsURL;
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
async function handleProxy(url, request) {
    const target = url.searchParams.get('url'); if (!target) return new Response("URL manquante", { status: 400 });
    const isVod = url.searchParams.get('isVod') === 'true', workerOrigin = url.origin;
    
    let fetchHeaders = { ...REQUEST_HEADERS }; 
    if (request.headers.get("Range")) fetchHeaders["Range"] = request.headers.get("Range");
    
    const res = await fetch(target, { headers: fetchHeaders }); 
    const newHeaders = new Headers(res.headers); 
    newHeaders.set("Access-Control-Allow-Origin", "*"); 
    newHeaders.set("Access-Control-Expose-Headers", "*"); 
    
    if (target.includes('.m3u8')) {
        newHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
        const finalUrl = res.url, base = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
        const proxify = (u) => {
            const full = u.startsWith('http') ? u : base + u;
            return (u.includes('.m3u8') || isVod) ? `${workerOrigin}/api/proxy?url=${encodeURIComponent(full)}&isVod=${isVod}` : full;
        };
        const newText = (await res.text()).split('\n').map(l => {
            const line = l.trim(); if (!line) return line;
            // Balises avec une adresse (EXT-X-MAP du fMP4, EXT-X-KEY…) : sans
            // réécriture, « init-0.mp4 » était résolu par rapport au Worker
            // (404) et les VODs chargeaient à l'infini.
            if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${proxify(u)}"`);
            return proxify(line);
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
        ? `query { streamPlaybackAccessToken(channelName: "${id}", params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`
        : `query { videoPlaybackAccessToken(id: "${id}", params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`;
    const data = await twitchGQL(query);
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
const USAGE_RETENTION_DAYS = 35;
const PLATFORMS = ['ios', 'web'];

// POST /api/ping — { id, version, platform } enregistre ; { id, forget: true } efface.
async function handlePing(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.TWITCH_DATA) return jsonError("KV 'TWITCH_DATA' non lié au Worker.", 500);
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }

    // Uniquement des UUID : pas question de laisser écrire des clés libres.
    const id = String(body.id || '');
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return jsonError('ID invalide', 400);

    if (body.forget === true) {
        await env.TWITCH_DATA.delete(USAGE_PREFIX + id);
        return jsonResponse({ ok: true, forgotten: true });
    }

    const day = new Date().toISOString().slice(0, 10);
    let prev = {};
    try { prev = (await env.TWITCH_DATA.getWithMetadata(USAGE_PREFIX + id)).metadata || {}; } catch (e) {}
    // Un même jour ne compte qu'une fois, quel que soit le nombre d'ouvertures.
    const days = prev.last === day ? (prev.days || 1) : (prev.days || 0) + 1;
    const platform = PLATFORMS.includes(body.platform) ? body.platform : 'ios';

    await env.TWITCH_DATA.put(USAGE_PREFIX + id, '', {
        expirationTtl: 60 * 60 * 24 * USAGE_RETENTION_DAYS,
        metadata: { first: prev.first || day, last: day, days, v: String(body.version || '?').slice(0, 16), p: platform }
    });
    return jsonResponse({ ok: true, days });
}

// GET /api/stats — compteurs agrégés, au total et par plateforme.
async function handleStats(env) {
    if (!env.TWITCH_DATA) return jsonError("KV 'TWITCH_DATA' non lié au Worker.", 500);
    const todayMs = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const blank = () => ({ today: 0, week: 0, month: 0, known: 0 });
    const total = blank();
    const platforms = Object.fromEntries(PLATFORMS.map((p) => [p, blank()]));
    const versions = {};
    const loyalty = { once: 0, few: 0, regular: 0, daily: 0 };
    let returning = 0, totalDays = 0, oldestFirst = null, cursor;

    // list() renvoie les métadonnées sans lecture par clé ; 1000 clés par page.
    do {
        const page = await env.TWITCH_DATA.list({ prefix: USAGE_PREFIX, limit: 1000, cursor });
        for (const key of page.keys) {
            const meta = key.metadata || {};
            const then = Date.parse((meta.last || '') + 'T00:00:00Z');
            const age = Number.isNaN(then) ? Infinity : Math.floor((todayMs - then) / 86400000);
            const bucket = platforms[meta.p] || platforms.ios;
            for (const c of [total, bucket]) {
                c.known++;
                if (age === 0) c.today++;
                if (age <= 7) c.week++;
                if (age <= 30) c.month++;
            }
            if (age <= 30) { const v = `${meta.p || 'ios'} ${meta.v || '?'}`; versions[v] = (versions[v] || 0) + 1; }
            const d = meta.days || 1;
            totalDays += d;
            if (d >= 2) returning++;
            if (d === 1) loyalty.once++; else if (d < 7) loyalty.few++; else if (d < 30) loyalty.regular++; else loyalty.daily++;
            if (meta.first && (!oldestFirst || meta.first < oldestFirst)) oldestFirst = meta.first;
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    const payload = {
        ...total, platforms, returning, loyalty,
        avgDays: total.known ? Math.round((totalDays / total.known) * 10) / 10 : 0,
        oldestFirst,
        versions: Object.entries(versions).map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count),
        generatedAt: new Date().toISOString()
    };
    // no-store : sinon « Actualiser » pourrait resservir les mêmes chiffres.
    return new Response(JSON.stringify(payload), { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function jsonResponse(obj) { return new Response(JSON.stringify(obj), { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } }); }
function jsonError(msg, status) { return new Response(JSON.stringify({ error: msg }), { status, headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } }); }
