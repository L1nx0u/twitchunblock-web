// ═══════════════════════════════════════════════════════════════════════════
//  Cartes (lives, VODs, clips) et petits rendus partagés, plus les aides de
//  date (« hors ligne depuis… ») utilisées par l'accueil et la page streamer.
//  Aucune dépendance interne : tous les modules y puisent.
// ═══════════════════════════════════════════════════════════════════════════

import { state } from './state.js'
import { store } from './store.js'
import { lang, t } from './i18n.js'
import {
  esc, formatClock, formatDuration, formatViewers, icon, thumb, uptimeSince,
} from './util.js'

// Bouton « Suivre » sans compte (page d'une chaîne).
export function followLocalInner(on) {
  return `${icon('heart', 15)}<span>${esc(t(on ? 'following' : 'follow'))}</span><small class="muted">· ${esc(t('on_this_device'))}</small>`
}

export function streamCard(s) {
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

export function vodCard(v, streamer) {
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
        <img src="${esc(v.previewThumbnailURL)}" alt="" loading="lazy" decoding="async"
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

export function clipCard(c) {
  const date = new Date(c.createdAt)
  const dateStr = Number.isFinite(date.getTime()) ? date.toLocaleDateString(lang(), { day: 'numeric', month: 'short' }) : ''
  return `
    <article class="card vod-card" data-clip="${esc(c.slug)}" tabindex="0">
      <div class="thumb">
        <img src="${esc(c.thumbnailURL)}" alt="" loading="lazy" decoding="async">
        <span class="pill duration">${esc(formatClock(c.durationSeconds ?? 0))}</span>
        <span class="pill views">${icon('eye', 12)} ${esc(formatViewers(c.viewCount ?? 0))}</span>
      </div>
      <div class="card-body">
        <div class="card-text">
          <h3 title="${esc(c.title)}">${esc(c.title)}</h3>
          <p class="meta">${esc([dateStr, c.curator?.displayName ? t('clipped_by', { u: c.curator.displayName }) : ''].filter(Boolean).join(' · '))}</p>
        </div>
      </div>
    </article>`
}

export function skeleton(n, kind = 'stream') {
  return Array.from({ length: n }, () => `<div class="card skeleton ${kind}"><div class="thumb"></div><div class="card-body"><span></span><span></span></div></div>`).join('')
}

export function emptyState(text, iconName = 'radio') {
  return `<div class="empty">${icon(iconName, 28)}<p>${esc(text)}</p></div>`
}

/** Fin du dernier live connu : la VOD la plus récente (début + durée) ou,
 *  si plus tard, le dernier live lancé (un live sans VOD n'en laisse pas). */
export function lastLiveEnd(publishedAt, lengthSeconds, lastStart) {
  const fromVod = Date.parse(publishedAt) + (lengthSeconds || 0) * 1000
  const start = Date.parse(lastStart)
  const end = Math.max(Number.isFinite(fromVod) ? fromVod : 0, Number.isFinite(start) ? start : 0)
  return end || NaN
}

/** « 13 j » en français, « 13d » en anglais : unités de la langue choisie. */
export function offlineFor(publishedAt, lengthSeconds, lastStart) {
  const end = lastLiveEnd(publishedAt, lengthSeconds, lastStart)
  const diff = Date.now() - end
  if (!Number.isFinite(diff) || diff < 0) return ''
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor(diff / 60_000)
  const [n, unit] = d > 0 ? [d, 'day'] : h > 0 ? [h, 'hour'] : [m, 'minute']
  try {
    return new Intl.NumberFormat(lang(), { style: 'unit', unit, unitDisplay: 'narrow' }).format(n)
  } catch {
    return `${n} ${unit[0]}`
  }
}

/** Date du dernier live, courte (« 21 sept. »), avec l'année si ce n'est pas celle-ci. */
export function offlineDate(publishedAt, lengthSeconds, lastStart) {
  const end = new Date(lastLiveEnd(publishedAt, lengthSeconds, lastStart))
  if (!Number.isFinite(end.getTime())) return ''
  const sameYear = end.getFullYear() === new Date().getFullYear()
  return end.toLocaleDateString(lang(), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}
