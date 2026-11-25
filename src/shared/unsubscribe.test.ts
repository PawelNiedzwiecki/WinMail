import { describe, expect, it } from 'vitest'
import type { ListMessage } from './types'
import { auditSummary, listIdOf, listKey, parseMailto, parseUnsubscribe, rankLists, unsubscribeWay } from './unsubscribe'

let uid = 0
const msg = (from: string, patch: Partial<ListMessage> = {}): ListMessage => ({
  accountId: 'a',
  mailbox: 'INBOX',
  uid: ++uid,
  from: { name: from.split('@')[0]!, email: from },
  date: '2026-11-20T10:00:00.000Z',
  seen: false,
  messageId: `<m${uid}@x>`,
  unsubscribe: { url: `https://${from.split('@')[1]}/u`, oneClick: true },
  ...patch
})

describe('reading the headers', () => {
  it('takes https links and mailto, one-click only with the post header', () => {
    expect(parseUnsubscribe('<https://x.example/u?a=1>, <mailto:u@x.example?subject=stop>', 'List-Unsubscribe=One-Click')).toEqual({
      url: 'https://x.example/u?a=1',
      mailto: 'mailto:u@x.example?subject=stop',
      oneClick: true
    })
    expect(parseUnsubscribe('<https://x.example/u>')).toEqual({ url: 'https://x.example/u', mailto: undefined, oneClick: false })
    expect(parseUnsubscribe('<http://x.example/u>')).toBeNull()
    expect(parseUnsubscribe('')).toBeNull()
    expect(parseUnsubscribe(null)).toBeNull()
  })

  it('picks the way out', () => {
    expect(unsubscribeWay({ url: 'https://x', oneClick: true })).toBe('one-click')
    expect(unsubscribeWay({ url: 'https://x', mailto: 'mailto:a@b', oneClick: false })).toBe('email')
    expect(unsubscribeWay({ url: 'https://x', oneClick: false })).toBe('web')
    expect(unsubscribeWay(null)).toBeNull()
  })

  it('reads List-Id and keys lists', () => {
    expect(listIdOf('Weekly News <Weekly.Example.com>')).toBe('weekly.example.com')
    expect(listIdOf('plain.example.com')).toBe('plain.example.com')
    expect(listIdOf(undefined)).toBeUndefined()
    expect(listKey({ listId: 'weekly.example.com', from: { name: '', email: 'A@x' } })).toBe('list:weekly.example.com')
    expect(listKey({ from: { name: '', email: 'News@X.example' } })).toBe('from:news@x.example')
  })

  it('reads mailto links', () => {
    expect(parseMailto('mailto:leave@list.example?subject=Unsubscribe%20me&body=please+remove')).toEqual({
      to: 'leave@list.example',
      subject: 'Unsubscribe me',
      body: 'please remove'
    })
    expect(parseMailto('mailto:leave@list.example')).toEqual({ to: 'leave@list.example', subject: 'unsubscribe', body: 'unsubscribe' })
    expect(parseMailto('mailto:?subject=x')).toBeNull()
    expect(parseMailto('mailto:a@b.example,c@d.example')).toBeNull()
    expect(parseMailto('https://x.example')).toBeNull()
  })
})

describe('rankLists', () => {
  it('groups by List-Id, else sender, and ranks least opened first', () => {
    const lists = rankLists(
      [
        msg('news@weekly.example', { listId: 'weekly' }),
        msg('editor@weekly.example', { listId: 'weekly', date: '2026-11-22T10:00:00.000Z', from: { name: 'Weekly', email: 'editor@weekly.example' } }),
        msg('deals@shop.example'),
        msg('deals@shop.example', { seen: true }),
        msg('hi@one.example'),
        msg('read@club.example', { seen: true })
      ],
      []
    )
    expect(lists.map((l) => [l.key, l.opened, l.total])).toEqual([
      ['list:weekly', 0, 2],
      ['from:hi@one.example', 0, 1],
      ['from:deals@shop.example', 1, 2],
      ['from:read@club.example', 1, 1]
    ])
    expect(lists[0]).toMatchObject({ name: 'Weekly', address: 'editor@weekly.example', lastAt: '2026-11-22T10:00:00.000Z', way: 'one-click' })
  })

  it('leaves out own mail and counts a message in two folders once', () => {
    const dup = msg('news@weekly.example')
    const lists = rankLists([dup, { ...dup, mailbox: '[Gmail]/All Mail', uid: 999 }, msg('me@home.example')], ['Me@Home.example'])
    expect(lists).toHaveLength(1)
    expect(lists[0]!.total).toBe(1)
  })

  it('takes the way out from the newest message that offers one', () => {
    const lists = rankLists(
      [
        msg('a@list.example', { date: '2026-11-23T00:00:00.000Z', unsubscribe: null }),
        msg('a@list.example', { date: '2026-11-01T00:00:00.000Z', accountId: 'b', unsubscribe: { mailto: 'mailto:x@list.example', oneClick: false } })
      ],
      []
    )
    expect(lists[0]).toMatchObject({ way: 'email', accountId: 'b', accountIds: ['a', 'b'] })
  })

  it('marks unsubscribed lists and those still sending a week later', () => {
    const at = '2026-11-01T00:00:00.000Z'
    const lists = rankLists(
      [
        msg('quiet@x.example', { date: '2026-11-03T00:00:00.000Z' }),
        msg('loud@y.example', { date: '2026-11-20T00:00:00.000Z' })
      ],
      [],
      { 'from:quiet@x.example': at, 'from:loud@y.example': at }
    )
    expect(lists.find((l) => l.key === 'from:quiet@x.example')).toMatchObject({ unsubscribedAt: at, stillSending: false })
    expect(lists.find((l) => l.key === 'from:loud@y.example')).toMatchObject({ unsubscribedAt: at, stillSending: true })
  })

  it('puts lists already left last, but not one still sending', () => {
    const at = '2026-11-01T00:00:00.000Z'
    const lists = rankLists(
      [
        msg('quiet@x.example', { date: '2026-11-03T00:00:00.000Z' }),
        msg('loud@y.example', { date: '2026-11-20T00:00:00.000Z' }),
        msg('read@z.example', { seen: true })
      ],
      [],
      { 'from:quiet@x.example': at, 'from:loud@y.example': at }
    )
    expect(lists.map((l) => l.key)).toEqual(['from:loud@y.example', 'from:read@z.example', 'from:quiet@x.example'])
  })

  it('sums up a selection', () => {
    expect(auditSummary([{ total: 48, opened: 0 }, { total: 12, opened: 2 }])).toBe("You've opened 2 of 60 from these 2 lists.")
    expect(auditSummary([{ total: 5, opened: 1 }])).toBe("You've opened 1 of 5 from this list.")
  })
})
