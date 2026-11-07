import { ChevronDown, Clock, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import type { DeliveredItem, WaitingInfo } from '@shared/types'
import { REASON_TEXT, briefHeading, sinceText, type Brief } from '@shared/brief'
import { hhmm } from '@shared/delivery'

/** The Claude paragraph: off (no opt-in or no key), being written, written, or failed. */
export type BriefParagraph = { state: 'off' } | { state: 'loading' } | { state: 'done'; text: string } | { state: 'error'; error: string }

interface Props {
  brief: Brief
  paragraph: BriefParagraph
  onOpen: (item: DeliveredItem) => void
  onOpenWaiting: (w: WaitingInfo) => void
  /** Asks Claude again after the paragraph failed. */
  onRetry: () => void
  onDismiss: () => void
}

/** Rows of "Needs you" shown before "Show all". */
const FIRST_ROWS = 4

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
/** The first name of "Priya Shah <priya@…>" (or the address itself, when there is no name). */
const firstName = (s: string) => (s.split('<')[0] ?? '').replace(/"/g, '').trim().split(/[\s,]+/)[0] || s.trim()

/** "no reply since Tue 3 Nov" for a nudged message, "due 16:00" for one coming back today. */
function waitingWhy(w: WaitingInfo): string {
  return w.nudgedAt ? `no reply since ${day(w.sentAt)}` : `due ${hhmm(w.dueAt)}`
}

/**
 * The Brief at the top of the Inbox and All Inboxes after a Delivery that brought mail: what needs the user, with a
 * reason, then everything else grouped. The day's first one is the Morning brief, which adds the overnight count
 * and the replies still awaited. All local; the optional Claude paragraph comes in above when it is ready and the
 * card never waits for it.
 */
export function BriefCard({ brief, paragraph, onOpen, onOpenWaiting, onRetry, onDismiss }: Props) {
  const [allNeeds, setAllNeeds] = useState(false)
  const [openKind, setOpenKind] = useState<string | null>(null)
  const needs = allNeeds ? brief.needs : brief.needs.slice(0, FIRST_ROWS)
  const hiddenNeeds = brief.needs.length - needs.length
  const also = brief.people.length + brief.kinds.length > 0
  const kind = brief.kinds.find((k) => k.category === openKind)
  const now = new Date()

  return (
    <section className={`brief ${brief.morning ? 'is-morning' : ''}`} aria-label={brief.morning ? 'Morning brief' : 'Brief'}>
      <header className="brief-head">
        <Clock size={13} className="brief-icon" aria-hidden />
        <h2 className="brief-title">{briefHeading(brief)}</h2>
        <button type="button" className="sq-btn brief-close" title="Dismiss the Brief" aria-label="Dismiss the Brief" onClick={onDismiss}>
          <X size={13} />
        </button>
      </header>
      <div className="brief-body">
        {brief.overnight && (
          <p className="brief-overnight">
            {brief.overnight.count === 1 ? 'It came' : brief.overnight.count === 2 ? 'Both came' : `All ${brief.overnight.count} came`}{' '}
            overnight, since {sinceText(brief.overnight.since, now)}.
          </p>
        )}

        {paragraph.state !== 'off' && (
          <div className="brief-ai" aria-live="polite">
            <div className="brief-ai-head">
              <Sparkles size={12} aria-hidden />
              <span className="ai-sent" title="The sender, subject and preview of each delivered message were sent to Claude">
                Sent to Claude
              </span>
            </div>
            {paragraph.state === 'loading' && <p className="brief-ai-text is-loading">Claude is writing a summary…</p>}
            {paragraph.state === 'done' && <p className="brief-ai-text">{paragraph.text}</p>}
            {paragraph.state === 'error' && (
              <p className="brief-ai-text is-error">
                {paragraph.error}{' '}
                <button type="button" className="brief-more" onClick={onRetry}>
                  Try again
                </button>
              </p>
            )}
          </div>
        )}

        {brief.needs.length > 0 && (
          <div className="brief-section">
            <div className="brief-label">Needs you</div>
            {needs.map(({ item, reason }) => (
              <button key={`${item.accountId}|${item.uid}`} type="button" className="brief-row" onClick={() => onOpen(item)}>
                <span className="brief-from">{item.from.name || item.from.email}</span>
                <span className="brief-subject">{item.subject || '(No Subject)'}</span>
                <span className={`brief-why is-${reason}`}>{REASON_TEXT[reason]}</span>
              </button>
            ))}
            {hiddenNeeds > 0 && (
              <button type="button" className="brief-more" onClick={() => setAllNeeds(true)}>
                Show {hiddenNeeds} more
              </button>
            )}
          </div>
        )}

        {brief.waiting.length > 0 && (
          <div className="brief-section">
            <div className="brief-label">Still waiting for a reply</div>
            {brief.waiting.map((w) => (
              <button key={w.id} type="button" className="brief-row" onClick={() => onOpenWaiting(w)}>
                <span className="brief-from">To {firstName(w.to)}</span>
                <span className="brief-subject">{w.subject || '(No Subject)'}</span>
                <span className={`brief-why ${w.nudgedAt ? 'is-nudged' : ''}`}>{waitingWhy(w)}</span>
              </button>
            ))}
          </div>
        )}

        {also && (
          <div className="brief-section">
            <div className="brief-label">{brief.needs.length ? 'Also' : 'Delivered'}</div>
            <div className="brief-also">
              {brief.people.map((p) => (
                <button
                  key={p.email}
                  type="button"
                  className="brief-chip"
                  title={p.items.map((i) => i.subject).join('\n')}
                  onClick={() => onOpen(p.items[0]!)}
                >
                  {p.name}
                  {p.items.length > 1 && <span className="brief-chip-n">{p.items.length}</span>}
                </button>
              ))}
              {brief.kinds.map((k) => (
                <button
                  key={k.category}
                  type="button"
                  className={`brief-chip is-kind ${openKind === k.category ? 'is-open' : ''}`}
                  aria-expanded={openKind === k.category}
                  onClick={() => setOpenKind(openKind === k.category ? null : k.category)}
                >
                  {k.label}
                  <ChevronDown size={11} className="brief-chip-chev" aria-hidden />
                </button>
              ))}
            </div>
            {kind && (
              <div className="brief-kind-list">
                {kind.items.map((item) => (
                  <button key={`${item.accountId}|${item.uid}`} type="button" className="brief-row is-small" onClick={() => onOpen(item)}>
                    <span className="brief-from">{item.from.name || item.from.email}</span>
                    <span className="brief-subject">{item.subject || '(No Subject)'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {brief.more > 0 && <p className="brief-overnight">{brief.more} more not listed.</p>}
      </div>
    </section>
  )
}
