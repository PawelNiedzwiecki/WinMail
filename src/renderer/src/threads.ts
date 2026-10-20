import type { MessageSummary } from '@shared/types'

export interface Thread {
  /** The newest message; its key stands for the whole conversation in the list. */
  latest: MessageSummary
  /** Newest first. */
  members: MessageSummary[]
}

/**
 * Groups messages into conversations: Gmail's thread id where the server gives one, else by
 * Message-ID and In-Reply-To / References within the same account. Order follows the input.
 */
export function groupThreads(list: MessageSummary[]): Thread[] {
  const parent = list.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  const byId = new Map<string, number>()
  list.forEach((m, i) => {
    const ids = [
      m.threadId ? `t|${m.accountId}|${m.threadId}` : null,
      m.messageId ? `m|${m.accountId}|${m.messageId}` : null,
      ...(m.threadId ? [] : (m.parents ?? []).map((p) => `m|${m.accountId}|${p}`))
    ]
    for (const id of ids) {
      if (!id) continue
      const seen = byId.get(id)
      if (seen === undefined) byId.set(id, i)
      else union(seen, i)
    }
  })
  const groups = new Map<number, MessageSummary[]>()
  list.forEach((m, i) => {
    const r = find(i)
    const g = groups.get(r)
    if (g) g.push(m)
    else groups.set(r, [m])
  })
  return [...groups.values()]
    .map((members) => {
      members.sort((a, b) => b.date.localeCompare(a.date))
      return { latest: members[0]!, members }
    })
    .sort((a, b) => b.latest.date.localeCompare(a.latest.date))
}
