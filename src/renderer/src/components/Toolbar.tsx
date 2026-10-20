import { SquarePen, Search, RefreshCw, X } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  hasAccounts: boolean
  refreshing: boolean
  query: string
  onQuery: (q: string) => void
  onRefresh: () => void
  onCompose: () => void
}

/** Global bar: compose, refresh and search. Per-message actions live in ActionBar. */
export function Toolbar(p: Props) {
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
        <RefreshCw size={16} className={p.refreshing ? 'spin' : ''} />
      </TbButton>
      <div className="tb-spacer" />
      <label className="search">
        <Search size={13} />
        <input
          id="search"
          placeholder="Search"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
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
  children: ReactNode
}) {
  return (
    <button
      className="tb-btn"
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
