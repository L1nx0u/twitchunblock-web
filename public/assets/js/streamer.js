// ═══════════════════════════════════════════════════════════════════════════
//  Page streamer : recherche, suggestions, onglets (VODs, Supprimées,
//  highlights, playlists, clips). La lecture elle-même vit dans watch.js.
// ═══════════════════════════════════════════════════════════════════════════

import { pushSync } from './main.js'
import { isLocallyFollowed } from './home.js'
import { state } from './state.js'
import * as api from './api.js'
import { store } from './store.js'
import { lang, t } from './i18n.js'
import { $, $$, debounce, esc, formatViewers, icon, uptimeSince } from './util.js'
import {
  emptyState, followLocalInner, offlineDate, offlineFor, skeleton, vodCard, clipCard,
} from './cards.js'

export function renderRecentChannels() {
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

export function hideSuggest() { suggestSeq++; $('#channel-suggest').hidden = true; suggestions = [] }

const debouncedSuggest = debounce(suggestChannels, 250)
/** Une frappe dans la recherche : relance les suggestions anti-rebond. */
export function queueSuggest() { debouncedSuggest(++suggestSeq) }

export function onSuggestKey(e) {
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

export function pickSuggestion(login) {
  $('#channel-input').value = login
  hideSuggest()
  searchChannel(login)
}

let searchSeq = 0
export async function searchChannel(raw) {
  const parts = String(raw || '').trim().split(/\s+/)
  const login = api.cleanLogin(parts[0])
  const keyword = parts.slice(1).join(' ').toLowerCase()
  const out = $('#channel-result')
  if (!login) { out.innerHTML = ''; return }

  out.innerHTML = `<div class="channel-hero skeleton"></div><div class="grid vods">${skeleton(8, 'vod')}</div>`
  const seq = ++searchSeq
  const [info, videos] = await Promise.all([
    api.getChannelInfo(login).catch(() => null),
    api.getChannelVideos(login).catch(() => null),
  ])
  if (seq !== searchSeq) return   // une recherche plus récente a pris la main
  if (!info && (!videos || videos.error)) {
    out.innerHTML = emptyState(t('not_found'), 'search')
    return
  }
  if (state.channel?.login !== login) state.channelTab = 'vods'
  state.channel = { login, info, videos: videos?.videos ?? [] }
  store.addHistory(login, 'channel', info?.displayName || login, { avatar: info?.profileImageURL || videos?.avatar || '' })
  pushSync()
  renderRecentChannels()
  renderChannel(keyword)
}

// Onglets de la page streamer, comme sur Twitch. « Supprimées » juste après
// les VODs : ce sont des VODs aussi, celles que Twitch a effacées.
const CHANNEL_TABS = [['vods', 'vods'], ['recover', 'recover_tab'], ['highlights', 'highlights'], ['playlists', 'playlists'], ['clips', 'clips']]

/** Charge le contenu de l'onglet à sa première ouverture. */
function loadChannelTab(tab) {
  if (tab === 'highlights') loadChannelHighlights()
  if (tab === 'playlists') loadChannelPlaylists()
  if (tab === 'clips') loadChannelClips()
}

export function setChannelTab(tab) {
  state.channelTab = tab
  for (const b of $$('#channel-tabs [data-ctab]')) b.classList.toggle('active', b.dataset.ctab === tab)
  for (const p of $$('[data-cpanel]')) p.hidden = p.dataset.cpanel !== tab
  loadChannelTab(tab)
}

async function loadChannelHighlights() {
  const login = state.channel?.login
  const box = $('#channel-highlights')
  if (!login || !box) return
  state.highlightCache ??= new Map()
  let list = state.highlightCache.get(login)
  if (!list) {
    box.innerHTML = skeleton(4, 'vod')
    list = await api.getHighlights(login).catch(() => null)
    if (list) state.highlightCache.set(login, list)
  }
  if (state.channel?.login !== login || !$('#channel-highlights')) return
  const name = state.channel.info?.displayName || login
  $('#channel-highlights').innerHTML = list?.length ? list.map((v) => vodCard(v, name)).join('') : emptyState(t('no_highlights'), 'film')
}

/** Section Clips de la page chaîne, chargée à part (période au choix). */
export async function loadChannelClips(period = state.clipPeriod ?? 'LAST_WEEK') {
  const login = state.channel?.login
  const box = $('#channel-clips')
  if (!login || !box) return
  state.clipPeriod = period
  for (const b of document.querySelectorAll('[data-clip-period]')) b.classList.toggle('active', b.dataset.clipPeriod === period)
  // Gardés en mémoire : la page est redessinée à chaque frappe du filtre.
  const key = `${login}|${period}`
  state.clipCache ??= new Map()
  let clips = state.clipCache.get(key)
  if (!clips) {
    box.innerHTML = skeleton(4, 'vod')
    clips = await api.getClips(login, period).catch(() => null)
    if (clips) state.clipCache.set(key, clips)
  }
  if (state.channel?.login !== login || state.clipPeriod !== period || !$('#channel-clips')) return
  $('#channel-clips').innerHTML = clips?.length ? clips.map(clipCard).join('') : emptyState(t('no_clips'), 'film')
}

/** Playlists de la chaîne : une rangée défilante par playlist, comme sur Twitch. */
async function loadChannelPlaylists() {
  const login = state.channel?.login
  if (!login) return
  state.playlistCache ??= new Map()
  let lists = state.playlistCache.get(login)
  if (!lists) {
    const b = $('#channel-playlists')
    if (b) b.innerHTML = `<div class="grid vods">${skeleton(4, 'vod')}</div>`
    lists = await api.getCollections(login).catch(() => null)
    if (lists) state.playlistCache.set(login, lists)
  }
  const box = $('#channel-playlists')
  if (state.channel?.login !== login || !box) return
  if (!lists?.length) { box.innerHTML = emptyState(t('no_playlists'), 'list'); return }
  const name = state.channel.info?.displayName || login
  box.innerHTML = `
    ${lists.map((c) => `
      <div class="playlist">
        <div class="playlist-head">
          <h3>${esc(c.title)}</h3>
          <button class="btn ghost sm" type="button" data-play-all="${esc(c.id)}">${icon('play', 14)}<span>${esc(t('play_all'))}</span></button>
        </div>
        <p class="muted playlist-sub">${c.description ? `${esc(c.description)} · ` : ''}${esc(t('videos_count', { n: c.total }))}</p>
        <div class="rail">${c.videos.map((v) => vodCard(v, name)).join('')}</div>
      </div>`).join('')}`
}

// ── Onglet « Supprimées » (récupération de VODs effacées) ───────────────────
async function loadChannelRecover() {
  const login = state.channel?.login
  const box = $('#channel-recover')
  if (!login || !box) return
  state.recoverCache ??= new Map()
  let data = state.recoverCache.get(login)
  if (!data) {
    box.innerHTML = `<p class="muted small" style="padding:0 2px">${esc(t('loading'))}</p>`
    data = await api.getRecoverableStreams(login).catch(() => null)
    if (data) state.recoverCache.set(login, data)
  }
  if (state.channel?.login !== login || !$('#channel-recover')) return
  const streams = data?.streams || []
  $('#channel-recover').innerHTML = streams.length
    ? `<div class="recover-list">${streams.map(recoverRow).join('')}</div>`
    : emptyState(t('recover_empty'), 'trash')
}

function recoverRow(s) {
  const date = new Date(s.epoch * 1000).toLocaleString(lang(), { dateStyle: 'medium', timeStyle: 'short' })
  const meta = [esc(date), s.game ? esc(s.game) : '',
    s.maxViews ? `${s.maxViews.toLocaleString(lang())} ${esc(t('recover_views'))}` : '']
    .filter(Boolean).join(' · ')
  return `<div class="recover-row">
    <div class="recover-info">
      <strong>${esc(s.title || s.login)}</strong>
      <span class="muted small">${meta}</span>
    </div>
    <button class="btn sm" type="button" data-recover data-login="${esc(s.login)}" data-stream="${esc(s.streamID)}" data-epoch="${s.epoch}" data-title="${esc(s.title || '')}">${icon('download', 16)}<span>${esc(t('recover_play'))}</span></button>
  </div>`
}

export function renderChannel(keyword = '') {
  const { login, info, videos } = state.channel
  const tab = state.channelTab ?? 'vods'
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
    const lastStart = info?.lastBroadcast?.startedAt
    const since = offlineFor(last?.publishedAt, last?.lengthSeconds, lastStart)
    const sinceDate = offlineDate(last?.publishedAt, last?.lengthSeconds, lastStart)
    status = `
      <div class="hero-live">
        <div class="hero-badges"><span class="pill off">${esc(t('offline'))}</span>
        ${since ? `<span class="muted">${esc(t('offline_since', { t: since }))} · ${esc(sinceDate)}</span>` : ''}</div>
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
        <button class="btn ghost sm follow-local${isLocallyFollowed(login) ? ' on' : ''}" type="button" data-action="follow-local" data-follow="${esc(login)}" title="${esc(t('follow_local_sub'))}">${followLocalInner(isLocallyFollowed(login))}</button>
      </div>
      ${status}
    </section>
    <div class="segmented channel-tabs" id="channel-tabs">
      ${CHANNEL_TABS.map(([id, k]) => `<button type="button" data-ctab="${id}" class="${tab === id ? 'active' : ''}">${esc(t(k))}</button>`).join('')}
    </div>
    <section class="block" data-cpanel="vods" ${tab === 'vods' ? '' : 'hidden'}>
      <div class="block-head">
        <h2>${icon('film', 18)}<span>${esc(t('vods'))}</span></h2>
        <label class="filter">${icon('search', 16)}<input id="vod-filter" type="search" value="${esc(keyword)}" placeholder="${esc(t('search'))}…"></label>
      </div>
      ${keyword ? `<p class="muted filter-count">${esc(filtered.length ? t('filter_count', { n: filtered.length, k: keyword }) : t('filter_none', { k: keyword }))}</p>` : ''}
      <div class="grid vods">${filtered.length ? filtered.map((v) => vodCard(v, name)).join('') : (keyword ? '' : emptyState(t('no_vod'), 'film'))}</div>
    </section>
    <section class="block" data-cpanel="recover" ${tab === 'recover' ? '' : 'hidden'}>
      <p class="muted small recover-hint">${esc(t('recover_hint'))}</p>
      <div id="channel-recover"></div>
    </section>
    <section class="block" data-cpanel="highlights" ${tab === 'highlights' ? '' : 'hidden'}>
      <div class="grid vods" id="channel-highlights"></div>
    </section>
    <section class="block" data-cpanel="playlists" id="channel-playlists" ${tab === 'playlists' ? '' : 'hidden'}></section>
    <section class="block" data-cpanel="clips" ${tab === 'clips' ? '' : 'hidden'}>
      <div class="block-head">
        <div class="segmented sm">
          ${[['LAST_DAY', 'period_day'], ['LAST_WEEK', 'period_week'], ['LAST_MONTH', 'period_month'], ['ALL_TIME', 'period_all']]
            .map(([p, k]) => `<button type="button" data-clip-period="${p}" class="${(state.clipPeriod ?? 'LAST_WEEK') === p ? 'active' : ''}">${esc(t(k))}</button>`).join('')}
        </div>
      </div>
      <div class="grid vods" id="channel-clips"></div>
    </section>`
  loadChannelTab(tab)

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
let channelTimer = null
function watchChannelLive() {
  clearInterval(channelTimer)
  const ch = state.channel
  if (!ch?.info?.stream) return
  let ticks = 0
  channelTimer = setInterval(async () => {
    if (state.channel !== ch) return clearInterval(channelTimer)
    if (document.hidden) return
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
