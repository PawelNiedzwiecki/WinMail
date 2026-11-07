// Delivery times are local; pin the zone so the clock-change days are London's (29 March and 25 October 2026).
process.env.TZ = 'Europe/London'

import { describe, expect, it } from 'vitest'
import {
  advance,
  isHeld,
  isVip,
  lastDeliveryAt,
  nextDeliveryAt,
  normaliseTimes,
  parseTime,
  sameDay,
  vipAddresses,
  type Holdable,
  type HoldRule
} from './delivery'

const TIMES = ['09:00', '13:00', '17:00']
/** A local time. */
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)

describe('times', () => {
  it('reads times of day', () => {
    expect(parseTime('09:00')).toBe(540)
    expect(parseTime('9:05')).toBe(545)
    expect(parseTime(' 23:59 ')).toBe(1439)
    for (const bad of ['24:00', '12:60', '1200', '', 'noon', null, 9]) expect(parseTime(bad)).toBeNull()
  })

  it('saves them sorted, each once, at most six; nothing usable gives the defaults', () => {
    expect(normaliseTimes(['17:00', '9:00', '13:00', '09:00', 'x'])).toEqual(['09:00', '13:00', '17:00'])
    expect(normaliseTimes(['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'])).toHaveLength(6)
    expect(normaliseTimes([])).toEqual(TIMES)
    expect(normaliseTimes('09:00')).toEqual(TIMES)
  })
})

describe('the last and next Delivery', () => {
  it('finds today’s, or yesterday’s last before the first', () => {
    expect(lastDeliveryAt(local(2026, 11, 7, 14, 30), TIMES)).toEqual(local(2026, 11, 7, 13))
    expect(lastDeliveryAt(local(2026, 11, 7, 13), TIMES)).toEqual(local(2026, 11, 7, 13))
    expect(lastDeliveryAt(local(2026, 11, 7, 8, 59), TIMES)).toEqual(local(2026, 11, 6, 17))
    // Across a month end.
    expect(lastDeliveryAt(local(2026, 12, 1, 7), TIMES)).toEqual(local(2026, 11, 30, 17))
  })

  it('finds the next later today, or tomorrow’s first', () => {
    expect(nextDeliveryAt(local(2026, 11, 7, 13), TIMES)).toEqual(local(2026, 11, 7, 17))
    expect(nextDeliveryAt(local(2026, 11, 7, 18), TIMES)).toEqual(local(2026, 11, 8, 9))
    expect(nextDeliveryAt(local(2026, 12, 31, 23), TIMES)).toEqual(local(2027, 1, 1, 9))
  })

  it('works with one time a day', () => {
    expect(lastDeliveryAt(local(2026, 11, 7, 8), ['10:00'])).toEqual(local(2026, 11, 6, 10))
    expect(nextDeliveryAt(local(2026, 11, 7, 11), ['10:00'])).toEqual(local(2026, 11, 8, 10))
  })

  it('keeps the clock time when the clocks change', () => {
    // 09:00 in London is 09:00 UTC in winter and 08:00 UTC in summer.
    expect(nextDeliveryAt(local(2026, 3, 28, 18), TIMES).toISOString()).toBe('2026-03-29T08:00:00.000Z')
    expect(nextDeliveryAt(local(2026, 10, 24, 18), TIMES).toISOString()).toBe('2026-10-25T09:00:00.000Z')
    // 01:30 does not exist on 29 March; that Delivery comes at 02:30.
    expect(nextDeliveryAt(local(2026, 3, 28, 23), ['01:30']).toISOString()).toBe('2026-03-29T01:30:00.000Z')
  })

  it('makes each Delivery once on the days the clocks change', () => {
    // In March 01:30 does not exist and becomes 02:30, the same moment as the 02:30 Delivery: one Delivery for both.
    // In October 01:30 happens twice; it is delivered the first time only.
    for (const [y, mo, d, count] of [
      [2026, 3, 29, 3],
      [2026, 10, 25, 4]
    ] as const) {
      const times = ['00:30', '01:30', '02:30', '09:00']
      let until = local(y, mo, d - 1, 23).toISOString()
      const crossed: string[] = []
      for (let t = local(y, mo, d - 1, 23).getTime(); t < local(y, mo, d + 1, 0).getTime(); t += 60_000) {
        const step = advance(until, new Date(t), times)
        until = step.deliveredUntil
        if (step.crossed) crossed.push(step.crossed.toISOString())
      }
      expect(new Set(crossed).size).toBe(crossed.length)
      expect(crossed).toHaveLength(count)
    }
  })
})

describe('advance', () => {
  it('moves to the Delivery time that passed, once', () => {
    const first = advance(local(2026, 11, 7, 9).toISOString(), local(2026, 11, 7, 13, 0), TIMES)
    expect(first.crossed).toEqual(local(2026, 11, 7, 13))
    expect(first.deliveredUntil).toBe(local(2026, 11, 7, 13).toISOString())
    const again = advance(first.deliveredUntil, local(2026, 11, 7, 13, 1), TIMES)
    expect(again.crossed).toBeNull()
    expect(again.deliveredUntil).toBe(first.deliveredUntil)
  })

  it('never moves back: a Deliver Now or turning on later than the last time stays', () => {
    const now = local(2026, 11, 7, 10, 15).toISOString()
    const r = advance(now, local(2026, 11, 7, 11), TIMES)
    expect(r.crossed).toBeNull()
    expect(r.deliveredUntil).toBe(now)
  })

  it('jumps over missed times to the last one (PC off)', () => {
    const r = advance(local(2026, 11, 5, 13).toISOString(), local(2026, 11, 7, 10), TIMES)
    expect(r.crossed).toEqual(local(2026, 11, 7, 9))
  })

  it('starts from the last time when nothing was saved', () => {
    expect(advance(null, local(2026, 11, 7, 10), TIMES).deliveredUntil).toBe(local(2026, 11, 7, 9).toISOString())
  })
})

describe('isHeld', () => {
  const rule: HoldRule = {
    deliveredUntil: local(2026, 11, 7, 13).toISOString(),
    vips: ['boss@example.com'],
    own: ['me@example.com']
  }
  const msg = (patch: Partial<Holdable> = {}): Holdable => ({
    seen: false,
    from: { name: 'Anna', email: 'anna@example.com' },
    date: local(2026, 11, 7, 12).toISOString(),
    arrivedAt: local(2026, 11, 7, 14).toISOString(),
    ...patch
  })

  /** The tests' "now": the evening of the day the messages arrive. */
  const NOW = local(2026, 11, 7, 20).getTime()
  const held = (m: Holdable, r: HoldRule | null = rule) => isHeld(m, r, NOW)

  it('holds unread mail that arrived after the last Delivery', () => {
    expect(held(msg())).toBe(true)
  })

  it('shows mail dated well ahead of this PC’s clock instead of holding it until then', () => {
    expect(held(msg({ arrivedAt: new Date(NOW + 5 * 60_000).toISOString() }))).toBe(true)
    expect(held(msg({ arrivedAt: new Date(NOW + 60 * 60_000).toISOString() }))).toBe(false)
  })

  it('goes by arrival, not the Date header', () => {
    expect(held(msg({ date: local(2026, 11, 7, 15).toISOString(), arrivedAt: local(2026, 11, 7, 12).toISOString() }))).toBe(false)
  })

  it('uses the Date header for rows saved without an arrival time', () => {
    expect(held(msg({ arrivedAt: undefined, date: local(2026, 11, 7, 14).toISOString() }))).toBe(true)
    expect(held(msg({ arrivedAt: undefined }))).toBe(false)
  })

  it('shows mail from exactly the Delivery time', () => {
    expect(held(msg({ arrivedAt: rule.deliveredUntil }))).toBe(false)
  })

  it('never holds read mail, VIPs, the user, or anything while batching is off', () => {
    expect(held(msg({ seen: true }))).toBe(false)
    expect(held(msg({ from: { name: 'Boss', email: 'Boss@Example.com ' } }))).toBe(false)
    expect(held(msg({ from: { name: 'Me', email: 'me@example.com' } }))).toBe(false)
    expect(held(msg(), null)).toBe(false)
  })

  it('treats unreadable dates as not held', () => {
    expect(held(msg({ arrivedAt: 'not a date', date: 'nor this' }))).toBe(false)
  })
})

describe('VIPs', () => {
  it('match on the address, whatever its case', () => {
    const vips = [
      { name: 'Boss', email: 'Boss@Example.com' },
      { name: '', email: 'boss@example.com' }
    ]
    expect(vipAddresses(vips)).toEqual(['boss@example.com'])
    expect(isVip('BOSS@example.com', vips)).toBe(true)
    expect(isVip('', vips)).toBe(false)
  })
})

describe('sameDay', () => {
  it('compares local calendar days', () => {
    expect(sameDay(local(2026, 11, 7, 0, 1), local(2026, 11, 7, 23, 59))).toBe(true)
    expect(sameDay(local(2026, 11, 7, 23, 59), local(2026, 11, 8, 0, 1))).toBe(false)
  })
})
