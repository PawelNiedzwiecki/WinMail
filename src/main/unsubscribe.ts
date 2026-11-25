import { net } from 'electron'
import type { AuditResult, ListMessage, MailingList, MoveTarget, SendInput, UnsubscribeResult } from '../shared/types'
import { AUDIT_DAYS, listKey, parseMailto, rankLists } from '../shared/unsubscribe'
import type { Store } from './store'

/** RFC 8058 one-click unsubscribe: a POST to the https link the sender gave. */
export async function oneClick(url: string): Promise<void> {
  if (!/^https:\/\//i.test(url)) throw new Error('Only secure unsubscribe links are supported.')
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click'
  })
  if (!res.ok) throw new Error(`The sender's server answered ${res.status}. Try the link in the message instead.`)
}

/** What the Unsubscribe audit needs from the mail service. */
export interface AuditMail {
  listMail(accountId: string, since: Date): Promise<ListMessage[]>
  send(input: SendInput): Promise<string>
  move(accountId: string, path: string, uids: number[], target: MoveTarget, uidValidity?: string): Promise<unknown>
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Unsubscribe audit. `scan` asks every enabled account's server for its list mail of the last 90 days and ranks the
 * lists; the result stays here, so `unsubscribe` acts on list keys and never on a URL or UID from the window.
 */
export class Unsubscriber {
  private last: { lists: Map<string, MailingList>; messages: Map<string, ListMessage[]> } | null = null

  constructor(
    private store: Store,
    private mail: AuditMail,
    private post: (url: string) => Promise<void> = oneClick
  ) {}

  async scan(now = new Date()): Promise<AuditResult> {
    const accounts = this.store.listAccounts().filter((a) => a.enabled)
    const since = new Date(now.getTime() - AUDIT_DAYS * 86_400_000)
    const settled = await Promise.allSettled(accounts.map((a) => this.mail.listMail(a.id, since)))
    const messages: ListMessage[] = []
    const errors: AuditResult['errors'] = []
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') messages.push(...s.value)
      else errors.push({ accountId: accounts[i]!.id, error: errMsg(s.reason) })
    })
    if (accounts.length && errors.length === accounts.length) throw new Error(errors[0]!.error)
    const own = this.store.listAccounts().map((a) => a.email)
    const lists = rankLists(messages, own, this.store.unsubscribed())
    const byKey = new Map<string, ListMessage[]>()
    for (const m of messages) byKey.set(listKey(m), [...(byKey.get(listKey(m)) ?? []), m])
    this.last = { lists: new Map(lists.map((l) => [l.key, l])), messages: byKey }
    return { lists, days: AUDIT_DAYS, errors }
  }

  /** Leaves each list in turn; one failing doesn't stop the rest. */
  async unsubscribe(keys: string[], opts: { moveToBin: boolean }, now = new Date()): Promise<UnsubscribeResult[]> {
    const out: UnsubscribeResult[] = []
    for (const key of [...new Set(keys)]) out.push(await this.one(key, opts.moveToBin, now))
    return out
  }

  private async one(key: string, moveToBin: boolean, now: Date): Promise<UnsubscribeResult> {
    const list = this.last?.lists.get(key)
    if (!list) return { key, ok: false, way: null, error: 'This list is no longer in the audit. Look through your mail again.' }
    const u = list.unsubscribe
    try {
      if (list.way === 'one-click' && u?.url) {
        await this.post(u.url)
      } else if (list.way === 'email' && u?.mailto) {
        const m = parseMailto(u.mailto)
        if (!m) throw new Error("The list's unsubscribe address can't be read.")
        await this.mail.send({ accountId: list.accountId, to: m.to, subject: m.subject, text: m.body })
      } else if (list.way === 'web') {
        return { key, ok: false, way: 'web', error: 'This list can only be left on its web page.' }
      } else {
        return { key, ok: false, way: null, error: 'This list offers no way to unsubscribe.' }
      }
    } catch (e) {
      return { key, ok: false, way: list.way, error: errMsg(e) }
    }
    this.store.addUnsubscribed(key, now.toISOString())
    const result: UnsubscribeResult = { key, ok: true, way: list.way }
    if (moveToBin) {
      try {
        result.moved = await this.toBin(this.last?.messages.get(key) ?? [])
      } catch (e) {
        result.error = `Unsubscribed, but its mail could not be moved to the Bin: ${errMsg(e)}`
      }
    }
    return result
  }

  /** Moves a list's scanned messages to the Bin, one folder at a time. */
  private async toBin(messages: ListMessage[]): Promise<number> {
    const groups = new Map<string, { accountId: string; mailbox: string; uidValidity?: string; uids: number[] }>()
    for (const m of messages) {
      const k = `${m.accountId}|${m.mailbox}|${m.uidValidity ?? ''}`
      const g = groups.get(k) ?? { accountId: m.accountId, mailbox: m.mailbox, uidValidity: m.uidValidity, uids: [] }
      g.uids.push(m.uid)
      groups.set(k, g)
    }
    let moved = 0
    for (const g of groups.values()) {
      for (let i = 0; i < g.uids.length; i += 300) {
        const part = g.uids.slice(i, i + 300)
        await this.mail.move(g.accountId, g.mailbox, part, 'trash', g.uidValidity)
        moved += part.length
      }
    }
    return moved
  }
}
