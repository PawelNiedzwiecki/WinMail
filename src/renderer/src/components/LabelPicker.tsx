import { Check, Minus, Plus, Search, Settings2 } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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

/** A label as drawn in the list: indented under its parent when "Parent/Child" and the parent is a label too. */
interface Entry {
  label: LabelInfo
  depth: number
  /** The part of the name to show: the leaf under a parent, the whole name otherwise. */
  text: string
  /** "Parent / " shown muted before the name while searching, so nested labels keep their context. */
  path?: string
}

type Row = { kind: 'label'; entry: Entry } | { kind: 'create'; name: string }
type Section = { title?: string; rows: Row[] }

/** Splits "Parent/Child" into the muted path and the name to show. */
function splitPath(name: string): { path?: string; text: string } {
  const i = name.lastIndexOf('/')
  return i > 0 ? { path: name.slice(0, i), text: name.slice(i + 1) } : { text: name }
}

/**
 * Orders labels as a tree (children right after their parent, siblings in the account's order) and works out
 * each one's indent. A child whose parent isn't in `labels` sits at the top level with its parent path muted.
 */
function toTree(labels: LabelInfo[]): Entry[] {
  const byName = new Map(labels.map((l) => [l.name, l]))
  const parentOf = (l: LabelInfo): LabelInfo | undefined => {
    const i = l.name.lastIndexOf('/')
    return i > 0 ? byName.get(l.name.slice(0, i)) : undefined
  }
  const children = new Map<string, LabelInfo[]>()
  const roots: LabelInfo[] = []
  for (const l of labels) {
    const parent = parentOf(l)
    if (parent) children.set(parent.id, [...(children.get(parent.id) ?? []), l])
    else roots.push(l)
  }
  const out: Entry[] = []
  const walk = (l: LabelInfo, depth: number, prefix: string) => {
    out.push({ label: l, depth, text: depth ? l.name.slice(prefix.length + 1) : l.name })
    for (const c of children.get(l.id) ?? []) walk(c, depth + 1, l.name)
  }
  for (const r of roots) {
    const start = out.length
    walk(r, 0, '')
    Object.assign(out[start]!, splitPath(r.name))
  }
  return out
}

/** The name with the first match of the search in bold. */
function highlight(text: string, needle: string): ReactNode {
  if (!needle) return text
  const i = text.toLowerCase().indexOf(needle)
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="label-match">{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </>
  )
}

/**
 * "Labels…": every label of the account with a tick for the ones on the selection (a dash when only some
 * messages have it), filtered as you type. Labels already on the messages when it opened are listed first and
 * stay put while you toggle, so nothing jumps under the pointer. Clicking applies at once and the picker stays
 * open for more.
 */
export function LabelPicker(p: Props) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const n = p.items.length

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of p.items) for (const l of m.labels ?? []) map.set(l, (map.get(l) ?? 0) + 1)
    return map
  }, [p.items])

  // Captured once: which labels count as "applied" for grouping, so toggling doesn't reshuffle the list.
  const [appliedAtOpen] = useState(() => new Set(counts.keys()))

  const all = useMemo(() => p.labels?.labels ?? [], [p.labels])
  const needle = q.trim().toLowerCase()

  const sections = useMemo<Section[]>(() => {
    if (needle) {
      // Searching flattens the tree; the parent path is shown muted so "Blizzard" still reads as under "Gry".
      const rows: Row[] = toTree(all.filter((l) => l.name.toLowerCase().includes(needle))).map((e) => ({
        kind: 'label',
        entry: { ...e, depth: 0, ...splitPath(e.label.name) }
      }))
      const exact = all.some((l) => l.name.toLowerCase() === needle)
      if (!exact) rows.push({ kind: 'create', name: q.trim() })
      return [{ rows }]
    }
    const toRows = (labels: LabelInfo[]): Row[] => toTree(labels).map((entry) => ({ kind: 'label', entry }))
    const applied = all.filter((l) => appliedAtOpen.has(l.id))
    if (!applied.length) return [{ rows: toRows(all) }]
    return [
      { title: n > 1 ? 'On these messages' : 'On this message', rows: toRows(applied) },
      { title: 'All labels', rows: toRows(all.filter((l) => !appliedAtOpen.has(l.id))) }
    ]
  }, [all, needle, q, appliedAtOpen, n])

  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections])

  // Keep the keyboard row in view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = async (row: Row | undefined) => {
    if (!row || creating) return
    if (row.kind === 'label') {
      p.onToggle(row.entry.label, (counts.get(row.entry.label.id) ?? 0) < n)
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
  const title = n > 1 ? `Label ${n} messages` : 'Labels'
  let index = -1

  return (
    <Dialog
      title={title}
      onClose={p.onClose}
      className="dialog-picker dialog-labels"
      footer={
        <>
          <button className="btn btn-quiet label-manage" onClick={p.onManage}>
            <Settings2 size={13} />
            Manage labels
          </button>
          {support !== 'none' && (
            <span className="label-keys" aria-hidden>
              <kbd>↑</kbd>
              <kbd>↓</kbd> move <kbd>↵</kbd> toggle <kbd>Esc</kbd> done
            </span>
          )}
        </>
      }
    >
      {support === 'none' ? (
        <div className="picker-empty label-unsupported">
          This account’s server can’t store labels on messages, so WinMail can’t add them here. Gmail, iCloud and
          Fastmail accounts can.
        </div>
      ) : (
        <>
          <label className="label-search">
            <Search size={14} aria-hidden />
            <input
              autoFocus
              placeholder="Search or create a label"
              aria-label="Search or create a label"
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
          </label>
          <div className="picker-list label-list" role="menu" aria-label="Labels" ref={listRef} onMouseLeave={() => setActive(-1)}>
            {!p.labels && <div className="picker-empty">Loading labels…</div>}
            {sections.map((s, si) => (
              <Fragment key={s.title ?? si}>
                {s.title && s.rows.length > 0 && (
                  <div className="label-section" role="presentation">
                    {s.title}
                  </div>
                )}
                {s.rows.map((row) => {
                  const i = ++index
                  const cls = `label-row${i === active ? ' is-active' : ''}`
                  if (row.kind === 'create') {
                    return (
                      <button
                        key="create"
                        data-index={i}
                        role="menuitem"
                        className={`${cls} label-create`}
                        disabled={creating}
                        onMouseMove={() => setActive(i)}
                        onClick={() => void choose(row)}
                      >
                        <span className="label-create-icon" aria-hidden>
                          <Plus size={12} strokeWidth={2.5} />
                        </span>
                        <span className="label-name">
                          {creating ? (
                            'Creating…'
                          ) : (
                            <>
                              Create <strong>“{row.name}”</strong>
                            </>
                          )}
                        </span>
                      </button>
                    )
                  }
                  const { label, depth, text, path } = row.entry
                  const have = counts.get(label.id) ?? 0
                  const state = have === 0 ? false : have === n ? true : 'mixed'
                  return (
                    <button
                      key={label.id}
                      data-index={i}
                      role="menuitemcheckbox"
                      aria-checked={state}
                      title={label.name}
                      className={`${cls}${state ? ' is-on' : ''}`}
                      style={depth ? { paddingLeft: 10 + depth * 18 } : undefined}
                      onMouseMove={() => setActive(i)}
                      onClick={() => void choose(row)}
                    >
                      <span className={`label-check${state ? ' is-on' : ''}`} aria-hidden>
                        {state === true ? (
                          <Check size={11} strokeWidth={3.25} />
                        ) : state === 'mixed' ? (
                          <Minus size={11} strokeWidth={3.25} />
                        ) : null}
                      </span>
                      <LabelDot colour={label.colour} size={8} />
                      <span className="label-name">
                        {path && <span className="label-path">{path} / </span>}
                        {highlight(text, needle)}
                      </span>
                      {state === 'mixed' && (
                        <span className="label-count">
                          {have} of {n}
                        </span>
                      )}
                    </button>
                  )
                })}
              </Fragment>
            ))}
            {p.labels && rows.length === 0 && (
              <div className="picker-empty">No labels yet. Type a name to create one.</div>
            )}
          </div>
        </>
      )}
    </Dialog>
  )
}
