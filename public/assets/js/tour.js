// ═══════════════════════════════════════════════════════════════════════════
//  Visite guidée du premier passage, journal des nouveautés, crédits.
//  La navigation entre les étapes repasse par le shell (setTab et suivants).
// ═══════════════════════════════════════════════════════════════════════════

import { refreshTexts, renderAccount, setTab } from './main.js'
import { minimizeWatch } from './watch.js'
import { closeSheet, openSheet } from './ui.js'
import { state } from './state.js'
import { store } from './store.js'
import { LANGS, applyStatic, deviceLang, lang, setLang, t } from './i18n.js'
import { $, esc, icon } from './util.js'
import * as usage from './usage.js'
import { CHANGELOG } from './changelog.js'

// ── Visite guidée du premier passage et nouveautés ─────────────────────
// Première visite : la visite guidée. Ensuite, à chaque nouvelle version du
// site (SITE_VERSION), les nouveautés pas encore vues.
const SEEN_VERSION = 'tu_seen_version'
// Lu au chargement, avant que le site n'écrive quoi que ce soit : une trace
// d'une visite précédente = pas de tutoriel, mais les nouveautés.
const RETURNING = (() => {
  try { return Boolean(localStorage.getItem('tu_prefs') || localStorage.getItem('twitch_token') || localStorage.getItem('twitch_vod_history')) } catch { return true }
})()
export function welcomeOrWhatsNew() {
  // Ouvert sur un lien de lecture partagé : on ne coupe pas la vidéo.
  if (state.watch || !$('#sheet')?.hidden) return
  let seen = null
  const returning = RETURNING
  try {
    seen = localStorage.getItem(SEEN_VERSION)
    localStorage.setItem(SEEN_VERSION, usage.SITE_VERSION)
  } catch { return }
  if (!seen && !returning) return startTour()
  const unseen = seen ? CHANGELOG.filter((e) => e.version > seen) : CHANGELOG.slice(0, 1)
  if (unseen.length) showWhatsNew(unseen)
}

/** Nouveautés : celles pas encore vues (au chargement), ou tout le journal
 *  (Réglages → Journal des modifications). */
export function showWhatsNew(entries, titleKey = 'whats_new') {
  const l = lang()
  openSheet(`
    <div class="sheet-head"><h2>${icon('sparkles', 20)} ${esc(t(titleKey))}</h2><button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
    ${entries.map((e) => `<div class="sheet-section whats-new">
      <h3>${esc(versionDate(e.version))}<small>${esc(e.version)}</small></h3>
      <ul>${(e.items[l] ?? e.items.en).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>`).join('')}
    <div class="sheet-section"><button class="btn primary" type="button" data-sheet-close style="width:100%">${esc(t('got_it'))}</button></div>`)
  $('#sheet').onclick = (e) => { if (e.target.closest('[data-sheet-close]')) closeSheet() }
}

/** « 2026.10.05c » → « 5 octobre 2026 », dans la langue du site. */
export function versionDate(version) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version)
  if (!m) return version
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString(lang(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// ── Visite guidée ────────────────────────────────────────────────────────
// Plutôt que des pages d'explication détachées du site, la visite se pose
// sur les vrais écrans : un voile sombre percé autour de l'élément montré,
// et une bulle qui l'explique. Elle ouvre les onglets d'elle-même et, aux
// étapes « appuie dessus », c'est le vrai bouton qui fait avancer.
const TOUR = [
  { card: 'welcome', tab: 'discover' },
  { sel: '#home-seg', tab: 'discover', icon: 'radio', title: 'tour_home_title', text: 'tour_home_text' },
  { sel: '[data-tab="channel"]', tab: 'discover', icon: 'user', title: 'nav_channel', text: 'tour_channel_tab_text', tap: true },
  { sel: '#channel-form', tab: 'channel', icon: 'search', title: 'tour_channel_title', text: 'tour_channel_text' },
  { sel: '[data-tab="link"]', tab: 'channel', icon: 'link', title: 'nav_link', text: 'tour_link_text', tap: true },
  { sel: '[data-tab="categories"]', tab: 'link', icon: 'layers', title: 'nav_categories', text: 'tour_cat_text', tap: true },
  { sel: '.topbar-actions', tab: 'categories', icon: 'settings', title: 'tour_settings_title', text: 'tour_settings_text' },
  { card: 'player', tab: 'discover' },
]
const TOUR_TIPS = [['play', 'tour_tip_keys'], ['clock', 'tour_tip_seek'], ['chevronDown', 'tour_tip_mini'], ['sparkles', 'tour_tip_app']]
const tour = { step: -1, el: null }

export function startTour() {
  closeSheet()
  if (!$('#watch').hidden) minimizeWatch()
  let root = $('#tour')
  if (!root) {
    root = document.createElement('div')
    root.id = 'tour'
    root.className = 'tour'
    root.innerHTML = '<div class="tour-hole"></div><div class="tour-pop" role="dialog" aria-modal="true"></div>'
    root.addEventListener('click', onTourClick)
    document.body.append(root)
  }
  document.documentElement.classList.add('touring')
  window.addEventListener('resize', placeTour)
  document.addEventListener('keydown', onTourKey, true)
  goTour(0)
}

function endTour() {
  $('#tour')?.remove()
  document.documentElement.classList.remove('touring')
  window.removeEventListener('resize', placeTour)
  document.removeEventListener('keydown', onTourKey, true)
  tour.step = -1
  tour.el = null
  setTab('discover')
}

function goTour(i) {
  if (i < 0) return
  if (i >= TOUR.length) return endTour()
  tour.step = i
  if (state.tab !== TOUR[i].tab) setTab(TOUR[i].tab)
  renderTour()
}

/** Suivant : aux étapes « appuie dessus », c'est le vrai bouton qui agit. */
function nextTour() {
  const s = TOUR[tour.step]
  if (s?.tap && tour.el) tour.el.click()
  goTour(tour.step + 1)
}

/** L'exemplaire affiché d'un élément : les onglets existent en haut
 *  (ordinateur) et dans la barre du bas (téléphone). */
function visibleEl(sel) {
  return [...document.querySelectorAll(sel)].find((el) => el.getClientRects().length > 0) ?? null
}

function renderTour() {
  const s = TOUR[tour.step]
  const pop = $('#tour .tour-pop')
  if (!pop) return
  if (s.card === 'welcome') {
    pop.innerHTML = `
      <div class="tour-badge">${icon('twitch', 34)}</div>
      <h2>${esc(t('tour_welcome_title'))}</h2>
      <p>${esc(t('tour_welcome_text'))}</p>
      <div class="segmented full tour-langs">
        <button type="button" data-tour-lang="auto" class="${store.prefs.lang ? '' : 'active'}">${esc(t('lang_auto'))}</button>
        ${LANGS.map((l) => `<button type="button" data-tour-lang="${l.id}" class="${store.prefs.lang === l.id ? 'active' : ''}">${esc(l.label)}</button>`).join('')}
      </div>
      <button class="btn primary full" type="button" data-tour="next">${esc(t('tour_start'))}</button>
      <button class="link-btn" type="button" data-tour="skip">${esc(t('tour_skip'))}</button>`
  } else if (s.card === 'player') {
    pop.innerHTML = `
      <div class="tour-badge">${icon('play', 34)}</div>
      <h2>${esc(t('tour_player_title'))}</h2>
      <ul class="tour-tips">${TOUR_TIPS.map(([ic, k]) => `<li>${icon(ic, 18)}<span>${esc(t(k))}</span></li>`).join('')}</ul>
      <button class="btn primary full" type="button" data-tour="next">${esc(t('tour_done'))}</button>`
  } else {
    pop.innerHTML = `
      <div class="tour-head"><span class="tour-ic">${icon(s.icon, 16)}</span><strong>${esc(t(s.title))}</strong><small class="muted">${tour.step}/${TOUR.length - 2}</small></div>
      <p>${esc(t(s.text))}</p>
      ${s.tap ? `<p class="tour-tap">${icon('chevronRight', 14)}<span>${esc(t('tour_tap'))}</span></p>` : ''}
      <div class="tour-actions">
        <button class="link-btn" type="button" data-tour="skip">${esc(t('tour_skip'))}</button>
        <button class="icon-btn sm" type="button" data-tour="back" title="${esc(t('back'))}" aria-label="${esc(t('back'))}">${icon('chevronLeft', 18)}</button>
        <button class="btn primary sm" type="button" data-tour="next">${esc(t('next'))}</button>
      </div>`
  }
  pop.classList.toggle('card', Boolean(s.card))
  placeTour()
  pop.querySelector('[data-tour="next"]')?.focus({ preventScroll: true })
}

/** Perce le voile autour de l'élément montré et cale la bulle dessous (ou
 *  dessus, s'il est en bas de l'écran). Refait à chaque redimensionnement. */
function placeTour() {
  const root = $('#tour')
  if (!root || tour.step < 0) return
  const s = TOUR[tour.step]
  const hole = root.querySelector('.tour-hole')
  const pop = root.querySelector('.tour-pop')
  const el = s.sel ? visibleEl(s.sel) : null
  tour.el = el
  root.classList.toggle('tap', Boolean(el && s.tap))
  if (!el) {
    // Carte centrée (accueil, astuces), ou élément introuvable.
    root.classList.add('no-hole')
    Object.assign(hole.style, { top: '50%', left: '50%', width: '0px', height: '0px' })
    pop.style.transition = 'none'
    Object.assign(pop.style, { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' })
    void pop.offsetWidth
    pop.style.transition = ''
    return
  }
  // En quittant une carte centrée, la bulle apparaît à sa place au lieu de
  // glisser depuis le centre (seul le trou s'anime, depuis le centre).
  const fromCard = root.classList.contains('no-hole')
  root.classList.remove('no-hole')
  if (fromCard) pop.style.transition = 'none'
  el.scrollIntoView({ block: 'nearest' })
  const r = el.getBoundingClientRect()
  const pad = 6
  Object.assign(hole.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` })
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const pw = pop.offsetWidth
  const ph = pop.offsetHeight
  const below = r.top + r.height / 2 < vh / 2
  const top = below ? r.bottom + pad + 12 : r.top - pad - 12 - ph
  const left = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), vw - pw - 12)
  Object.assign(pop.style, { top: `${Math.max(12, Math.min(top, vh - ph - 12))}px`, left: `${left}px`, transform: 'none' })
  if (fromCard) { void pop.offsetWidth; pop.style.transition = '' }
}

function onTourClick(e) {
  // Les clics de la visite ne concernent pas le reste du site.
  e.stopPropagation()
  const l = e.target.closest('[data-tour-lang]')?.dataset.tourLang
  if (l) return setTourLang(l)
  const act = e.target.closest('[data-tour]')?.dataset.tour
  if (act === 'skip') return endTour()
  if (act === 'back') return goTour(tour.step - 1)
  if (act === 'next') return nextTour()
  // Clic dans le trou d'une étape « appuie dessus » : le vrai bouton.
  const s = TOUR[tour.step]
  if (!s?.tap || !tour.el || e.target.closest('.tour-pop')) return
  const r = tour.el.getBoundingClientRect()
  if (e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) nextTour()
}

function onTourKey(e) {
  const go = { Escape: endTour, ArrowRight: nextTour, ArrowLeft: () => goTour(tour.step - 1) }[e.key]
  if (!go) return
  e.preventDefault()
  e.stopPropagation()
  go()
}

/** La langue d'abord : toute la visite, et le site derrière, la suivent. */
function setTourLang(l) {
  store.prefs.lang = l === 'auto' ? null : l
  setLang(l === 'auto' ? deviceLang() : l)
  store.savePrefs()
  applyStatic()
  renderAccount()
  refreshTexts()
  renderTour()
}

export function creditsHtml() {
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
