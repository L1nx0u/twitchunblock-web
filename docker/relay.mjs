// ═══════════════════════════════════════════════════════════════════════════
//  Relais vidéo sur un serveur à soi (un VPS).
//
//  Sur le site, la lecture passe par le relais du Worker (/api/proxy) :
//  chaque segment de VOD, la playlist d'un direct toutes les ~2 s. C'est
//  presque tout le quota de requêtes de Cloudflare. Ce serveur fait la même
//  chose — il exécute la même fonction, celle de worker.js —, sans quota.
//  Le Worker garde tout le reste (comptes, sauvegardes, comptage, annonces).
//
//  Seules /api/proxy et /health sont servies. Le site s'en sert quand
//  `relayUrl` est configuré (api.js) et repasse par le Worker si ce serveur
//  ne répond pas.
//
//  Il tourne dans l'image Docker du site (même worker.js) :
//    node /app/relay.mjs        voir relay/docker-compose.yml et le README
//
//  Variables :
//    PORT             port d'écoute (8788)
//    PUBLIC_ORIGIN    adresse publique (https://relais.exemple.fr), utilisée
//                     dans les playlists réécrites
//    ALLOWED_ORIGINS  sites autorisés, séparés par des virgules ; « * » dans
//                     un nom en remplace une partie
//                     (https://test2-*-mxfia19s-projects.vercel.app).
//                     Vide = tous.
// ═══════════════════════════════════════════════════════════════════════════

import http from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
// worker.js, copié en .mjs dans l'image : Node le lit alors sans hésiter
// comme un module (export default).
import worker from './worker.mjs'

const PORT = Number(process.env.PORT) || 8788
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '')
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean)
  .map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]*')}$`, 'i'))

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
  'Access-Control-Max-Age': '86400',
}

/** Un autre site ne se sert pas du relais (ni de sa bande passante) : son
 *  origine est refusée. Sans en-tête Origin (lecteur natif de Safari, VLC),
 *  la requête passe. */
const originOk = (o) => !o || !ALLOWED.length || ALLOWED.some((re) => re.test(o))

// En-têtes de la réponse à ne pas recopier : ceux de la connexion, et la
// compression — fetch() a déjà décompressé le corps.
const SKIP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'upgrade'])

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', PUBLIC_ORIGIN || `http://${req.headers.host || `localhost:${PORT}`}`)
    if (url.pathname === '/health') {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      return res.end('ok')
    }
    if (url.pathname !== '/api/proxy') { res.writeHead(404, CORS); return res.end() }
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, CORS); return res.end() }
    // Sans en-tête CORS : le site voit un échec réseau et repasse par le Worker.
    if (!originOk(req.headers.origin)) { res.writeHead(403); return res.end('Origin not allowed') }

    const headers = new Headers()
    if (req.headers.range) headers.set('Range', req.headers.range)
    const r = await worker.fetch(new Request(url, { headers }), {}, { waitUntil() {}, passThroughOnException() {} })

    // Playlist réécrite ou corps décompressé : la longueur d'origine est fausse.
    const stale = r.headers.has('content-encoding') || /mpegurl/i.test(r.headers.get('content-type') || '')
    const out = {}
    r.headers.forEach((v, k) => {
      if (SKIP.has(k) || (k === 'content-length' && stale)) return
      out[k] = v
    })
    res.writeHead(r.status, out)
    if (!r.body || req.method === 'HEAD') return res.end()
    // Au fil de l'eau : un segment n'est jamais gardé en mémoire en entier.
    await pipeline(Readable.fromWeb(r.body), res)
  } catch {
    // Spectateur parti en cours de route, ou Twitch injoignable.
    if (!res.headersSent) { res.writeHead(502, CORS); res.end() } else res.destroy()
  }
})

server.keepAliveTimeout = 65_000
server.listen(PORT, () => {
  console.log(`Relais vidéo sur le port ${PORT}${PUBLIC_ORIGIN ? ` — ${PUBLIC_ORIGIN}` : ''}`
    + (ALLOWED.length ? ` — ${ALLOWED.length} origine(s) autorisée(s)` : ' — toutes origines'))
})

// Arrêt propre (docker stop) : on finit les réponses en cours.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
