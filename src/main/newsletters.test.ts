import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type NewsletterRuleEntry, type Settings } from '../shared/types'
import { Newsletters, type NewsletterMail } from './newsletters'
import type { NewsletterCandidate } from './mail'
import type { NewsletterMark, Store } from './store'

const news = (uid: number, patch: Partial<NewsletterCandidate> = {}): NewsletterCandidate => ({
  uid,
  from: { name: 'Weekly', email: `hello${uid}@weekly.example.com` },
  newsletter: true,
  messageId: `<n${uid}@weekly.example.com>`,
  arrivedAt: '2099-01-01T00:00:00.000Z',
  ...patch
})
const person = (uid: number): NewsletterCandidate => news(uid, { from: { name: 'Anna', email: 'anna@example.com' }, newsletter: false })

/** A fake Inbox per account: UIDs and what each message looks like. */
function setup(opts: { on?: boolean; inbox?: Record<string, NewsletterCandidate[]>; validity?: string; failMove?: boolean } = {}) {
  let settings: Settings = { ...DEFAULT_SETTINGS, newsletters: opts.on ?? true }
  const marks: Record<string, NewsletterMark> = {}
  let moved: string[] = []
  const accounts = [
    { id: 'a', email: 'me@example.com', enabled: true },
    { id: 'b', email: 'work@example.com', enabled: false }
  ] as Account[]
  const inbox: Record<string, NewsletterCandidate[]> = { a: [], b: [], ...opts.inbox }
  const validity = () => opts.validity ?? '1'
  const store = {
    getSettings: () => settings,
    listAccounts: () => accounts,
    newsletterMark: (id: string) => marks[id] ?? null,
    setNewsletterMark: (id: string, m: NewsletterMark | null) => (m ? (marks[id] = m) : delete marks[id]),
    newslettersMoved: () => moved,
    addNewslettersMoved: (ids: string[]) => (moved = [...ids, ...moved]),
    setNewsletterRules: (list: NewsletterRuleEntry[]) => (settings = { ...settings, newsletterRules: list })
  } as unknown as Store
  const mail: NewsletterMail = {
    inboxPath: () => 'INBOX',
    inboxAfter: vi.fn(async (id, mark, max) => {
      const top = Math.max(0, ...inbox[id]!.map((c) => c.uid))
      if (!mark || mark.uidValidity !== validity()) return { uidValidity: validity(), uid: top, items: [] }
      const items = inbox[id]!.filter((c) => c.uid > mark.uid).sort((x, y) => x.uid - y.uid).slice(0, max)
      return { uidValidity: validity(), uid: items.length ? items[items.length - 1]!.uid : mark.uid, items }
    }),
    inboxNewest: vi.fn(async (id) => ({ uidValidity: validity(), items: [...inbox[id]!] })),
    moveToNewsletters: vi.fn(async (id, _path, uids) => {
      if (opts.failMove) throw new Error('offline')
      inbox[id] = inbox[id]!.filter((c) => !uids.includes(c.uid))
      return uids.length
    }),
    moveToInbox: vi.fn(async () => {})
  }
  const changed = vi.fn()
  const n = new Newsletters(store, mail, changed)
  return {
    n,
    mail,
    changed,
    inbox,
    marks,
    moved: () => moved,
    settings: () => settings,
    setSettings: (s: Partial<Settings>) => {
      const before = settings
      settings = { ...settings, ...s }
      n.settingsChanged(before, settings)
    }
  }
}

describe('Newsletters', () => {
  it('moves nothing already in the Inbox when it starts watching', async () => {
    const t = setup({ inbox: { a: [news(1), news(2)] } })
    await t.n.sweep()
    expect(t.mail.moveToNewsletters).not.toHaveBeenCalled()
    expect(t.marks.a).toMatchObject({ uidValidity: '1', uid: 2 })
    expect(t.mail.inboxAfter).toHaveBeenCalledTimes(1) // only enabled accounts
  })

  it('moves new Newsletters and leaves other mail', async () => {
    const t = setup({ inbox: { a: [news(1)] } })
    await t.n.sweep()
    t.inbox.a!.push(news(2), person(3), news(4))
    await t.n.sweep()
    expect(t.mail.moveToNewsletters).toHaveBeenCalledWith('a', 'INBOX', [2, 4], '1')
    expect(t.marks.a!.uid).toBe(4)
    expect(t.moved()).toEqual(['<n2@weekly.example.com>', '<n4@weekly.example.com>'])
    expect(t.changed).toHaveBeenCalledTimes(1)
  })

  it('keeps the mark when the move fails, so it is tried again', async () => {
    const t = setup({ inbox: { a: [] }, failMove: true })
    await t.n.sweep()
    t.inbox.a!.push(news(5))
    await t.n.sweep()
    expect(t.marks.a!.uid).toBe(0)
    expect(t.changed).not.toHaveBeenCalled()
  })

  it('leaves mail WinMail moved before, and mail from before it started watching', async () => {
    const t = setup({ inbox: { a: [] } })
    await t.n.sweep()
    const since = t.marks.a!.since
    t.inbox.a!.push(
      news(6, { messageId: '<back@weekly.example.com>', arrivedAt: new Date(Date.parse(since) + 1000).toISOString() }),
      news(7, { arrivedAt: '2020-01-01T00:00:00.000Z' }),
      news(8, { arrivedAt: new Date(Date.parse(since) + 1000).toISOString() })
    )
    t.moved().push('<back@weekly.example.com>')
    await t.n.sweep()
    expect(t.mail.moveToNewsletters).toHaveBeenCalledWith('a', 'INBOX', [8], '1')
  })

  it('follows sender rules and VIPs', async () => {
    const t = setup({ inbox: { a: [] } })
    t.setSettings({
      newsletterRules: [
        { email: 'hello2@weekly.example.com', rule: 'never' },
        { email: 'anna@example.com', rule: 'always' }
      ],
      vips: [{ name: 'Weekly', email: 'hello4@weekly.example.com' }]
    })
    await t.n.sweep()
    t.inbox.a!.push(news(2), person(3), news(4), news(5))
    await t.n.sweep()
    expect(t.mail.moveToNewsletters).toHaveBeenCalledWith('a', 'INBOX', [3, 5], '1')
  })

  it('starts again after the Inbox is renumbered', async () => {
    const t = setup({ inbox: { a: [news(1)] } })
    await t.n.sweep()
    const t2 = { ...t }
    t2.marks.a = { ...t.marks.a!, uidValidity: 'old' }
    await t.n.sweep()
    expect(t.mail.moveToNewsletters).not.toHaveBeenCalled()
    expect(t.marks.a!.uidValidity).toBe('1')
  })

  it('does nothing while off, and forgets the marks when turned off', async () => {
    const t = setup({ on: false, inbox: { a: [news(1)] } })
    await t.n.sweep()
    expect(t.mail.inboxAfter).not.toHaveBeenCalled()
    t.setSettings({ newsletters: true })
    await vi.waitFor(() => expect(t.marks.a).toBeDefined())
    t.setSettings({ newsletters: false })
    expect(t.marks.a).toBeUndefined()
    expect(t.changed).toHaveBeenCalledTimes(2)
  })

  it('runs one sweep per account at a time and goes round again when asked meanwhile', async () => {
    const t = setup({ inbox: { a: [] } })
    await t.n.sweep()
    t.inbox.a!.push(news(2))
    const first = t.n.sweep('a')
    t.inbox.a!.push(news(3))
    const second = t.n.sweep('a')
    await Promise.all([first, second])
    expect(t.mail.moveToNewsletters).toHaveBeenNthCalledWith(1, 'a', 'INBOX', [2], '1')
    expect(t.mail.moveToNewsletters).toHaveBeenNthCalledWith(2, 'a', 'INBOX', [3], '1')
    expect(t.changed).toHaveBeenCalledTimes(1)
  })

  it('counts and moves what is already in the Inbox', async () => {
    const t = setup({ inbox: { a: [news(1), person(2), news(3)] } })
    expect(await t.n.countInbox()).toBe(2)
    expect(await t.n.moveInbox()).toBe(2)
    expect(t.mail.moveToNewsletters).toHaveBeenCalledWith('a', 'INBOX', [1, 3], '1')
    expect(t.changed).toHaveBeenCalledTimes(1)
  })

  it('moves a message with a sender rule', async () => {
    const t = setup()
    await t.n.setRule({ name: 'Weekly', email: 'Hello@weekly.example.com' }, 'never', { accountId: 'a', mailbox: 'Newsletters', uid: 9 })
    expect(t.mail.moveToInbox).toHaveBeenCalledWith('a', 'Newsletters', [9], undefined)
    expect(t.settings().newsletterRules).toEqual([{ email: 'hello@weekly.example.com', name: 'Weekly', rule: 'never' }])
    await t.n.setRule({ name: 'Anna', email: 'anna@example.com' }, 'always', { accountId: 'a', mailbox: 'INBOX', uid: 4 })
    expect(t.mail.moveToNewsletters).toHaveBeenCalledWith('a', 'INBOX', [4], undefined)
    await t.n.setRule({ name: 'Anna', email: 'anna@example.com' }, null)
    expect(t.settings().newsletterRules).toHaveLength(1)
  })

  it('tells the notifier which mail is about to move', () => {
    const t = setup()
    expect(t.n.willMove({ from: { name: '', email: 'x@news.example.com' }, newsletter: true })).toBe(true)
    expect(t.n.willMove({ from: { name: '', email: 'me@example.com' }, newsletter: true })).toBe(false)
    t.setSettings({ newsletters: false })
    expect(t.n.willMove({ from: { name: '', email: 'x@news.example.com' }, newsletter: true })).toBe(false)
  })
})
