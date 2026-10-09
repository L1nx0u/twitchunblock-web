// ═══════════════════════════════════════════════════════════════════════════
//  Multistream : plusieurs lives en grille, ajout par recherche ou suivis en
//  direct. Chaque tuile est un vrai Player (même interface que le lecteur).
//  Le son suit la tuile focus (clic) ; le chat reste sur le lecteur principal.
// ═══════════════════════════════════════════════════════════════════════════

import * as api from './api.js'
import { store } from './store.js'
import { session, state } from './state.js'
import { Player } from './player.js'
import { stopMainPlayback } from './watch.js'
import { localFollows } from './home.js'
import { $, debounce, esc, formatViewers, icon, toast } from './util.js'
import { renderIcons } from './ui.js'
import { emptyState } from './cards.js'
import { t } from './i18n.js'

const MAX_TILES = 4
const tiles = []   // { login, name, player, el }
let focused = null
let sideLoaded = false
let suggestions = []
/** Numéro de la frappe en cours : une réponse différée arrivée après coup
 *  ne rouvre plus la liste par-dessus la grille. */
let suggestSeq = 0

export function bindMulti() {
  $('#multi-form').addEventListener('submit', (e) => {
    e.preventDefault()
    hideSuggest()
    addStream($('#multi-input').value)
    $('#multi-input').value = ''
  })
  const debouncedSuggest = debounce(suggestMulti, 250)
  $('#multi-input').addEventListener('input', () => debouncedSuggest(++suggestSeq))
  $('#multi-input').addEventListener('blur', () => setTimeout(hideSuggest, 150))
  $('#multi-suggest').addEventListener('mousedown', (e) => {
    const b = e.target.closest('[data-multi-pick]')
    if (!b) return
    e.preventDefault()
    hideSuggest()
    $('#multi-input').value = ''
    addStream(b.dataset.multiPick)
  })
  $('#multi-grid').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-multi-x]')
    if (rm) return removeStream(rm.dataset.multiX)
    const head = e.target.closest('.multi-head')
    if (head) focusStream(head.dataset.multiHead)
  })
  $('#multi-followed').addEventListener('click', (e) => {
    const row = e.target.closest('[data-multi-add]')
    if (row) addStream(row.dataset.multiAdd)
  })
}

/** Appelée à l'ouverture de l'onglet : charge la barre latérale une fois. */
export function multiShown() {
  if (!sideLoaded) { sideLoaded = true; loadMultiSidebar() }
  renderEmpty()
}

/** Rafraîchit les textes statiques après un changement de langue. */
export function refreshMultiTexts() {
  renderEmpty()
}

async function suggestMulti(seq) {
  if (seq !== suggestSeq) return
  const raw = $('#multi-input').value
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
  renderSuggest()
}

function renderSuggest() {
  const box = $('#multi-suggest')
  if (!suggestions.length) return hideSuggest()
  box.innerHTML = suggestions.map((s) => `
    <button type="button" class="suggest-row" data-multi-pick="${esc(s.login)}">
      ${s.profileImageURL ? `<img class="avatar xs" src="${esc(s.profileImageURL)}" alt="">` : `<span class="avatar xs placeholder">${icon('user', 14)}</span>`}
      <span class="suggest-name">${esc(s.displayName || s.login)}</span>
      ${s.stream ? `<span class="pill live sm">${esc(formatViewers(s.stream.viewersCount))}</span>` : ''}
    </button>`).join('')
  box.hidden = false
}

function hideSuggest() { suggestSeq++; $('#multi-suggest').hidden = true; suggestions = [] }

export async function addStream(raw) {
  const login = api.cleanLogin(raw)
  if (!login) return
  if (tiles.some((m) => m.login === login)) { focusStream(login); return }
  if (tiles.length >= MAX_TILES) { toast(t('multi_full'), 'error'); return }
  stopMainPlayback()

  const grid = $('#multi-grid')
  grid.querySelector('.multi-empty')?.remove()
  const el = document.createElement('article')
  el.className = 'multi-tile'
  el.innerHTML = `
    <div class="multi-head" data-multi-head="${esc(login)}" tabindex="0">
      <span class="avatar sm placeholder">…</span>
      <span class="multi-name">${esc(login)}</span>
      <button class="icon-btn xs" type="button" data-multi-x="${esc(login)}" title="${esc(t('close'))}" aria-label="${esc(t('close'))}">${icon('x', 12)}</button>
    </div>
    <div class="multi-screen"></div>`
  grid.append(el)
  renderIcons(el)

  const [links, info] = await Promise.all([
    api.getLive(login).catch(() => null),
    api.getChannelInfo(login).catch(() => null),
  ])
  if (!grid.contains(el)) return   // grille vidée pendant le chargement
  if (!links || !links.links || !Object.keys(links.links).length) {
    el.remove()
    renderEmpty()
    toast(t('err_live'), 'error')
    return
  }
  const name = info?.displayName || login
  const avatar = info?.profileImageURL || ''
  el.querySelector('.multi-name').textContent = name
  const av = el.querySelector('.avatar')
  if (avatar) {
    const img = document.createElement('img')
    img.className = 'avatar sm'
    img.src = avatar
    img.alt = ''
    img.loading = 'lazy'
    av.replaceWith(img)
  } else {
    av.textContent = (name || '?')[0]
  }
  const player = new Player(el.querySelector('.multi-screen'), {
    fullscreenTarget: el,
    prefs: store.prefs,
    savePrefs: () => store.savePrefs(),
    onToggleChat: () => focusStream(login),
    onHelp: () => toast(t('shortcuts_help'), 'info'),
    keysActive: () => state.tab === 'multi' && focused === login && !$('#sheet')?.classList.contains('open'),
    isChatOpen: () => store.prefs.chatOpen,
    onError: () => toast(t('err_live'), 'error'),
  })
  player.load({ links: links.links, kind: 'live' })
  tiles.push({ login, name, player, el })
  if (!focused) focusStream(login)
  else player.video.muted = true
}

export function focusStream(login) {
  if (!tiles.some((m) => m.login === login)) return
  focused = login
  for (const m of tiles) {
    const on = m.login === login
    m.el.classList.toggle('focused', on)
    m.player.video.muted = !on
    if (on && m.player.video.paused) m.player.video.play().catch(() => {})
  }
}

export function removeStream(login) {
  const i = tiles.findIndex((m) => m.login === login)
  if (i === -1) return
  const [m] = tiles.splice(i, 1)
  m.player.destroy()
  m.el.remove()
  if (focused === login) {
    focused = null
    if (tiles.length) focusStream(tiles[0].login)
  }
  renderEmpty()
}

/** Détruit toutes les tuiles (ouverture d'un live/VOD/clip ailleurs). */
export function stopMulti() {
  for (const m of tiles) m.player.destroy()
  tiles.length = 0
  focused = null
  const grid = $('#multi-grid')
  if (grid) {
    grid.innerHTML = ''
    renderEmpty()
  }
}

function renderEmpty() {
  const grid = $('#multi-grid')
  if (!grid) return
  grid.querySelector('.multi-empty')?.remove()
  if (!tiles.length) {
    const d = document.createElement('div')
    d.className = 'multi-empty'
    d.innerHTML = emptyState(t('multi_empty'), 'grid')
    grid.append(d)
  }
}

async function loadMultiSidebar() {
  const box = $('#multi-followed')
  if (!box) return
  let rows = []
  try {
    if (session.token && session.userId) {
      const streams = await api.getFollowedStreams(session.userId)
      rows = streams.map((s) => ({ login: s.login, name: s.name, avatar: s.avatar, sub: s.game || t('live_now') }))
    } else {
      const local = localFollows()
      if (local.length) {
        const channels = await api.getChannelsByLogins(local)
        rows = channels.filter((c) => c.stream).map((c) => ({
          login: c.login, name: c.name, avatar: c.avatar,
          sub: c.stream.game || `${formatViewers(c.stream.viewers)} ${t('viewers')}`,
        }))
      }
    }
  } catch { rows = [] }
  if (!rows.length) {
    box.innerHTML = emptyState(t('offline_none'), 'heart')
    return
  }
  box.innerHTML = rows.map((c) => `
    <button type="button" class="multi-row" data-multi-add="${esc(c.login)}">
      ${c.avatar ? `<img src="${esc(c.avatar)}" alt="" loading="lazy">` : `<span class="avatar placeholder">${esc((c.name || '?')[0])}</span>`}
      <span class="multi-name">${esc(c.name)}<small>${esc(c.sub)}</small></span>
    </button>`).join('')
}
