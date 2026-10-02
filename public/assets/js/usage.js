// ═══════════════════════════════════════════════════════════════════════════
//  Comptage d'utilisation du site.
//
//  Même mécanisme que l'app iOS (UsageService.swift) : le navigateur signale
//  « je suis là » au Worker, qui compte les identifiants distincts par jour.
//  Ce qui part : un identifiant tiré au hasard et gardé dans ce navigateur,
//  la version du site, « web ». Pas de compte Twitch, pas de chaîne regardée,
//  pas d'historique ; le Worker ne garde pas les adresses IP.
//
//  Désactivable dans les réglages : l'identifiant est alors effacé côté
//  serveur.
// ═══════════════════════════════════════════════════════════════════════════

import { API_URL } from './api.js'
import { uid } from './util.js'

export const SITE_VERSION = '2026.10.02'
const ID_KEY = 'tu_install_id'
const LAST_KEY = 'tu_last_ping'
/** Un signal par heure au plus : le Worker ne compte qu'une fois par jour,
 *  inutile de lui écrire à chaque rechargement de page. */
const PING_EVERY = 60 * 60 * 1000

function installId() {
  let id = null
  try { id = localStorage.getItem(ID_KEY) } catch {}
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = uid()
    // Repli si randomUUID manque : on garde la forme d'un UUID, seule acceptée.
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })
    }
    try { localStorage.setItem(ID_KEY, id) } catch {}
  }
  return id
}

function post(body) {
  return fetch(`${API_URL}/api/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  })
}

/** Appelé au démarrage et à intervalles réguliers. */
export async function ping(enabled) {
  if (!enabled) return
  let last = 0
  try { last = Number(localStorage.getItem(LAST_KEY)) || 0 } catch {}
  if (Date.now() - last < PING_EVERY) return
  try {
    const res = await post({ id: installId(), version: SITE_VERSION, platform: 'web' })
    if (res.ok) try { localStorage.setItem(LAST_KEY, String(Date.now())) } catch {}
  } catch { /* le comptage ne doit jamais gêner le site */ }
}

/** Refus du comptage : on efface l'identifiant côté serveur. */
export async function forget() {
  try {
    await post({ id: installId(), forget: true })
    localStorage.removeItem(LAST_KEY)
  } catch {}
}

/** Chiffres agrégés. `null` si le Worker n'a pas encore les routes. */
export async function fetchStats() {
  const res = await fetch(`${API_URL}/api/stats`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}
