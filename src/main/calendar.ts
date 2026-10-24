import ICAL from 'ical.js'
import type { Address, CalendarInvite, InviteAnswer, InviteAttendee } from '../shared/types'

/**
 * Calendar invitations in mail (iCalendar, RFC 5545; sent and answered as in RFC 5546 / iMIP).
 * Outlook, Google Calendar and iCloud send a text/calendar part, often with a copy as invite.ics.
 */

type Part = { contentType: string; filename?: string; content: Buffer }

const isCalendar = (a: Part) =>
  /^(text\/calendar|application\/ics)$/i.test(a.contentType) || /\.ics$/i.test(a.filename ?? '')

/** The inline text/calendar alternative: shown as the event card, not as an unnamed attachment. */
export const isInlineCalendar = (a: { contentType: string; filename?: string }) =>
  /^text\/calendar$/i.test(a.contentType) && !a.filename

/** The inline text/calendar part, else an attached .ics. */
export function findCalendarPart(parts: Part[]): string | null {
  const inline = parts.findIndex(isInlineCalendar)
  const index = inline >= 0 ? inline : parts.findIndex(isCalendar)
  return index < 0 ? null : parts[index]!.content.toString('utf8')
}

const ANSWERS: InviteAnswer[] = ['ACCEPTED', 'TENTATIVE', 'DECLINED']

const mailto = (v: unknown) => (typeof v === 'string' ? v.replace(/^mailto:/i, '').trim() : '')

function parse(text: string): { cal: ICAL.Component; ev: ICAL.Event } | null {
  try {
    const cal = new ICAL.Component(ICAL.parse(text))
    // Outlook names zones its own way ("GMT Standard Time") and defines them in the file.
    for (const tz of cal.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)
    // Several VEVENTs mean a series plus changed occurrences; the one without RECURRENCE-ID is the series.
    const events = cal.getAllSubcomponents('vevent')
    const main = events.find((e) => !e.hasProperty('recurrence-id')) ?? events[0]
    return main ? { cal, ev: new ICAL.Event(main) } : null
  } catch {
    return null
  }
}

/** All-day events keep their calendar dates ("2026-10-27"); timed ones become instants. */
function when(t: ICAL.Time | null): string | null {
  if (!t) return null
  if (t.isDate) return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
  return t.toJSDate().toISOString()
}

/** What the reading pane shows; null when the part isn't a usable event. `me` are your addresses, lower case. */
export function parseInvite(text: string, me: string[]): CalendarInvite | null {
  const p = parse(text)
  if (!p) return null
  const { cal, ev } = p
  if (!ev.startDate) return null
  const method = String(cal.getFirstPropertyValue('method') ?? 'PUBLISH').toUpperCase()
  const attendees: InviteAttendee[] = ev.attendees
    .map((a) => ({
      name: String(a.getParameter('cn') ?? ''),
      email: mailto(a.getFirstValue()),
      status: String(a.getParameter('partstat') ?? 'NEEDS-ACTION').toUpperCase()
    }))
    .filter((a) => a.email)
  const orgProp = ev.component.getFirstProperty('organizer')
  const organizer: Address | null = orgProp
    ? { name: String(orgProp.getParameter('cn') ?? ''), email: mailto(orgProp.getFirstValue()) }
    : null
  const mine = attendees.find((a) => me.includes(a.email.toLowerCase()))
  const answer = mine && (ANSWERS as string[]).includes(mine.status) ? (mine.status as InviteAnswer) : null
  const end = ev.endDate ?? null
  return {
    method,
    uid: ev.uid || '',
    summary: ev.summary || '(No title)',
    start: when(ev.startDate)!,
    end: when(end),
    allDay: ev.startDate.isDate,
    recurring: ev.isRecurring(),
    location: ev.location || null,
    organizer: organizer?.email ? organizer : null,
    attendees,
    answer,
    isOrganizer: !!organizer && me.includes(organizer.email.toLowerCase())
  }
}

/** Properties a reply keeps from the invitation: enough for any calendar to match it to the event. */
const KEEP = ['uid', 'sequence', 'recurrence-id', 'dtstart', 'dtend', 'duration', 'summary', 'location', 'organizer']

/**
 * An iMIP REPLY (RFC 5546 3.2.3) to an invitation: the event with you as its only attendee and your answer.
 * Time zone definitions come along so DTSTART still means the same time.
 */
export function buildReply(text: string, me: Address, answer: InviteAnswer): { ics: string; summary: string; organizer: string } {
  const p = parse(text)
  if (!p) throw new Error("This invitation can't be read.")
  const { cal, ev } = p
  const organizer = mailto(ev.component.getFirstPropertyValue('organizer'))
  if (!organizer) throw new Error("This invitation doesn't say who sent it, so there's no one to answer.")

  const reply = new ICAL.Component('vcalendar')
  reply.addPropertyWithValue('prodid', '-//WinMail//Calendar reply//EN')
  reply.addPropertyWithValue('version', '2.0')
  reply.addPropertyWithValue('method', 'REPLY')
  for (const tz of cal.getAllSubcomponents('vtimezone')) reply.addSubcomponent(new ICAL.Component(tz.toJSON()))

  const out = new ICAL.Component('vevent')
  for (const name of KEEP) for (const prop of ev.component.getAllProperties(name)) out.addProperty(new ICAL.Property(prop.toJSON()))
  // DTSTAMP must be UTC (RFC 5545 3.8.7.2); Time.now() would be floating local time.
  out.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))
  // Answer with the address the invitation used for you, so the organiser's calendar finds the guest.
  const invited = ev.attendees.find((a) => mailto(a.getFirstValue()).toLowerCase() === me.email.toLowerCase())
  const attendee = new ICAL.Property('attendee')
  attendee.setValue(`mailto:${invited ? mailto(invited.getFirstValue()) : me.email}`)
  if (me.name) attendee.setParameter('cn', me.name)
  attendee.setParameter('partstat', answer)
  out.addProperty(attendee)
  reply.addSubcomponent(out)

  return { ics: reply.toString(), summary: ev.summary || '(No title)', organizer }
}
