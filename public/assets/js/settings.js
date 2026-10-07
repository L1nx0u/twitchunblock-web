// ═══════════════════════════════════════════════════════════════════════════
//  Feuilles « Ouvrir dans… » et réglages, export / import de sauvegarde,
//  annonce du développeur et statistiques d'utilisation.
// ═══════════════════════════════════════════════════════════════════════════

import { refreshTexts, renderAccount } from './main.js'
import { applyLayout, loadFollowed, loadTop, renderTopLocal } from './home.js'
import { showWhatsNew, startTour, creditsHtml } from './tour.js'
import { refs, session, state } from './state.js'
import { closeSheet, openSheet } from './ui.js'
import * as api from './api.js'
import { store } from './store.js'
import * as usage from './usage.js'
import { LANGS, applyStatic, deviceLang, lang, setLang, t } from './i18n.js'
import { $, esc, formatViewers, icon, isMobile, toast } from './util.js'
import { CHANGELOG } from './changelog.js'
import { deviceTopLang, topLangName, TOP_LANGS } from './home.js'
import { qualityLabel } from './player.js'

function currentStreamUrl() {
  const links = state.watch?.links
  if (!links) return ''
  const link = links[refs.player.quality] ?? Object.values(links)[0] ?? ''
  // Proxy coupé : l'appli externe reçoit l'adresse directe de Twitch.
  return api.EXTERNAL_LINKS_VIA_PROXY ? link : api.directUrl(link)
}

export function openInSheet() {
  const url = currentStreamUrl()
  if (!url) return
  const name = (state.watch?.login || state.watch?.id || 'Twitch').replace(/[^a-zA-Z0-9]/g, '_')
  const apps = isMobile ? `
    <a class="sheet-row" href="vlc://${esc(url)}"><span class="app-dot vlc"></span><span>VLC</span>${icon('chevronRight', 16)}</a>
    <a class="sheet-row" href="outplayer://${esc(url)}"><span class="app-dot outplayer"></span><span>Outplayer</span>${icon('chevronRight', 16)}</a>
    <a class="sheet-row" href="infuse://x-callback-url/play?url=${esc(encodeURIComponent(url.replace('/api/proxy', `/api/proxy/${name}.m3u8`)))}"><span class="app-dot infuse"></span><span>Infuse</span>${icon('chevronRight', 16)}</a>` : ''
  openSheet(`
    <div class="sheet-head"><h2>${esc(t('open_in'))}</h2><button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
    <p class="muted sheet-sub">${esc(t('quality'))} : ${esc(qualityLabel(refs.player.quality ?? ''))}</p>
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

export function openSettings() {
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
      <label class="setting setting-col">
        <span class="setting-text"><span>${esc(t('top_lang'))}</span><small>${esc(t('top_lang_sub', { l: topLangName(deviceTopLang()) }))}</small></span>
        <select class="text-input" id="set-toplang">
          <option value="auto" ${p.topLang ? '' : 'selected'}>${esc(t('lang_auto'))} · ${esc(topLangName(deviceTopLang()))}</option>
          ${TOP_LANGS.map((c) => [c, topLangName(c)]).sort((a, b) => a[1].localeCompare(b[1], lang())).map(([c, n]) => `<option value="${c}" ${p.topLang === c ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
      </label>
      ${toggle('set-homelist', t('home_list'), p.homeList, t('home_list_sub'))}
    </div>
    <div class="sheet-section">
      <h3>${esc(t('player_settings'))}</h3>
      ${toggle('set-clickpause', t('click_pause'), p.clickPause !== false, t('click_pause_sub'))}
    </div>
    <div class="sheet-section">
      <h3>${esc(t('experimental'))}</h3>
      <p class="muted small">${esc(t('experimental_sub'))}</p>
      ${toggle('set-lowlatency', t('low_latency'), p.lowLatency === true, t('low_latency_sub'))}
    </div>
    <div class="sheet-section">
      <h3>${esc(t('chat_settings'))}</h3>
      ${toggle('set-sync', t('chat_sync'), p.chatSync, t('chat_sync_sub'))}
      ${toggle('set-raid', t('auto_raid'), p.autoRaid, t('auto_raid_sub'))}
      ${toggle('set-ts', t('timestamps'), p.timestamps)}
      ${toggle('set-deleted', t('keep_deleted'), p.keepDeleted)}
      ${toggle('set-history', t('load_history'), p.loadHistory)}
      ${toggle('set-bots', t('hide_bots'), p.hideBots, t('hide_bots_sub'))}
      ${toggle('set-cmds', t('hide_commands'), p.hideCommands, t('hide_commands_sub'))}
      <label class="setting setting-col">
        <span class="setting-text"><span>${esc(t('muted_words'))}</span><small>${esc(t('muted_words_sub'))}</small></span>
        <input class="text-input" type="text" id="set-muted" autocomplete="off" spellcheck="false" maxlength="300" value="${esc((p.mutedWords ?? []).join(', '))}">
      </label>
      ${(p.blockedUsers ?? []).length ? `<div class="setting">
        <span class="setting-text"><span>${esc(t('hidden_users', { n: p.blockedUsers.length }))}</span><small>${esc(p.blockedUsers.slice(-6).join(', '))}</small></span>
        <button class="btn sm ghost" type="button" data-action="clear-blocked">${esc(t('clear'))}</button>
      </div>` : ''}
      <label class="setting setting-col">
        <span class="setting-text"><span>${esc(t('highlight_words'))}</span><small>${esc(t('highlight_words_sub'))}</small></span>
        <input class="text-input" type="text" id="set-words" autocomplete="off" spellcheck="false" maxlength="300" value="${esc((p.highlightWords ?? []).join(', '))}">
      </label>
      <label class="setting">
        <span class="setting-text"><span>${esc(t('chat_size'))}</span></span>
        <span class="size-ctl"><input type="range" id="set-size" min="12" max="20" step="1" value="${p.chatSize}"><output>${p.chatSize}</output></span>
      </label>
    </div>
    <div class="sheet-section">
      <h3>${esc(t('backup'))}</h3>
      <p class="muted small">${esc(t('backup_sub'))}</p>
      <div class="sheet-group">
        <button class="sheet-row" type="button" data-action="export-data">${icon('download', 18)}<span>${esc(t('export_data'))}</span></button>
        <button class="sheet-row" type="button" data-action="import-data">${icon('refresh', 18)}<span>${esc(t('import_data'))}</span></button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </div>
    <div class="sheet-section">
      <h3>${esc(t('usage'))}</h3>
      <div class="usage-stats" id="usage-stats"><p class="muted small">${esc(t('loading'))}</p></div>
      <a class="sheet-row" href="/stats" target="_blank" rel="noopener">${icon('trending', 18)}<span>${esc(t('usage_details'))}</span>${icon('external', 16)}</a>
      ${toggle('set-usage', t('share_usage'), p.shareUsage, t('share_usage_sub'))}
    </div>
    <div class="sheet-section">
      <h3>${esc(t('about'))}</h3>
      <p class="muted small">${esc(t('about_text'))}</p>
      <div class="sheet-group">
        <a class="sheet-row" href="${api.GITHUB_URL}" target="_blank" rel="noopener">${icon('github', 18)}<span>${esc(t('source_site'))}</span>${icon('external', 16)}</a>
        <a class="sheet-row" href="${api.APP_GITHUB_URL}" target="_blank" rel="noopener">${icon('github', 18)}<span>${esc(t('source_app'))}</span>${icon('external', 16)}</a>
        <button class="sheet-row" type="button" data-action="whats-new">${icon('sparkles', 18)}<span>${esc(t('changelog'))}</span></button>
        <button class="sheet-row" type="button" data-action="replay-tutorial">${icon('play', 18)}<span>${esc(t('replay_tutorial'))}</span></button>
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
    if (id === 'set-sync') p.chatSync = e.target.checked
    if (id === 'set-raid') p.autoRaid = e.target.checked
    if (id === 'set-deleted') p.keepDeleted = e.target.checked
    if (id === 'set-history') p.loadHistory = e.target.checked
    if (id === 'set-bots') p.hideBots = e.target.checked
    if (id === 'set-cmds') p.hideCommands = e.target.checked
    if (id === 'set-muted') {
      p.mutedWords = e.target.value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean).slice(0, 50)
    }
    if (id === 'set-words') {
      p.highlightWords = e.target.value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean).slice(0, 30)
    }
    if (id === 'import-file') { importData(e.target.files?.[0]); e.target.value = ''; return }
    if (id === 'set-clickpause') p.clickPause = e.target.checked
    if (id === 'set-lowlatency') p.lowLatency = e.target.checked
    if (id === 'set-homelist') { p.homeList = e.target.checked; store.savePrefs(); applyLayout(); return }
    if (id === 'set-toplang') {
      p.topLang = e.target.value === 'auto' ? null : e.target.value
      store.savePrefs()
      renderTopLocal()
      loadTop('local')
      return
    }
    if (id === 'set-usage') {
      p.shareUsage = e.target.checked
      if (p.shareUsage) usage.ping(true)
      else usage.forget()
    }
    store.savePrefs()
    refs.chat.applyPrefs()
  }
  sheet.oninput = (e) => {
    if (e.target.id !== 'set-size') return
    p.chatSize = Number(e.target.value)
    e.target.nextElementSibling.textContent = p.chatSize
    store.savePrefs()
    refs.chat.applyPrefs()
  }
}

// ── Sauvegarde : export / import ───────────────────────────────────────
// Même format que l'app iOS : les suivis passent d'un appareil à l'autre,
// et les réglages communs aux deux portent le même nom.
const BACKUP_FORMAT = 'twitchunblock-backup'
// Réglages exportés : tout sauf ce qui dépend de l'appareil.
const BACKUP_SKIP = new Set(['volume', 'muted', 'chatOpen'])

export function exportData() {
  const p = store.prefs
  const settings = Object.fromEntries(Object.entries(p).filter(([k]) => !BACKUP_SKIP.has(k) && k !== 'localFollows' && k !== 'followedCategories'))
  const data = {
    format: BACKUP_FORMAT,
    version: 1,
    platform: 'web',
    exportedAt: new Date().toISOString(),
    follows: [...(p.localFollows ?? [])],
    accountFollows: [...(state.accountFollows ?? [])],
    followedCategories: [...(p.followedCategories ?? [])],
    settings,
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  a.download = `twitchunblock-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  toast(t('export_done'), 'success')
}

async function importData(file) {
  if (!file) return
  let data
  try {
    if (file.size > 2_000_000) throw new Error('size')
    data = JSON.parse(await file.text())
    if (data?.format !== BACKUP_FORMAT) throw new Error('format')
  } catch {
    return toast(t('import_bad'), 'error')
  }
  const p = store.prefs
  const login = (x) => (typeof x === 'string' && /^[a-zA-Z0-9_]{1,25}$/.test(x) ? x.toLowerCase() : null)
  const incoming = [...(data.follows ?? []), ...(data.accountFollows ?? [])].map(login).filter(Boolean)
  const before = new Set(p.localFollows ?? [])
  p.localFollows = [...new Set([...(p.localFollows ?? []), ...incoming])].slice(0, 300)
  const added = p.localFollows.filter((l) => !before.has(l)).length

  const cats = new Map((p.followedCategories ?? []).map((c) => [c.id, c]))
  for (const c of data.followedCategories ?? []) {
    if (c && typeof c.id === 'string' && typeof c.name === 'string' && !cats.has(c.id)) {
      cats.set(c.id, { id: c.id, name: c.name, box: typeof c.box === 'string' ? c.box : '' })
    }
  }
  p.followedCategories = [...cats.values()].slice(0, 200)

  // Réglages : seulement les clés connues du site, du même type que la
  // valeur actuelle. Une sauvegarde de l'app iOS apporte les réglages
  // communs (langue, filtres du chat…), qu'elle exporte sous ces noms-là.
  if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
    for (const [k, v] of Object.entries(data.settings)) {
      if (BACKUP_SKIP.has(k) || !(k in p) || k === 'localFollows' || k === 'followedCategories') continue
      const cur = p[k]
      if (cur === null || typeof cur === typeof v || (Array.isArray(cur) && Array.isArray(v))) p[k] = v
    }
  }
  store.savePrefs()
  if (p.lang) setLang(p.lang)
  applyStatic()
  applyLayout()
  refs.chat.applyPrefs()
  loadFollowed()
  toast(t('import_done', { n: added }), 'success')
  openSettings()
}

// ── Annonce du développeur ─────────────────────────────────────────────
// Même annonce que dans l'app (publiée depuis /stats), en haut de l'accueil.
// Relue à l'ouverture et au retour sur l'onglet (au plus toutes les 5 min) ;
// une annonce fermée ne revient pas (une nouvelle, si).
const ANN_DISMISSED = 'tu_ann_dismissed'
// Réactions : une par appareil, la même toucher deux fois la retire.
const ANN_REACTIONS = ['👍', '❤️', '🔥', '😂', '👎']
const ANN_REACTED = 'tu_ann_reacted'
function annReactions() { try { return JSON.parse(localStorage.getItem(ANN_REACTED) || '{}') } catch { return {} } }
function annReaction(id) { return annReactions()[id] ?? null }
async function reactToAnnouncement(a, emoji) {
  const all = annReactions()
  const prev = all[a.id] ?? null
  const next = prev === emoji ? null : emoji
  // Affichage immédiat ; on revient en arrière si le serveur refuse.
  const save = (v) => {
    const m = annReactions()
    if (v) m[a.id] = v; else delete m[a.id]
    // Seules les 10 dernières annonces sont gardées.
    try { localStorage.setItem(ANN_REACTED, JSON.stringify(Object.fromEntries(Object.entries(m).slice(-10)))) } catch {}
    renderAnnouncement()
  }
  save(next)
  try {
    const res = await fetch(`${api.API_URL}/api/announcement/react`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ announcementId: a.id, id: usage.installId(), emoji: next }),
    })
    if (!res.ok) throw new Error(String(res.status))
  } catch { save(prev); toast(t('react_failed')) }
}
let annFetchedAt = 0
let annCurrent = null
export async function loadAnnouncement(force = false) {
  if (!force && Date.now() - annFetchedAt < 5 * 60_000) return renderAnnouncement()
  try {
    const res = await fetch(`${api.API_URL}/api/announcement`, { cache: 'no-store' })
    if (!res.ok) return
    annCurrent = (await res.json()).announcement ?? null
    annFetchedAt = Date.now()
  } catch { return }
  renderAnnouncement()
}
export function renderAnnouncement() {
  const box = $('#announcement')
  if (!box) return
  let dismissed = []
  try { dismissed = JSON.parse(localStorage.getItem(ANN_DISMISSED) || '[]') } catch {}
  const a = annCurrent
  if (!a || !(a.until > Date.now()) || dismissed.includes(a.id)) { box.hidden = true; box.innerHTML = ''; return }
  const link = /^https:\/\//i.test(a.link || '') ? a.link : null
  box.innerHTML = `<div class="announce" role="status">
    <span class="announce-ic">${icon('megaphone', 18)}</span>
    <div class="announce-body">
      ${a.title ? `<h3>${esc(a.title)}</h3>` : ''}
      ${a.message ? `<p>${esc(a.message)}</p>` : ''}
      ${link ? `<a class="btn primary sm" href="${esc(link)}" target="_blank" rel="noopener">${esc(t('announcement_open'))} ${icon('external', 14)}</a>` : ''}
      <div class="announce-reacts" role="group" aria-label="${esc(t('react'))}">${ANN_REACTIONS.map((e) => `<button type="button" data-react="${e}" class="${annReaction(a.id) === e ? 'on' : ''}" aria-pressed="${annReaction(a.id) === e}">${e}</button>`).join('')}</div>
    </div>
    <button class="icon-btn" type="button" data-ann-close title="${esc(t('close'))}">${icon('x', 18)}</button>
  </div>`
  box.hidden = false
  box.querySelector('.announce-reacts').onclick = (e) => {
    const b = e.target.closest('[data-react]')
    if (b) reactToAnnouncement(a, b.dataset.react)
  }
  box.querySelector('[data-ann-close]').onclick = () => {
    try { localStorage.setItem(ANN_DISMISSED, JSON.stringify([...dismissed, a.id].slice(-20))) } catch {}
    box.hidden = true
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

export function renderSettingsAccount() {
  const box = $('#settings-account')
  if (!box) return
  const s = session
  box.innerHTML = s.login ? `
    <h3>${esc(t('account'))}</h3>
    <div class="account-row">
      ${s.avatar ? `<img class="avatar" src="${esc(s.avatar)}" alt="">` : `<span class="avatar placeholder">${esc(s.login[0].toUpperCase())}</span>`}
      <div class="account-id"><strong>${esc(s.login)}</strong>
        <small class="muted">${esc(s.canChat ? t('connected_as', { u: s.login }) : t('chat_rescope'))}</small></div>
      ${s.canChat ? '' : `<button class="btn sm primary" type="button" data-action="login-again">${esc(t('login'))}</button>`}
      <button class="btn sm danger" type="button" data-action="logout">${icon('logout', 16)}<span>${esc(t('logout'))}</span></button>
    </div>` : `
    <h3>${esc(t('account'))}</h3>
    <div class="account-row">
      <span class="avatar placeholder">${icon('user', 18)}</span>
      <div class="account-id"><strong>${esc(t('not_connected'))}</strong><small class="muted">${esc(t('login_prompt'))}</small></div>
    </div>
    <button class="btn primary full" type="button" data-action="login">${icon('twitch', 18)}<span>${esc(t('login'))}</span></button>`
}
