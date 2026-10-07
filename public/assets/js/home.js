// ═══════════════════════════════════════════════════════════════════════════
//  Accueil : reprendre, suivies, top des lives, hors ligne, catégories.
//  La reprise d'un jeton refusé par Helix (401) repasse par le shell.
// ═══════════════════════════════════════════════════════════════════════════

import { adoptToken } from './main.js'
import { state, session } from './state.js'
import * as api from './api.js'
import { store } from './store.js'
import { lang, t } from './i18n.js'
import {
  $, $$, debounce, esc, formatClock, formatViewers, icon, uptimeSince,
} from './util.js'
import { emptyState, offlineDate, offlineFor, skeleton, streamCard } from './cards.js'

// ── Reprendre ──────────────────────────────────────────────────────────────
export function renderContinue() {
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

// ── Suivis sans compte et affichage de l'accueil ─────────────────────────
export const localFollows = () => store.prefs.localFollows ?? []
export function isLocallyFollowed(login) { return localFollows().includes(String(login).toLowerCase()) }
export function toggleLocalFollow(login) {
  const l = String(login).toLowerCase()
  const list = localFollows()
  store.prefs.localFollows = list.includes(l) ? list.filter((x) => x !== l) : [l, ...list].slice(0, 300)
  store.savePrefs()
  state.loaded.followed = 0
}

/** Grille de cartes ou liste façon Twitch, au choix (bouton + réglage). */
export function applyLayout() {
  const list = Boolean(store.prefs.homeList)
  for (const id of ['#followed-grid', '#top-grid']) $(id)?.classList.toggle('as-list', list)
  const b = $('#layout-toggle')
  if (b) {
    b.innerHTML = icon(list ? 'grid' : 'list', 18)
    b.title = t(list ? 'layout_grid' : 'layout_list')
    b.setAttribute('aria-label', b.title)
  }
}

let followedRetried = false
export async function loadFollowed({ silent = false } = {}) {
  const grid = $('#followed-grid')
  const head = $('#followed-block')
  state.loaded.followed = Date.now()
  const local = localFollows()
  if (!session.token) {
    head.classList.add('logged-out')
    const loginCard = (compact) => `
      <div class="login-card${compact ? ' compact' : ''}">
        ${compact ? '' : `<div class="login-card-icon">${icon('heart', 26)}</div>`}
        <p>${esc(t(compact ? 'login_optional' : 'login_prompt_local'))}</p>
        <button class="btn primary${compact ? ' sm' : ''}" type="button" data-action="login">${icon('twitch', 18)}<span>${esc(t('login'))}</span></button>
      </div>`
    if (!local.length) { grid.innerHTML = loginCard(false); renderOffline([]); return }
    // Sans compte : les chaînes suivies sur cet appareil, par la requête publique.
    if (!silent) { grid.innerHTML = skeleton(Math.min(4, local.length)); offlinePending() }
    try {
      const channels = await api.getChannelsByLogins(local)
      if (session.token) return
      const live = channels.filter((c) => c.stream).map((c) => c.stream).sort((a, b) => b.viewers - a.viewers)
      const offline = channels.filter((c) => !c.stream)
      grid.innerHTML = (live.length ? live.map(streamCard).join('') : noLiveFollowed(offline.length)) + loginCard(true)
      renderOffline(offline, live.length > 0)
    } catch {
      if (!silent) { grid.innerHTML = emptyState(t('err_loading'), 'refresh'); offlineFailed() }
    }
    return
  }
  head.classList.remove('logged-out')
  if (!session.userId) return
  if (!silent) { grid.innerHTML = skeleton(4); offlinePending() }
  const token = session.token
  try {
    // Lives du compte (Helix), plus toutes les chaînes suivies (compte +
    // appareil) pour les lives de l'appareil et la liste hors ligne.
    const [streams, logins] = await Promise.all([
      api.getFollowedStreams(session.userId),
      api.getFollowedLogins(session.userId).catch(() => []),
    ])
    state.accountFollows = logins
    const all = [...new Set([...logins, ...local])]
    const channels = await api.getChannelsByLogins(all).catch(() => null)
    if (session.token !== token) return   // déconnecté entre-temps
    followedRetried = false
    const known = new Set(streams.map((s) => s.login.toLowerCase()))
    const extra = (channels ?? []).filter((c) => c.stream && !known.has(c.login.toLowerCase())).map((c) => c.stream)
    // Mêlés et triés par audience, comme sur Twitch (pas relégués en bas).
    const live = [...streams, ...extra].sort((a, b) => b.viewers - a.viewers)
    const offline = channels ? channels.filter((c) => !c.stream) : null
    grid.innerHTML = live.length ? live.map(streamCard).join('') : noLiveFollowed(offline?.length ?? 0)
    if (offline) renderOffline(offline, live.length > 0)
    else if (!silent) offlineFailed()
  } catch (err) {
    if (session.token !== token) return
    // Une seule nouvelle tentative : un jeton valide mais refusé par Helix
    // (autre application, droit manquant) relançait la boucle sans fin.
    if (err.status === 401 && !followedRetried) { followedRetried = true; await adoptToken(session.token); return }
    // En rafraîchissement silencieux, une panne passagère garde l'existant.
    if (!silent) { grid.innerHTML = emptyState(t('err_loading'), 'refresh'); offlineFailed() }
  }
}

/** Onglet « Hors ligne » pendant le chargement, ou s'il a échoué : une
 *  liste déjà affichée reste en place. */
function offlinePending() {
  const box = $('#followed-offline')
  if (box && !box.querySelector('.offline-list')) box.innerHTML = `<p class="muted small">${esc(t('loading'))}</p>`
}
function offlineFailed() {
  const box = $('#followed-offline')
  if (box && !box.querySelector('.offline-list')) box.innerHTML = emptyState(t('err_loading'), 'refresh')
}

/** Aucune chaîne suivie en live : et, s'il y en a hors ligne, un pas vers
 *  leur onglet. */
function noLiveFollowed(offlineCount) {
  return `<div class="empty">${icon('heart', 28)}<p>${esc(t('no_live_followed'))}</p>${offlineCount
    ? `<button class="btn ghost sm" type="button" data-action="home-offline">${icon('clock', 16)}<span>${esc(t('see_offline', { n: offlineCount }))}</span></button>`
    : ''}</div>`
}

/** Onglet « Hors ligne » : les chaînes suivies hors ligne, pour ouvrir leur
 *  page (VODs, clips, diffusions supprimées) sans chercher. */
export function renderOffline(list, anyLive = false) {
  const box = $('#followed-offline')
  if (!box) return
  list = list.slice().sort((a, b) => a.name.localeCompare(b.name, lang()))
  $('#offline-count').textContent = list.length ? String(list.length) : ''
  box.innerHTML = list.length ? `
    <div class="offline-list">${list.map((c) => `
      <button type="button" class="offline-row" data-channel="${esc(c.login)}">
        ${c.avatar ? `<img class="avatar sm" src="${esc(c.avatar)}" alt="" loading="lazy">` : `<span class="avatar sm placeholder">${esc((c.name || '?')[0])}</span>`}
        <span class="offline-text"><span>${esc(c.name)}</span>${c.lastEnd ? `<small class="muted">${esc(offlineFor(null, 0, c.lastEnd))} · ${esc(offlineDate(null, 0, c.lastEnd))}</small>` : ''}</span>
      </button>`).join('')}</div>`
    : emptyState(t(anyLive ? 'offline_all_live' : 'offline_none'), anyLive ? 'radio' : 'heart')
}

// ── Sous-onglets de l'accueil : Suivies | Top | Hors ligne ───────────────
const HOME_TABS = ['followed', 'top', 'offline']
export function applyHomeTab() {
  const tab = HOME_TABS.includes(store.prefs.homeTab) ? store.prefs.homeTab : 'followed'
  for (const b of $$('#home-seg [data-home]')) b.classList.toggle('active', b.dataset.home === tab)
  $('#followed-block').hidden = tab !== 'followed'
  $('#top-block').hidden = tab !== 'top'
  $('#offline-block').hidden = tab !== 'offline'
}

export function setHomeTab(tab) {
  store.prefs.homeTab = tab
  store.savePrefs()
  applyHomeTab()
}

// ── Catégories ─────────────────────────────────────────────────────────
export const cat = { tab: 'all', items: [], cursor: null, q: '', loaded: 0, current: null, streamsCursor: null }
export const followedCats = () => store.prefs.followedCategories ?? []
export const isCatFollowed = (id) => followedCats().some((c) => c.id === id)

export function catCard(c) {
  return `<article class="cat-card" data-cat="${esc(c.id)}" data-cat-name="${esc(c.name)}" data-cat-box="${esc(c.box)}" tabindex="0">
    <div class="cat-box"><img src="${esc(c.box)}" alt="" loading="lazy" decoding="async"></div>
    <h3 title="${esc(c.name)}">${esc(c.name)}</h3>
    ${c.viewers != null ? `<p class="meta">${icon('eye', 12)} ${esc(formatViewers(c.viewers))}</p>` : ''}
  </article>`
}

export async function loadCategories({ more = false } = {}) {
  const grid = $('#cat-grid')
  for (const b of $$('#cat-seg [data-cat-tab]')) b.classList.toggle('active', b.dataset.catTab === cat.tab)
  $('#cat-search-wrap').hidden = cat.tab !== 'all'
  $('#cat-more').innerHTML = ''
  if (cat.tab === 'followed') {
    const list = followedCats()
    if (!list.length) { grid.innerHTML = emptyState(t('cat_followed_empty_web'), 'heart'); return }
    grid.innerHTML = list.map(catCard).join('')
    // Audience à jour, triées de la plus regardée à la moins regardée.
    try {
      const fresh = await api.getCategoriesByIds(list.map((c) => c.id))
      if (cat.tab !== 'followed') return
      const byId = Object.fromEntries(fresh.map((c) => [c.id, c]))
      grid.innerHTML = list.map((c) => byId[c.id] ?? c).sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0)).map(catCard).join('')
    } catch {}
    return
  }
  if (!more) grid.innerHTML = skeleton(12, 'cat')
  try {
    if (cat.q) {
      cat.items = await api.searchCategories(cat.q); cat.cursor = null
    } else {
      const page = await api.getTopCategories(more ? cat.cursor : null)
      cat.items = more ? [...cat.items, ...page.items.filter((x) => !cat.items.some((y) => y.id === x.id))] : page.items
      cat.cursor = page.cursor
    }
    cat.loaded = Date.now()
    grid.innerHTML = cat.items.length ? cat.items.map(catCard).join('') : emptyState(t('no_result'), 'search')
    if (cat.cursor && !cat.q) $('#cat-more').innerHTML = `<button class="btn ghost" type="button" data-action="cat-more">${esc(t('load_more'))}</button>`
  } catch {
    grid.innerHTML = emptyState(t('err_loading'), 'refresh')
  }
}

export async function openCategory(c, { more = false } = {}) {
  cat.current = c
  $('#cat-browser').hidden = true
  const box = $('#cat-detail')
  box.hidden = false
  if (!more) {
    const on = isCatFollowed(c.id)
    box.innerHTML = `
      <div class="cat-head">
        <button class="btn ghost sm" type="button" data-action="cat-back">${icon('chevronLeft', 16)}<span>${esc(t('nav_categories'))}</span></button>
        ${c.box ? `<img class="cat-head-box" src="${esc(c.box)}" alt="">` : ''}
        <h2>${esc(c.name)}</h2>
        <button class="btn ghost sm follow-local${on ? ' on' : ''}" type="button" data-action="cat-follow">${icon('heart', 15)}<span>${esc(t(on ? 'following' : 'follow'))}</span></button>
      </div>
      <div class="grid${store.prefs.homeList ? ' as-list' : ''}" id="cat-streams">${skeleton(8)}</div>
      <div class="load-more" id="cat-streams-more"></div>`
    window.scrollTo({ top: 0 })
  }
  try {
    const page = await api.getCategoryStreams(c.id, more ? cat.streamsCursor : null)
    if (cat.current !== c) return
    cat.streamsCursor = page.cursor
    const grid = $('#cat-streams')
    const html = page.items.map(streamCard).join('')
    if (more) grid.insertAdjacentHTML('beforeend', html)
    else grid.innerHTML = html || emptyState(t('no_live'))
    $('#cat-streams-more').innerHTML = page.cursor ? `<button class="btn ghost" type="button" data-action="cat-streams-more">${esc(t('load_more'))}</button>` : ''
  } catch {
    if (!more) $('#cat-streams').innerHTML = emptyState(t('err_loading'), 'refresh')
  }
}

export function closeCategory() {
  cat.current = null
  $('#cat-detail').hidden = true
  $('#cat-browser').hidden = false
  if (cat.tab === 'followed') loadCategories()
}

export function setupCategories() {
  $('#cat-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat-tab]')
    if (b && b.dataset.catTab !== cat.tab) { cat.tab = b.dataset.catTab; loadCategories() }
  })
  $('#cat-grid').addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]')
    if (c) openCategory({ id: c.dataset.cat, name: c.dataset.catName, box: c.dataset.catBox })
  })
  $('#cat-search').addEventListener('input', debounce((e) => { cat.q = e.target.value.trim(); loadCategories() }, 350))
  $('#home-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-home]')
    if (b) setHomeTab(b.dataset.home)
  })
}

export async function loadTop(language, { silent = false } = {}) {
  state.topLang = language
  state.loaded.top = Date.now()
  for (const b of $$('#top-seg [data-lang]')) b.classList.toggle('active', b.dataset.lang === language)
  const grid = $('#top-grid')
  if (!silent) grid.innerHTML = skeleton(8)
  try {
    const streams = await api.getTopStreams(language === 'all' ? null : topLangCode())
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
export function startLiveTicker() {
  setInterval(() => {
    if (document.hidden) return
    for (const el of document.querySelectorAll('[data-started]')) {
      el.textContent = uptimeSince(el.dataset.started)
    }
    if (state.tab !== 'discover' || document.hidden || !$('#watch').hidden && !$('#watch').classList.contains('minimized')) return
    const now = Date.now()
    if (now - state.loaded.top > 60_000) loadTop(state.topLang, { silent: true })
    if (session.userId && now - state.loaded.followed > 60_000) loadFollowed({ silent: true })
  }, 1000)
}

// ── Langue du top des lives ────────────────────────────────────────────
// Twitch ne filtre pas par pays mais par langue du streamer : on prend la
// langue choisie dans les réglages, sinon la première langue de l'appareil
// que Twitch connaît (« pt-BR » → portugais), sinon l'anglais.
export const TOP_LANGS = ['ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'th', 'tl', 'tr', 'uk', 'vi', 'zh', 'zh_hk']
const TOP_ALIAS = { nb: 'no', nn: 'no', fil: 'tl' }
export function deviceTopLang() {
  for (const raw of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const tag = String(raw || '').toLowerCase()
    if (/^zh-(hk|mo|hant)/.test(tag)) return 'zh_hk'
    const base = tag.split('-')[0]
    const code = TOP_ALIAS[base] ?? base
    if (TOP_LANGS.includes(code)) return code
  }
  return 'en'
}
export const topLangCode = () => (TOP_LANGS.includes(store.prefs.topLang) ? store.prefs.topLang : deviceTopLang())
export function topLangName(code) {
  try {
    const n = new Intl.DisplayNames([lang()], { type: 'language' }).of(code === 'zh_hk' ? 'zh-HK' : code)
    return n ? n.charAt(0).toLocaleUpperCase(lang()) + n.slice(1) : code.toUpperCase()
  } catch { return code.toUpperCase() }
}
export function renderTopLocal() {
  const b = $('#top-local')
  if (b) b.textContent = topLangName(topLangCode())
}
