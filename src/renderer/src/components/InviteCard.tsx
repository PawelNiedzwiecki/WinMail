import { CalendarPlus, Check, HelpCircle, MapPin, Repeat, Users, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { CalendarInvite, InviteAnswer } from '@shared/types'

interface Props {
  invite: CalendarInvite
  /** Sends the answer to the organiser; rejects with the error to show. */
  onAnswer: (answer: InviteAnswer) => Promise<void>
  onOpen: () => void
}

const ANSWERS: { answer: InviteAnswer; label: string; icon: ReactNode }[] = [
  { answer: 'ACCEPTED', label: 'Yes', icon: <Check size={14} /> },
  { answer: 'TENTATIVE', label: 'Maybe', icon: <HelpCircle size={14} /> },
  { answer: 'DECLINED', label: 'No', icon: <X size={14} /> }
]

/** How a guest's answer reads in a reply ("Sam Patel accepted"). */
const REPLIED: Record<string, string> = {
  ACCEPTED: 'accepted',
  TENTATIVE: 'tentatively accepted',
  DECLINED: 'declined',
  DELEGATED: 'delegated'
}

const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** All-day dates are calendar days, the same wherever you are; read them as local dates. */
const localDate = (d: string) => {
  const [y, m, n] = d.split('-').map(Number)
  return new Date(y!, m! - 1, n!)
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** "Tue 27 October 2026 · 14:00 – 15:00", in your time zone. */
export function inviteWhen(i: Pick<CalendarInvite, 'start' | 'end' | 'allDay'>): string {
  if (i.allDay) {
    const start = localDate(i.start)
    // The end date is the day after the last one.
    const last = i.end ? localDate(i.end) : start
    if (i.end) last.setDate(last.getDate() - 1)
    return last > start ? `${day.format(start)} – ${day.format(last)}` : `${day.format(start)} · All day`
  }
  const start = new Date(i.start)
  if (!i.end) return `${day.format(start)} · ${time.format(start)}`
  const end = new Date(i.end)
  return sameDay(start, end)
    ? `${day.format(start)} · ${time.format(start)} – ${time.format(end)}`
    : `${day.format(start)}, ${time.format(start)} – ${day.format(end)}, ${time.format(end)}`
}

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

function linkified(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    )
  )
}

/** A calendar invitation in a message: what, when, where, and Yes / Maybe / No. */
export function InviteCard({ invite: i, onAnswer, onOpen }: Props) {
  const [pending, setPending] = useState<InviteAnswer | null>(null)
  const start = i.allDay ? localDate(i.start) : new Date(i.start)
  const cancelled = i.method === 'CANCEL'
  const canAnswer = i.method === 'REQUEST' && !i.isOrganizer
  const guests = i.attendees.length
  const replied = i.method === 'REPLY' ? i.attendees.find((a) => a.status in REPLIED) : undefined

  const answer = async (a: InviteAnswer) => {
    if (pending || a === i.answer) return
    setPending(a)
    try {
      await onAnswer(a)
    } catch {
      // The reading pane shows the error; the buttons stay as they were.
    } finally {
      setPending(null)
    }
  }

  return (
    <div className={`invite ${cancelled ? 'is-cancelled' : ''}`} role="group" aria-label={`Event: ${i.summary}`}>
      <div className="invite-date" aria-hidden="true">
        <span className="invite-month">{start.toLocaleDateString(undefined, { month: 'short' })}</span>
        <span className="invite-day">{start.getDate()}</span>
      </div>
      <div className="invite-main">
        <div className="invite-title">
          <span className="invite-summary">{i.summary}</span>
          {cancelled && <span className="invite-badge">Cancelled</span>}
        </div>
        <div className="invite-when">
          {inviteWhen(i)}
          {i.recurring && (
            <span className="invite-repeat" title="Repeats">
              <Repeat size={12} /> Repeats
            </span>
          )}
        </div>
        {i.location && (
          <div className="invite-line">
            <MapPin size={13} />
            <span>{linkified(i.location)}</span>
          </div>
        )}
        {(i.organizer || guests > 0) && (
          <div
            className="invite-line"
            title={i.attendees.map((a) => `${a.name || a.email}: ${a.status.toLowerCase().replace('needs-action', 'no answer yet')}`).join('\n')}
          >
            <Users size={13} />
            <span>
              {i.organizer && <>Organiser: {i.organizer.name || i.organizer.email}</>}
              {i.organizer && guests > 0 && ' · '}
              {guests > 0 && `${guests} ${guests === 1 ? 'guest' : 'guests'}`}
            </span>
          </div>
        )}
        {replied && (
          <div className="invite-replied">
            {replied.name || replied.email} {REPLIED[replied.status]}
          </div>
        )}
        {cancelled && <div className="invite-replied">This event was cancelled. Open it in your calendar to remove it.</div>}

        <div className="invite-actions">
          {canAnswer && (
            <>
              <span className="invite-going">Going?</span>
              <div className="invite-answers" role="radiogroup" aria-label="Going?">
                {ANSWERS.map((a) => (
                  <button
                    key={a.answer}
                    role="radio"
                    aria-checked={i.answer === a.answer}
                    className={`invite-answer ${i.answer === a.answer ? 'is-on' : ''}`}
                    disabled={!!pending}
                    onClick={() => void answer(a.answer)}
                  >
                    {pending === a.answer ? <span className="spinner" /> : a.icon}
                    {a.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <button className="invite-open" onClick={onOpen}>
            <CalendarPlus size={14} /> {cancelled || i.method === 'REPLY' ? 'Open in Calendar' : 'Add to Calendar'}
          </button>
        </div>
      </div>
    </div>
  )
}
