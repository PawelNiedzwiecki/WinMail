import { Sparkles, X } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import type { GmailCategory, MailQuery, MailQueryFolder } from '@shared/types'

interface Props {
  question: string
  query: MailQuery
  /** Called with the query after a chip was edited or removed; the search runs again without asking Claude. */
  onChange: (query: MailQuery) => void
  onClose: () => void
}

type ListField = 'from' | 'to' | 'subject' | 'words'
type DateField = 'after' | 'before'

interface Chip {
  id: string
  label: string
  value: string
  /** Text chips edit as a comma-separated list, date chips with a date picker; the rest can only be removed. */
  edit?: { kind: 'list'; field: ListField } | { kind: 'date'; field: DateField }
  remove: (q: MailQuery) => MailQuery
}

const FOLDERS: Record<MailQueryFolder, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  drafts: 'Drafts',
  archive: 'Archive',
  junk: 'Junk',
  trash: 'Bin',
  all: 'All mail'
}

const CATEGORIES: Record<GmailCategory, string> = {
  primary: 'Primary',
  social: 'Social',
  promotions: 'Promotions',
  updates: 'Updates',
  forums: 'Forums'
}

/** "2026-09-01" as "1 Sep 2026". */
export function ukDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** How Claude read the question, one chip per condition, in reading order. */
export function chipsOf(q: MailQuery): Chip[] {
  const chips: Chip[] = []
  const list = (field: ListField, label: string, joiner: string) => {
    if (q[field].length)
      chips.push({
        id: field,
        label,
        value: q[field].join(joiner),
        edit: { kind: 'list', field },
        remove: (x) => ({ ...x, [field]: [] })
      })
  }
  list('from', 'From', ' or ')
  list('to', 'To', ' or ')
  list('subject', 'Subject', ', ')
  list('words', 'Contains', ', ')
  if (q.after)
    chips.push({ id: 'after', label: 'Since', value: ukDate(q.after), edit: { kind: 'date', field: 'after' }, remove: (x) => ({ ...x, after: null }) })
  if (q.before)
    chips.push({ id: 'before', label: 'Until', value: ukDate(q.before), edit: { kind: 'date', field: 'before' }, remove: (x) => ({ ...x, before: null }) })
  if (q.read) chips.push({ id: 'read', label: '', value: q.read === 'unread' ? 'Unread' : 'Read', remove: (x) => ({ ...x, read: null }) })
  if (q.flagged) chips.push({ id: 'flagged', label: '', value: 'Flagged', remove: (x) => ({ ...x, flagged: false }) })
  if (q.hasAttachment)
    chips.push({ id: 'attachment', label: '', value: 'Has attachment', remove: (x) => ({ ...x, hasAttachment: false }) })
  if (q.category)
    chips.push({ id: 'category', label: 'Category', value: CATEGORIES[q.category], remove: (x) => ({ ...x, category: null }) })
  if (q.folder) chips.push({ id: 'folder', label: 'In', value: FOLDERS[q.folder], remove: (x) => ({ ...x, folder: null }) })
  return chips
}

/** Under the list header during an AI search: what Claude searched for, as chips to edit or remove. */
export function AiSearchBar(p: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const chips = chipsOf(p.query)

  const commitList = (field: ListField, text: string) => {
    const values = text
      .split(',')
      .flatMap((s) => s.split(/\s+or\s+/i))
      .map((s) => s.trim())
      .filter(Boolean)
    p.onChange({ ...p.query, [field]: values })
    setEditing(null)
  }
  const commitDate = (field: DateField, value: string) => {
    const next = { ...p.query, [field]: value || null }
    if (next.after && next.before && next.after > next.before) [next.after, next.before] = [next.before, next.after]
    p.onChange(next)
    setEditing(null)
  }

  return (
    <div className="ai-bar" role="group" aria-label="How Claude searched">
      <div className="ai-bar-head">
        <Sparkles size={12} />
        <span className="ai-bar-question" title={p.question}>
          {p.question}
        </span>
        <button className="ai-bar-close" title="Close AI search" aria-label="Close AI search" onClick={p.onClose}>
          <X size={12} />
        </button>
      </div>
      <div className="ai-chips">
        {chips.length === 0 && <span className="ai-chip-none">No filters: showing everything here</span>}
        {chips.map((c) =>
          editing === c.id && c.edit ? (
            <ChipEditor
              key={c.id}
              chip={c}
              initial={c.edit.kind === 'list' ? p.query[c.edit.field].join(', ') : (p.query[c.edit.field] ?? '')}
              onCommit={(v) => (c.edit!.kind === 'list' ? commitList(c.edit!.field as ListField, v) : commitDate(c.edit!.field as DateField, v))}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <span key={c.id} className="ai-chip">
              <button
                className="ai-chip-body"
                disabled={!c.edit}
                title={c.edit ? 'Edit' : undefined}
                onClick={() => setEditing(c.id)}
              >
                {c.label && <span className="ai-chip-label">{c.label}</span>}
                <span className="ai-chip-value">{c.value}</span>
              </button>
              <button
                className="ai-chip-x"
                title="Remove"
                aria-label={`Remove ${c.label || c.value}`}
                onClick={() => p.onChange(c.remove(p.query))}
              >
                <X size={10} />
              </button>
            </span>
          )
        )}
      </div>
    </div>
  )
}

function ChipEditor(p: { chip: Chip; initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(p.initial)
  const date = p.chip.edit?.kind === 'date'
  // Enter and Escape unmount the input, which blurs it; only the first ending counts.
  const done = useRef(false)
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit) p.onCommit(value)
    else p.onCancel()
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') finish(true)
    else if (e.key === 'Escape') {
      e.stopPropagation()
      finish(false)
    }
  }
  return (
    <span className="ai-chip is-editing">
      <span className="ai-chip-label">{p.chip.label}</span>
      <input
        autoFocus
        className="ai-chip-input"
        type={date ? 'date' : 'text'}
        value={value}
        size={date ? undefined : Math.max(6, value.length + 1)}
        aria-label={p.chip.label}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => finish(true)}
      />
    </span>
  )
}
