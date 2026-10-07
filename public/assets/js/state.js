// ═══════════════════════════════════════════════════════════════════════════
//  État partagé : session Twitch, état de navigation, et références vivantes
//  (lecteur, chat, temps réel). Objets mutés, jamais réassignés : chaque
//  module voit la même réalité sans import circulaire de valeurs.
// ═══════════════════════════════════════════════════════════════════════════

// ── Session Twitch ─────────────────────────────────────────────────────────
export const session = {
  token: null, userId: null, login: null, avatar: null, scopes: [],
  get canChat() { return Boolean(this.token && this.login && this.scopes.includes('chat:edit') && this.scopes.includes('chat:read')) },
  get needRescope() { return Boolean(this.token && !this.canChat) },
}

export const state = {
  tab: 'discover',
  topLang: 'local',       // 'local' (langue choisie) ou 'all'
  loaded: { followed: 0, top: 0 },
  channel: null,          // { login, info, videos }
  watch: null,            // { kind, login?, id?, info, links }
  vodMeta: new Map(),     // id → { title, thumb, streamer }
}

// ── Références vivantes ────────────────────────────────────────────────────
// Assignées par le module du lecteur (setupPlayer), lues partout ailleurs.
export const refs = {
  player: null,
  chat: null,
  hermes: null,
}
