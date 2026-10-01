// ═══════════════════════════════════════════════════════════════════════════
//  Message épinglé d'une chaîne.
//
//  L'IRC n'annonce pas les épinglages : on interroge GQL, dont la requête
//  est publique — le bandeau s'affiche donc aussi sans connexion.
// ═══════════════════════════════════════════════════════════════════════════

import { gql } from '../api.js'
import { readableColor, tokenizeSegment } from './message.js'
import { twitchEmote } from './emotes.js'

const QUERY = `query($l: String!) {
  channel(name: $l) {
    pinnedChatMessages(first: 1) {
      edges { node {
        id startsAt endsAt
        pinnedBy { displayName }
        pinnedMessage {
          id
          content { text fragments { text content { __typename ... on Emote { id } } } }
          sender { login displayName chatColor }
        }
      } }
    }
  }
}`

/** Le message épinglé en cours, ou `null`. */
export async function fetchPinned(login) {
  const data = await gql(QUERY, { l: login })
  const node = data?.channel?.pinnedChatMessages?.edges?.[0]?.node
  const msg = node?.pinnedMessage
  if (!node || !msg) return null
  // Un épinglage peut avoir une durée : passé son terme, il n'a plus lieu d'être.
  if (node.endsAt && Date.parse(node.endsAt) < Date.now()) return null

  const tokens = []
  for (const f of msg.content?.fragments ?? []) {
    if (f?.content?.__typename === 'Emote' && f.content.id) {
      tokens.push({ kind: 'emote', emote: twitchEmote(f.content.id, String(f.text ?? '').trim()) })
    } else if (f?.text) {
      tokens.push(...tokenizeSegment(String(f.text)))
    }
  }
  if (!tokens.length && msg.content?.text) tokens.push(...tokenizeSegment(msg.content.text))

  const login_ = msg.sender?.login ?? ''
  return {
    id: node.id,
    tokens,
    sender: msg.sender?.displayName || login_,
    login: login_,
    color: readableColor(msg.sender?.chatColor) ?? '#bf94ff',
    pinnedBy: node.pinnedBy?.displayName ?? '',
  }
}
