import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import type { Account, ListMessage } from '../shared/types'
import { Unsubscriber, type AuditMail } from './unsubscribe'
import type { Store } from './store'

let uid = 0
const msg = (accountId: string, from: string, patch: Partial<ListMessage> = {}): ListMessage => ({
  accountId,
  mailbox: 'INBOX',
  uid: ++uid,
  uidValidity: '7',
  from: { name: from, email: from },
  date: '2026-11-20T10:00:00.000Z',
  seen: false,
  messageId: `<m${uid}@x>`,
  unsubscribe: { url: 'https://one.example/u', oneClick: true },
  ...patch
})

function setup(mail: Record<string, ListMessage[] | Error>, opts: { postFails?: boolean } = {}) {
  let unsubscribed: Record<string, string> = {}
  const accounts = [
    { id: 'a', email: 'me@a.example', enabled: true },
    { id: 'b', email: 'me@b.example', enabled: true },
    { id: 'c', email: 'me@c.example', enabled: false }
  ] as Account[]
  const store = {
    listAccounts: () => accounts,
    unsubscribed: () => unsubscribed,
    addUnsubscribed: (k: string, at: string) => (unsubscribed = { ...unsubscribed, [k]: at })
  } as unknown as Store
  const audit: AuditMail = {
    listMail: vi.fn(async (id) => {
      const got = mail[id] ?? []
      if (got instanceof Error) throw got
      return got
    }),
    send: vi.fn(async () => '<sent@x>'),
    move: vi.fn(async () => null)
  }
  const post = vi.fn(async (url: string) => {
    if (opts.postFails) throw new Error(`The sender's server answered 500 for ${url}`)
  })
  return { u: new Unsubscriber(store, audit, post), audit, post, unsubscribed: () => unsubscribed }
}

describe('Unsubscriber', () => {
  it('scans enabled accounts and ranks their lists', async () => {
    const t = setup({
      a: [msg('a', 'news@one.example'), msg('a', 'news@one.example', { seen: true }), msg('a', 'me@b.example')],
      b: [msg('b', 'deals@two.example')]
    })
    const r = await t.u.scan(new Date('2026-11-25T00:00:00Z'))
    expect(t.audit.listMail).toHaveBeenCalledTimes(2)
    expect(t.audit.listMail).toHaveBeenCalledWith('a', new Date('2026-08-27T00:00:00Z'))
    expect(r.lists.map((l) => [l.key, l.opened, l.total])).toEqual([
      ['from:deals@two.example', 0, 1],
      ['from:news@one.example', 1, 2]
    ])
    expect(r).toMatchObject({ days: 90, errors: [] })
  })

  it('reports an account it could not look through, and fails only when none could', async () => {
    const t = setup({ a: [msg('a', 'news@one.example')], b: new Error('offline') })
    expect((await t.u.scan()).errors).toEqual([{ accountId: 'b', error: 'offline' }])
    const none = setup({ a: new Error('offline'), b: new Error('offline') })
    await expect(none.u.scan()).rejects.toThrow('offline')
  })

  it('leaves one-click lists with a POST and email lists with an email from the right account', async () => {
    const t = setup({
      a: [msg('a', 'news@one.example')],
      b: [msg('b', 'mail@two.example', { unsubscribe: { mailto: 'mailto:leave@two.example?subject=stop', oneClick: false } })]
    })
    await t.u.scan()
    const now = new Date('2026-11-25T12:00:00Z')
    const r = await t.u.unsubscribe(['from:news@one.example', 'from:mail@two.example'], { moveToBin: false }, now)
    expect(r).toEqual([
      { key: 'from:news@one.example', ok: true, way: 'one-click' },
      { key: 'from:mail@two.example', ok: true, way: 'email' }
    ])
    expect(t.post).toHaveBeenCalledWith('https://one.example/u')
    expect(t.audit.send).toHaveBeenCalledWith({ accountId: 'b', to: 'leave@two.example', subject: 'stop', text: 'unsubscribe' })
    expect(t.unsubscribed()).toEqual({ 'from:news@one.example': now.toISOString(), 'from:mail@two.example': now.toISOString() })
    expect(t.audit.move).not.toHaveBeenCalled()
  })

  it('moves the scanned mail to the Bin when asked', async () => {
    const t = setup({ a: [msg('a', 'news@one.example', { uid: 5 }), msg('a', 'news@one.example', { uid: 6, mailbox: 'Archive' })] })
    await t.u.scan()
    const [r] = await t.u.unsubscribe(['from:news@one.example'], { moveToBin: true })
    expect(r).toMatchObject({ ok: true, moved: 2 })
    expect(t.audit.move).toHaveBeenCalledWith('a', 'INBOX', [5], 'trash', '7')
    expect(t.audit.move).toHaveBeenCalledWith('a', 'Archive', [6], 'trash', '7')
  })

  it("doesn't remember or move a list it failed to leave, and goes on with the rest", async () => {
    const t = setup(
      {
        a: [
          msg('a', 'news@one.example'),
          msg('a', 'web@three.example', { unsubscribe: { url: 'https://three.example/prefs', oneClick: false } }),
          msg('a', 'none@four.example', { unsubscribe: null })
        ]
      },
      { postFails: true }
    )
    await t.u.scan()
    const r = await t.u.unsubscribe(['from:news@one.example', 'from:web@three.example', 'from:none@four.example', 'from:gone@x'], { moveToBin: true })
    expect(r.map((x) => [x.ok, x.way])).toEqual([
      [false, 'one-click'],
      [false, 'web'],
      [false, null],
      [false, null]
    ])
    expect(r[0]!.error).toMatch(/500/)
    expect(t.unsubscribed()).toEqual({})
    expect(t.audit.move).not.toHaveBeenCalled()
  })
})
