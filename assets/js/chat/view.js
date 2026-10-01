// ═══════════════════════════════════════════════════════════════════════════
//  Panneau de chat : affichage, défilement, saisie, emotes, fiche utilisateur.
//
//  Remplace l'iframe de Twitch. Celle-ci ne savait rien faire de ce que fait
//  l'app — emotes BTTV/FFZ/7TV, historique à l'arrivée, chat des VODs — et
//  exigeait que le domaine soit déclaré comme « parent » chez Twitch.
// ═══════════════════════════════════════════════════════════════════════════

import { LiveChat } from './live.js'
import { VodChat } from './vod.js'
import { parseBadgeTag } from './badges.js'
import { emoteCatalog, suggestEmotes } from './emotes.js'
import { plainText, systemMessage } from './message.js'
import { gql } from '../api.js'
import { t } from '../i18n.js'
import { $, debounce, esc, formatClock, icon } from '../util.js'

const MAX_NODES = 300

export class ChatView {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {object} o.prefs          préférences (timestamps, keepDeleted, loadHistory, chatSize)
   * @param {() => {token: string|null, login: string|null, canChat: boolean, needRescope: boolean}} o.session
   * @param {() => void} o.onLogin
   * @param {() => void} [o.onHide]
   */
  constructor(root, o) {
    this.root = root
    this.o = o
    this.client = null
    this.mode = null
    this.messages = []         // gardés pour la fiche utilisateur et les mentions
    this.queue = []
    this.frame = 0
    this.stick = true
    this.pending = 0
    this.replyTo = null
    this.suggestIndex = 0
    this.suggestions = []
    this.build()
  }

  // ── Structure ───────────────────────────────────────────────────────────
  build() {
    this.root.classList.add('chat')
    this.root.innerHTML = `
      <header class="chat-head">
        <span class="chat-title">${icon('chat', 16)}<span class="chat-title-text"></span></span>
        <span class="chat-status"></span>
        <button class="icon-btn sm chat-hide" type="button" data-i18n-title="close">${icon('x', 18)}</button>
      </header>
      <div class="chat-list" role="log" aria-live="off" tabindex="0"></div>
      <button class="chat-resume" type="button" hidden>${icon('arrowDown', 14)}<span></span></button>
      <div class="chat-empty" hidden></div>
      <footer class="chat-composer" hidden>
        <div class="chat-suggest" role="listbox" hidden></div>
        <div class="emote-picker" hidden>
          <div class="emote-picker-head">
            <input class="emote-search" type="search" autocomplete="off" data-i18n-ph="emote_search_ph">
          </div>
          <div class="emote-grid"></div>
        </div>
        <div class="chat-replying" hidden><span></span><button class="icon-btn xs" type="button">${icon('x', 14)}</button></div>
        <div class="chat-input-row">
          <input class="chat-input" type="text" maxlength="500" autocomplete="off" enterkeyhint="send" spellcheck="true">
          <button class="icon-btn sm chat-emote-btn" type="button" data-i18n-title="emotes">${icon('smile', 20)}</button>
          <button class="icon-btn sm chat-send" type="button" aria-label="send">${icon('send', 18)}</button>
        </div>
        <button class="chat-login" type="button" hidden></button>
      </footer>
      <div class="user-card" hidden role="dialog"></div>`

    this.el = {
      title: $('.chat-title-text', this.root),
      status: $('.chat-status', this.root),
      list: $('.chat-list', this.root),
      resume: $('.chat-resume', this.root),
      empty: $('.chat-empty', this.root),
      composer: $('.chat-composer', this.root),
      input: $('.chat-input', this.root),
      send: $('.chat-send', this.root),
      emoteBtn: $('.chat-emote-btn', this.root),
      picker: $('.emote-picker', this.root),
      grid: $('.emote-grid', this.root),
      emoteSearch: $('.emote-search', this.root),
      suggest: $('.chat-suggest', this.root),
      replying: $('.chat-replying', this.root),
      login: $('.chat-login', this.root),
      card: $('.user-card', this.root),
      inputRow: $('.chat-input-row', this.root),
    }

    this.el.list.addEventListener('scroll', () => this.onScroll(), { passive: true })
    this.el.resume.addEventListener('click', () => this.scrollToBottom(true))
    this.el.list.addEventListener('click', (e) => this.onListClick(e))
    $('.chat-hide', this.root).addEventListener('click', () => this.o.onHide?.())

    this.el.input.addEventListener('keydown', (e) => this.onKey(e))
    this.el.input.addEventListener('input', () => this.updateSuggestions())
    this.el.input.addEventListener('blur', () => setTimeout(() => this.hideSuggestions(), 150))
    this.el.send.addEventListener('click', () => this.submit())
    this.el.emoteBtn.addEventListener('click', () => this.togglePicker())
    this.el.emoteSearch.addEventListener('input', debounce(() => this.renderPicker(), 120))
    this.el.grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-emote]')
      if (b) this.insertText(b.dataset.emote)
    })
    this.el.suggest.addEventListener('mousedown', (e) => {
      const b = e.target.closest('[data-i]')
      if (b) { e.preventDefault(); this.applySuggestion(Number(b.dataset.i)) }
    })
    $('button', this.el.replying).addEventListener('click', () => this.setReply(null))
    this.el.login.addEventListener('click', () => this.o.onLogin())
    this.el.card.addEventListener('click', (e) => this.onCardClick(e))
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.hideCard(); this.hidePicker() }
    })

    this.applyPrefs()
  }

  applyPrefs() {
    const p = this.o.prefs
    this.root.style.setProperty('--chat-size', `${p.chatSize}px`)
    this.root.classList.toggle('show-time', Boolean(p.timestamps))
  }

  // ── Ouverture / fermeture ──────────────────────────────────────────────
  openLive({ channel, channelId }) {
    this.close()
    this.mode = 'live'
    this.channel = channel
    this.authFailed = false
    this.el.title.textContent = t('chat')
    this.setStatus('connecting')
    this.refreshComposer()
    const s = this.o.session()
    this.client = new LiveChat({
      channel,
      channelId,
      token: s.canChat ? s.token : null,
      login: s.canChat ? s.login : null,
      loadRecent: this.o.prefs.loadHistory,
      onEvent: (type, payload) => this.onEvent(type, payload),
    })
    this.client.start()
  }

  openVod({ videoId, channelId, channelLogin, startAt }) {
    this.close()
    this.mode = 'vod'
    this.channel = channelLogin
    this.el.title.textContent = t('chat_vod')
    this.el.composer.hidden = true
    this.setStatus('connecting')
    this.client = new VodChat({
      videoId, channelId, channelLogin,
      onEvent: (type, payload) => this.onEvent(type, payload),
    })
    this.client.start(startAt || 0)
  }

  /** Temps de lecture, pour le chat des VODs. */
  tick(seconds) {
    if (this.mode === 'vod') this.client?.tick(seconds)
  }

  close() {
    this.client?.stop()
    this.client = null
    this.mode = null
    cancelAnimationFrame(this.frame)
    this.queue = []
    this.messages = []
    this.el.list.replaceChildren()
    this.el.empty.hidden = true
    this.pending = 0
    this.stick = true
    this.el.resume.hidden = true
    this.setReply(null)
    this.hideCard()
    this.hidePicker()
    this.hideSuggestions()
  }

  /** La session a changé (connexion, déconnexion) : on reconnecte le live. */
  sessionChanged() {
    if (this.mode === 'live' && this.channel) {
      this.openLive({ channel: this.channel, channelId: this.client?.o.channelId ?? null })
    }
  }

  // ── Évènements du client ───────────────────────────────────────────────
  onEvent(type, payload) {
    switch (type) {
      case 'status':
        this.setStatus(payload)
        // Rediffusion : rien ne s'affiche avant le premier message de la
        // vidéo. Sans indication, un panneau vide passe pour une panne.
        if (payload === 'connected' && this.mode === 'vod' && !this.el.list.childElementCount) {
          this.el.empty.textContent = t('chat_vod_empty')
          this.el.empty.hidden = false
        }
        if (payload === 'auth-failed') {
          this.enqueue(systemMessage(t('chat_rescope')))
          this.refreshComposer(true)
        }
        if (payload === 'connected') this.refreshComposer()
        break
      case 'add':
        this.el.empty.hidden = true
        this.enqueue(payload)
        break
      case 'batch':
        this.el.empty.hidden = true
        for (const m of payload) this.enqueue(m)
        break
      case 'prepend':
        this.prepend(payload)
        break
      case 'moderate':
        this.moderate(payload)
        break
      case 'clear':
        this.messages = []
        this.queue = []
        this.el.list.replaceChildren()
        this.stick = true
        this.el.resume.hidden = true
        break
      case 'empty':
        this.el.empty.textContent = t('chat_vod_empty')
        this.el.empty.hidden = false
        break
    }
  }

  setStatus(state) {
    const s = this.el.status
    s.dataset.state = state
    s.textContent = state === 'connecting' ? t('chat_connecting')
      : state === 'disconnected' ? t('chat_disconnected') : ''
  }

  // ── Rendu des messages ─────────────────────────────────────────────────
  /** Les chats très actifs envoient des dizaines de messages par seconde :
   *  on les regroupe par image pour ne recalculer la mise en page qu'une fois. */
  enqueue(msg) {
    this.queue.push(msg)
    if (!this.frame) this.frame = requestAnimationFrame(() => this.flush())
  }

  flush() {
    this.frame = 0
    if (!this.queue.length) return
    const batch = this.queue.splice(0)
    const frag = document.createDocumentFragment()
    for (const m of batch) frag.appendChild(this.renderMessage(m))
    this.messages.push(...batch)
    if (this.messages.length > MAX_NODES * 2) this.messages.splice(0, this.messages.length - MAX_NODES * 2)
    this.el.list.appendChild(frag)

    const extra = this.el.list.childElementCount - MAX_NODES
    // En pause, on ne retire rien : le texte qu'on est en train de lire ne
    // doit pas glisser sous les yeux.
    if (extra > 0 && this.stick) for (let i = 0; i < extra; i++) this.el.list.firstElementChild?.remove()

    if (this.stick) this.scrollToBottom()
    else {
      this.pending += batch.filter((m) => !m.systemMsg).length
      this.showResume()
    }
  }

  prepend(older) {
    const known = new Set(this.messages.map((m) => m.id))
    const fresh = older.filter((m) => !known.has(m.id))
    if (!fresh.length) return
    const frag = document.createDocumentFragment()
    for (const m of fresh) frag.appendChild(this.renderMessage(m))
    const sep = document.createElement('div')
    sep.className = 'msg-sep'
    sep.textContent = t('chat_history')
    frag.appendChild(sep)
    this.el.list.prepend(frag)
    this.messages.unshift(...fresh)
    if (this.stick) this.scrollToBottom()
  }

  renderMessage(m) {
    const div = document.createElement('div')
    if (m.systemMsg) {
      div.className = 'msg sys'
      div.textContent = m.systemMsg
      return div
    }

    const me = this.o.session().login
    const mentionsMe = me && m.tokens.some((tk) => tk.kind === 'mention' && tk.value.toLowerCase() === me)
    div.className = 'msg'
      + (m.isHighlight ? ' hl' : '')
      + (m.isFirstMessage ? ' first' : '')
      + (mentionsMe ? ' me' : '')
      + (m.isHistorical && this.mode === 'live' ? ' old' : '')
      + (m.isDeleted ? ' deleted' : '')
    div.dataset.id = m.id
    div.dataset.user = m.userName

    let html = ''
    if (m.replyTo) {
      html += `<div class="msg-reply">${icon('reply', 12)}<span>${esc(t('reply_to', { u: m.replyTo }))}${m.replyBody ? ` : ${esc(m.replyBody)}` : ''}</span></div>`
    }
    const time = this.mode === 'vod' && m.offset !== null
      ? formatClock(m.offset)
      : new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    html += `<span class="msg-time">${esc(time)}</span>`
    m.badgeList ??= parseBadgeTag(m.badgeTag)
    // Une image en échec garderait sa place, vide, et décalerait le pseudo.
    for (const b of m.badgeList) html += `<img class="badge" src="${esc(b.url)}" alt="" title="${esc(b.set)}" onerror="this.remove()">`
    html += `<button class="msg-name" type="button" style="color:${esc(m.color)}">${esc(m.displayName)}</button>`
    html += m.isAction ? ' ' : '<span class="msg-colon">: </span>'
    html += `<span class="msg-body"${m.isAction ? ` style="color:${esc(m.color)}"` : ''}>${this.renderTokens(m.tokens, me)}</span>`
    div.innerHTML = html
    return div
  }

  renderTokens(tokens, me) {
    return tokens.map((tk) => {
      switch (tk.kind) {
        case 'emote':
          return `<img class="emote" src="${esc(tk.emote.url)}" alt="${esc(tk.emote.name)}" title="${esc(tk.emote.name)}" loading="lazy" decoding="async" onerror="this.replaceWith(this.alt)">`
        case 'mention': {
          const self = me && tk.value.toLowerCase() === me ? ' self' : ''
          return `<span class="mention${self}" data-user="${esc(tk.value.toLowerCase())}">@${esc(tk.value)}</span>`
        }
        case 'link': {
          const href = /^https?:\/\//i.test(tk.value) ? tk.value : `https://${tk.value}`
          return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(tk.value)}</a>`
        }
        default:
          return esc(tk.value)
      }
    }).join(' ')
  }

  moderate({ id, user }) {
    const nodes = id
      ? this.el.list.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)
      : this.el.list.querySelectorAll(`[data-user="${CSS.escape(user)}"]`)
    for (const n of nodes) {
      if (this.o.prefs.keepDeleted) n.classList.add('deleted')
      else n.remove()
    }
    for (const m of this.messages) if (id ? m.id === id : m.userName === user) m.isDeleted = true
  }

  // ── Défilement ─────────────────────────────────────────────────────────
  onScroll() {
    const l = this.el.list
    const atBottom = l.scrollHeight - l.scrollTop - l.clientHeight < 40
    if (atBottom && !this.stick) {
      this.stick = true
      this.pending = 0
      this.el.resume.hidden = true
    } else if (!atBottom && this.stick && !this.autoScrolling) {
      this.stick = false
      this.showResume()
    }
  }

  scrollToBottom(force = false) {
    const l = this.el.list
    this.autoScrolling = true
    l.scrollTop = l.scrollHeight
    requestAnimationFrame(() => { this.autoScrolling = false })
    if (force) {
      this.stick = true
      this.pending = 0
      this.el.resume.hidden = true
    }
  }

  showResume() {
    const span = $('span', this.el.resume)
    span.textContent = this.pending > 0 ? t('chat_new', { n: this.pending > 99 ? '99+' : this.pending }) : t('chat_paused')
    this.el.resume.hidden = false
  }

  // ── Saisie ─────────────────────────────────────────────────────────────
  refreshComposer(rescope = false) {
    if (this.mode !== 'live') { this.el.composer.hidden = true; return }
    this.el.composer.hidden = false
    this.authFailed ||= rescope
    const s = this.o.session()
    // Le champ s'affiche dès que le jeton a les droits, sans attendre la
    // fin de la connexion : sinon « Connecte-toi pour écrire » clignotait
    // à chaque ouverture pour quelqu'un de déjà connecté.
    const writable = s.canChat && !this.authFailed
    this.el.inputRow.hidden = !writable
    this.el.login.hidden = writable
    if (writable) {
      const ready = Boolean(this.client?.canSend)
      this.el.input.placeholder = ready ? t('chat_send_ph') : t('chat_connecting')
      this.el.input.disabled = !ready
      this.el.send.disabled = !ready
    } else {
      this.el.login.textContent = (this.authFailed || s.needRescope) ? t('chat_rescope') : t('chat_readonly')
    }
  }

  submit() {
    const text = this.el.input.value.trim()
    if (!text || !this.client?.send) return
    if (this.client.send(text, this.replyTo?.id)) {
      this.el.input.value = ''
      this.setReply(null)
      this.hideSuggestions()
      this.scrollToBottom(true)
    }
  }

  onKey(e) {
    if (!this.el.suggest.hidden && this.suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = this.suggestions.length
        this.suggestIndex = (this.suggestIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
        this.renderSuggestions()
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && this.suggestIndex >= 0)) {
        e.preventDefault()
        this.applySuggestion(this.suggestIndex)
        return
      }
      if (e.key === 'Escape') { this.hideSuggestions(); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      this.submit()
    }
  }

  /** Mot en cours de frappe, juste avant le curseur. */
  currentWord() {
    const v = this.el.input.value
    const caret = this.el.input.selectionStart ?? v.length
    const start = v.lastIndexOf(' ', caret - 1) + 1
    return { word: v.slice(start, caret), start, end: caret }
  }

  updateSuggestions() {
    const { word } = this.currentWord()
    if (word.startsWith('@') && word.length >= 2) {
      const kw = word.slice(1).toLowerCase()
      const names = new Map()
      for (let i = this.messages.length - 1; i >= 0 && names.size < 40; i--) {
        const m = this.messages[i]
        if (m.userName && !names.has(m.userName)) names.set(m.userName, m)
      }
      for (const n of this.client?.present ?? []) if (!names.has(n)) names.set(n, null)
      this.suggestions = [...names.keys()]
        .filter((n) => n.startsWith(kw))
        .slice(0, 8)
        .map((n) => ({ kind: 'user', value: `@${names.get(n)?.displayName ?? n}`, label: names.get(n)?.displayName ?? n, color: names.get(n)?.color }))
    } else if (word.length >= 2) {
      this.suggestions = suggestEmotes(word, 8).map((e) => ({ kind: 'emote', value: e.name, label: e.name, url: e.url }))
    } else {
      this.suggestions = []
    }
    this.suggestIndex = 0
    this.renderSuggestions()
  }

  renderSuggestions() {
    if (!this.suggestions.length) return this.hideSuggestions()
    this.el.suggest.innerHTML = this.suggestions.map((s, i) => `
      <button type="button" class="suggest-item${i === this.suggestIndex ? ' active' : ''}" data-i="${i}" role="option">
        ${s.kind === 'emote' ? `<img src="${esc(s.url)}" alt="">` : `<span class="dot" style="background:${esc(s.color ?? '#bf94ff')}"></span>`}
        <span>${esc(s.label)}</span>
      </button>`).join('')
    this.el.suggest.hidden = false
  }

  hideSuggestions() {
    this.el.suggest.hidden = true
    this.suggestions = []
  }

  applySuggestion(i) {
    const s = this.suggestions[i]
    if (!s) return
    const { start, end } = this.currentWord()
    const v = this.el.input.value
    const next = `${v.slice(0, start)}${s.value} ${v.slice(end)}`
    this.el.input.value = next
    const caret = start + s.value.length + 1
    this.el.input.setSelectionRange(caret, caret)
    this.el.input.focus()
    this.hideSuggestions()
  }

  insertText(text) {
    const input = this.el.input
    const v = input.value
    const caret = input.selectionStart ?? v.length
    const before = v.slice(0, caret)
    const pad = before && !before.endsWith(' ') ? ' ' : ''
    input.value = `${before}${pad}${text} ${v.slice(caret)}`
    const pos = caret + pad.length + text.length + 1
    input.setSelectionRange(pos, pos)
    input.focus()
  }

  setReply(msg) {
    this.replyTo = msg
    this.el.replying.hidden = !msg
    if (msg) {
      $('span', this.el.replying).textContent = t('reply_to', { u: msg.displayName })
      this.el.input.focus()
    }
  }

  // ── Sélecteur d'emotes ─────────────────────────────────────────────────
  togglePicker() {
    if (this.el.picker.hidden) {
      this.el.picker.hidden = false
      this.el.emoteSearch.value = ''
      this.renderPicker()
    } else this.hidePicker()
  }

  hidePicker() { this.el.picker.hidden = true }

  renderPicker() {
    const kw = this.el.emoteSearch.value.trim().toLowerCase()
    const { channel, global } = emoteCatalog()
    const filter = (list) => (kw ? list.filter((e) => e.name.toLowerCase().includes(kw)) : list)
    const section = (title, list) => list.length ? `
      <div class="emote-section">${esc(title)}</div>
      <div class="emote-cells">${list.slice(0, 400).map((e) =>
        `<button type="button" data-emote="${esc(e.name)}" title="${esc(e.name)}"><img src="${esc(e.url)}" alt="${esc(e.name)}" loading="lazy" decoding="async"></button>`).join('')}</div>` : ''
    this.el.grid.innerHTML = section(t('emotes_channel'), filter(channel)) + section(t('emotes_global'), filter(global))
  }

  // ── Fiche utilisateur ──────────────────────────────────────────────────
  onListClick(e) {
    const mention = e.target.closest('.mention')
    if (mention) return this.showCard(mention.dataset.user, null)
    const row = e.target.closest('.msg:not(.sys)')
    if (!row || e.target.closest('a')) return
    const msg = this.messages.find((m) => m.id === row.dataset.id)
    this.showCard(row.dataset.user, msg)
  }

  async showCard(login, msg) {
    if (!login) return
    const theirs = this.messages.filter((m) => m.userName === login).slice(-25)
    const ref = msg ?? theirs[theirs.length - 1]
    const name = ref?.displayName ?? login
    const color = ref?.color ?? '#bf94ff'
    const canReply = this.mode === 'live' && this.client?.canSend
    const card = this.el.card
    card.dataset.login = login
    card.dataset.msg = msg?.id ?? ''
    card.innerHTML = `
      <div class="user-card-head">
        <img class="avatar" alt="" hidden>
        <div class="user-card-id">
          <strong style="color:${esc(color)}">${esc(name)}</strong>
          <span class="muted">@${esc(login)}</span>
        </div>
        <button class="icon-btn sm" type="button" data-act="close">${icon('x', 18)}</button>
      </div>
      ${canReply ? `<div class="user-card-actions">
        <button class="btn sm" type="button" data-act="mention">@ ${esc(t('mention'))}</button>
        ${msg ? `<button class="btn sm" type="button" data-act="reply">${icon('reply', 14)} ${esc(t('reply'))}</button>` : ''}
      </div>` : ''}
      <div class="user-card-label">${esc(t('user_messages'))}</div>
      <div class="user-card-msgs">${theirs.length
        ? theirs.map((m) => `<div class="uc-msg${m.isDeleted ? ' deleted' : ''}"><span class="msg-time">${esc(this.mode === 'vod' && m.offset !== null ? formatClock(m.offset) : new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span> ${this.renderTokens(m.tokens, null)}</div>`).join('')
        : '<div class="muted">—</div>'}</div>`
    card.hidden = false
    const list = $('.user-card-msgs', card)
    list.scrollTop = list.scrollHeight

    // L'avatar n'est qu'un plus : chargé à part, sans retarder la fiche.
    try {
      const d = await gql('query($l: String!) { user(login: $l) { profileImageURL(width: 70) } }', { l: login })
      const url = d?.user?.profileImageURL
      const img = $('.avatar', card)
      if (url && card.dataset.login === login && img) { img.src = url; img.hidden = false }
    } catch {}
  }

  onCardClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (!act) return
    const card = this.el.card
    if (act === 'close') return this.hideCard()
    if (act === 'mention') {
      const m = this.messages.find((x) => x.userName === card.dataset.login)
      this.insertText(`@${m?.displayName ?? card.dataset.login}`)
      this.hideCard()
    }
    if (act === 'reply') {
      const m = this.messages.find((x) => x.id === card.dataset.msg)
      if (m) this.setReply(m)
      this.hideCard()
    }
  }

  hideCard() { this.el.card.hidden = true }
}

export { plainText }
