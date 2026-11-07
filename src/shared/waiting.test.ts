import { describe, expect, it } from 'vitest'
import { asksQuestion, autoWait, daysLabel, goesToPeople, isAutomatic, isListAddress, nudgeTime, ownWords } from './waiting'

describe('asksQuestion', () => {
  it('finds a question mark ending a sentence', () => {
    expect(asksQuestion('Are you free on Friday?')).toBe(true)
    expect(asksQuestion('Hi Anna,\n\nCould you send the figures? Thanks!')).toBe(true)
    expect(asksQuestion('Lunch tomorrow ?')).toBe(true)
    expect(asksQuestion('Masz chwilę jutro?')).toBe(true)
    expect(asksQuestion('“Is it done?” she asked.')).toBe(true)
  })

  it('finds requests without a question mark', () => {
    expect(asksQuestion('Let me know what you think.')).toBe(true)
    expect(asksQuestion('Please confirm by Monday.')).toBe(true)
    expect(asksQuestion('Looking forward to hearing from you')).toBe(true)
    expect(asksQuestion('Daj znać, jak będziesz wiedział.')).toBe(true)
    expect(asksQuestion('Gib mir Bescheid.')).toBe(true)
  })

  it('ignores statements, links and addresses', () => {
    expect(asksQuestion('Thanks, see you tomorrow.')).toBe(false)
    expect(asksQuestion('The report is at https://example.com/view?id=4 for anyone.')).toBe(false)
    expect(asksQuestion('Details: www.example.com/a?b=c')).toBe(false)
    expect(asksQuestion('')).toBe(false)
  })

  it('ignores questions in the quote and the signature', () => {
    const reply = 'Sounds good, done.\n\nOn Mon, 4 Nov 2026 at 10:00, Anna <anna@example.com> wrote:\n> Can you send it?'
    expect(asksQuestion(reply)).toBe(false)
    expect(asksQuestion('Done.\n> Can you send it?')).toBe(false)
    expect(asksQuestion('Done.\n--\nAlex\nNeed help? Call us.')).toBe(false)
    expect(asksQuestion('Done.\n\nFrom: Anna\nSent: Monday\nCan you send it?')).toBe(false)
    expect(asksQuestion('Gotowe.\n\nW dniu 4.11.2026 Anna napisała:\n> Czy możesz?')).toBe(false)
  })
})

describe('ownWords', () => {
  it('keeps text above the quote', () => {
    expect(ownWords('One\nTwo\n\nOn Tue, Jan wrote:\n> Three').trim()).toBe('One\nTwo')
  })
})

describe('isListAddress', () => {
  it('tells lists and robots from people', () => {
    expect(isListAddress('no-reply@example.com')).toBe(true)
    expect(isListAddress('noreply@github.com')).toBe(true)
    expect(isListAddress('team@googlegroups.com')).toBe(true)
    expect(isListAddress('dev@lists.example.org')).toBe(true)
    expect(isListAddress('python-list@python.org')).toBe(true)
    expect(isListAddress('all-staff@company.com')).toBe(true)
    expect(isListAddress('newsletter@shop.example')).toBe(true)
    expect(isListAddress('anna@example.com')).toBe(false)
    expect(isListAddress('support@vendor.example')).toBe(false)
    expect(isListAddress('allison@example.com')).toBe(false)
    expect(isListAddress('newsom@example.com')).toBe(false)
  })
})

describe('goesToPeople', () => {
  const own = ['me@example.com']
  it('needs someone other than yourself', () => {
    expect(goesToPeople(['anna@example.com'], own)).toBe(true)
    expect(goesToPeople(['ME@example.com'], own)).toBe(false)
    expect(goesToPeople([], own)).toBe(false)
  })
  it('refuses lists, broadcasts and replies to list mail', () => {
    expect(goesToPeople(['anna@example.com', 'team@googlegroups.com'], own)).toBe(false)
    expect(goesToPeople(Array.from({ length: 11 }, (_, i) => `p${i}@example.com`), own)).toBe(false)
    expect(goesToPeople(['anna@example.com'], own, true)).toBe(false)
  })
})

describe('autoWait', () => {
  const base = { recipients: ['anna@example.com'], own: ['me@example.com'] }
  it('turns on for a question to people', () => {
    expect(autoWait({ ...base, text: 'Free on Friday?' })).toBe('question')
    expect(autoWait({ ...base, text: 'Thanks!' })).toBe(null)
  })
  it('turns on for a follow-up even without a question', () => {
    expect(autoWait({ ...base, text: 'Just checking in.', followUp: true })).toBe('followUp')
  })
  it('stays off for lists', () => {
    expect(autoWait({ ...base, recipients: ['noreply@example.com'], text: 'Free on Friday?' })).toBe(null)
    expect(autoWait({ ...base, replyToList: true, text: 'Free on Friday?' })).toBe(null)
  })
})

describe('nudgeTime', () => {
  const at = (s: string) => new Date(s)
  it('comes back the given days later in the day', () => {
    const due = nudgeTime(at('2026-11-02T15:30:00'), 3)
    expect([due.getDate(), due.getHours(), due.getMinutes()]).toEqual([5, 15, 30])
  })
  it('moves a night-time nudge to 08:00', () => {
    const late = nudgeTime(at('2026-11-02T22:10:00'), 3)
    expect([late.getDate(), late.getHours(), late.getMinutes()]).toEqual([6, 8, 0])
    const early = nudgeTime(at('2026-11-02T06:45:00'), 1)
    expect([early.getDate(), early.getHours(), early.getMinutes()]).toEqual([3, 8, 0])
    const evening = nudgeTime(at('2026-11-02T18:00:00'), 2)
    expect([evening.getDate(), evening.getHours()]).toEqual([5, 8])
  })
  it('crosses month ends', () => {
    const due = nudgeTime(at('2026-11-29T12:00:00'), 3)
    expect([due.getMonth(), due.getDate()]).toEqual([11, 2])
  })
})

describe('isAutomatic', () => {
  it('skips out-of-office answers and bounces', () => {
    expect(isAutomatic({ from: 'anna@example.com', subject: 'Automatic reply: Lunch?' })).toBe(true)
    expect(isAutomatic({ from: 'anna@example.com', subject: 'Out of Office: Lunch?' })).toBe(true)
    expect(isAutomatic({ from: 'anna@example.com', subject: 'Re: Autoreply' })).toBe(true)
    expect(isAutomatic({ from: 'anna@example.com', subject: 'Re: Lunch?', autoSubmitted: true })).toBe(true)
    expect(isAutomatic({ from: 'MAILER-DAEMON@mx.example.com', subject: 'Undelivered Mail Returned to Sender' })).toBe(true)
  })
  it('counts a person’s answer', () => {
    expect(isAutomatic({ from: 'anna@example.com', subject: 'Re: Lunch?' })).toBe(false)
    expect(isAutomatic({ from: 'anna@example.com', subject: 'Re: Out of the office plans' })).toBe(false)
  })
})

describe('daysLabel', () => {
  it('reads naturally', () => {
    expect([1, 3, 7, 14].map(daysLabel)).toEqual(['1 day', '3 days', '1 week', '2 weeks'])
  })
})
