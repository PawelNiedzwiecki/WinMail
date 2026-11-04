import { X } from 'lucide-react'
import type { SyntheticEvent } from 'react'
import type { AccountLabels, LabelColour, LabelInfo, MessageSummary } from '@shared/types'

/** The labels to draw for a message, in the account's order; ids the account doesn't list yet still show. */
export function labelsFor(m: MessageSummary, sets: Record<string, AccountLabels>, hide?: string): LabelInfo[] {
  const ids = (m.labels ?? []).filter((id) => id !== hide)
  if (!ids.length) return []
  const known = sets[m.accountId]?.labels ?? []
  const byId = new Map(known.map((l) => [l.id, l]))
  const order = (id: string) => {
    const i = known.findIndex((l) => l.id === id)
    return i < 0 ? known.length : i
  }
  return ids
    .sort((a, b) => order(a) - order(b))
    .map((id) => byId.get(id) ?? { id, name: id.replace(/^\$label(\d)$/i, 'Label $1'), colour: 'grey' as LabelColour })
}

/** A small round swatch of a label colour, for menus and pickers. */
export function LabelDot({ colour, size = 10 }: { colour: LabelColour; size?: number }) {
  return <span className={`label-dot lc-${colour}`} style={{ width: size, height: size }} aria-hidden />
}

interface Props {
  labels: LabelInfo[]
  /** Dots instead of named chips, for compact rows. */
  compact?: boolean
  /** Chips shown before the rest collapse into "+N". */
  max?: number
  onOpen?: (label: LabelInfo) => void
  onRemove?: (label: LabelInfo) => void
}

/**
 * Coloured label chips. Clicking one shows the messages with that label. They sit inside message rows, which are
 * buttons, so they are spans with button roles rather than nested buttons.
 */
export function LabelChips({ labels, compact, max = 3, onOpen, onRemove }: Props) {
  if (!labels.length) return null
  const shown = labels.slice(0, max)
  const rest = labels.length - shown.length
  const open = (l: LabelInfo, e: SyntheticEvent) => {
    if (!onOpen) return
    e.stopPropagation()
    e.preventDefault()
    onOpen(l)
  }
  return (
    <span className={`label-chips${compact ? ' is-compact' : ''}`}>
      {shown.map((l) =>
        compact ? (
          <span
            key={l.id}
            className={`label-dot lc-${l.colour}`}
            title={l.name}
            role={onOpen ? 'button' : undefined}
            aria-label={onOpen ? `Show messages labelled ${l.name}` : l.name}
            onClick={(e) => open(l, e)}
          />
        ) : (
          <span key={l.id} className={`label-chip lc-${l.colour}`} title={onOpen ? `Show messages labelled “${l.name}”` : l.name}>
            <span
              className="label-chip-name"
              role={onOpen ? 'button' : undefined}
              tabIndex={onOpen && onRemove ? 0 : undefined}
              onClick={(e) => open(l, e)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(l, e)}
            >
              {l.name}
            </span>
            {onRemove && (
              <button
                className="label-chip-x"
                title={`Remove “${l.name}”`}
                aria-label={`Remove label ${l.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(l)
                }}
              >
                <X size={10} strokeWidth={2.4} />
              </button>
            )}
          </span>
        )
      )}
      {rest > 0 && (
        <span className="label-more" title={labels.slice(max).map((l) => l.name).join(', ')}>
          +{rest}
        </span>
      )}
    </span>
  )
}
