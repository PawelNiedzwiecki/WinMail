import { Flag, Paperclip } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useEffect, useRef, type CSSProperties, type ReactNode, type UIEvent } from 'react'
import type { ListDensity, MessageSummary } from '@shared/types'
import { formatListDate } from '../format'
import { useReduceMotion } from '../motion'

const ROW_MS = 0.18

/**
 * A message that arrives grows in and one that leaves collapses, so the rows around it slide
 * instead of jumping. `instant` (a new folder, category or search) skips both, so a wholesale
 * swap doesn't animate every row at once. It reaches leaving rows through AnimatePresence's custom.
 */
const rowVariants: Variants = {
  hidden: { opacity: 0, height: 0 },
  shown: { opacity: 1, height: 'auto', transition: { duration: ROW_MS, ease: 'easeOut' } },
  gone: (instant: boolean) =>
    instant
      ? { opacity: 0, transition: { duration: 0 } }
      : { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, transition: { duration: ROW_MS, ease: 'easeOut' } }
}

interface Props {
  /** Lines of message text under the subject; 0 = title only. */
  previewLines: 0 | 1 | 2 | 3
  density: ListDensity
  title: string
  subtitle?: string
  messages: MessageSummary[]
  selectedKey: string | null
  loading: boolean
  /** A different list is loading: show placeholder rows instead of the previous list. */
  switching?: boolean
  /** Background activity shown in the footer, e.g. "Checking for new mail…". */
  status?: { text: string; busy: boolean } | null
  error: string | null
  /** account id -> label, shown on rows in the unified inbox */
  accountLabels?: Record<string, string>
  /** Older messages exist on the server beyond what is loaded. */
  hasMore?: boolean
  /** Messages with a reply being written, tagged "Draft". */
  draftKeys?: Set<string>
  /** Messages picked with Ctrl or Shift, besides the selected one. */
  checkedKeys?: Set<string>
  /** Message key -> messages in its conversation, when more than one. */
  threadCounts?: Map<string, number>
  /** Tabs above the list, e.g. Gmail inbox categories. */
  tabs?: ReactNode
  /** What the list shows (folder, category, search); when it changes, rows swap without animating. */
  view?: string
  onSelect: (key: string, mods?: { toggle: boolean; range: boolean }) => void
  /** Double-click or Enter on a row. */
  onOpen?: (key: string) => void
  /** Right-click on a row; the row is selected first. */
  onContextMenu?: (key: string, x: number, y: number) => void
  onLoadMore?: () => void
}

export function MessageList(p: Props) {
  const unread = p.messages.filter((m) => !m.seen).length
  const showSkeleton = p.loading && (p.messages.length === 0 || !!p.switching)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const reduceMotion = useReduceMotion()
  const shownView = useRef(p.view)
  const instant = reduceMotion || shownView.current !== p.view
  useEffect(() => {
    shownView.current = p.view
  }, [p.view])

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [p.selectedKey])

  // Older messages load on their own as the end of the list comes into view.
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (p.hasMore && !p.loading && el.scrollHeight - el.scrollTop - el.clientHeight < 200) p.onLoadMore?.()
  }

  return (
    <section
      className={`list density-${p.density}`}
      style={{ '--preview-lines': p.previewLines } as CSSProperties}
    >
      <header className="list-header">
        <h1>{p.title}</h1>
        <span className="list-sub">
          {p.subtitle ? `${p.subtitle} · ` : ''}
          {showSkeleton
            ? 'Loading…'
            : `${p.messages.length} ${p.messages.length === 1 ? 'message' : 'messages'}${unread ? `, ${unread} unread` : ''}`}
        </span>
      </header>
      {p.tabs}
      {p.error && <div className="list-error">{p.error}</div>}
      <div className="list-scroll" role="listbox" aria-multiselectable tabIndex={-1} onScroll={onScroll}>
        {showSkeleton && <ListSkeleton previewLines={p.previewLines} />}
        {!p.loading && p.messages.length === 0 && !p.error && <div className="list-empty">No messages</div>}
        {!showSkeleton && (
          <AnimatePresence initial={false} custom={instant}>
            {p.messages.map((m) => {
              const selected = m.key === p.selectedKey || !!p.checkedKeys?.has(m.key)
              const count = p.threadCounts?.get(m.key)
              return (
                <motion.button
                  key={m.key}
                  ref={m.key === p.selectedKey ? selectedRef : undefined}
                  // Padding isn't animated on the way in, so the measured 'auto' height is exact.
                  variants={rowVariants}
                  custom={instant}
                  initial={instant ? false : 'hidden'}
                  animate="shown"
                  exit="gone"
                  style={{ overflow: 'hidden' }}
                  role="option"
                  aria-selected={selected}
                  className={`row ${selected ? 'is-selected' : ''} ${m.seen ? '' : 'is-unread'}`}
                  onClick={(e) => p.onSelect(m.key, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })}
                  onDoubleClick={() => p.onOpen?.(m.key)}
                  onContextMenu={(e) => {
                    if (!p.onContextMenu) return
                    e.preventDefault()
                    if (!selected) p.onSelect(m.key)
                    p.onContextMenu(m.key, e.clientX, e.clientY)
                  }}
                >
                  <div className="row-gutter">
                    {!m.seen && <span className="unread-dot" />}
                    {m.flagged && <Flag size={11} className="row-flag" fill="currentColor" />}
                  </div>
                  <div className="row-main">
                    <div className="row-top">
                      <span className="row-from">
                        {m.from.name || m.from.email}
                        {count ? <span className="row-count">{count}</span> : null}
                        {p.draftKeys?.has(m.key) && <span className="row-draft">Draft</span>}
                      </span>
                      <span className="row-date">{formatListDate(m.date)}</span>
                    </div>
                    <div className="row-subject">
                      <span className="row-subject-text">{m.subject}</span>
                      {m.hasAttachments ? <Paperclip size={11} className="row-clip" /> : null}
                      {p.accountLabels && <span className="row-account">{p.accountLabels[m.accountId]}</span>}
                    </div>
                    {p.previewLines > 0 && <div className="row-preview">{m.preview}</div>}
                  </div>
                </motion.button>
              )
            })}
          </AnimatePresence>
        )}
        {p.hasMore && p.messages.length > 0 && !showSkeleton && (
          <button className="btn list-more" disabled={p.loading} onClick={p.onLoadMore}>
            {p.loading ? 'Loading…' : 'Load Older Messages'}
          </button>
        )}
      </div>
      {/* Always rendered with a fixed height, so status changes don't resize the list above it. */}
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

const SKELETON_ROWS: [number, number, number][] = [
  [46, 88, 72],
  [34, 76, 90],
  [52, 92, 60],
  [40, 70, 84],
  [58, 84, 66],
  [36, 90, 78],
  [48, 74, 88],
  [42, 82, 62],
  [54, 78, 86],
  [38, 94, 70]
]

/** Placeholder rows with the same layout as real ones, shown while a different list loads. */
function ListSkeleton({ previewLines }: { previewLines: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading messages">
      {SKELETON_ROWS.map(([from, subject, preview], i) => (
        <div key={i} className="row skel-row" aria-hidden="true">
          <div className="row-gutter" />
          <div className="row-main">
            <div className="row-top">
              <span className="skel-line" style={{ width: `${from}%` }} />
              <span className="skel-line skel-date" />
            </div>
            <div className="skel-line" style={{ width: `${subject}%` }} />
            {previewLines > 0 && <div className="skel-line" style={{ width: `${preview}%` }} />}
          </div>
        </div>
      ))}
    </div>
  )
}
