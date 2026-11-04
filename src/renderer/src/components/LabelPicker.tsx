import { Check, Minus, Plus, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AccountLabels, LabelInfo, MessageSummary } from '@shared/types'
import { Dialog } from './Dialog'
import { LabelDot } from './LabelChips'

interface Props {
  /** Null while the account's labels are still loading. */
  labels: AccountLabels | null
  /** The messages being labelled, all in one account. */
  items: MessageSummary[]
  /** Adds the label to every message (`on`) or takes it off all of them. */
  onToggle: (label: LabelInfo, on: boolean) => void
  /** Makes a label and puts it on the messages. */
  onCreate: (name: string) => Promise<void>
  onManage: () => void
  onClose: () => void
}

type Row = { kind: 'label'; label: LabelInfo } | { kind: 'create'; name: string }

/**
 * "Labels…": every label of the account with a tick for the ones on the selection (a dash when only some
 * messages have it), filtered as you type. Clicking applies at once and the picker stays open for more.
 */
export function LabelPicker(p: Props) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)
  const n = p.items.length

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of p.items) for (const l of m.labels ?? []) map.set(l, (map.get(l) ?? 0) + 1)
    return map
  }, [p.items])

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase()
    const list = (p.labels?.labels ?? []).filter((l) => !needle || l.name.toLowerCase().includes(needle))
    const out: Row[] = list.map((label) => ({ kind: 'label', label }))
    const exact = (p.labels?.labels ?? []).some((l) => l.name.toLowerCase() === needle)
    if (needle && !exact) out.push({ kind: 'create', name: q.trim() })
    return out
  }, [p.labels, q])

  const choose = async (row: Row | undefined) => {
    if (!row || creating) return
    if (row.kind === 'label') {
      p.onToggle(row.label, (counts.get(row.label.id) ?? 0) < n)
      return
    }
    setCreating(true)
    try {
      await p.onCreate(row.name)
      setQ('')
      setActive(0)
    } finally {
      setCreating(false)
    }
  }

  const support = p.labels?.support
  const title = n > 1 ? `Labels for ${n} messages` : 'Labels'

  return (
    <Dialog
      title={title}
      onClose={p.onClose}
      className="dialog-picker dialog-labels"
      footer={
        <button className="btn btn-quiet label-manage" onClick={p.onManage}>
          <Settings2 size={13} />
          Manage labels…
        </button>
      }
    >
      {support === 'none' ? (
        <div className="picker-empty label-unsupported">
          This account’s server can’t store labels on messages, so WinMail can’t add them here. Gmail, iCloud and
          Fastmail accounts can.
        </div>
      ) : (
        <>
          <input
            className="dialog-filter"
            autoFocus
            placeholder="Find or create a label"
            aria-label="Find or create a label"
            value={q}
            disabled={!p.labels}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => Math.min(rows.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                void choose(rows[active])
              }
            }}
          />
          <div className="picker-list" role="menu" aria-label="Labels">
            {!p.labels && <div className="picker-empty">Loading labels…</div>}
            {rows.map((row, i) => {
              const cls = `picker-item label-item ${i === active ? 'is-active' : ''}`
              if (row.kind === 'create') {
                return (
                  <button
                    key="create"
                    role="menuitem"
                    className={cls}
                    disabled={creating}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void choose(row)}
                  >
                    <Plus size={14} />
                    <span>{creating ? 'Creating…' : `Create label “${row.name}”`}</span>
                  </button>
                )
              }
              const have = counts.get(row.label.id) ?? 0
              const state = have === 0 ? false : have === n ? true : 'mixed'
              return (
                <button
                  key={row.label.id}
                  role="menuitemcheckbox"
                  aria-checked={state}
                  className={cls}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void choose(row)}
                >
                  <span className={`label-check${state ? ' is-on' : ''}`} aria-hidden>
                    {state === true ? <Check size={11} strokeWidth={3} /> : state === 'mixed' ? <Minus size={11} strokeWidth={3} /> : null}
                  </span>
                  <LabelDot colour={row.label.colour} />
                  <span>{row.label.name}</span>
                </button>
              )
            })}
            {p.labels && rows.length === 0 && (
              <div className="picker-empty">{q ? 'No matching labels' : 'No labels yet. Type a name to create one.'}</div>
            )}
          </div>
        </>
      )}
    </Dialog>
  )
}
