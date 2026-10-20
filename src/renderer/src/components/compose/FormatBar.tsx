import {
  Bold,
  Italic,
  Link2,
  List,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  TextQuote,
  Underline,
  Undo2,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { touch } from '../../compose/autosave'
import { exec, isActive, toggleQuote, type FormatCommand } from '../../compose/editorCommands'
import { editorOf } from '../../compose/sessions'

interface Props {
  id: string
  onLink: () => void
}

interface Item {
  cmd: FormatCommand
  icon: LucideIcon
  label: string
  /** Shows pressed while the cursor is in text with this format. */
  state?: boolean
}

const GROUPS: Item[][] = [
  [
    { cmd: 'undo', icon: Undo2, label: 'Undo (Ctrl+Z)' },
    { cmd: 'redo', icon: Redo2, label: 'Redo (Ctrl+Y)' }
  ],
  [
    { cmd: 'bold', icon: Bold, label: 'Bold (Ctrl+B)', state: true },
    { cmd: 'italic', icon: Italic, label: 'Italic (Ctrl+I)', state: true },
    { cmd: 'underline', icon: Underline, label: 'Underline (Ctrl+U)', state: true },
    { cmd: 'strikeThrough', icon: Strikethrough, label: 'Strikethrough (Alt+Shift+5)', state: true }
  ],
  [
    { cmd: 'insertOrderedList', icon: ListOrdered, label: 'Numbered list (Ctrl+Shift+7)', state: true },
    { cmd: 'insertUnorderedList', icon: List, label: 'Bulleted list (Ctrl+Shift+8)', state: true },
    { cmd: 'outdent', icon: ListIndentDecrease, label: 'Indent less (Ctrl+[)' },
    { cmd: 'indent', icon: ListIndentIncrease, label: 'Indent more (Ctrl+])' }
  ]
]

/** Gmail's formatting bar, minus fonts, sizes and colours. */
export function FormatBar({ id, onLink }: Props) {
  const [active, setActive] = useState<Set<FormatCommand>>(new Set())

  useEffect(() => {
    const update = () => {
      const root = editorOf(id)?.root()
      const sel = window.getSelection()
      if (!root || !sel?.anchorNode || !root.contains(sel.anchorNode)) return
      const on = new Set<FormatCommand>()
      for (const it of GROUPS.flat()) if (it.state && isActive(it.cmd)) on.add(it.cmd)
      setActive((prev) => (prev.size === on.size && [...on].every((c) => prev.has(c)) ? prev : on))
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [id])

  const run = (fn: () => void) => {
    const root = editorOf(id)?.root()
    if (!root) return
    // Keep the selection: the buttons don't take focus (see onMouseDown below).
    if (document.activeElement !== root) root.focus()
    fn()
    touch(id)
  }

  const btn = (label: string, icon: ReactNode, onClick: () => void, pressed?: boolean, key?: string) => (
    <button
      key={key ?? label}
      className={`fmt-btn${pressed ? ' is-on' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  )

  return (
    <div className="format-bar" role="toolbar" aria-label="Formatting options">
      {GROUPS.map((group, i) => (
        <span className="fmt-group" key={i}>
          {group.map((it) => btn(it.label, <it.icon size={16} />, () => run(() => exec(it.cmd)), it.state ? active.has(it.cmd) : undefined, it.cmd))}
        </span>
      ))}
      <span className="fmt-group">
        {btn('Quote (Ctrl+Shift+9)', <TextQuote size={16} />, () => run(() => toggleQuote(editorOf(id)!.root()!)))}
        {btn('Insert link (Ctrl+K)', <Link2 size={16} />, onLink)}
        {btn('Remove formatting (Ctrl+\\)', <RemoveFormatting size={16} />, () => run(() => exec('removeFormat')))}
      </span>
    </div>
  )
}
