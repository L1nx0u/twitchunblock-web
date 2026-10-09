// ═══════════════════════════════════════════════════════════════════════════
//  Coque : démarrage, session Twitch, sauvegarde distante, navigation,
//  routage global des clics. Le contenu vit dans les modules :
//  state.js (état), ui.js (feuilles), cards.js (cartes), home.js (accueil),
//  tour.js (visite), streamer.js (page chaîne), watch.js (lecteur),
//  settings.js (réglages).
//
//  Les modules se rappellent entre eux (accueil → shell pour la reprise
//  d'un jeton, visite → shell pour changer d'onglet…) : uniquement des
//  fonctions appelées à l'exécution, jamais à l'évaluation — les cycles
//  sont sûrs.
// ═══════════════════════════════════════════════════════════════════════════

import * as api from './api.js'
import { store } from './store.js'
import { applyStatic, initLang, t } from './i18n.js'
import { loadHls } from './player.js'
import { $, $$, esc, icon, isMobile, toast } from './util.js'
import { refs, session, state } from './state.js'
import { applyTheme, closeSheet, renderIcons } from './ui.js'
import { followLocalInner } from './cards.js'
import {
  applyHomeTab, applyLayout, cat, closeCategory, followedCats, isCatFollowed,
  isLocallyFollowed, loadCategories, loadFollowed, loadTop, openCategory,
  renderContinue, renderTopLocal, setHomeTab, setupCategories,
  startLiveTicker, toggleLocalFollow,
} from './home.js'
import { showWhatsNew, startTour, welcomeOrWhatsNew } from './tour.js'
import { CHANGELOG } from './changelog.js'
import {
  hideSuggest, loadChannelClips, onSuggestKey, pickSuggestion, queueSuggest,
  renderChannel, renderRecentChannels, searchChannel, setChannelTab,
} from './streamer.js'
import {
  closeWatch, expandWatch, minimizeWatch, openClip, openLive, openVod,
  playPlaylist, recoverAndPlay, setupPlayer,
} from './watch.js'
import {
  exportData, loadAnnouncement, openInSheet, openSettings,
  renderAnnouncement, renderSettingsAccount,
} from './settings.js'
import { bindMulti, multiShown, refreshMultiTexts } from './multi.js'

// ── Démarrage ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot)

async function boot() {
  applyTheme(store.prefs.theme)
  initLang(store.prefs.lang)
  loadHls()   // prêt avant le premier clic
  applyStatic()
  renderTopLocal()
  applyLayout()
  applyHomeTab()
  setupCategories()
  loadAnnouncement(true)
  setTimeout(welcomeOrWhatsNew, 900)
  renderIcons()
  bindGlobal()
  setupPlayer()
  renderContinue()
  renderRecentChannels()
  startLiveTicker()
  // Installable comme une app (et la coque s'ouvre hors ligne).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }

  // Jeton déjà là (session précédente, ou retour de connexion sans popup).
  if (store.token) await adoptToken(store.token, { silent: true })
  else renderAccount()

  const params = new URLSearchParams(location.search)
  const vod = params.get('id') ?? params.get('vod')
  const channel = api.cleanLogin(params.get('channel'))
  const clip = params.get('clip')
  if (clip && /^[A-Za-z0-9_-]{3,100}$/.test(clip)) openClip(clip)
  else if (vod && /^\d{6,}$/.test(vod)) openVod(vod)
  else if (channel) { setTab('channel'); searchChannel(channel); openLive(channel) }
  setTab(state.tab)
}

// ── Session Twitch ─────────────────────────────────────────────────────────
export async function adoptToken(token, { silent = false } = {}) {
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
  refs.chat?.sessionChanged()
}

export function login() {
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
  // Jeton révoqué chez Twitch, pas seulement oublié ici.
  if (session.token) api.revokeToken(session.token)
  store.token = null
  Object.assign(session, { token: null, userId: null, login: null, avatar: null, scopes: [] })
  renderAccount()
  state.loaded.followed = 0
  loadFollowed()
  refs.chat?.sessionChanged()
  closeSheet()
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return
  const raw = typeof e.data === 'string' ? e.data : ''
  if (!raw.includes('access_token=')) return
  const params = new URLSearchParams(raw.replace(/^#/, ''))
  const token = params.get('access_token')
  let expected = null
  try { expected = localStorage.getItem('tu_oauth_state') } catch {}
  if (!token || !expected || params.get('state') !== expected) return
  try { localStorage.removeItem('tu_oauth_state') } catch {}
  adoptToken(token)
})

export function renderAccount() {
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
export let lastSyncAt = 0

/** Un changement à sauvegarder. Aucun envoi immédiat. */
export function pushSync() { syncDirty = true }

export function flushSync({ force = false } = {}) {
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
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSync({ force: true }); else loadAnnouncement() })
window.addEventListener('pagehide', () => flushSync({ force: true }))

// ── Navigation ─────────────────────────────────────────────────────────────
export function setTab(tab) {
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
  if (tab === 'categories' && !cat.current && (cat.tab === 'followed' || Date.now() - cat.loaded > 120_000)) loadCategories()
  if (tab === 'multi') multiShown()
  window.scrollTo({ top: 0 })
}

function bindGlobal() {
  bindMulti()
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
    const all = e.target.closest('[data-play-all]')
    if (all) return playPlaylist(all.dataset.playAll)
    const clip = e.target.closest('[data-clip]')
    if (clip) return openClip(clip.dataset.clip)
    const ctab = e.target.closest('[data-ctab]')
    if (ctab) return setChannelTab(ctab.dataset.ctab)
    const period = e.target.closest('[data-clip-period]')
    if (period) return loadChannelClips(period.dataset.clipPeriod)
    const rec = e.target.closest('[data-recover]')
    if (rec) return recoverAndPlay(rec)
    const chan = e.target.closest('[data-channel]')
    if (chan) {
      // Depuis le lecteur (pseudo) : réduit en mini-lecteur pour voir la page.
      if (chan.closest('#watch')) minimizeWatch()
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
  $('#channel-input').addEventListener('input', () => queueSuggest())
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
  'cat-more': () => loadCategories({ more: true }),
  'cat-streams-more': () => cat.current && openCategory(cat.current, { more: true }),
  'cat-back': () => closeCategory(),
  'cat-follow': (e) => {
    const c = cat.current
    if (!c) return
    const list = followedCats()
    store.prefs.followedCategories = isCatFollowed(c.id) ? list.filter((x) => x.id !== c.id) : [{ id: c.id, name: c.name, box: c.box }, ...list].slice(0, 200)
    store.savePrefs()
    const b = e.target.closest('[data-action="cat-follow"]')
    const on = isCatFollowed(c.id)
    b.classList.toggle('on', on)
    b.innerHTML = `${icon('heart', 15)}<span>${esc(t(on ? 'following' : 'follow'))}</span>`
  },
  'whats-new': () => showWhatsNew(CHANGELOG, 'changelog'),
  'replay-tutorial': () => startTour(),
  'home-offline': () => setHomeTab('offline'),
  'toggle-layout': () => { store.prefs.homeList = !store.prefs.homeList; store.savePrefs(); applyLayout() },
  'follow-local': (e) => {
    const b = e.target.closest('[data-follow]')
    if (!b) return
    toggleLocalFollow(b.dataset.follow)
    const on = isLocallyFollowed(b.dataset.follow)
    b.classList.toggle('on', on)
    b.innerHTML = followLocalInner(on)
  },
  'export-data': () => exportData(),
  'import-data': () => $('#import-file')?.click(),
  'clear-blocked': () => {
    store.prefs.blockedUsers = []
    store.savePrefs()
    toast(t('hidden_cleared'))
    openSettings()
  },
  'clear-channels': () => { store.clearHistory('channel'); pushSync(); renderRecentChannels() },
  'watch-minimize': () => minimizeWatch(),
  'watch-expand': () => expandWatch(),
  'watch-close': () => closeWatch(),
  'watch-toggle-play': () => refs.player.togglePlay(),
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
actions['login-again'] = () => login()

/** Après un changement de langue : ce qui a été rendu en JS est refait. */
export function refreshTexts() {
  renderTopLocal()
  applyLayout()
  renderAnnouncement()
  renderContinue()
  renderRecentChannels()
  state.loaded.followed = 0
  state.loaded.top = 0
  if (state.tab === 'discover') { loadFollowed(); loadTop(state.topLang) }
  if (state.channel) renderChannel($('#vod-filter')?.value?.trim().toLowerCase() ?? '')
  refs.chat.applyPrefs()
  refreshMultiTexts()
}
