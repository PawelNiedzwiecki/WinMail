import { X } from 'lucide-react'
import { useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { Contact } from '@shared/types'
import { initials } from '../../format'
import { chipLabel, format, inQuotes, matches, parseList, tokenStart, type Chip } from '../../compose/addresses'
import type { RecipientField as Field } from '../../compose/sessions'

const MAX_SUGGESTIONS = 8
const CHIP_TYPE = 'application/x-winmail-chip'

interface Props {
  field: Field
  chips: Chip[]
  typing: string
  contacts: Contact[]
  /** Every address already in To, Cc or Bcc, which suggestions leave out. */
  taken: Set<string>
  inputRef?: (el: HTMLInputElement | null) => void
  onChange: (chips: Chip[], typing: string) => void
  /** A chip was dropped here from another field. */
  onDropChip: (from: Field, index: number) => void
}

/** Recipients as chips, with the address being typed after them and suggestions below. */
export function RecipientField(p: Props) {
  const id = useId()
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const input = useRef<HTMLInputElement | null>(null)

  const query = p.typing.slice(tokenStart(p.typing)).trim().toLowerCase()
  const suggestions = useMemo(() => {
    if (!query) return []
    return p.contacts.filter((c) => matches(c, query) && !p.taken.has(c.email.toLowerCase())).slice(0, MAX_SUGGESTIONS)
  }, [p.contacts, p.taken, query])
  const open = focused && !dismissed && suggestions.length > 0
  const current = Math.min(active, suggestions.length - 1)

  /** Typed text becomes chips; an unfinished quoted name stays as text. */
  const commit = (text = p.typing) => {
    if (!text.trim() || inQuotes(text)) return
    p.onChange([...p.chips, ...parseList(text)], '')
  }

  const pick = (c: Contact) => {
    const before = p.typing.slice(0, tokenStart(p.typing))
    p.onChange([...p.chips, ...parseList(before), { name: c.name, email: c.email, valid: true }], '')
    setActive(0)
  }

  const removeChip = (i: number) => {
    p.onChange(p.chips.filter((_, n) => n !== i), p.typing)
    setSelected(null)
  }

  const editChip = (i: number) => {
    const text = format(p.chips[i]!)
    p.onChange(p.chips.filter((_, n) => n !== i), p.typing ? `${p.typing}, ${text}` : text)
    setSelected(null)
    input.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    const k = e.key
    if (open) {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault()
        setActive((current + (k === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
        return
      }
      if ((k === 'Enter' || k === 'Tab') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        pick(suggestions[current]!)
        return
      }
      if (k === 'Escape') {
        // Close the list only, not the card.
        e.stopPropagation()
        setDismissed(true)
        return
      }
    }
    if ((k === 'Enter' || k === 'Tab') && p.typing.trim() && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (k === 'Enter') e.preventDefault()
      commit()
    } else if (k === ',' || k === ';') {
      if (p.typing.trim() && !inQuotes(p.typing)) {
        e.preventDefault()
        commit()
      }
    } else if (k === 'Backspace' && !p.typing && p.chips.length) {
      e.preventDefault()
      if (selected !== null) removeChip(selected)
      else setSelected(p.chips.length - 1)
    } else if (k === 'ArrowLeft' && !p.typing && p.chips.length) {
      e.preventDefault()
      setSelected(selected === null ? p.chips.length - 1 : Math.max(0, selected - 1))
    } else if (k === 'ArrowRight' && selected !== null) {
      e.preventDefault()
      setSelected(selected >= p.chips.length - 1 ? null : selected + 1)
    } else if (k === 'Enter' && selected !== null) {
      e.preventDefault()
      editChip(selected)
    } else if (k === 'Delete' && selected !== null) {
      e.preventDefault()
      removeChip(selected)
    } else if (k.length === 1 || k === 'Escape') {
      if (selected !== null && k !== 'Escape') setSelected(null)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!/[,;\n]/.test(text) && parseList(text).length < 2) return
    e.preventDefault()
    p.onChange([...p.chips, ...parseList(p.typing + text)], '')
  }

  const onDrop = (e: DragEvent) => {
    const data = e.dataTransfer.getData(CHIP_TYPE)
    if (!data) return
    e.preventDefault()
    const { field, index } = JSON.parse(data) as { field: Field; index: number }
    if (field !== p.field) p.onDropChip(field, index)
  }

  return (
    <div
      className="recipient"
      onClick={(e) => e.target === e.currentTarget && input.current?.focus()}
      onDragOver={(e) => e.dataTransfer.types.includes(CHIP_TYPE) && e.preventDefault()}
      onDrop={onDrop}
    >
      {p.chips.map((c, i) => (
        <span
          key={`${c.email}-${i}`}
          className={`chip${c.valid ? '' : ' is-invalid'}${selected === i ? ' is-selected' : ''}`}
          title={c.valid ? c.email : `“${chipLabel(c)}” isn't a valid address`}
          draggable
          onDragStart={(e) => e.dataTransfer.setData(CHIP_TYPE, JSON.stringify({ field: p.field, index: i }))}
          onClick={() => setSelected(i)}
          onDoubleClick={() => editChip(i)}
        >
          <span className="chip-avatar">{initials(chipLabel(c))}</span>
          <span className="chip-label">{chipLabel(c)}</span>
          <button
            className="chip-x"
            tabIndex={-1}
            aria-label={`Remove ${chipLabel(c)}`}
            onClick={(e) => {
              e.stopPropagation()
              removeChip(i)
            }}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        ref={(el) => {
          input.current = el
          p.inputRef?.(el)
        }}
        className="recipient-input"
        value={p.typing}
        role="combobox"
        aria-label={p.field === 'to' ? 'To' : p.field === 'cc' ? 'Cc' : 'Bcc'}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${current}` : undefined}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setSelected(null)
          commit()
        }}
        onChange={(e) => {
          p.onChange(p.chips, e.target.value)
          setDismissed(false)
          setActive(0)
          setSelected(null)
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      {open && (
        <ul className="suggest" id={`${id}-list`} role="listbox" data-compose-popup>
          {suggestions.map((c, i) => (
            <li
              key={c.email}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === current}
              className={i === current ? 'is-active' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c)}
            >
              <span className="suggest-avatar">{initials(c.name || c.email)}</span>
              <span className="suggest-text">
                <span className="suggest-name">{c.name || c.email}</span>
                {c.name && <span className="suggest-email">{c.email}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
