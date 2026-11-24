import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { MessageSummary } from '@shared/types'
import { arrivedOf, issueTitle, type IssueGroup } from '@shared/newsletters'
import { formatListDate } from '../format'

interface Props {
  /** Every issue, newest first. */
  issues: IssueGroup<MessageSummary>[]
  /** The issue shown, an index into `issues`. */
  index: number
  onIssue: (index: number) => void
  selectedKey: string | null
  checkedKeys?: Set<string>
  /** A different list is loading: placeholder cards instead of the previous ones. */
  loading: boolean
  switching?: boolean
  status?: { text: string; busy: boolean } | null
  error: string | null
  /** account id -> name, on each card when more than one account is enabled. */
  accountLabels?: Record<string, string>
  onSelect: (key: string, mods?: { toggle: boolean; range: boolean }) => void
  onOpen?: (key: string) => void
  onContextMenu?: (key: string, x: number, y: number) => void
}

/** Colours for a sender's mark, picked by its address so each newsletter keeps its own. */
const MARKS = ['#2563eb', '#7c3aed', '#db2777', '#d97706', '#059669', '#0891b2', '#dc2626', '#4f46e5']
function markColour(email: string): string {
  let h = 0
  for (const ch of email.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return MARKS[h % MARKS.length]!
}

/**
 * The Magazine: one issue of Newsletters as a contents page. Each card opens its article in the reading pane; ‹ ›
 * step through issues. No count anywhere pulls the user in: the header says how many articles, and that is all.
 */
export function MagazineContents(p: Props) {
  const group = p.issues[p.index] ?? null
  const items = group?.items ?? []
  const unread = items.filter((m) => !m.seen).length
  const showSkeleton = p.loading && (p.issues.length === 0 || !!p.switching)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const title = group ? issueTitle(group.issue, new Date()) : 'Magazine'

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [p.selectedKey])
  // A new issue starts at its top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [group?.issue.key])

  const older = p.index + 1 < p.issues.length
  const newer = p.index > 0

  return (
    <section className="list magazine">
      <header className="list-header">
        <div className="list-heading">
          <span className="mag-kicker">Magazine</span>
          <h1>{showSkeleton ? 'Magazine' : title}</h1>
          <span className="list-sub">
            {showSkeleton
              ? 'Loading…'
              : group
                ? `${items.length} ${items.length === 1 ? 'article' : 'articles'}${unread ? `, ${unread} unread` : ''}`
                : 'No issues yet'}
          </span>
        </div>
        <div className="mag-nav">
          <button
            className="mag-nav-btn"
            aria-label="Older issue"
            title={older ? `Older issue: ${issueTitle(p.issues[p.index + 1]!.issue, new Date())}` : 'No older issue'}
            disabled={!older || showSkeleton}
            onClick={() => p.onIssue(p.index + 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="mag-nav-btn"
            aria-label="Newer issue"
            title={newer ? `Newer issue: ${issueTitle(p.issues[p.index - 1]!.issue, new Date())}` : 'This is the newest issue'}
            disabled={!newer || showSkeleton}
            onClick={() => p.onIssue(p.index - 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>
      {p.error && <div className="list-error">{p.error}</div>}
      <div className="list-scroll mag-scroll" ref={scrollRef} role="listbox" aria-label={title} aria-multiselectable tabIndex={-1}>
        {showSkeleton && <MagazineSkeleton />}
        {!showSkeleton && !p.loading && !group && !p.error && (
          <div className="mag-empty">
            <p className="mag-empty-title">No newsletters yet</p>
            <p>New ones will collect here as they arrive, one issue a day.</p>
          </div>
        )}
        {!showSkeleton &&
          items.map((m) => {
            const selected = m.key === p.selectedKey || !!p.checkedKeys?.has(m.key)
            const name = m.from.name || m.from.email
            return (
              <button
                key={m.key}
                ref={m.key === p.selectedKey ? selectedRef : undefined}
                role="option"
                aria-selected={selected}
                className={`mag-card ${selected ? 'is-selected' : ''} ${m.seen ? '' : 'is-unread'}`}
                onClick={(e) => p.onSelect(m.key, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })}
                onDoubleClick={() => p.onOpen?.(m.key)}
                onContextMenu={(e) => {
                  if (!p.onContextMenu) return
                  e.preventDefault()
                  if (!selected) p.onSelect(m.key)
                  p.onContextMenu(m.key, e.clientX, e.clientY)
                }}
              >
                <span className="mag-masthead">
                  <span className="mag-mark" style={{ background: markColour(m.from.email) }} aria-hidden>
                    {name.trim().charAt(0).toUpperCase() || '?'}
                  </span>
                  <span className="mag-sender">{name}</span>
                  {!m.seen && <span className="unread-dot" aria-label="Unread" />}
                  <span className="mag-time">{formatListDate(arrivedOf(m).toISOString())}</span>
                </span>
                <span className="mag-title">{m.subject}</span>
                {m.preview && <span className="mag-preview">{m.preview}</span>}
                {p.accountLabels && <span className="row-account mag-account">{p.accountLabels[m.accountId]}</span>}
              </button>
            )
          })}
      </div>
      <footer className={`list-status ${p.status?.busy ? '' : 'is-done'}`} role="status">
        {p.status && !showSkeleton && (
          <>
            {p.status.busy && <span className="spinner" />}
            {p.status.text}
          </>
        )}
      </footer>
    </section>
  )
}

const SKELETON_CARDS: [number, number, number][] = [
  [38, 82, 92],
  [30, 70, 86],
  [44, 90, 74],
  [34, 64, 88]
]

/** Placeholder cards with the same layout as real ones. */
function MagazineSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the Magazine">
      {SKELETON_CARDS.map(([sender, title, preview], i) => (
        <div key={i} className="mag-card skel-card" aria-hidden="true">
          <span className="mag-masthead">
            <span className="mag-mark skel-mark" />
            <span className="skel-line" style={{ width: `${sender}%` }} />
          </span>
          <span className="skel-line skel-title" style={{ width: `${title}%` }} />
          <span className="skel-line" style={{ width: `${preview}%` }} />
          <span className="skel-line" style={{ width: `${preview - 22}%` }} />
        </div>
      ))}
    </div>
  )
}
