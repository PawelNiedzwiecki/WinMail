import { Folder } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { MailboxInfo } from '@shared/types'
import { Dialog } from './Dialog'

interface Props {
  mailboxes: MailboxInfo[]
  /** The folder the messages are in now; not offered. */
  current: string
  onPick: (path: string) => void
  onClose: () => void
}

/** "Move to…": every folder of the account, filtered as you type. */
export function FolderPicker(p: Props) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return p.mailboxes.filter(
      (b) =>
        b.path !== p.current &&
        b.specialUse !== 'drafts' &&
        b.specialUse !== 'snoozed' &&
        (!needle || b.name.toLowerCase().includes(needle) || b.path.toLowerCase().includes(needle))
    )
  }, [p.mailboxes, p.current, q])

  const pick = (b: MailboxInfo | undefined) => {
    if (!b) return
    p.onClose()
    p.onPick(b.path)
  }

  return (
    <Dialog title="Move to" onClose={p.onClose} className="dialog-picker">
      <input
        className="dialog-filter"
        autoFocus
        placeholder="Find a folder"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(list.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(list[active])
          }
        }}
      />
      <div className="picker-list" role="listbox">
        {list.map((b, i) => (
          <button
            key={b.path}
            role="option"
            aria-selected={i === active}
            className={`picker-item ${i === active ? 'is-active' : ''}`}
            style={{ paddingLeft: 10 + (q ? 0 : b.depth * 14) }}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(b)}
          >
            <Folder size={14} />
            <span>{q ? b.path : b.name}</span>
          </button>
        ))}
        {list.length === 0 && <div className="picker-empty">No matching folders</div>}
      </div>
    </Dialog>
  )
}
