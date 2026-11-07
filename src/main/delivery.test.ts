process.env.TZ = 'Europe/London'

import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type DeliveryRecord, type MessageSummary, type Settings } from '../shared/types'
import { Deliveries, type DeliveryMail } from './delivery'
import type { DeliveryStore, Store } from './store'

const local = (d: number, h: number, mi = 0, s = 0) => new Date(2026, 10, d, h, mi, s)

const message = (uid: number, arrived: Date, patch: Partial<MessageSummary> = {}): MessageSummary => ({
  key: `a|INBOX|${uid}`,
  accountId: 'a',
  mailbox: 'INBOX',
  uid,
  from: { name: 'Anna', email: 'anna@example.com' },
  to: [],
  subject: `Message ${uid}`,
  preview: '',
  date: arrived.toISOString(),
  arrivedAt: arrived.toISOString(),
  seen: false,
  flagged: false,
  hasAttachments: false,
  ...patch
})

function setup(opts: { on?: boolean; deliveredUntil?: string | null; held?: MessageSummary[]; failFor?: string } = {}) {
  let settings: Settings = { ...DEFAULT_SETTINGS, batchDelivery: opts.on ?? true }
  let delivery: DeliveryStore = { deliveredUntil: opts.deliveredUntil ?? null, records: [] }
  const accounts = [
    { id: 'a', email: 'me@example.com', enabled: true },
    { id: 'b', email: 'work@example.com', enabled: true },
    { id: 'c', email: 'old@example.com', enabled: false }
  ] as Account[]
  const store = {
    getSettings: () => settings,
    getDelivery: () => delivery,
    setDelivery: (d: DeliveryStore) => (delivery = d),
    listAccounts: () => accounts
  } as unknown as Store
  const heldBetween = vi.fn<DeliveryMail['heldBetween']>(async (accountId, after, until) => {
    if (accountId === opts.failFor) throw new Error('offline')
    return (opts.held ?? []).filter(
      (m) => m.accountId === accountId && m.arrivedAt! > after && m.arrivedAt! <= until
    )
  })
  const changed = vi.fn()
  const announced: DeliveryRecord[] = []
  const d = new Deliveries(store, { heldBetween }, changed, (r) => announced.push(r))
  return {
    d,
    heldBetween,
    changed,
    announced,
    delivery: () => delivery,
    setSettings: (s: Partial<Settings>) => {
      const before = settings
      settings = { ...settings, ...s }
      d.settingsChanged(before, settings, local(7, 11))
    }
  }
}

describe('Deliveries', () => {
  it('makes a Delivery when a time passes while running, and announces it', async () => {
    const held = [message(1, local(7, 10)), message(2, local(7, 12, 30)), message(3, local(7, 13, 5))]
    const t = setup({ deliveredUntil: local(7, 9).toISOString(), held })
    await t.d.tick(local(7, 12, 59, 40))
    expect(t.delivery().records).toHaveLength(0)
    await t.d.tick(local(7, 13, 0, 10))
    const [r] = t.delivery().records
    expect(r!.kind).toBe('scheduled')
    expect(r!.at).toBe(local(7, 13).toISOString())
    // Newest first; the one that came after 13:00 waits for the next Delivery.
    expect(r!.items.map((i) => i.uid)).toEqual([2, 1])
    expect(t.delivery().deliveredUntil).toBe(local(7, 13).toISOString())
    expect(t.announced).toEqual([r])
    expect(t.changed).toHaveBeenCalled()
    // Disabled accounts are not searched.
    expect(t.heldBetween.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })

  it('records a missed time on the first look after starting, without announcing it', async () => {
    const t = setup({ deliveredUntil: local(6, 17).toISOString(), held: [message(1, local(7, 8))] })
    await t.d.tick(local(7, 9, 2))
    const [r] = t.delivery().records
    expect(r!.kind).toBe('catch-up')
    expect(r!.items).toHaveLength(1)
    expect(t.announced).toHaveLength(0)
  })

  it('treats a time noticed long after it passed (the PC slept) as a catch-up', async () => {
    const t = setup({ deliveredUntil: local(7, 9).toISOString(), held: [message(1, local(7, 10))] })
    await t.d.tick(local(7, 12))
    await t.d.tick(local(7, 15))
    expect(t.delivery().records[0]!.kind).toBe('catch-up')
    expect(t.announced).toHaveLength(0)
  })

  it('announces nothing when a Delivery brought nothing', async () => {
    const t = setup({ deliveredUntil: local(7, 9).toISOString() })
    await t.d.tick(local(7, 12, 59, 50))
    await t.d.tick(local(7, 13, 0, 20))
    expect(t.delivery().records[0]!.items).toEqual([])
    expect(t.announced).toHaveLength(0)
  })

  it('Deliver Now shows everything held and records it silently', async () => {
    const t = setup({ deliveredUntil: local(7, 9).toISOString(), held: [message(1, local(7, 10))] })
    const state = await t.d.deliverNow(local(7, 10, 30))
    expect(state.deliveredUntil).toBe(local(7, 10, 30).toISOString())
    expect(t.delivery().records[0]!.kind).toBe('now')
    expect(t.delivery().records[0]!.items).toHaveLength(1)
    expect(t.announced).toHaveLength(0)
    // The 13:00 Delivery still comes, with what arrived after the Deliver Now.
    await t.d.tick(local(7, 12, 59, 50))
    await t.d.tick(local(7, 13, 0, 20))
    expect(t.delivery().records[0]!.kind).toBe('scheduled')
  })

  it('Deliver Now during a running Delivery waits for it, then delivers what is left', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const t = setup({ deliveredUntil: local(7, 9).toISOString(), held: [message(1, local(7, 12)), message(2, local(7, 13, 2))] })
    const first = t.heldBetween.getMockImplementation()!
    t.heldBetween.mockImplementationOnce(async (...args) => {
      await gate
      return first(...args)
    })
    await t.d.tick(local(7, 12, 59, 50))
    const scheduled = t.d.tick(local(7, 13, 0, 10))
    const now = t.d.deliverNow(local(7, 13, 5))
    release()
    await scheduled
    const state = await now
    expect(state.deliveredUntil).toBe(local(7, 13, 5).toISOString())
    expect(t.delivery().records.map((r) => [r.kind, r.items.map((i) => i.uid)])).toEqual([
      ['now', [2]],
      ['scheduled', [1]]
    ])
  })

  it('Deliver Now before the timer has seen a Delivery time lists that mail too', async () => {
    const t = setup({ deliveredUntil: local(7, 9).toISOString(), held: [message(1, local(7, 12)), message(2, local(7, 13, 2))] })
    await t.d.deliverNow(local(7, 13, 5))
    expect(t.delivery().records.map((r) => r.items.map((i) => i.uid))).toEqual([[2, 1]])
  })

  it('refuses Deliver Now while batching is off', async () => {
    const t = setup({ on: false })
    await expect(t.d.deliverNow()).rejects.toThrow(/off/)
  })

  it('turning on holds from that moment; turning off holds nothing', () => {
    const t = setup({ on: false })
    expect(t.d.rule()).toBeNull()
    t.setSettings({ batchDelivery: true })
    expect(t.delivery().deliveredUntil).toBe(local(7, 11).toISOString())
    expect(t.changed).toHaveBeenCalledTimes(1)
    t.setSettings({ batchDelivery: false })
    expect(t.delivery().deliveredUntil).toBeNull()
    expect(t.d.rule()).toBeNull()
    expect(t.d.state().nextAt).toBeNull()
  })

  it('editing the times never moves the point back', () => {
    const t = setup({ deliveredUntil: local(7, 10, 30).toISOString() })
    t.setSettings({ deliveryTimes: ['08:00'] })
    expect(t.d.rule(local(7, 11))!.deliveredUntil).toBe(local(7, 10, 30).toISOString())
  })

  it('holds by the last Delivery time even before the timer has run', () => {
    const t = setup({ deliveredUntil: local(6, 17).toISOString() })
    expect(t.d.rule(local(7, 9, 0, 5))!.deliveredUntil).toBe(local(7, 9).toISOString())
  })

  it('knows the VIPs and the user’s own addresses', () => {
    const t = setup({ deliveredUntil: local(7, 9).toISOString() })
    t.setSettings({ vips: [{ name: 'Boss', email: 'Boss@Example.com' }] })
    const rule = t.d.rule(local(7, 10))!
    expect(rule.vips).toEqual(['boss@example.com'])
    expect(rule.own).toEqual(['me@example.com', 'work@example.com', 'old@example.com'])
  })

  it('marks the first Delivery of each day', async () => {
    const t = setup({ deliveredUntil: local(6, 13).toISOString() })
    await t.d.tick(local(6, 17, 0, 10))
    await t.d.tick(local(7, 9, 0, 10))
    await t.d.tick(local(7, 12, 59, 50))
    await t.d.tick(local(7, 13, 0, 10))
    expect(t.delivery().records.map((r) => [r.at, r.first])).toEqual([
      [local(7, 13).toISOString(), false],
      [local(7, 9).toISOString(), true],
      [local(6, 17).toISOString(), true]
    ])
  })

  it('still delivers when an account cannot be searched', async () => {
    const t = setup({
      deliveredUntil: local(7, 9).toISOString(),
      held: [message(1, local(7, 10)), message(2, local(7, 11), { accountId: 'b', key: 'b|INBOX|2' })],
      failFor: 'a'
    })
    await t.d.tick(local(7, 12, 59, 50))
    await t.d.tick(local(7, 13, 0, 20))
    expect(t.delivery().deliveredUntil).toBe(local(7, 13).toISOString())
    expect(t.delivery().records[0]!.items.map((i) => i.accountId)).toEqual(['b'])
  })

  it('keeps 14 records and lists at most 200 messages in one', async () => {
    const held = Array.from({ length: 250 }, (_, i) => message(i + 1, new Date(local(7, 9).getTime() + (i + 1) * 1000)))
    const t = setup({ deliveredUntil: local(7, 9).toISOString(), held })
    await t.d.deliverNow(local(7, 10))
    expect(t.delivery().records[0]!.items).toHaveLength(200)
    expect(t.delivery().records[0]!.more).toBe(50)
    expect(t.d.state(local(7, 10)).last!.count).toBe(250)
    for (let i = 0; i < 20; i++) await t.d.deliverNow(new Date(local(7, 10).getTime() + (i + 1) * 60_000))
    expect(t.delivery().records).toHaveLength(14)
  })
})
