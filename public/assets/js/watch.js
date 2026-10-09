// ═══════════════════════════════════════════════════════════════════════════
//  Lecteur : ouverture de lives / VODs / clips / VODs reconstruites,
//  temps réel (Hermes, raids), mini-lecteur, bascule entre Workers.
// ═══════════════════════════════════════════════════════════════════════════

import { flushSync, lastSyncAt, login, pushSync } from './main.js'
import { renderRecentChannels, renderChannel } from './streamer.js'
import { renderContinue } from './home.js'
import { refs, session, state } from './state.js'
import * as api from './api.js'
import { store } from './store.js'
import { lang, t } from './i18n.js'
import {
  $, esc, formatClock, formatDuration, formatViewers, icon, toast, uptimeSince,
} from './util.js'
import { Player } from './player.js'
import { ChatView } from './chat/view.js'
import { Hermes } from './chat/hermes.js'
import { stopMulti } from './multi.js'

// ── Lecteur ────────────────────────────────────────────────────────────────
export function setupPlayer() {
  const watch = $('#watch')
  refs.player = new Player($('#player'), {
    fullscreenTarget: $('#watch-body'),
    prefs: store.prefs,
    savePrefs: () => store.savePrefs(),
    onToggleChat: () => toggleChat(),
    onTheatre: () => toggleTheatre(),
    onHelp: () => toast(t('shortcuts_help'), 'info'),
    // Raccourcis actifs : lecteur affiché en grand, aucune feuille ouverte.
    keysActive: () => !$('#watch').hidden && !$('#watch').classList.contains('minimized') && !$('#sheet')?.classList.contains('open'),
    isChatOpen: () => store.prefs.chatOpen,
    onTime: (cur, duration) => onPlaybackTime(cur, duration),
    // Une pause est un bon moment pour sauvegarder — sans dépasser un envoi
    // par minute si l'on enchaîne pause et lecture.
    onPause: () => { if (Date.now() - lastSyncAt > 60_000) flushSync({ force: true }) },
    onError: () => showWatchError(state.watch?.kind === 'live' ? t('err_live') : t('err_vod')),
    onWorkerDown: (base) => switchWorker(base),
  })
  refs.chat = new ChatView($('#chat'), {
    prefs: store.prefs,
    // Retard de l'image à compenser dans le chat, si le réglage est actif.
    getDelay: () => (store.prefs.chatSync ? refs.player.liveDelay() : 0),
    onOpenChannel: (login) => openLive(login),
    onOpenClip: (slug) => openClip(slug),
    onPrefsChange: () => store.savePrefs(),
    session: () => session,
    onLogin: () => login(),
    onHide: () => toggleChat(false),
  })
  applyChatOpen()
  // Playlist lancée avec « Tout lire » : vidéo suivante à la fin.
  refs.player.video.addEventListener('ended', () => playNextInPlaylist())
  // Clic sur la vidéo réduite : on rouvre.
  $('#player').addEventListener('click', (e) => {
    if ($('#watch').classList.contains('minimized')) { e.stopPropagation(); expandWatch() }
  }, true)
}

/**
 * Le Worker qui servait la vidéo ne répond plus (quota du jour atteint) : on
 * redemande les liens — un autre Worker répond — et la lecture reprend au
 * même endroit. Au plus une fois par minute, pour ne pas boucler si tous les
 * Workers tombent : le lecteur retente alors comme avant. `false` = rien fait.
 */
let lastWorkerSwitch = 0
function switchWorker(base) {
  const w = state.watch
  if (w?.kind !== 'live' && w?.kind !== 'vod') return false
  if (Date.now() - lastWorkerSwitch < 60_000 || !api.markWorkerDown(base)) return false
  lastWorkerSwitch = Date.now()
  console.info('[TwitchUnblock] Worker injoignable, passage au secours :', base)
  const request = w.kind === 'live' ? api.getLive(w.login) : api.getVodLinks(w.id)
  request
    .then((links) => {
      if (state.watch !== w || !links?.links || !Object.keys(links.links).length) return
      w.links = links.links
      w.direct = links.direct ?? null
      refs.player.swapLinks(links.links)
    })
    .catch(() => {})
  return true
}

/** Mode théâtre : la vidéo prend toute la hauteur, sans le bandeau d'infos. */
function toggleTheatre(force) {
  store.prefs.theatre = typeof force === 'boolean' ? force : !store.prefs.theatre
  store.savePrefs()
  $('#watch').classList.toggle('theatre', store.prefs.theatre)
}

function toggleChat(force) {
  store.prefs.chatOpen = typeof force === 'boolean' ? force : !store.prefs.chatOpen
  store.savePrefs()
  applyChatOpen()
}

function applyChatOpen() {
  $('#watch').classList.toggle('theatre', Boolean(store.prefs.theatre))
  $('#watch').classList.toggle('chat-hidden', !store.prefs.chatOpen)
  refs.player.setChatOpen(store.prefs.chatOpen)
}

function showWatch(kind, title) {
  const watch = $('#watch')
  watch.hidden = false
  watch.classList.remove('minimized', 'error')
  watch.dataset.kind = kind
  document.documentElement.classList.add('watching')
  $('#watch-loading').hidden = false
  $('#watch-title').textContent = title || ''
  setWatchChannel(kind === 'live' ? state.watch?.login : null)
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

export async function openLive(rawLogin) {
  const login = api.cleanLogin(rawLogin)
  if (!login) return
  stopPlayback()
  state.watch = { kind: 'live', login, info: null, links: null }
  const token = state.watch
  showWatch('live', login)
  setUrl({ channel: login })

  const [links, info] = await Promise.all([
    api.getLive(login).catch((e) => ({ error: e?.status ? 'missing' : 'network' })),
    api.getChannelInfo(login).catch(() => null),
  ])
  if (state.watch !== token) return
  if (!links || links.error || !links.links || !Object.keys(links.links).length) {
    return showWatchError(links?.error === 'network' ? t('err_network') : t('err_live'))
  }
  token.links = links.links
  token.info = info
  token.direct = links.direct ?? null
  $('#watch-loading').hidden = true
  refs.player.load({ links: links.links, kind: 'live' })
  refs.chat.openLive({ channel: login, channelId: info?.id ?? null })
  renderLiveInfo(info, links)
  if (info?.id) startHermes(token, login, info.id)

  store.addHistory(login, 'channel', info?.displayName || login, { avatar: info?.profileImageURL || links.avatar || '' })
  pushSync()
  renderRecentChannels()

  // Spectateurs et titre : rafraîchis toutes les 30 s. Le temps de live,
  // lui, est recalculé chaque seconde à partir de l'heure de début — il
  // restait figé sur sa valeur d'ouverture.
  clearInterval(infoTimer)
  infoTimer = setInterval(async () => {
    if (document.hidden) return   // en arrière-plan, Hermes suffit
    if (state.watch !== token) return clearInterval(infoTimer)
    const fresh = await api.getChannelInfo(login).catch(() => null)
    if (!fresh || state.watch !== token) return
    // Repli si Hermes n'a rien dit : le live a disparu entre deux relectures.
    if (!fresh.stream && token.info?.stream) return liveEnded(token)
    token.info = fresh
    renderLiveInfo(fresh, links)
  }, 30_000)
  clearInterval(uptimeTimer)
  uptimeTimer = setInterval(() => {
    if (state.watch !== token) return clearInterval(uptimeTimer)
    const el = $('#watch-uptime')
    if (el && token.startedAt) el.textContent = uptimeSince(token.startedAt)
  }, 1000)
}

let infoTimer = null
let uptimeTimer = null

// ── Temps réel (Hermes) ──────────────────────────────────────────────────
function startHermes(token, login, channelId) {
  refs.hermes?.stop()
  refs.hermes = new Hermes({
    topics: [`raid.${channelId}`, `video-playback-by-id.${channelId}`, `predictions-channel-v1.${channelId}`, `pinned-chat-updates-v1.${channelId}`],
    onEvent: (topic, data) => {
      if (state.watch !== token) return
      const kind = topic.split('.')[0]
      if (kind === 'video-playback-by-id') {
        if (data.type === 'viewcount' && Number.isFinite(data.viewers) && token.info?.stream) {
          token.info.stream.viewersCount = data.viewers
          renderLiveInfo(token.info, token.links)
        } else if (data.type === 'stream-down') {
          // Laisse au raid éventuel le temps d'arriver avant d'afficher la fin.
          setTimeout(() => { if (state.watch === token) liveEnded(token) }, 4000)
        }
      } else if (kind === 'raid') onRaid(token, data)
      else if (kind === 'predictions-channel-v1') refs.chat.setPrediction(data.data?.event)
      else if (kind === 'pinned-chat-updates-v1') refs.chat.refreshPinned()
    },
  })
}

/** Raid sortant : bandeau dans le chat, puis on suit le streamer chez sa
 *  cible au départ du raid (réglable). */
function onRaid(token, data) {
  const raid = data.raid
  if (!raid?.target_login) return
  const target = api.cleanLogin(raid.target_login)
  if (!target) return
  token.raidTarget = { login: target, name: raid.target_display_name || target }
  const follow = () => { refs.chat.hideRaid(); openLive(target) }
  if (data.type === 'raid_update_v2' || data.type === 'raid_update') {
    refs.chat.showRaid(raid, {
      auto: store.prefs.autoRaid,
      onFollow: follow,
      onCancel: () => { token.raidCancelled = true },
    })
  } else if (data.type === 'raid_go_v2' || data.type === 'raid_go') {
    if (store.prefs.autoRaid && !token.raidCancelled) {
      toast(t('raid_following', { u: token.raidTarget.name }))
      follow()
    } else refs.chat.showRaid(raid, { auto: false, onFollow: follow, onCancel: () => {} })
  } else if (data.type === 'raid_cancel_v2' || data.type === 'raid_cancel') {
    token.raidTarget = null
    refs.chat.hideRaid()
  }
}

/** Fin du live : un écran à la place de l'image figée, avec la suite. */
function liveEnded(token) {
  if (state.watch !== token || token.ended) return
  token.ended = true
  if (token.info) token.info.stream = null
  clearInterval(uptimeTimer)
  const box = $('#watch-ended')
  const raid = token.raidTarget
  box.innerHTML = `
    <span class="ended-ic">${icon('radio', 30)}</span>
    <p class="ended-title">${esc(t('live_ended'))}</p>
    <div class="ended-actions">
      ${raid ? `<button class="btn primary" type="button" data-ended-raid>${icon('play', 16)}<span>${esc(t('watch_target', { u: raid.name }))}</span></button>` : ''}
      <button class="btn" type="button" data-action="see-vods">${icon('film', 16)}<span>${esc(t('see_vods'))}</span></button>
    </div>`
  const btn = $('[data-ended-raid]', box)
  if (btn) btn.onclick = () => openLive(raid.login)
  $('#watch').classList.add('ended')
  refs.player.video?.pause()
  $('#watch-sub').innerHTML = `<span class="pill sm">${esc(t('offline'))}</span>`
}

function renderLiveInfo(info, links) {
  const name = info?.displayName || state.watch?.login
  const avatar = info?.profileImageURL || links?.avatar
  const s = info?.stream
  const title = s?.title || links?.title || ''
  const game = s?.game?.displayName || links?.game || ''
  if (state.watch && s?.createdAt) state.watch.startedAt = s.createdAt
  $('#watch-title').textContent = name
  setWatchChannel(state.watch?.login)
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

// ── Clips ────────────────────────────────────────────────────────────────
export async function openClip(slug) {
  stopPlayback()
  state.watch = { kind: 'clip', id: slug, info: null, links: null, offset: null }
  const token = state.watch
  showWatch('vod', t('clip'))
  setUrl({ clip: slug })
  const clip = await api.getClip(slug).catch(() => null)
  if (state.watch !== token) return
  if (!clip || !Object.keys(clip.links).length) return showWatchError(t('err_clip'))
  token.links = clip.links
  token.info = clip
  token.login = clip.broadcaster?.login ?? null
  $('#watch-loading').hidden = true
  refs.player.load({ links: clip.links, kind: 'vod', startAt: 0 })
  // Chat de la VOD d'origine, si elle existe encore.
  if (clip.video?.id && Number.isFinite(clip.videoOffsetSeconds)) {
    token.offset = clip.videoOffsetSeconds
    refs.chat.openVod({ videoId: clip.video.id, channelId: clip.broadcaster?.id ?? null, channelLogin: token.login, startAt: token.offset })
  }
  const name = clip.broadcaster?.displayName || token.login || ''
  $('#watch-title').textContent = name
  setWatchChannel(clip.broadcaster?.login || token.login)
  $('#mini-title').textContent = clip.title || t('clip')
  setAvatar(clip.broadcaster?.profileImageURL)
  $('#watch-sub').innerHTML = `<span class="pill vod sm">${esc(t('clip'))}</span><span>${icon('eye', 13)} ${esc(formatViewers(clip.viewCount ?? 0))}</span><span>${icon('clock', 13)} ${esc(formatClock(clip.durationSeconds ?? 0))}</span>`
  $('#watch-info').innerHTML = `
    <div class="wi-text">
      <h1 title="${esc(clip.title ?? '')}">${esc(clip.title ?? '')}</h1>
      ${clip.game?.displayName ? `<p class="hero-game">${icon('gamepad', 14)} ${esc(clip.game.displayName)}</p>` : ''}
    </div>
    <div class="wi-actions">
      ${token.login ? `<button class="btn ghost sm" type="button" data-action="see-vods">${icon('film', 16)}<span>${esc(t('see_vods'))}</span></button>` : ''}
      ${clip.video?.id ? `<button class="btn ghost sm" type="button" data-vod="${esc(clip.video.id)}">${icon('play', 16)}<span>${esc(t('full_vod'))}</span></button>` : ''}
    </div>`
}

/** « Tout lire » : lance la première vidéo, la suivante démarre à la fin. */
export function playPlaylist(id) {
  const list = state.playlistCache?.get(state.channel?.login)?.find((c) => c.id === id)
  if (!list) return
  state.playlist = { ids: list.videos.map((v) => String(v.id)) }
  openVod(list.videos[0].id)
}

function playNextInPlaylist() {
  const w = state.watch, q = state.playlist
  if (w?.kind !== 'vod' || !q) return
  const next = q.ids[q.ids.indexOf(w.id) + 1]
  if (next) openVod(next, undefined, { keepPlaylist: true })
  else state.playlist = null
}

export async function openVod(id, preset, { keepPlaylist = false } = {}) {
  const vodId = String(id)
  if (!keepPlaylist && !state.playlist?.ids.includes(vodId)) state.playlist = null
  stopPlayback()
  const known = preset ?? state.vodMeta.get(vodId) ?? {}
  state.watch = { kind: 'vod', id: vodId, info: null, links: null }
  const token = state.watch
  showWatch('vod', known.title || `VOD ${vodId}`)
  setUrl({ id: vodId })

  const [links, meta] = await Promise.all([
    api.getVodLinks(vodId).catch((e) => ({ error: e?.status ? 'missing' : 'network' })),
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
  refs.player.load({ links: links.links, kind: 'vod', startAt })
  api.getVodChapters(vodId).then((ch) => { if (state.watch === token) refs.player.setChapters(ch) }).catch(() => {})
  refs.chat.openVod({ videoId: vodId, channelId: meta?.owner?.id ?? null, channelLogin: meta?.owner?.login ?? null, startAt })
  if (startAt) toast(t('resume_at', { t: formatClock(startAt) }))

  const title = meta?.title || known.title || `VOD ${vodId}`
  const streamer = meta?.owner?.displayName || known.streamer || ''
  const thumbUrl = meta?.previewThumbnailURL || known.thumb || ''
  store.addHistory(vodId, 'vod', title, { thumb: thumbUrl, streamer })
  pushSync()

  $('#watch-title').textContent = streamer || title
  setWatchChannel(meta?.owner?.login)
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

// ── VOD reconstruite (onglet « Supprimées ») ─────────────────────────────
export async function recoverAndPlay(btn) {
  const { login, stream, epoch, title } = btn.dataset
  const label = btn.querySelector('span')
  const prev = label ? label.textContent : ''
  btn.disabled = true
  if (label) label.textContent = t('recover_resolving')
  try {
    const r = await api.resolveRecovery(login, stream, Number(epoch))
    if (!r?.links || !Object.keys(r.links).length) throw new Error('none')
    stopPlayback()
    state.watch = { kind: 'vod', id: `recovered-${stream}`, info: null, links: r.links, recovered: true }
    const tok = state.watch
    showWatch('vod', title || login)
    setUrl({})   // une VOD reconstruite n'a pas d'URL partageable
    if (state.watch !== tok) return
    $('#watch-loading').hidden = true
    refs.player.load({ links: r.links, kind: 'vod', startAt: 0 })
    $('#watch-title').textContent = title || login
    $('#mini-title').textContent = title || login
    setWatchChannel(login)
  } catch (e) {
    toast(t('recover_failed'), 'error')
  } finally {
    btn.disabled = false
    if (label) label.textContent = prev
  }
}

function setAvatar(url) {
  const img = $('#watch-avatar')
  if (url) { img.src = url; img.hidden = false } else img.hidden = true
}

let lastSave = 0
function onPlaybackTime(cur, duration) {
  const w = state.watch
  // Clip : le chat de la VOD d'origine suit, décalé de la position du clip.
  if (w?.kind === 'clip') { if (w.offset != null) refs.chat.tick(w.offset + cur); return }
  if (!w || w.kind !== 'vod') return
  refs.chat.tick(cur)
  if (cur > 0 && Math.abs(cur - lastSave) > 5) {
    lastSave = cur
    store.setProgress(w.id, cur)
    if (Number.isFinite(duration) && duration > 0) store.setLength(w.id, duration)
    pushSync()
  }
}

export function stopPlayback() {
  stopMulti()
  refs.hermes?.stop()
  refs.hermes = null
  $('#watch')?.classList.remove('ended')
  clearInterval(infoTimer)
  clearInterval(uptimeTimer)
  refs.player.destroy()
  refs.chat.close()
  lastSave = 0
}

/** Pseudo et avatar du lecteur cliquables : ouvrent la page de la chaîne. */
function setWatchChannel(login) {
  for (const el of [$('#watch-title'), $('#watch-avatar')]) {
    if (!el) continue
    if (login) { el.dataset.channel = String(login).toLowerCase(); el.classList.add('linkish') }
    else { delete el.dataset.channel; el.classList.remove('linkish') }
  }
}

export function minimizeWatch() {
  const watch = $('#watch')
  if (watch.hidden) return
  if (refs.player.isFullscreen) document.exitFullscreen?.().catch(() => {})
  watch.classList.add('minimized')
  document.documentElement.classList.remove('watching')
}

export function expandWatch() {
  $('#watch').classList.remove('minimized')
  document.documentElement.classList.add('watching')
}

export function closeWatch() {
  const watch = $('#watch')
  if (refs.player.isFullscreen) document.exitFullscreen?.().catch(() => {})
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
