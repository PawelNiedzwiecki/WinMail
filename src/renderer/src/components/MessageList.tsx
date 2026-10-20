import { Flag, Paperclip } from 'lucide-react'
import { useEffect, useRef, type ReactNode, type UIEvent } from 'react'
import type { MessageSummary } from '@shared/types'
import { formatListDate } from '../format'

interface Props {
  title: string
  subtitle?: string
  messages: MessageSummary[]
  selectedKey: string | null
  loading: boolean
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
  onSelect: (key: string, mods?: { toggle: boolean; range: boolean }) => void
  /** Double-click or Enter on a row. */
  onOpen?: (key: string) => void
  /** Right-click on a row; the row is selected first. */
  onContextMenu?: (key: string, x: number, y: number) => void
  onLoadMore?: () => void
}

export function MessageList(p: Props) {
  const unread = p.messages.filter((m) => !m.seen).length
  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [p.selectedKey])

  // Older messages load on their own as the end of the list comes into view.
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (p.hasMore && !p.loading && el.scrollHeight - el.scrollTop - el.clientHeight < 200) p.onLoadMore?.()
  }

  return (
    <section className="list">
      <header className="list-header">
        <h1>{p.title}</h1>
        <span className="list-sub">
          {p.subtitle ? `${p.subtitle} · ` : ''}
          {p.messages.length} {p.messages.length === 1 ? 'message' : 'messages'}{unread ? `, ${unread} unread` : ''}
        </span>
      </header>
      {p.tabs}
      {p.error && <div className="list-error">{p.error}</div>}
      <div className="list-scroll" role="listbox" aria-multiselectable onScroll={onScroll}>
        {p.loading && p.messages.length === 0 && (
          <div className="list-empty list-loading">
            <span className="spinner" />
            Loading messages…
          </div>
        )}
        {!p.loading && p.messages.length === 0 && !p.error && (
          <div className="list-empty">No messages</div>
        )}
        {p.messages.map((m) => {
          const selected = m.key === p.selectedKey || !!p.checkedKeys?.has(m.key)
          const count = p.threadCounts?.get(m.key)
          return (
            <button
              key={m.key}
              ref={m.key === p.selectedKey ? selectedRef : undefined}
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
                  {p.accountLabels && (
                    <span className="row-account">{p.accountLabels[m.accountId]}</span>
                  )}
                </div>
                <div className="row-preview">{m.preview}</div>
              </div>
            </button>
          )
        })}
        {p.hasMore && p.messages.length > 0 && (
          <button className="btn list-more" disabled={p.loading} onClick={p.onLoadMore}>
            {p.loading ? 'Loading…' : 'Load Older Messages'}
          </button>
        )}
      </div>
      {p.status && !(p.loading && p.messages.length === 0) && (
        <footer className={`list-status ${p.status.busy ? '' : 'is-done'}`} role="status">
          {p.status.busy && <span className="spinner" />}
          {p.status.text}
        </footer>
      )}
    </section>
  )
}
