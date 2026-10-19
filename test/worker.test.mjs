// Suite du Worker : validation des entrées, liste d'hôtes du proxy,
// réécriture des playlists, nettoyage des sauvegardes, limitation.
// Aucun appel réseau : que des fonctions pures.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOGIN_RE,
  VOD_ID_RE,
  CURSOR_RE,
  proxyAllowed,
  isPlaylistTarget,
  isSegmentHost,
  isProxyPath,
  parseAndProxyM3U8,
  cleanHistoryItem,
  rateLimited,
  jsonResponse,
  jsonError,
} from '../worker.js'
import worker from '../worker.js'

describe('validation des entrées', () => {
  it('LOGIN_RE accepte les pseudos Twitch', () => {
    assert.match('squeezie', LOGIN_RE)
    assert.match('x', LOGIN_RE)
    assert.match('a'.repeat(25), LOGIN_RE)
    assert.match('UPPER_123', LOGIN_RE)
  })
  it('LOGIN_RE refuse le reste', () => {
    assert.doesNotMatch('', LOGIN_RE)
    assert.doesNotMatch('a'.repeat(26), LOGIN_RE)
    assert.doesNotMatch('avec-espace x', LOGIN_RE)
    assert.doesNotMatch('quote"injection', LOGIN_RE)
    assert.doesNotMatch('a-b', LOGIN_RE)
  })
  it('VOD_ID_RE : que des chiffres, bornés', () => {
    assert.match('123456789', VOD_ID_RE)
    assert.doesNotMatch('', VOD_ID_RE)
    assert.doesNotMatch('12a34', VOD_ID_RE)
    assert.doesNotMatch('1'.repeat(21), VOD_ID_RE)
  })
  it('CURSOR_RE : curseurs opaques bornés', () => {
    assert.match('eyJhYmM9', CURSOR_RE)
    assert.doesNotMatch('', CURSOR_RE)
    assert.doesNotMatch('a'.repeat(501), CURSOR_RE)
    assert.doesNotMatch('espace dedans', CURSOR_RE)
  })
})

describe('proxyAllowed', () => {
  it('laisse passer Twitch et Luminous en HTTPS', () => {
    assert.equal(proxyAllowed('https://usher.ttvnw.net/vod/1.m3u8'), true)
    assert.equal(proxyAllowed('https://as.luminous.dev/live/squeezie?allow_source=true'), true)
    assert.equal(proxyAllowed('https://dqrpb9wgowsf5.cloudfront.net/abcd1234abcd1234abcd_squeezie_1/index-dvr.m3u8'), true)
  })
  it('refuse le HTTP, les inconnus et les chemins libres sur CloudFront', () => {
    assert.equal(proxyAllowed('http://usher.ttvnw.net/vod/1.m3u8'), false)
    assert.equal(proxyAllowed('https://evil.example.com/video.ts'), false)
    assert.equal(proxyAllowed('https://dqrpb9wgowsf5.cloudfront.net/n-importe-quoi.txt'), false)
    assert.equal(proxyAllowed('pas une url'), false)
  })
  // Régression : `twitch.tv` entier était accepté, gql.twitch.tv compris —
  // de quoi se servir du Worker comme relais gratuit vers l'API de Twitch.
  it('refuse le reste de twitch.tv, l’API GQL comprise', () => {
    assert.equal(proxyAllowed('https://gql.twitch.tv/gql'), false)
    assert.equal(proxyAllowed('https://www.twitch.tv/squeezie'), false)
  })
  it('accepte les serveurs de VOD de Twitch, dossiers à empreinte compris', () => {
    assert.equal(proxyAllowed('https://vod-secure.twitch.tv/abcd1234abcd1234abcd_chaine_1/chunked/index-dvr.m3u8'), true)
    assert.equal(proxyAllowed('https://vod-secure.twitch.tv/n-importe-quoi.txt'), false)
  })
})

describe('isSegmentHost', () => {
  it('reconnaît les adresses qui servent des segments (jamais plafonnées)', () => {
    assert.equal(isSegmentHost('https://d2nvs31859zcd8.cloudfront.net/abcd1234abcd1234abcd_s_1/chunked/12.ts'), true)
    assert.equal(isSegmentHost('https://vod-secure.twitch.tv/abcd1234abcd1234abcd_s_1/chunked/12.ts'), true)
    assert.equal(isSegmentHost('https://as.luminous.dev/live/squeezie'), false)
  })
})

describe('isProxyPath', () => {
  it('accepte /api/proxy et la variante des applis externes', () => {
    assert.equal(isProxyPath('/api/proxy'), true)
    assert.equal(isProxyPath('/api/proxy/squeezie.m3u8'), true)
    assert.equal(isProxyPath('/api/get-live'), false)
  })
})

describe('isPlaylistTarget', () => {
  it('repère les playlists avant récupération', () => {
    assert.equal(isPlaylistTarget('https://x/y.m3u8'), true)
    assert.equal(isPlaylistTarget('https://as.luminous.dev/live/s?allow_source=true'), true)
    assert.equal(isPlaylistTarget('https://ab.playlist.ttvnw.net/v1/playlist/x'), true)
  })
  it('laisse les segments tranquilles', () => {
    assert.equal(isPlaylistTarget('https://d2nvs31859zcd8.cloudfront.net/abcd1234abcd1234abcd_s_1/chunked/12.ts'), false)
  })
})

describe('parseAndProxyM3U8', () => {
  const master = 'https://usher.ttvnw.net/channel.m3u8'
  const content = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=8000000,VIDEO="chunked"',
    'https://usher.ttvnw.net/master1.m3u8',
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=3000000,VIDEO="720p60"',
    'https://usher.ttvnw.net/master2.m3u8',
    '',
  ].join('\n')
  it('trie Auto puis Source puis le reste, via le proxy', () => {
    const out = parseAndProxyM3U8(content, master, 'https://w.test', false, true)
    assert.deepEqual(Object.keys(out), ['Auto', 'Source', '720p60'])
    assert.equal(out.Auto, `https://w.test/api/proxy?url=${encodeURIComponent(master)}&isVod=false`)
    assert.equal(out.Source, `https://w.test/api/proxy?url=${encodeURIComponent('https://usher.ttvnw.net/master1.m3u8')}&isVod=false`)
  })
  it('sans proxy, renvoie les adresses brutes', () => {
    const out = parseAndProxyM3U8(content, master, 'https://w.test', false, false)
    assert.equal(out.Auto, master)
    assert.equal(out['720p60'], 'https://usher.ttvnw.net/master2.m3u8')
  })
})

describe('cleanHistoryItem', () => {
  it('garde les champs connus, en texte borné', () => {
    const out = cleanHistoryItem({ term: 'squeezie', type: 'vod', display: 'Stream', thumb: 'https://x/y.jpg', addedAt: 123 })
    assert.deepEqual(out, { term: 'squeezie', type: 'vod', display: 'Stream', thumb: 'https://x/y.jpg', addedAt: 123 })
  })
  it('refuse le reste', () => {
    assert.equal(cleanHistoryItem(null), null)
    assert.equal(cleanHistoryItem({ type: 'vod' }), null)
    assert.equal(cleanHistoryItem({ term: 'x', type: 'unknown' }), null)
    // vignette non-HTTPS écartée, élément gardé
    assert.deepEqual(
      cleanHistoryItem({ term: 'x', type: 'channel', thumb: 'http://x/y.jpg' }),
      { term: 'x', type: 'channel', display: 'x' },
    )
  })
})

describe('réponses JSON', () => {
  it('jsonResponse : 200, JSON, CORS', async () => {
    const r = jsonResponse({ ok: true })
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('Content-Type'), 'application/json')
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*')
    assert.deepEqual(await r.json(), { ok: true })
  })
  it('jsonError : statut et message', async () => {
    const r = jsonError('Raté', 400)
    assert.equal(r.status, 400)
    assert.deepEqual(await r.json(), { error: 'Raté' })
  })
})

describe('rateLimited', () => {
  const req = (ip) => new Request('https://w.test/api/get-m3u8?id=1', {
    headers: ip ? { 'CF-Connecting-IP': ip } : {},
  })
  it('laisse passer jusqu’au plafond, puis bloque', () => {
    const bucket = `test-${Date.now()}-a`
    assert.equal(rateLimited(bucket, req('10.0.0.1'), 2, 60_000), false)
    assert.equal(rateLimited(bucket, req('10.0.0.1'), 2, 60_000), false)
    assert.equal(rateLimited(bucket, req('10.0.0.1'), 2, 60_000), true)
  })
  it('compte par adresse, pas globalement', () => {
    const bucket = `test-${Date.now()}-b`
    assert.equal(rateLimited(bucket, req('10.0.0.2'), 1, 60_000), false)
    assert.equal(rateLimited(bucket, req('10.0.0.3'), 1, 60_000), false)
    assert.equal(rateLimited(bucket, req('10.0.0.2'), 1, 60_000), true)
  })
  it('sans adresse (dev local, Docker), jamais limité', () => {
    const bucket = `test-${Date.now()}-c`
    for (let i = 0; i < 5; i++) assert.equal(rateLimited(bucket, req(null), 1, 60_000), false)
  })
})

describe('réactions aux annonces', () => {
  // Fausse base D1 : seulement ce que store() lit, l'annonce en cours.
  // Régression : sans les constantes REACTIONS / REACTION_PREFIX, la route
  // levait un ReferenceError et répondait 500 à chaque réaction.
  const env = () => {
    const announcement = { id: 'ann1', title: 't', message: 'm', until: Date.now() + 3600_000 }
    const row = { value: JSON.stringify(announcement), meta: null, expires: announcement.until }
    const stmt = (sql) => ({
      bind: () => ({
        first: async () => (sql.includes('SELECT value, meta') ? row : undefined),
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      }),
    })
    return { DB: { prepare: stmt, batch: async () => [] } }
  }
  const react = (body) => worker.fetch(new Request('https://w.test/api/announcement/react', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' },
    body: JSON.stringify(body),
  }), env(), {})

  it('enregistre une réaction sur l’annonce en cours', async () => {
    const res = await react({ announcementId: 'ann1', id: '123e4567-e89b-42d3-a456-426614174000', emoji: '👍' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true, emoji: '👍' })
  })
  it('refuse un emoji hors de la liste', async () => {
    const res = await react({ announcementId: 'ann1', id: '123e4567-e89b-42d3-a456-426614174000', emoji: '💀' })
    assert.equal(res.status, 400)
  })
})
