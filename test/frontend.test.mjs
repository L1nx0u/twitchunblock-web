// Suite du site : formats, échappement, normalisation des données Twitch,
// réécriture des liens proxy, tri des qualités. Sans réseau ni DOM.
import './shims.mjs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  esc, formatClock, formatDuration, formatViewers, thumb,
} from '../public/assets/js/util.js'
import {
  cleanLogin, clipSlugFrom, fixProxiedUrl, streamFromHelix,
} from '../public/assets/js/api.js'
import { qualityLabel, sortQualities } from '../public/assets/js/player.js'

describe('esc', () => {
  it('échappe tout ce qui entre dans le DOM', () => {
    assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
    assert.equal(esc('a&b"c\'d'), 'a&amp;b&quot;c&#39;d')
    assert.equal(esc(null), '')
  })
})

describe('formats', () => {
  it('formatViewers compacte', () => {
    assert.equal(formatViewers(0), '0')
    assert.equal(formatViewers(999), '999')
    assert.equal(formatViewers(1000), '1k')
    assert.equal(formatViewers(1500), '1.5k')
    assert.equal(formatViewers(1_000_000), '1M')
    assert.equal(formatViewers(2_500_000), '2.5M')
  })
  it('formatClock en h:mm:ss', () => {
    assert.equal(formatClock(0), '0:00')
    assert.equal(formatClock(65), '1:05')
    assert.equal(formatClock(3725), '1:02:05')
    assert.equal(formatClock(-5), '0:00')
  })
  it('formatDuration en clair', () => {
    assert.equal(formatDuration(2700), '45 min')
    assert.equal(formatDuration(3720), '1 h 02')
  })
  it('thumb remplit les gabarits', () => {
    assert.equal(thumb('https://x/{width}x{height}', 440, 248), 'https://x/440x248')
    assert.equal(thumb('', 1, 1), '')
  })
})

describe('cleanLogin', () => {
  it('normalise les pseudos saisis', () => {
    assert.equal(cleanLogin(' Squeezie '), 'squeezie')
    assert.equal(cleanLogin('@squeezie'), 'squeezie')
    assert.equal(cleanLogin(''), null)
    assert.equal(cleanLogin('avec espace'), null)
    assert.equal(cleanLogin('avec-tiret'), null)
  })
})

describe('clipSlugFrom', () => {
  it('extrait le slug des deux formes de lien', () => {
    assert.equal(clipSlugFrom('https://clips.twitch.tv/SlugHere-abc_123'), 'SlugHere-abc_123')
    assert.equal(clipSlugFrom('https://www.twitch.tv/squeezie/clip/FunnyMoment-xyz'), 'FunnyMoment-xyz')
  })
  it('refuse le reste', () => {
    assert.equal(clipSlugFrom('https://twitch.tv/videos/123456'), null)
    assert.equal(clipSlugFrom('n’importe quoi'), null)
  })
})

describe('streamFromHelix', () => {
  it('met les lives Helix au format des cartes', () => {
    const out = streamFromHelix({
      user_login: 'squeezie', user_name: 'Squeezie', title: 'Live', game_name: 'Jeu',
      viewer_count: 42000, thumbnail_url: 'https://x/{width}x{height}', started_at: '2026-10-07T10:00:00Z',
    })
    assert.deepEqual(out, {
      login: 'squeezie', name: 'Squeezie', avatar: '', title: 'Live', game: 'Jeu',
      viewers: 42000, thumb: 'https://x/440x248', startedAt: '2026-10-07T10:00:00Z',
    })
  })
})

describe('fixProxiedUrl', () => {
  const WORKER = 'https://test2.kurzmathis4.workers.dev'
  it('renvoie les relatifs du Worker vers le proxy, à côté de la playlist', () => {
    const playlist = `${WORKER}/api/proxy?url=${encodeURIComponent('https://d1x/cloud/chunked/index.m3u8')}&isVod=true`
    assert.equal(
      fixProxiedUrl(`${WORKER}/api/init-0.mp4`, playlist),
      `${WORKER}/api/proxy?url=${encodeURIComponent('https://d1x/cloud/chunked/init-0.mp4')}&isVod=true`,
    )
  })
  it('fait passer les sous-playlists directes par le proxy', () => {
    const direct = 'https://ab.playlist.ttvnw.net/v1/playlist/live.m3u8'
    const playlist = `${WORKER}/api/proxy?url=${encodeURIComponent('https://as.luminous.dev/live/s')}&isVod=false`
    assert.equal(fixProxiedUrl(direct, playlist), `${WORKER}/api/proxy?url=${encodeURIComponent(direct)}&isVod=false`)
  })
  it('laisse le reste tranquille', () => {
    assert.equal(fixProxiedUrl('https://static.twitch.tv/x.png', `${WORKER}/api/proxy?url=https%3A%2F%2Fx`), 'https://static.twitch.tv/x.png')
    assert.equal(fixProxiedUrl('pas une url', `${WORKER}/x`), 'pas une url')
  })
})

describe('qualités', () => {
  it('sortQualities : Auto, puis par définition, audio en dernier', () => {
    // Tel quel : une 1080p60 (score 108060) passe devant « Source » (100000).
    // Le commentaire du lecteur dit l'inverse — à trancher (voir synthèse).
    assert.deepEqual(
      sortQualities(['720p30', 'audio_only', 'Source', 'Auto', '1080p60']),
      ['Auto', '1080p60', 'Source', '720p30', 'audio_only'],
    )
  })
  it('qualityLabel : étiquettes courtes', () => {
    assert.equal(qualityLabel('chunked'), 'Source')
    assert.equal(qualityLabel('audio_only'), 'Audio')
    assert.equal(qualityLabel('720p30'), '720p')
    assert.equal(qualityLabel('1080p60'), '1080p60')
  })
})
