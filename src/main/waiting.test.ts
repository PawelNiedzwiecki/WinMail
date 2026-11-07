import { describe, expect, it, vi } from 'vitest'
import type { Account, SendInput, WaitingInfo } from '../shared/types'
import type { MailService, ReplyCandidate } from './mail'
import type { Store } from './store'
import { WaitingFor } from './waiting'

const DAY = 24 * 60 * 60_000

function setup(opts: { lookForReplies?: (accountId: string, ids: string[]) => Promise<void> } = {}) {
  let waiting: WaitingInfo[] = []
  const accounts = [{ id: 'a', email: 'me@example.com', enabled: true }] as Account[]
  const store = {
    listWaiting: () => waiting,
    setWaiting: (l: WaitingInfo[]) => (waiting = l),
    listAccounts: () => accounts
  } as unknown as Store
  let watch: (rows: ReplyCandidate[]) => void = () => {}
  const mail = {
    watchReplies: (fn: (rows: ReplyCandidate[]) => void) => (watch = fn),
    lookForReplies: vi.fn(opts.lookForReplies ?? (async () => {})),
    findSent: vi.fn(async () => null)
  } as unknown as MailService
  const changed = vi.fn()
  const nudged: WaitingInfo[][] = []
  const w = new WaitingFor(store, mail, changed, (items) => nudged.push(items))
  return { w, mail, changed, nudged, list: () => waiting, reply: (rows: ReplyCandidate[]) => watch(rows), accounts }
}

const input = (patch: Partial<SendInput> = {}): SendInput => ({
  accountId: 'a',
  to: 'Anna <anna@example.com>',
  subject: 'Lunch?',
  text: 'Free on Friday?',
  waitDays: 3,
  ...patch
})

const row = (patch: Partial<ReplyCandidate> = {}): ReplyCandidate => ({
  accountId: 'a',
  parents: ['<m1@x>'],
  from: 'anna@example.com',
  date: new Date().toISOString(),
  automatic: false,
  ...patch
})

describe('WaitingFor', () => {
  it('waits only when the message asked to', () => {
    const t = setup()
    t.w.sent(input({ waitDays: 0 }), '<m0@x>')
    t.w.sent(input({ waitDays: undefined }), '<m0b@x>')
    expect(t.list()).toEqual([])
    t.w.sent(input(), '<m1@x>', new Date('2026-11-02T15:00:00'))
    expect(t.list()).toHaveLength(1)
    expect(t.list()[0]).toMatchObject({ messageId: '<m1@x>', days: 3, to: 'Anna <anna@example.com>' })
    expect(new Date(t.list()[0]!.dueAt).getDate()).toBe(5)
  })

  it('ends the wait when a person replies, not for your own mail or an out-of-office', () => {
    const t = setup()
    t.w.sent(input(), '<m1@x>')
    t.reply([row({ from: 'ME@example.com' }), row({ automatic: true }), row({ parents: ['<other@x>'] }), row({ accountId: 'b' })])
    expect(t.list()).toHaveLength(1)
    t.reply([row()])
    expect(t.list()).toEqual([])
  })

  it('a follow-up in the conversation replaces the earlier wait', () => {
    const t = setup()
    t.w.sent(input(), '<m1@x>')
    t.w.sent(input({ inReplyTo: '<m1@x>', references: ['<m1@x>'], subject: 'Re: Lunch?', waitDays: 2 }), '<m2@x>')
    expect(t.list().map((x) => x.messageId)).toEqual(['<m2@x>'])
    // Writing again with the switch off just ends the wait.
    t.w.sent(input({ references: ['<m1@x>', '<m2@x>'], waitDays: 0 }), '<m3@x>')
    expect(t.list()).toEqual([])
  })

  it('nudges a due message after one more search', async () => {
    const t = setup()
    t.w.sent(input(), '<m1@x>', new Date(Date.now() - 4 * DAY))
    await t.w.check(Date.now() - 2 * DAY)
    expect(t.nudged).toHaveLength(0)
    await t.w.check()
    expect(t.mail.lookForReplies).toHaveBeenCalledWith('a', ['<m1@x>'])
    expect(t.nudged).toHaveLength(1)
    expect(t.list()[0]!.nudgedAt).toBeTruthy()
    await t.w.check()
    expect(t.nudged).toHaveLength(1)
  })

  it('does not nudge when the search finds a reply', async () => {
    const t = setup({ lookForReplies: async () => t.reply([row()]) })
    t.w.sent(input(), '<m1@x>', new Date(Date.now() - 4 * DAY))
    await t.w.check()
    expect(t.nudged).toHaveLength(0)
    expect(t.list()).toEqual([])
  })

  it('retries an unreachable account and gives up after half a day', async () => {
    const t = setup({ lookForReplies: async () => Promise.reject(new Error('offline')) })
    const sent = Date.now() - 3 * DAY - 60 * 60_000
    t.w.sent(input(), '<m1@x>', new Date(sent))
    const due = Date.parse(t.list()[0]!.dueAt)
    await t.w.check(due + 60_000)
    await t.w.check(due + 2 * 60_000)
    expect(t.mail.lookForReplies).toHaveBeenCalledTimes(1)
    expect(t.nudged).toHaveLength(0)
    await t.w.check(due + 13 * 60 * 60_000)
    expect(t.nudged).toHaveLength(1)
  })

  it('leaves disabled accounts alone', async () => {
    const t = setup()
    t.w.sent(input(), '<m1@x>', new Date(Date.now() - 4 * DAY))
    t.accounts[0]!.enabled = false
    await t.w.check()
    expect(t.mail.lookForReplies).not.toHaveBeenCalled()
    expect(t.nudged).toHaveLength(0)
  })

  it('waits longer, stops and puts back', async () => {
    const t = setup()
    t.w.sent(input(), '<m1@x>', new Date(Date.now() - 4 * DAY))
    await t.w.check()
    const id = t.list()[0]!.id
    const next = t.w.longer(id, 7)
    expect(next.nudgedAt).toBeUndefined()
    expect(Date.parse(next.dueAt)).toBeGreaterThan(Date.now() + 6 * DAY)
    const item = t.w.stop(id)
    expect(t.list()).toEqual([])
    t.w.restore(item)
    t.w.restore(item)
    expect(t.list()).toHaveLength(1)
    expect(() => t.w.stop('nope')).toThrow()
  })

  it('lists nudged messages first', async () => {
    const t = setup()
    t.w.sent(input({ subject: 'later' }), '<m1@x>')
    t.w.sent(input({ subject: 'old' }), '<m2@x>', new Date(Date.now() - 5 * DAY))
    await t.w.check()
    expect(t.w.list().map((x) => x.subject)).toEqual(['old', 'later'])
  })
})
