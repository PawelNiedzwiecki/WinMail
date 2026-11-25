// Issues are local; pin the zone so the clock-change days are London's (29 March and 25 October 2026).
process.env.TZ = 'Europe/London'

import { describe, expect, it } from 'vitest'
import {
  groupIssues,
  isNewsletter,
  issueOf,
  issueTitle,
  looksLikeNewsletter,
  ruleMap,
  withRule,
  type NewsletterHeaders,
  type NewsletterRule
} from './newsletters'

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)

const NEWS: NewsletterHeaders = {
  from: 'hello@weekly.example.com',
  subject: 'This week in design: 12 links',
  listUnsubscribe: '<https://weekly.example.com/u/abc>, <mailto:u@weekly.example.com>',
  isReply: false,
  automated: false
}

describe('looksLikeNewsletter', () => {
  it('takes subscribed mail', () => {
    expect(looksLikeNewsletter(NEWS)).toBe(true)
    expect(looksLikeNewsletter({ ...NEWS, listPost: 'NO' })).toBe(true)
    expect(looksLikeNewsletter({ ...NEWS, listPost: 'No (posting not allowed)' })).toBe(true)
  })

  it('needs a way to unsubscribe', () => {
    expect(looksLikeNewsletter({ ...NEWS, listUnsubscribe: undefined })).toBe(false)
    expect(looksLikeNewsletter({ ...NEWS, listUnsubscribe: '  ' })).toBe(false)
  })

  it('leaves discussion lists, replies and automatic mail', () => {
    expect(looksLikeNewsletter({ ...NEWS, listPost: '<mailto:team@groups.example.com>' })).toBe(false)
    expect(looksLikeNewsletter({ ...NEWS, isReply: true })).toBe(false)
    expect(looksLikeNewsletter({ ...NEWS, automated: true })).toBe(false)
  })

  it('leaves receipts, codes and social notifications', () => {
    expect(looksLikeNewsletter({ ...NEWS, subject: 'Your receipt from Example' })).toBe(false)
    expect(looksLikeNewsletter({ ...NEWS, subject: 'Security alert: new sign-in' })).toBe(false)
    expect(looksLikeNewsletter({ ...NEWS, subject: 'Your order has shipped' })).toBe(false)
    expect(looksLikeNewsletter({ ...NEWS, from: 'notification@facebookmail.com' })).toBe(false)
    expect(looksLikeNewsletter({ ...NEWS, from: 'messages-noreply@linkedin.com' })).toBe(false)
  })

  it('takes a promotional subject even with a transactional word', () => {
    expect(looksLikeNewsletter({ ...NEWS, subject: 'Free shipping on every order this weekend' })).toBe(true)
  })
})

describe('isNewsletter', () => {
  const rule: NewsletterRule = { rules: {}, vips: ['jane@example.com'], own: ['me@example.com'] }
  const from = (email: string) => ({ name: '', email })

  it('follows the headers by default', () => {
    expect(isNewsletter({ from: from('a@news.example.com'), newsletter: true }, rule)).toBe(true)
    expect(isNewsletter({ from: from('a@news.example.com'), newsletter: false }, rule)).toBe(false)
    expect(isNewsletter({ from: from('a@news.example.com') }, rule)).toBe(false)
  })

  it('never takes VIPs or the user', () => {
    expect(isNewsletter({ from: from('Jane@Example.com'), newsletter: true }, rule)).toBe(false)
    expect(isNewsletter({ from: from('me@example.com'), newsletter: true }, rule)).toBe(false)
  })

  it('lets sender rules win', () => {
    const r = { ...rule, rules: { 'a@news.example.com': 'never' as const, 'jane@example.com': 'always' as const } }
    expect(isNewsletter({ from: from('A@news.example.com'), newsletter: true }, r)).toBe(false)
    expect(isNewsletter({ from: from('jane@example.com'), newsletter: false }, r)).toBe(true)
  })

  it('keeps one rule per sender, newest first', () => {
    let list = withRule([], { name: 'Weekly', email: 'Hello@Weekly.example.com' }, 'always')
    list = withRule(list, { name: '', email: 'b@example.com' }, 'never')
    list = withRule(list, { name: 'Weekly', email: 'hello@weekly.example.com' }, 'never')
    expect(list).toEqual([
      { email: 'hello@weekly.example.com', name: 'Weekly', rule: 'never' },
      { email: 'b@example.com', name: undefined, rule: 'never' }
    ])
    expect(ruleMap(list)).toEqual({ 'hello@weekly.example.com': 'never', 'b@example.com': 'never' })
    expect(withRule(list, { name: '', email: 'b@example.com' }, null)).toHaveLength(1)
  })
})

describe('issues', () => {
  it('makes daily issues from midnight to midnight', () => {
    const i = issueOf(local(2026, 11, 24, 23, 59), 'day')
    expect(i.key).toBe('day:2026-11-24')
    expect(i.start).toEqual(local(2026, 11, 24))
    expect(i.end).toEqual(local(2026, 11, 25))
    expect(issueOf(local(2026, 11, 25, 0, 0), 'day').key).toBe('day:2026-11-25')
  })

  it('keeps clock-change days whole', () => {
    const spring = issueOf(local(2026, 3, 29, 12), 'day')
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3600_000)
    const autumn = issueOf(local(2026, 10, 25, 12), 'day')
    expect(autumn.end.getTime() - autumn.start.getTime()).toBe(25 * 3600_000)
  })

  it('starts weekly issues on the chosen day', () => {
    // 24 November 2026 is a Tuesday.
    expect(issueOf(local(2026, 11, 24, 9), 'week', 1).key).toBe('week:2026-11-23')
    expect(issueOf(local(2026, 11, 23, 0), 'week', 1).key).toBe('week:2026-11-23')
    expect(issueOf(local(2026, 11, 22, 23, 59), 'week', 1).key).toBe('week:2026-11-16')
    expect(issueOf(local(2026, 11, 24, 9), 'week', 0).key).toBe('week:2026-11-22')
    expect(issueOf(local(2026, 11, 24, 9), 'week', 3).key).toBe('week:2026-11-18')
    const w = issueOf(local(2026, 10, 27), 'week', 1)
    expect(w.end).toEqual(local(2026, 11, 2))
  })

  it('groups messages newest first', () => {
    const msgs = [
      { id: 1, date: local(2026, 11, 23, 8).toISOString() },
      { id: 2, date: local(2026, 11, 24, 7).toISOString() },
      { id: 3, date: local(2026, 11, 24, 9).toISOString(), arrivedAt: local(2026, 11, 24, 10).toISOString() },
      { id: 4, date: 'not a date' }
    ]
    const groups = groupIssues(msgs, 'day')
    expect(groups.map((g) => g.issue.key)).toEqual(['day:2026-11-24', 'day:2026-11-23'])
    expect(groups[0]!.items.map((m) => m.id)).toEqual([3, 2])
    expect(groupIssues(msgs, 'week')[0]!.items.map((m) => m.id)).toEqual([3, 2, 1])
  })

  it('titles issues', () => {
    const now = local(2026, 11, 24, 15)
    expect(issueTitle(issueOf(now, 'day'), now)).toBe('Today')
    expect(issueTitle(issueOf(local(2026, 11, 23, 9), 'day'), now)).toBe('Yesterday')
    expect(issueTitle(issueOf(local(2026, 11, 20, 9), 'day'), now)).toBe('Friday 20 November')
    expect(issueTitle(issueOf(local(2025, 12, 31, 9), 'day'), now)).toBe('Wednesday 31 December 2025')
    expect(issueTitle(issueOf(now, 'week', 1), now)).toBe('This week')
    expect(issueTitle(issueOf(local(2026, 11, 17), 'week', 1), now)).toBe('Last week')
    expect(issueTitle(issueOf(local(2026, 11, 10), 'week', 1), now)).toBe('Week of 9 November')
  })
})
