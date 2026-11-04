import { SquarePen, Search, RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  hasAccounts: boolean
  refreshing: boolean
  query: string
  onQuery: (q: string) => void
  onRefresh: () => void
  onCompose: () => void
  /** A Claude key is saved, so the search box can ask Claude. */
  aiAvailable: boolean
  /** The search box takes a question for Claude instead of filtering as you type. */
  aiMode: boolean
  onAiMode: (on: boolean) => void
  /** Enter in AI mode. */
  onAsk: () => void
  /** Claude is reading the question. */
  asking: boolean
}

/** Global bar: compose, refresh and search. Per-message actions live in ActionBar. */
export function Toolbar(p: Props) {
  // The refresh icon finishes the turn it's on instead of snapping back when the check ends.
  const [spinning, setSpinning] = useState(false)
  const refreshing = useRef(p.refreshing)
  refreshing.current = p.refreshing
  useEffect(() => {
    if (p.refreshing) setSpinning(true)
  }, [p.refreshing])

  return (
    <div className="toolbar">
      <button
        className="compose-pill"
        title="New Message (Ctrl+N)"
        aria-label="New Message"
        disabled={!p.hasAccounts}
        onClick={p.onCompose}
      >
        <SquarePen size={15} />
        Compose
      </button>
      <TbButton title="Get New Mail" disabled={!p.hasAccounts} onClick={p.onRefresh}>
        <RefreshCw
          size={16}
          className={spinning ? 'spin' : ''}
          onAnimationIteration={() => !refreshing.current && setSpinning(false)}
        />
      </TbButton>
      <div className="tb-spacer" />
      <label className={p.aiMode ? 'search is-ai' : 'search'}>
        {p.aiAvailable ? (
          <button
            type="button"
            className={`search-ai ${p.asking ? 'is-busy' : ''}`}
            title={p.aiMode ? 'Back to normal search' : 'Ask Claude to find mail (or start with ?)'}
            aria-label={p.aiMode ? 'Back to normal search' : 'Search with Claude'}
            aria-pressed={p.aiMode}
            onClick={(e) => {
              e.preventDefault()
              p.onAiMode(!p.aiMode)
              document.getElementById('search')?.focus()
            }}
          >
            <Sparkles size={13} />
          </button>
        ) : (
          <Search size={13} />
        )}
        <input
          id="search"
          placeholder={p.aiMode ? 'Ask, e.g. invoices from Northwind last month' : 'Search'}
          aria-label={p.aiMode ? 'Ask Claude to find mail, then press Enter' : 'Search'}
          value={p.query}
          onChange={(e) => {
            const v = e.target.value
            // "?" at the start switches to asking Claude, a shortcut to the sparkle button.
            if (p.aiAvailable && !p.aiMode && v.startsWith('?')) {
              p.onAiMode(true)
              p.onQuery(v.slice(1).trimStart())
            } else p.onQuery(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && p.aiMode) {
              e.preventDefault()
              p.onAsk()
            } else if (e.key === 'Escape' && (p.query || p.aiMode)) {
              e.preventDefault()
              e.stopPropagation()
              if (p.query) p.onQuery('')
              else p.onAiMode(false)
            }
          }}
        />
        {p.query ? (
          <button
            type="button"
            className="search-clear"
            title="Clear search"
            aria-label="Clear search"
            onClick={() => p.onQuery('')}
          >
            <X size={12} />
          </button>
        ) : p.aiMode ? (
          <kbd className="search-kbd">Enter</kbd>
        ) : (
          <kbd className="search-kbd">Ctrl F</kbd>
        )}
      </label>
    </div>
  )
}

export function TbButton(props: {
  title: string
  disabled?: boolean
  onClick: () => void
  /** Turns red on hover, for destructive actions. */
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      className={props.danger ? 'tb-btn is-danger' : 'tb-btn'}
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
