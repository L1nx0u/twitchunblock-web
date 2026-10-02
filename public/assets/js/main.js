// ═══════════════════════════════════════════════════════════════════════════
//  Point d'entrée : navigation, accueil, page streamer, lecteur, réglages.
// ═══════════════════════════════════════════════════════════════════════════

import * as api from './api.js'
import { store } from './store.js'
import { LANGS, applyStatic, deviceLang, initLang, setLang, t, lang } from './i18n.js'
import { Player, loadHls, qualityLabel } from './player.js'
import { ChatView } from './chat/view.js'
import * as usage from './usage.js'
import {
  $, $$, debounce, esc, formatClock, formatDuration, formatViewers, icon, isIOS, isMobile,
  thumb, toast, uptimeSince,
} from './util.js'

// ── État ───────────────────────────────────────────────────────────────────
const session = {
  token: null, userId: null, login: null, avatar: null, scopes: [],
  get canChat() { return Boolean(this.token && this.login && this.scopes.includes('chat:edit') && this.scopes.includes('chat:read')) },
  get needRescope() { return Boolean(this.token && !this.canChat) },
}

const state = {
  tab: 'discover',
  topLang: 'fr',
  loaded: { followed: 0, top: 0 },
  channel: null,          // { login, info, videos }
  watch: null,            // { kind, login?, id?, info, links }
  vodMeta: new Map(),     // id → { title, thumb, streamer }
}

let player = null
let chat = null
let infoTimer = null
let uptimeTimer = null
let channelTimer = null
let lastSave = 0

// ── Démarrage ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot)

async function boot() {
  initLang(store.prefs.lang)
  loadHls()   // prêt avant le premier clic
  applyStatic()
  renderIcons()
  bindGlobal()
  setupPlayer()
  renderContinue()
  renderRecentChannels()
  startLiveTicker()
  usage.ping(store.prefs.shareUsage)
  setInterval(() => usage.ping(store.prefs.shareUsage), 15 * 60 * 1000)

  // Jeton déjà là (session précédente, ou retour de connexion sans popup).
  if (store.token) await adoptToken(store.token, { silent: true })
  else renderAccount()

  const params = new URLSearchParams(location.search)
  const vod = params.get('id') ?? params.get('vod')
  const channel = api.cleanLogin(params.get('channel'))
  if (vod && /^\d{6,}$/.test(vod)) openVod(vod)
  else if (channel) { setTab('channel'); searchChannel(channel); openLive(channel) }
  setTab(state.tab)
}

/** Remplit les emplacements d'icônes déclarés dans le HTML. */
function renderIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, Number(el.dataset.size) || 20))
    el.removeAttribute('data-icon')
  }
}

// ── Session Twitch ─────────────────────────────────────────────────────────
async function adoptToken(token, { silent = false } = {}) {
  const v = await api.validateToken(token)
  if (!v) {
    store.token = null
    Object.assign(session, { token: null, userId: null, login: null, avatar: null, scopes: [] })
    if (!silent) toast(t('session_expired'), 'error')
    else toast(t('session_expired'))
    renderAccount()
    return
  }
  store.token = token
  session.token = token
  if (!v.offline) Object.assign(session, { userId: v.userId, login: v.login, scopes: v.scopes })
  renderAccount()

  if (session.login) {
    api.getAvatars([session.login]).then((a) => { session.avatar = a[session.login] ?? null; renderAccount() })
  }
  if (session.userId) await pullSync()
  state.loaded.followed = 0
  if (state.tab === 'discover') loadFollowed()
  chat?.sessionChanged()
}

function login() {
  const url = api.loginUrl()
  const w = 500
  const h = 720
  const left = (screen.width - w) / 2
  const top = (screen.height - h) / 2
  const popup = isMobile ? null : window.open(url, 'TwitchLogin', `width=${w},height=${h},left=${left},top=${top}`)
  // Mobile, ou popup bloquée : redirection pleine page. Le script de tête
  // récupère le jeton au retour.
  if (!popup) location.href = url
}

function logout() {
  store.token = null
  Object.assign(session, { token: null, userId: null, login: null, avatar: null, scopes: [] })
  renderAccount()
  state.loaded.followed = 0
  loadFollowed()
  chat?.sessionChanged()
  closeSheet()
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return
  const raw = typeof e.data === 'string' ? e.data : ''
  if (!raw.includes('access_token=')) return
  const token = new URLSearchParams(raw.replace(/^#/, '')).get('access_token')
  if (token) adoptToken(token)
})

function renderAccount() {
  const btn = $('#account-btn')
  if (session.login) {
    btn.innerHTML = session.avatar
      ? `<img src="${esc(session.avatar)}" alt="">`
      : `<span class="initial">${esc(session.login[0].toUpperCase())}</span>`
    btn.title = t('connected_as', { u: session.login })
    btn.classList.add('logged')
  } else {
    btn.innerHTML = `${icon('twitch', 18)}<span>${esc(t('login'))}</span>`
    btn.title = t('login')
    btn.classList.remove('logged')
  }
  renderSettingsAccount()
}

// ── Sauvegarde distante ────────────────────────────────────────────────────
async function pullSync() {
  const data = await api.syncPull(session.userId)
  if (!data) return
  if (Array.isArray(data.history) && data.history.length) {
    // Fusion plutôt que remplacement : ce qui a été vu ici depuis la dernière
    // sauvegarde ne doit pas disparaître.
    const seen = new Set(store.history.map((h) => String(h.term).toLowerCase()))
    store.history = [...store.history, ...data.history.filter((h) => !seen.has(String(h.term).toLowerCase()))].slice(0, 30)
    store.saveHistory()
  }
  for (const [id, time] of Object.entries(data.progress ?? {})) {
    if (time > store.getProgress(id)) store.setProgress(id, time)
  }
  renderContinue()
  renderRecentChannels()
}

// Envoi économe. Avant, chaque sauvegarde de progression (toutes les 5 s de
// lecture) partait au serveur : ~700 écritures par heure de VOD et par
// personne, pour un KV gratuit plafonné à 1 000 écritures par jour au total.
// Désormais un changement ne fait que marquer la sauvegarde « à envoyer » ;
// l'envoi a lieu à la fermeture du lecteur, quand la page passe en arrière-
// plan, ou au plus toutes les 10 minutes — et jamais si rien n'a changé.
const SYNC_EVERY = 10 * 60_000
let syncDirty = false
let lastSyncBody = ''
let lastSyncAt = 0

/** Un changement à sauvegarder. Aucun envoi immédiat. */
function pushSync() { syncDirty = true }

function flushSync({ force = false } = {}) {
  if (!syncDirty || !session.userId) return
  if (!force && Date.now() - lastSyncAt < SYNC_EVERY) return
  // Seule la progression des VODs de l'historique part : le Worker garde
  // déjà les autres (il fusionne), inutile d'alourdir chaque envoi.
  const vods = new Set(store.history.filter((h) => h.type === 'vod').map((h) => String(h.term)))
  const progress = Object.fromEntries(Object.entries(store.allProgress())
    .filter(([id]) => vods.has(id)).map(([id, t]) => [id, Math.round(t)]))
  const data = { history: store.history, progress }
  const body = JSON.stringify(data)
  syncDirty = false
  if (body === lastSyncBody) return
  lastSyncBody = body
  lastSyncAt = Date.now()
  api.syncPush(session.userId, data)
}

setInterval(() => flushSync(), 60_000)
// Fermeture d'onglet, changement d'appli sur mobile : dernier envoi.
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSync({ force: true }) })
window.addEventListener('pagehide', () => flushSync({ force: true }))

// ── Navigation ─────────────────────────────────────────────────────────────
function setTab(tab) {
  state.tab = tab
  for (const b of $$('[data-tab]')) b.classList.toggle('active', b.dataset.tab === tab)
  for (const v of $$('.view')) v.hidden = v.id !== `view-${tab}`
  if (tab === 'discover') {
    const stale = (k) => Date.now() - state.loaded[k] > 90_000
    if (stale('followed')) loadFollowed()
    if (stale('top')) loadTop(state.topLang)
    renderContinue()
  }
  if (tab === 'channel') renderRecentChannels()
  window.scrollTo({ top: 0 })
}

function bindGlobal() {
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]')
    if (tab) return setTab(tab.dataset.tab)

    const del = e.target.closest('[data-del]')
    if (del) {
      e.stopPropagation()
      store.removeHistory(del.dataset.del)
      pushSync()
      renderContinue()
      renderRecentChannels()
      return
    }
    const live = e.target.closest('[data-live]')
    if (live) return openLive(live.dataset.live)
    const vod = e.target.closest('[data-vod]')
    if (vod) return openVod(vod.dataset.vod)
    const chan = e.target.closest('[data-channel]')
    if (chan) {
      setTab('channel')
      $('#channel-input').value = chan.dataset.channel
      return searchChannel(chan.dataset.channel)
    }
    const act = e.target.closest('[data-action]')?.dataset.action
    if (act) actions[act]?.(e)
  })

  // Accueil
  $('#top-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]')
    if (b) loadTop(b.dataset.lang)
  })

  // Streamer
  $('#channel-form').addEventListener('submit', (e) => {
    e.preventDefault()
    hideSuggest()
    searchChannel($('#channel-input').value)
  })
  const debouncedSuggest = debounce(suggestChannels, 250)
  $('#channel-input').addEventListener('input', () => debouncedSuggest(++suggestSeq))
  $('#channel-input').addEventListener('keydown', onSuggestKey)
  $('#channel-input').addEventListener('blur', () => setTimeout(hideSuggest, 150))
  $('#channel-suggest').addEventListener('mousedown', (e) => {
    const b = e.target.closest('[data-pick]')
    if (!b) return
    e.preventDefault()
    pickSuggestion(b.dataset.pick)
  })

  // Lien / ID
  $('#link-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const raw = $('#link-input').value
    const id = (raw.match(/videos\/(\d+)/) ?? raw.match(/\b(\d{6,})\b/) ?? [])[1]
    if (!id) return toast(t('invalid_id'), 'error')
    openVod(id)
  })

  // Feuilles (réglages, ouvrir dans…)
  $('#sheet-backdrop').addEventListener('click', closeSheet)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#sheet-backdrop').hidden) closeSheet()
  })
}

const actions = {
  login: () => (session.login ? openSettings() : login()),
  logout,
  settings: () => openSettings(),
  'refresh-discover': () => { loadFollowed(); loadTop(state.topLang) },
  'clear-channels': () => { store.clearHistory('channel'); pushSync(); renderRecentChannels() },
  'watch-minimize': () => minimizeWatch(),
  'watch-expand': () => expandWatch(),
  'watch-close': () => closeWatch(),
  'watch-toggle-play': () => player.togglePlay(),
  'open-in': () => openInSheet(),
  'see-vods': () => {
    const login = state.watch?.login ?? state.watch?.info?.owner?.login
    if (!login) return
    minimizeWatch()
    setTab('channel')
    $('#channel-input').value = login
    searchChannel(login)
  },
  'watch-retry': () => {
    const w = state.watch
    if (!w) return
    if (w.kind === 'live') openLive(w.login)
    else openVod(w.id)
  },
}

// ── Cartes ─────────────────────────────────────────────────────────────────
function streamCard(s) {
  return `
    <article class="card stream-card" data-live="${esc(s.login)}" tabindex="0">
      <div class="thumb">
        <img src="${esc(thumb(s.thumb, 440, 248))}" alt="" loading="lazy" decoding="async">
        <span class="pill live">${esc(t('live_now'))}</span>
        <span class="pill viewers">${icon('eye', 12)}${esc(formatViewers(s.viewers))}</span>
        ${s.startedAt ? `<span class="pill uptime" data-started="${esc(s.startedAt)}">${esc(uptimeSince(s.startedAt))}</span>` : ''}
      </div>
      <div class="card-body">
        ${s.avatar ? `<img class="avatar sm" src="${esc(s.avatar)}" alt="" loading="lazy">` : `<span class="avatar sm placeholder">${esc((s.name || '?')[0])}</span>`}
        <div class="card-text">
          <h3 title="${esc(s.title)}">${esc(s.title)}</h3>
          <p class="name">${esc(s.name)}</p>
          ${s.game ? `<p class="meta">${esc(s.game)}</p>` : ''}
        </div>
      </div>
    </article>`
}

function vodCard(v, streamer) {
  state.vodMeta.set(String(v.id), { title: v.title, thumb: v.previewThumbnailURL, streamer, length: v.lengthSeconds })
  const progress = store.getProgress(v.id)
  const ratio = v.lengthSeconds ? Math.min(1, progress / v.lengthSeconds) : 0
  const date = new Date(v.publishedAt ?? v.createdAt)
  const dateStr = Number.isFinite(date.getTime())
    ? date.toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: 'numeric' })
    : ''
  return `
    <article class="card vod-card" data-vod="${esc(v.id)}" tabindex="0">
      <div class="thumb">
        <img src="${esc(thumb(v.previewThumbnailURL, 320, 180))}" alt="" loading="lazy" decoding="async"
             onerror="this.src='https://vod-secure.twitch.tv/_404/404_processing_320x180.png'">
        <span class="pill duration">${esc(formatDuration(v.lengthSeconds))}</span>
        ${ratio > 0.01 ? `<span class="progress"><span style="width:${(ratio * 100).toFixed(1)}%"></span></span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-text">
          <h3 title="${esc(v.title)}">${esc(v.title)}</h3>
          <p class="meta">${esc(dateStr)}</p>
        </div>
      </div>
    </article>`
}

function skeleton(n, kind = 'stream') {
  return Array.from({ length: n }, () => `<div class="card skeleton ${kind}"><div class="thumb"></div><div class="card-body"><span></span><span></span></div></div>`).join('')
}

function emptyState(text, iconName = 'radio') {
  return `<div class="empty">${icon(iconName, 28)}<p>${esc(text)}</p></div>`
}

// ── Accueil ────────────────────────────────────────────────────────────────
function renderContinue() {
  const vods = store.history.filter((h) => h.type === 'vod').slice(0, 12)
  const block = $('#continue-block')
  block.hidden = vods.length === 0
  if (!vods.length) return
  $('#continue-rail').innerHTML = vods.map((h) => {
    state.vodMeta.set(String(h.term), { title: h.display, thumb: h.thumb, streamer: h.streamer })
    const p = store.getProgress(h.term)
    const len = store.getLength(h.term)
    const ratio = len ? Math.min(1, p / len) : 0
    return `
      <article class="card rail-card" data-vod="${esc(h.term)}" tabindex="0">
        <div class="thumb">
          <img src="${esc(h.thumb || 'https://vod-secure.twitch.tv/_404/404_processing_320x180.png')}" alt="" loading="lazy">
          ${p > 5 ? `<span class="pill duration">${esc(formatClock(p))}</span>` : ''}
          ${ratio > 0.01 ? `<span class="progress"><span style="width:${(ratio * 100).toFixed(1)}%"></span></span>` : ''}
          <button class="del" type="button" data-del="${esc(h.term)}" aria-label="${esc(t('close'))}">${icon('x', 14)}</button>
        </div>
        <div class="card-body"><div class="card-text">
          <h3 title="${esc(h.display)}">${esc(h.display)}</h3>
          <p class="name">${esc(h.streamer || 'VOD')}</p>
        </div></div>
      </article>`
  }).join('')
}

async function loadFollowed({ silent = false } = {}) {
  const grid = $('#followed-grid')
  const head = $('#followed-block')
  state.loaded.followed = Date.now()
  if (!session.token) {
    head.classList.add('logged-out')
    grid.innerHTML = `
      <div class="login-card">
        <div class="login-card-icon">${icon('heart', 26)}</div>
        <p>${esc(t('login_prompt'))}</p>
        <button class="btn primary" type="button" data-action="login">${icon('twitch', 18)}<span>${esc(t('login'))}</span></button>
      </div>`
    return
  }
  head.classList.remove('logged-out')
  if (!session.userId) return
  if (!silent) grid.innerHTML = skeleton(4)
  try {
    const streams = await api.getFollowedStreams(session.userId)
    grid.innerHTML = streams.length ? streams.map(streamCard).join('') : emptyState(t('no_live_followed'), 'heart')
  } catch (err) {
    if (err.status === 401) { await adoptToken(session.token); return }
    // En rafraîchissement silencieux, une panne passagère garde l'existant.
    if (!silent) grid.innerHTML = emptyState(t('err_loading'), 'refresh')
  }
}

async function loadTop(language, { silent = false } = {}) {
  state.topLang = language
  state.loaded.top = Date.now()
  for (const b of $$('#top-seg [data-lang]')) b.classList.toggle('active', b.dataset.lang === language)
  const grid = $('#top-grid')
  if (!silent) grid.innerHTML = skeleton(8)
  try {
    const streams = await api.getTopStreams(language === 'all' ? null : language)
    if (state.topLang !== language) return
    grid.innerHTML = streams.length ? streams.map(streamCard).join('') : emptyState(t('no_live'))
  } catch {
    if (!silent) grid.innerHTML = emptyState(t('err_loading'), 'refresh')
  }
}

/**
 * Accueil vivant : les durées de live avancent chaque seconde, et les
 * listes (spectateurs, nouveaux lives) sont relues chaque minute sans
 * squelette, tant que l'onglet est affiché et la page visible.
 */
function startLiveTicker() {
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-started]')) {
      el.textContent = uptimeSince(el.dataset.started)
    }
    if (state.tab !== 'discover' || document.hidden || !$('#watch').hidden && !$('#watch').classList.contains('minimized')) return
    const now = Date.now()
    if (now - state.loaded.top > 60_000) loadTop(state.topLang, { silent: true })
    if (session.userId && now - state.loaded.followed > 60_000) loadFollowed({ silent: true })
  }, 1000)
}

function creditsHtml() {
  const items = [
    ['Twitch', 'https://www.twitch.tv'],
    ['hls.js', 'https://github.com/video-dev/hls.js'],
    ['BetterTTV', 'https://betterttv.com'],
    ['FrankerFaceZ', 'https://www.frankerfacez.com'],
    ['7TV', 'https://7tv.app'],
    ['recent-messages', 'https://recent-messages.robotty.de'],
    ['Lucide', 'https://lucide.dev'],
    ['Inter', 'https://rsms.me/inter/'],
  ]
  return `
    <p class="credits-title">${esc(t('credits'))}</p>
    <p class="muted small credits">${esc(t('made_by'))} <a href="https://github.com/MXFia19" target="_blank" rel="noopener">MXFia19</a>.
      ${esc(t('thanks'))} ${items.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join(', ')}.
      ${esc(t('not_affiliated'))}</p>`
}

// ── Page streamer ──────────────────────────────────────────────────────────
function renderRecentChannels() {
  const chans = store.history.filter((h) => h.type === 'channel').slice(0, 10)
  const box = $('#recent-channels')
  box.hidden = chans.length === 0
  $('#recent-list').innerHTML = chans.map((h) => `
    <span class="chip" data-channel="${esc(h.term)}" tabindex="0">
      ${h.avatar ? `<img src="${esc(h.avatar)}" alt="">` : icon('user', 14)}
      <span>${esc(h.display)}</span>
      <button type="button" data-del="${esc(h.term)}" aria-label="${esc(t('close'))}">${icon('x', 12)}</button>
    </span>`).join('')
}

let suggestions = []
let suggestIndex = -1
/** Numéro de la frappe en cours. Valider ou choisir l'incrémente : une
 *  suggestion différée arrivée après coup ne rouvre plus la liste par-dessus
 *  les résultats. */
let suggestSeq = 0

async function suggestChannels(seq) {
  if (seq !== suggestSeq) return
  const raw = $('#channel-input').value
  const word = raw.trim().split(/\s+/)[0] ?? ''
  if (!word || raw.trim().includes(' ') || word.length < 2) return hideSuggest()
  const local = store.history
    .filter((h) => h.type === 'channel' && h.term.toLowerCase().includes(word.toLowerCase()))
    .map((h) => ({ login: h.term, displayName: h.display, profileImageURL: h.avatar, stream: null }))
  let remote = []
  try { remote = await api.searchChannels(word) } catch {}
  if (seq !== suggestSeq) return
  const seen = new Set()
  suggestions = [...local, ...remote].filter((s) => s?.login && !seen.has(s.login) && seen.add(s.login)).slice(0, 7)
  suggestIndex = -1
  renderSuggest()
}

function renderSuggest() {
  const box = $('#channel-suggest')
  if (!suggestions.length) return hideSuggest()
  box.innerHTML = suggestions.map((s, i) => `
    <button type="button" class="suggest-row${i === suggestIndex ? ' active' : ''}" data-pick="${esc(s.login)}">
      ${s.profileImageURL ? `<img class="avatar xs" src="${esc(s.profileImageURL)}" alt="">` : `<span class="avatar xs placeholder">${icon('user', 14)}</span>`}
      <span class="suggest-name">${esc(s.displayName || s.login)}</span>
      ${s.stream ? `<span class="pill live sm">${esc(formatViewers(s.stream.viewersCount))}</span>` : ''}
    </button>`).join('')
  box.hidden = false
}

function hideSuggest() { suggestSeq++; $('#channel-suggest').hidden = true; suggestions = [] }

function onSuggestKey(e) {
  if ($('#channel-suggest').hidden || !suggestions.length) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const n = suggestions.length
    suggestIndex = (suggestIndex + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n
    renderSuggest()
  } else if (e.key === 'Enter' && suggestIndex >= 0) {
    e.preventDefault()
    pickSuggestion(suggestions[suggestIndex].login)
  } else if (e.key === 'Escape') hideSuggest()
}

function pickSuggestion(login) {
  $('#channel-input').value = login
  hideSuggest()
  searchChannel(login)
}

async function searchChannel(raw) {
  const parts = String(raw || '').trim().split(/\s+/)
  const login = api.cleanLogin(parts[0])
  const keyword = parts.slice(1).join(' ').toLowerCase()
  const out = $('#channel-result')
  if (!login) { out.innerHTML = ''; return }

  out.innerHTML = `<div class="channel-hero skeleton"></div><div class="grid vods">${skeleton(8, 'vod')}</div>`
  const [info, videos] = await Promise.all([
    api.getChannelInfo(login).catch(() => null),
    api.getChannelVideos(login).catch(() => null),
  ])
  if (!info && (!videos || videos.error)) {
    out.innerHTML = emptyState(t('not_found'), 'search')
    return
  }
  state.channel = { login, info, videos: videos?.videos ?? [] }
  store.addHistory(login, 'channel', info?.displayName || login, { avatar: info?.profileImageURL || videos?.avatar || '' })
  pushSync()
  renderRecentChannels()
  renderChannel(keyword)
}

function renderChannel(keyword = '') {
  const { login, info, videos } = state.channel
  watchChannelLive()
  const name = info?.displayName || login
  const avatar = info?.profileImageURL || ''
  const live = info?.stream
  let status = ''
  if (live) {
    status = `
      <div class="hero-live">
        <div class="hero-badges">
          <span class="pill live">${esc(t('live_now'))}</span>
          <span class="muted">${icon('eye', 14)} <span id="channel-viewers">${esc(formatViewers(live.viewersCount))}</span></span>
          <span class="muted">${icon('clock', 14)} <span id="channel-uptime">${esc(uptimeSince(live.createdAt))}</span></span>
        </div>
        <p class="hero-title">${esc(live.title)}</p>
        ${live.game ? `<p class="hero-game">${icon('gamepad', 14)} ${esc(live.game.displayName)}</p>` : ''}
        <button class="btn primary" type="button" data-live="${esc(login)}">${icon('play', 16)}<span>${esc(t('watch_live'))}</span></button>
      </div>
      <img class="hero-thumb" src="${esc(live.previewImageURL)}" alt="" data-live="${esc(login)}">`
  } else {
    const last = videos[0]
    const since = last ? offlineFor(last.publishedAt, last.lengthSeconds) : ''
    status = `
      <div class="hero-live">
        <div class="hero-badges"><span class="pill off">${esc(t('offline'))}</span>
        ${since ? `<span class="muted">${esc(t('offline_since', { t: since }))}</span>` : ''}</div>
        ${info?.broadcastSettings?.title ? `<p class="hero-title muted">${esc(info.broadcastSettings.title)}</p>` : ''}
      </div>`
  }

  const filtered = keyword ? videos.filter((v) => {
    const d = new Date(v.publishedAt).toLocaleDateString(lang())
    return v.title.toLowerCase().includes(keyword) || d.includes(keyword)
  }) : videos

  $('#channel-result').innerHTML = `
    <section class="channel-hero${live ? ' is-live' : ''}">
      <div class="hero-id">
        ${avatar ? `<img class="avatar lg${live ? ' ring' : ''}" src="${esc(avatar)}" alt="">` : ''}
        <div><h2>${esc(name)}</h2><p class="muted">@${esc(login)}</p></div>
      </div>
      ${status}
    </section>
    <section class="block">
      <div class="block-head">
        <h2>${icon('film', 18)}<span>${esc(t('vods'))}</span></h2>
        <label class="filter">${icon('search', 16)}<input id="vod-filter" type="search" value="${esc(keyword)}" placeholder="${esc(t('search'))}…"></label>
      </div>
      ${keyword ? `<p class="muted filter-count">${esc(filtered.length ? t('filter_count', { n: filtered.length, k: keyword }) : t('filter_none', { k: keyword }))}</p>` : ''}
      <div class="grid vods">${filtered.length ? filtered.map((v) => vodCard(v, name)).join('') : (keyword ? '' : emptyState(t('no_vod'), 'film'))}</div>
    </section>`

  const filter = $('#vod-filter')
  filter.addEventListener('input', debounce(() => {
    const pos = filter.selectionStart
    renderChannel(filter.value.trim().toLowerCase())
    const again = $('#vod-filter')
    again.focus()
    again.setSelectionRange(pos, pos)
  }, 200))
}

/**
 * Page streamer : le temps de live avance chaque seconde et les spectateurs
 * sont relus chaque minute. Rendue une seule fois, la page restait figée.
 */
function watchChannelLive() {
  clearInterval(channelTimer)
  const ch = state.channel
  if (!ch?.info?.stream) return
  let ticks = 0
  channelTimer = setInterval(async () => {
    if (state.channel !== ch) return clearInterval(channelTimer)
    const s = ch.info?.stream
    const el = $('#channel-uptime')
    if (el && s?.createdAt) el.textContent = uptimeSince(s.createdAt)
    if (++ticks % 60 || state.tab !== 'channel') return
    const fresh = await api.getChannelInfo(ch.login).catch(() => null)
    if (!fresh || state.channel !== ch) return
    const wasLive = Boolean(ch.info?.stream)
    ch.info = fresh
    const v = $('#channel-viewers')
    if (wasLive !== Boolean(fresh.stream)) renderChannel($('#vod-filter')?.value?.trim().toLowerCase() ?? '')
    else if (v && fresh.stream) v.textContent = formatViewers(fresh.stream.viewersCount)
  }, 1000)
}

function offlineFor(publishedAt, lengthSeconds) {
  const end = Date.parse(publishedAt) + (lengthSeconds || 0) * 1000
  const diff = Date.now() - end
  if (!Number.isFinite(diff) || diff < 0) return ''
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor(diff / 60_000)
  return d > 0 ? `${d} j` : h > 0 ? `${h} h` : `${m} min`
}

// ── Lecteur ────────────────────────────────────────────────────────────────
function setupPlayer() {
  const watch = $('#watch')
  player = new Player($('#player'), {
    fullscreenTarget: $('#watch-body'),
    prefs: store.prefs,
    savePrefs: () => store.savePrefs(),
    onToggleChat: () => toggleChat(),
    isChatOpen: () => store.prefs.chatOpen,
    onTime: (cur, duration) => onPlaybackTime(cur, duration),
    // Une pause est un bon moment pour sauvegarder — sans dépasser un envoi
    // par minute si l'on enchaîne pause et lecture.
    onPause: () => { if (Date.now() - lastSyncAt > 60_000) flushSync({ force: true }) },
    onError: () => showWatchError(state.watch?.kind === 'live' ? t('err_live') : t('err_vod')),
  })
  chat = new ChatView($('#chat'), {
    prefs: store.prefs,
    session: () => session,
    onLogin: () => login(),
    onHide: () => toggleChat(false),
  })
  applyChatOpen()
  applyStatic(watch)
  // Clic sur la vidéo réduite : on rouvre.
  $('#player').addEventListener('click', (e) => {
    if (watch.classList.contains('minimized')) { e.stopPropagation(); expandWatch() }
  }, true)
}

function toggleChat(force) {
  store.prefs.chatOpen = typeof force === 'boolean' ? force : !store.prefs.chatOpen
  store.savePrefs()
  applyChatOpen()
}

function applyChatOpen() {
  $('#watch').classList.toggle('chat-hidden', !store.prefs.chatOpen)
  player.setChatOpen(store.prefs.chatOpen)
}

function showWatch(kind, title) {
  const watch = $('#watch')
  watch.hidden = false
  watch.classList.remove('minimized', 'error')
  watch.dataset.kind = kind
  document.documentElement.classList.add('watching')
  $('#watch-loading').hidden = false
  $('#watch-title').textContent = title || ''
  $('#watch-sub').innerHTML = ''
  $('#watch-avatar').hidden = true
  $('#mini-title').textContent = title || ''
  $('#watch-info').innerHTML = ''
  requestAnimationFrame(() => watch.classList.add('open'))
}

function showWatchError(message) {
  $('#watch').classList.add('error')
  $('#watch-loading').hidden = true
  $('#watch-error-text').textContent = message
}

async function openLive(rawLogin) {
  const login = api.cleanLogin(rawLogin)
  if (!login) return
  stopPlayback()
  state.watch = { kind: 'live', login, info: null, links: null }
  const token = state.watch
  showWatch('live', login)
  setUrl({ channel: login })

  const [links, info] = await Promise.all([
    api.getLive(login).catch(() => ({ error: 'network' })),
    api.getChannelInfo(login).catch(() => null),
  ])
  if (state.watch !== token) return
  if (!links || links.error || !links.links || !Object.keys(links.links).length) {
    return showWatchError(links?.error === 'network' ? t('err_network') : t('err_live'))
  }
  token.links = links.links
  token.info = info
  $('#watch-loading').hidden = true
  player.load({ links: links.links, kind: 'live' })
  chat.openLive({ channel: login, channelId: info?.id ?? null })
  renderLiveInfo(info, links)

  store.addHistory(login, 'channel', info?.displayName || login, { avatar: info?.profileImageURL || links.avatar || '' })
  pushSync()
  renderRecentChannels()

  // Spectateurs et titre : rafraîchis toutes les 30 s. Le temps de live,
  // lui, est recalculé chaque seconde à partir de l'heure de début — il
  // restait figé sur sa valeur d'ouverture.
  clearInterval(infoTimer)
  infoTimer = setInterval(async () => {
    if (state.watch !== token) return clearInterval(infoTimer)
    const fresh = await api.getChannelInfo(login).catch(() => null)
    if (fresh && state.watch === token) { token.info = fresh; renderLiveInfo(fresh, links) }
  }, 30_000)
  clearInterval(uptimeTimer)
  uptimeTimer = setInterval(() => {
    if (state.watch !== token) return clearInterval(uptimeTimer)
    const el = $('#watch-uptime')
    if (el && token.startedAt) el.textContent = uptimeSince(token.startedAt)
  }, 1000)
}

function renderLiveInfo(info, links) {
  const name = info?.displayName || state.watch?.login
  const avatar = info?.profileImageURL || links?.avatar
  const s = info?.stream
  const title = s?.title || links?.title || ''
  const game = s?.game?.displayName || links?.game || ''
  if (state.watch && s?.createdAt) state.watch.startedAt = s.createdAt
  $('#watch-title').textContent = name
  $('#mini-title').textContent = `${name}${title ? ` · ${title}` : ''}`
  setAvatar(avatar)
  $('#watch-sub').innerHTML = `
    <span class="pill live sm">${esc(t('live_now'))}</span>
    ${s ? `<span>${icon('eye', 13)} ${esc(formatViewers(s.viewersCount))}</span><span>${icon('clock', 13)} <span id="watch-uptime">${esc(uptimeSince(s.createdAt))}</span></span>` : ''}`
  $('#watch-info').innerHTML = `
    <div class="wi-text">
      <h1 title="${esc(title)}">${esc(title)}</h1>
      ${game ? `<p class="hero-game">${icon('gamepad', 14)} ${esc(game)}</p>` : ''}
    </div>
    <div class="wi-actions">
      <button class="btn ghost sm" type="button" data-action="see-vods">${icon('film', 16)}<span>${esc(t('see_vods'))}</span></button>
      <button class="btn ghost sm" type="button" data-action="open-in">${icon('external', 16)}<span>${esc(t('open_in'))}</span></button>
    </div>`
}

async function openVod(id, preset) {
  const vodId = String(id)
  stopPlayback()
  const known = preset ?? state.vodMeta.get(vodId) ?? {}
  state.watch = { kind: 'vod', id: vodId, info: null, links: null }
  const token = state.watch
  showWatch('vod', known.title || `VOD ${vodId}`)
  setUrl({ id: vodId })

  const [links, meta] = await Promise.all([
    api.getVodLinks(vodId).catch(() => ({ error: 'network' })),
    api.getVodMeta(vodId).catch(() => null),
  ])
  if (state.watch !== token) return
  if (!links || links.error || !links.links || !Object.keys(links.links).length) {
    return showWatchError(links?.error === 'network' ? t('err_network') : t('err_vod'))
  }
  token.links = links.links
  token.info = meta
  token.login = meta?.owner?.login ?? null

  const length = meta?.lengthSeconds ?? known.length ?? 0
  if (length) store.setLength(vodId, length)
  let startAt = store.getProgress(vodId)
  // Une VOD finie (ou presque) repart du début plutôt que de se terminer aussitôt.
  if (length && startAt > length - 30) startAt = 0
  if (startAt < 10) startAt = 0

  $('#watch-loading').hidden = true
  player.load({ links: links.links, kind: 'vod', startAt })
  chat.openVod({ videoId: vodId, channelId: meta?.owner?.id ?? null, channelLogin: meta?.owner?.login ?? null, startAt })
  if (startAt) toast(t('resume_at', { t: formatClock(startAt) }))

  const title = meta?.title || known.title || `VOD ${vodId}`
  const streamer = meta?.owner?.displayName || known.streamer || ''
  const thumbUrl = meta?.previewThumbnailURL || known.thumb || ''
  store.addHistory(vodId, 'vod', title, { thumb: thumbUrl, streamer })
  pushSync()

  $('#watch-title').textContent = streamer || title
  $('#mini-title').textContent = title
  setAvatar(meta?.owner?.profileImageURL)
  const date = meta?.createdAt ? new Date(meta.createdAt).toLocaleDateString(lang(), { day: 'numeric', month: 'long', year: 'numeric' }) : ''
  $('#watch-sub').innerHTML = `<span class="pill vod sm">VOD</span>${date ? `<span>${esc(date)}</span>` : ''}${length ? `<span>${icon('clock', 13)} ${esc(formatDuration(length))}</span>` : ''}`
  $('#watch-info').innerHTML = `
    <div class="wi-text">
      <h1 title="${esc(title)}">${esc(title)}</h1>
      ${meta?.game?.displayName ? `<p class="hero-game">${icon('gamepad', 14)} ${esc(meta.game.displayName)}</p>` : ''}
    </div>
    <div class="wi-actions">
      ${token.login ? `<button class="btn ghost sm" type="button" data-action="see-vods">${icon('film', 16)}<span>${esc(t('see_vods'))}</span></button>` : ''}
      <button class="btn ghost sm" type="button" data-action="open-in">${icon('external', 16)}<span>${esc(t('open_in'))}</span></button>
    </div>`
}

function setAvatar(url) {
  const img = $('#watch-avatar')
  if (url) { img.src = url; img.hidden = false } else img.hidden = true
}

function onPlaybackTime(cur, duration) {
  const w = state.watch
  if (!w || w.kind !== 'vod') return
  chat.tick(cur)
  if (cur > 0 && Math.abs(cur - lastSave) > 5) {
    lastSave = cur
    store.setProgress(w.id, cur)
    if (Number.isFinite(duration) && duration > 0) store.setLength(w.id, duration)
    pushSync()
  }
}

function stopPlayback() {
  clearInterval(infoTimer)
  clearInterval(uptimeTimer)
  player.destroy()
  chat.close()
  lastSave = 0
}

function minimizeWatch() {
  const watch = $('#watch')
  if (watch.hidden) return
  if (player.isFullscreen) document.exitFullscreen?.().catch(() => {})
  watch.classList.add('minimized')
  document.documentElement.classList.remove('watching')
}

function expandWatch() {
  $('#watch').classList.remove('minimized')
  document.documentElement.classList.add('watching')
}

function closeWatch() {
  const watch = $('#watch')
  if (player.isFullscreen) document.exitFullscreen?.().catch(() => {})
  stopPlayback()
  flushSync({ force: true })
  state.watch = null
  watch.classList.remove('open')
  document.documentElement.classList.remove('watching')
  setTimeout(() => { if (!state.watch) { watch.hidden = true; watch.classList.remove('minimized') } }, 220)
  setUrl({})
  renderContinue()
  if (state.channel) {
    // Les barres de progression des cartes ont pu changer.
    const kw = $('#vod-filter')?.value?.trim().toLowerCase() ?? ''
    if (state.tab === 'channel') renderChannel(kw)
  }
}

function setUrl(params) {
  const q = new URLSearchParams(params).toString()
  history.replaceState(null, '', q ? `${location.pathname}?${q}` : location.pathname)
}

// ── Feuilles : ouvrir dans…, réglages ─────────────────────────────────────
function openSheet(html) {
  const sheet = $('#sheet')
  sheet.innerHTML = html
  renderIcons(sheet)
  $('#sheet-backdrop').hidden = false
  sheet.hidden = false
  requestAnimationFrame(() => { sheet.classList.add('open'); $('#sheet-backdrop').classList.add('open') })
}

function closeSheet() {
  const sheet = $('#sheet')
  sheet.classList.remove('open')
  $('#sheet-backdrop').classList.remove('open')
  setTimeout(() => { sheet.hidden = true; $('#sheet-backdrop').hidden = true }, 200)
}

function currentStreamUrl() {
  const links = state.watch?.links
  if (!links) return ''
  const link = links[player.quality] ?? Object.values(links)[0] ?? ''
  // Proxy coupé : l'appli externe reçoit l'adresse directe de Twitch.
  return api.EXTERNAL_LINKS_VIA_PROXY ? link : api.directUrl(link)
}

function openInSheet() {
  const url = currentStreamUrl()
  if (!url) return
  const name = (state.watch?.login || state.watch?.id || 'Twitch').replace(/[^a-zA-Z0-9]/g, '_')
  const apps = isMobile ? `
    <a class="sheet-row" href="vlc://${esc(url)}"><span class="app-dot vlc"></span><span>VLC</span>${icon('chevronRight', 16)}</a>
    <a class="sheet-row" href="outplayer://${esc(url)}"><span class="app-dot outplayer"></span><span>Outplayer</span>${icon('chevronRight', 16)}</a>
    <a class="sheet-row" href="infuse://x-callback-url/play?url=${esc(encodeURIComponent(url.replace('/api/proxy', `/api/proxy/${name}.m3u8`)))}"><span class="app-dot infuse"></span><span>Infuse</span>${icon('chevronRight', 16)}</a>` : ''
  openSheet(`
    <div class="sheet-head"><h2>${esc(t('open_in'))}</h2><button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
    <p class="muted sheet-sub">${esc(t('quality'))} : ${esc(qualityLabel(player.quality ?? ''))}</p>
    <div class="sheet-group">
      ${apps}
      <button class="sheet-row" type="button" data-sheet="copy">${icon('copy', 18)}<span>${esc(t('copy_link'))}</span></button>
      <button class="sheet-row" type="button" data-sheet="m3u">${icon('download', 18)}<span>${esc(t('download_m3u'))}</span></button>
    </div>
    <input class="link-box" readonly value="${esc(url)}">`)

  const sheet = $('#sheet')
  sheet.onclick = async (e) => {
    if (e.target.closest('[data-sheet-close]')) return closeSheet()
    const act = e.target.closest('[data-sheet]')?.dataset.sheet
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(url) } catch { $('.link-box', sheet).select(); document.execCommand('copy') }
      toast(t('copied'), 'success')
    }
    if (act === 'm3u') {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([`#EXTM3U\n#EXTINF:-1,${name}\n${url}\n`], { type: 'audio/x-mpegurl' }))
      a.download = `${name}.m3u`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
  }
}

function openSettings() {
  const p = store.prefs
  const toggle = (id, label, checked, sub = '') => `
    <label class="setting">
      <span class="setting-text"><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      <input type="checkbox" class="switch" id="${id}" ${checked ? 'checked' : ''}>
    </label>`
  openSheet(`
    <div class="sheet-head"><h2>${esc(t('settings'))}</h2><button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
    <div class="sheet-section" id="settings-account"></div>
    <div class="sheet-section">
      <h3>${esc(t('language'))}</h3>
      <div class="segmented full" id="set-lang">
        <button type="button" data-l="auto" class="${p.lang ? '' : 'active'}">${esc(t('lang_auto'))}</button>
        ${LANGS.map((l) => `<button type="button" data-l="${l.id}" class="${p.lang === l.id ? 'active' : ''}">${esc(l.label)}</button>`).join('')}
      </div>
      <p class="muted small lang-hint">${esc(t('lang_auto_sub', { l: LANGS.find((x) => x.id === deviceLang())?.label ?? 'English' }))}</p>
    </div>
    <div class="sheet-section">
      <h3>${esc(t('chat_settings'))}</h3>
      ${toggle('set-ts', t('timestamps'), p.timestamps)}
      ${toggle('set-deleted', t('keep_deleted'), p.keepDeleted)}
      ${toggle('set-history', t('load_history'), p.loadHistory)}
      <label class="setting">
        <span class="setting-text"><span>${esc(t('chat_size'))}</span></span>
        <span class="size-ctl"><input type="range" id="set-size" min="12" max="20" step="1" value="${p.chatSize}"><output>${p.chatSize}</output></span>
      </label>
    </div>
    <div class="sheet-section">
      <h3>${esc(t('usage'))}</h3>
      <div class="usage-stats" id="usage-stats"><p class="muted small">${esc(t('loading'))}</p></div>
      ${toggle('set-usage', t('share_usage'), p.shareUsage, t('share_usage_sub'))}
    </div>
    <div class="sheet-section">
      <h3>${esc(t('about'))}</h3>
      <p class="muted small">${esc(t('about_text'))}</p>
      <div class="sheet-group">
        <a class="sheet-row" href="${api.GITHUB_URL}" target="_blank" rel="noopener">${icon('github', 18)}<span>${esc(t('source_site'))}</span>${icon('external', 16)}</a>
        <a class="sheet-row" href="${api.APP_GITHUB_URL}" target="_blank" rel="noopener">${icon('github', 18)}<span>${esc(t('source_app'))}</span>${icon('external', 16)}</a>
      </div>
      ${creditsHtml()}
    </div>`)
  renderSettingsAccount()
  renderUsageStats()

  const sheet = $('#sheet')
  sheet.onclick = (e) => {
    if (e.target.closest('[data-sheet-close]')) return closeSheet()
    const l = e.target.closest('[data-l]')?.dataset.l
    if (l) {
      // « Appareil » n'enregistre rien : la langue suivra l'appareil, y
      // compris s'il change de langue plus tard.
      store.prefs.lang = l === 'auto' ? null : l
      setLang(l === 'auto' ? deviceLang() : l)
      store.savePrefs()
      applyStatic()
      renderAccount()
      refreshTexts()
      // La feuille elle-même est refaite dans la nouvelle langue.
      const scroll = sheet.scrollTop
      openSettings()
      $('#sheet').scrollTop = scroll
    }
  }
  sheet.onchange = (e) => {
    const id = e.target.id
    if (id === 'set-ts') p.timestamps = e.target.checked
    if (id === 'set-deleted') p.keepDeleted = e.target.checked
    if (id === 'set-history') p.loadHistory = e.target.checked
    if (id === 'set-usage') {
      p.shareUsage = e.target.checked
      if (p.shareUsage) usage.ping(true)
      else usage.forget()
    }
    store.savePrefs()
    chat.applyPrefs()
  }
  sheet.oninput = (e) => {
    if (e.target.id !== 'set-size') return
    p.chatSize = Number(e.target.value)
    e.target.nextElementSibling.textContent = p.chatSize
    store.savePrefs()
    chat.applyPrefs()
  }
}

/** Combien de gens utilisent le site et l'app : aujourd'hui, 7 et 30 jours. */
async function renderUsageStats() {
  const box = $('#usage-stats')
  if (!box) return
  let s = null
  try { s = await usage.fetchStats() } catch {}
  if (!$('#usage-stats')) return
  if (!s) { box.innerHTML = `<p class="muted small">${esc(t('usage_unavailable'))}</p>`; return }
  const web = s.platforms?.web ?? { today: 0, week: 0, month: 0 }
  const ios = s.platforms?.ios ?? { today: s.today, week: s.week, month: s.month }
  const row = (label, k) => `
    <div class="usage-cell">
      <span class="usage-label">${esc(label)}</span>
      <strong>${esc(formatViewers(s[k] ?? 0))}</strong>
      <span class="usage-split">${icon('globe', 12)} ${esc(formatViewers(web[k] ?? 0))} · iOS ${esc(formatViewers(ios[k] ?? 0))}</span>
    </div>`
  box.innerHTML = `
    <div class="usage-grid">${row(t('usage_today'), 'today')}${row(t('usage_week'), 'week')}${row(t('usage_month'), 'month')}</div>
    <p class="muted small">${esc(t('usage_note'))}</p>`
}

function renderSettingsAccount() {
  const box = $('#settings-account')
  if (!box) return
  box.innerHTML = session.login ? `
    <h3>${esc(t('account'))}</h3>
    <div class="account-row">
      ${session.avatar ? `<img class="avatar" src="${esc(session.avatar)}" alt="">` : `<span class="avatar placeholder">${esc(session.login[0].toUpperCase())}</span>`}
      <div class="account-id"><strong>${esc(session.login)}</strong>
        <small class="muted">${esc(session.canChat ? t('connected_as', { u: session.login }) : t('chat_rescope'))}</small></div>
      ${session.canChat ? '' : `<button class="btn sm primary" type="button" data-action="login-again">${esc(t('login'))}</button>`}
      <button class="btn sm danger" type="button" data-action="logout">${icon('logout', 16)}<span>${esc(t('logout'))}</span></button>
    </div>` : `
    <h3>${esc(t('account'))}</h3>
    <div class="account-row">
      <span class="avatar placeholder">${icon('user', 18)}</span>
      <div class="account-id"><strong>${esc(t('not_connected'))}</strong><small class="muted">${esc(t('login_prompt'))}</small></div>
    </div>
    <button class="btn primary full" type="button" data-action="login">${icon('twitch', 18)}<span>${esc(t('login'))}</span></button>`
}
actions['login-again'] = () => login()

/** Après un changement de langue : ce qui a été rendu en JS est refait. */
function refreshTexts() {
  renderContinue()
  renderRecentChannels()
  state.loaded.followed = 0
  state.loaded.top = 0
  if (state.tab === 'discover') { loadFollowed(); loadTop(state.topLang) }
  if (state.channel) renderChannel($('#vod-filter')?.value?.trim().toLowerCase() ?? '')
  chat.applyPrefs()
}
