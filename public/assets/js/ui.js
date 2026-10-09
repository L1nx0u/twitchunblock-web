// ═══════════════════════════════════════════════════════════════════════════
//  Coque : icônes du HTML statique et feuilles modales (réglages, ouvrir
//  dans…). Utilisé par le shell (main.js) et les modules.
// ═══════════════════════════════════════════════════════════════════════════

import { $, icon } from './util.js'

/** Applique le thème (sombre par défaut) + couleur du navigateur. */
export function applyTheme(theme) {
  const light = theme === 'light'
  document.documentElement.dataset.theme = light ? 'light' : 'dark'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = light ? '#f7f7f8' : '#0e0e10'
}

/** Remplit les emplacements d'icônes déclarés dans le HTML. */
export function renderIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, Number(el.dataset.size) || 20))
    el.removeAttribute('data-icon')
  }
}

export function openSheet(html) {
  const sheet = $('#sheet')
  sheet.innerHTML = html
  renderIcons(sheet)
  $('#sheet-backdrop').hidden = false
  sheet.hidden = false
  requestAnimationFrame(() => { sheet.classList.add('open'); $('#sheet-backdrop').classList.add('open') })
}

export function closeSheet() {
  const sheet = $('#sheet')
  sheet.classList.remove('open')
  $('#sheet-backdrop').classList.remove('open')
  setTimeout(() => { sheet.hidden = true; $('#sheet-backdrop').hidden = true }, 200)
}
