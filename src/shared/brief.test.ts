process.env.TZ = 'Europe/London'

import { describe, expect, it } from 'vitest'
import {
  briefHeading,
  briefPrompt,
  fromPerson,
  isOwnMessageId,
  makeBrief,
  morningNotice,
  needsYou,
  sinceText,
  stillWaiting,
  type BriefContext
} from './brief'
import type { DeliveredItem, DeliveryRecord, WaitingInfo } from './types'

const ME = 'alex@example.com'
const ctx: BriefContext = { own: [ME, 'Alex@Work.example'], vips: [], waitingIds: [] }

let uid = 0
const item = (from: [string, string], subject: string, patch: Partial<DeliveredItem> = {}): DeliveredItem => ({
  accountId: 'a',
  mailbox: 'INBOX',
  uid: ++uid,
  from: { name: from[0], email: from[1] },
  to: [{ name: 'Someone', email: 'team@example.com' }],
  subject,
  preview: 'Notes from today attached.',
  arrivedAt: new Date(2026, 10, 7, 12, uid).toISOString(),
  flagged: false,
  hasAttachments: false,
  ...patch
})
const jane = (subject = 'Notes', patch: Partial<DeliveredItem> = {}) => item(['Jane Doe', 'jane@example.org'], subject, patch)

const record = (items: DeliveredItem[], patch: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  id: 'r1',
  at: new Date(2026, 10, 7, 13, 0).toISOString(),
  kind: 'scheduled',
  first: false,
  items,
  more: 0,
  ...patch
})

const wait = (id: string, patch: Partial<WaitingInfo> = {}): WaitingInfo => ({
  id,
  accountId: 'a',
  messageId: `<${id}@example.com>`,
  to: 'Priya',
  subject: id,
  sentAt: new Date(2026, 10, 3, 10).toISOString(),
  days: 3,
  dueAt: new Date(2026, 10, 10, 10).toISOString(),
  ...patch
})

describe('fromPerson', () => {
  it('takes people and leaves out lists, robots, bulk mail and other tabs', () => {
    expect(fromPerson(jane())).toBe(true)
    expect(fromPerson(item(['GitHub', 'noreply@github.com'], 'PR'))).toBe(false)
    expect(fromPerson(item(['Shop', 'news@shop.example'], 'Sale'))).toBe(false)
    expect(fromPerson(jane('Weekly', { bulk: true }))).toBe(false)
    expect(fromPerson(jane('Hi', { category: 'promotions' }))).toBe(false)
    expect(fromPerson(jane('Hi', { category: 'social' }))).toBe(false)
    expect(fromPerson(jane('Hi', { automatic: true }))).toBe(false)
    expect(fromPerson(jane('Out of office: Notes'))).toBe(false)
    expect(fromPerson(item(['Billing', 'billing@utility.example'], 'Your bill'))).toBe(false)
  })

  it('keeps a person whose subject only sounds like a notification', () => {
    expect(fromPerson(jane('Re: booking for Friday', { category: 'updates', parents: ['<b@example.org>'] }))).toBe(true)
  })

  it('leaves out a receipt or statement sent straight to the user', () => {
    const statement = item(['Bank', 'statements@bank.example'], 'Your statement', { to: [{ name: 'Alex', email: ME }] })
    expect(fromPerson(statement)).toBe(false)
    expect(fromPerson({ ...statement, category: 'updates' })).toBe(false)
    expect(needsYou(statement, ctx)).toBeNull()
  })
})

describe('isOwnMessageId', () => {
  it('matches the Message-IDs WinMail gives sent mail at the user’s own domains', () => {
    expect(isOwnMessageId('<winmail.1b4e28ba-2fa1-41d2-883f-0016d3cca427@example.com>', [ME])).toBe(true)
    expect(isOwnMessageId('<winmail.1b4e28ba-2fa1-41d2-883f-0016d3cca427@WORK.example>', ctx.own)).toBe(true)
    expect(isOwnMessageId('<winmail.1b4e28ba-2fa1-41d2-883f-0016d3cca427@other.example>', [ME])).toBe(false)
  })

  it('does not take another mail app’s bare UUID at the same domain for the user’s', () => {
    // Apple Mail and Thunderbird give IDs like these to anyone's mail at a shared domain.
    expect(isOwnMessageId('<1b4e28ba-2fa1-41d2-883f-0016d3cca427@example.com>', [ME])).toBe(false)
    expect(isOwnMessageId('<1B4E28BA-2FA1-41D2-883F-0016D3CCA427@example.com>', [ME])).toBe(false)
    expect(isOwnMessageId('<CAF=abc123@mail.gmail.com>', [ME])).toBe(false)
  })
})

describe('needsYou', () => {
  it('needs a person and a reason', () => {
    expect(needsYou(jane(), ctx)).toBeNull()
    expect(needsYou(item(['Shop', 'news@shop.example'], 'Can you believe these prices?'), ctx)).toBeNull()
  })

  it('gives each reason, strongest first', () => {
    const vips = { ...ctx, vips: [{ name: 'Jane', email: 'JANE@example.org' }] }
    expect(needsYou(jane('Lunch?', { hasInvite: true }), vips)).toBe('vip')
    expect(needsYou(jane('Invitation: review', { hasInvite: true, preview: 'Can you come?' }), ctx)).toBe('invite')
    expect(needsYou(jane('Re: Quote', { parents: ['<q@example.com>'], preview: 'Any thoughts?' }), { ...ctx, waitingIds: ['<q@example.com>'] })).toBe('replied')
    expect(needsYou(jane('Re: Quote', { parents: ['<winmail.1b4e28ba-2fa1-41d2-883f-0016d3cca427@example.com>'] }), ctx)).toBe('replied')
    expect(needsYou(jane('Dinner', { preview: 'Are you free on Thursday?' }), ctx)).toBe('question')
    expect(needsYou(jane('Dinner', { preview: 'Let me know by Friday.' }), ctx)).toBe('question')
    expect(needsYou(jane('Notes', { flagged: true }), ctx)).toBe('flagged')
    expect(needsYou(jane('Notes', { to: [{ name: 'Alex', email: 'alex@work.example' }] }), ctx)).toBe('to-you')
  })

  it('does not count a question in the quoted part', () => {
    expect(needsYou(jane('Re: Plan', { preview: 'Sounds good.\n> Shall we go?' }), ctx)).toBeNull()
  })

  it('never lists the user’s own mail', () => {
    expect(needsYou(item(['Alex', ME], 'Note to self', { preview: 'Did I pay?' }), ctx)).toBeNull()
  })
})

describe('makeBrief', () => {
  const items = [
    jane('Dinner', { preview: 'Are you free on Thursday?' }),
    item(['Sam', 'sam@example.org'], 'Photos'),
    item(['Sam', 'sam@example.org'], 'More photos'),
    item(['Lena', 'lena@example.org'], 'Notes'),
    item(['Shop', 'news@shop.example'], 'Sale', { category: 'promotions' }),
    item(['Bank', 'alerts@bank.example'], 'Statement', { category: 'updates' }),
    item(['GitHub', 'noreply@github.com'], 'PR', { category: 'updates' }),
    item(['Club', 'club@groups.example'], 'Meeting', { category: 'forums', bulk: true })
  ]

  it('splits Needs you, people and the rest by category', () => {
    const b = makeBrief(record(items), ctx)
    expect(b.count).toBe(8)
    expect(b.needs.map((r) => [r.item.subject, r.reason])).toEqual([['Dinner', 'question']])
    expect(b.people.map((p) => [p.name, p.items.length])).toEqual([
      ['Sam', 2],
      ['Lena', 1]
    ])
    expect(b.kinds.map((k) => k.label)).toEqual(['2 notifications', '1 newsletter or offer', '1 list message'])
    expect(b.kindCount).toBe(4)
    expect(b.morning).toBe(false)
    expect(b.waiting).toEqual([])
    expect(b.overnight).toBeNull()
  })

  it('orders Needs you by reason', () => {
    const b = makeBrief(record([jane('A', { flagged: true }), jane('B', { hasInvite: true })]), ctx)
    expect(b.needs.map((r) => r.reason)).toEqual(['invite', 'flagged'])
  })

  it('counts messages beyond the listed ones', () => {
    expect(makeBrief(record(items.slice(0, 2), { more: 5 }), ctx).count).toBe(7)
  })

  it('adds replies still awaited and the overnight count to the Morning brief', () => {
    const yesterday = record([], { id: 'r0', at: new Date(2026, 10, 6, 17).toISOString() })
    const morning = record(items, { at: new Date(2026, 10, 7, 9).toISOString(), first: true })
    const now = new Date(2026, 10, 7, 9, 1)
    const b = makeBrief(morning, ctx, {
      records: [morning, yesterday],
      waiting: [wait('later'), wait('today', { dueAt: new Date(2026, 10, 7, 16).toISOString() }), wait('nudged', { nudgedAt: new Date(2026, 10, 6, 8).toISOString() })],
      now
    })
    expect(b.morning).toBe(true)
    expect(b.waiting.map((w) => w.id)).toEqual(['nudged', 'today'])
    expect(b.overnight).toEqual({ count: 8, since: yesterday.at })
    expect(sinceText(b.overnight!.since, now)).toBe('17:00 yesterday')
  })

  it('has no overnight line for the very first Delivery', () => {
    expect(makeBrief(record(items, { first: true }), ctx, { records: [] }).overnight).toBeNull()
  })
})

describe('text', () => {
  it('heads a Brief with the time and count', () => {
    const at = new Date(2026, 10, 7, 13).toISOString()
    expect(briefHeading({ at, morning: false, count: 7 })).toBe('13:00 delivery · 7 messages')
    expect(briefHeading({ at: new Date(2026, 10, 7, 9).toISOString(), morning: true, count: 1 })).toBe('Morning brief · 09:00 · 1 message')
  })

  it('says when the overnight mail started', () => {
    const now = new Date(2026, 10, 9, 9)
    expect(sinceText(new Date(2026, 10, 9, 7, 30).toISOString(), now)).toBe('07:30')
    expect(sinceText(new Date(2026, 10, 6, 17).toISOString(), now)).toBe('Friday at 17:00')
  })

  it('words the Morning brief notification', () => {
    const b = makeBrief(record([jane('A', { flagged: true }), jane('B', { hasInvite: true }), jane('C')], { first: true }), ctx, {
      waiting: [wait('n', { nudgedAt: new Date(2026, 10, 6).toISOString() })],
      now: new Date(2026, 10, 7, 9)
    })
    expect(morningNotice(b)).toEqual({ title: 'Morning brief', body: '3 messages, 2 need you\n1 reply still awaited' })
    expect(morningNotice(makeBrief(record([jane('A', { flagged: true })], { first: true }), ctx)).body).toBe('1 message, 1 needs you')
  })

  it('sends only the sender, subject and preview to Claude', () => {
    const text = briefPrompt(
      record([jane('Dinner', { preview: 'Are   you\nfree?', to: [{ name: 'Alex', email: ME }], parents: ['<x@y>'] })], { more: 2 })
    )
    expect(text).toBe('1. From: Jane Doe <jane@example.org>\nSubject: Dinner\nPreview: Are you free?\n\n(and 2 more not listed)')
    expect(text).not.toContain(ME)
  })
})

describe('stillWaiting', () => {
  it('lists nudged ones first, then those due by the end of today', () => {
    const now = new Date(2026, 10, 7, 9)
    const list = stillWaiting(
      [
        wait('tomorrow', { dueAt: new Date(2026, 10, 8, 8).toISOString() }),
        wait('tonight', { dueAt: new Date(2026, 10, 7, 23, 59).toISOString() }),
        wait('nudged', { nudgedAt: new Date(2026, 10, 5).toISOString(), dueAt: new Date(2026, 10, 5).toISOString() })
      ],
      now
    )
    expect(list.map((w) => w.id)).toEqual(['nudged', 'tonight'])
  })
})

describe('groups without a saved category', () => {
  it('sorts them with the categoriser', () => {
    const b = makeBrief(
      record([item(['Contoso Weekly', 'news@contoso.example'], 'This week', { bulk: true }), item(['Bank', 'statements@bank.example'], 'Your statement')]),
      ctx
    )
    expect(b.kinds.map((k) => k.label)).toEqual(['1 notification', '1 newsletter or offer'])
  })
})
