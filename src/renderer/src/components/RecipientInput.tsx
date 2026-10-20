import { useId, useMemo, useState, type Ref } from 'react'
import type { Contact } from '@shared/types'

const MAX_SUGGESTIONS = 8

interface Props {
  value: string
  onChange: (v: string) => void
  contacts: Contact[]
  inputRef?: Ref<HTMLInputElement>
}

/** Start of the address being typed: after the last comma that isn't inside a quoted name. */
function tokenStart(v: string): number {
  let start = 0
  let quoted = false
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '"' && v[i - 1] !== '\\') quoted = !quoted
    else if ((v[i] === ',' || v[i] === ';') && !quoted) start = i + 1
  }
  return start
}

function format(c: Contact): string {
  if (!c.name) return c.email
  // Names with punctuation must be quoted or the address parser splits them.
  const name = /[",;<>@()[\]:\\.]/.test(c.name) ? `"${c.name.replace(/["\\]/g, '\\$&')}"` : c.name
  return `${name} <${c.email}>`
}

function matches(c: Contact, q: string): boolean {
  const email = c.email.toLowerCase()
  const name = c.name.toLowerCase()
  return (
    email.startsWith(q) ||
    email.slice(email.indexOf('@') + 1).startsWith(q) ||
    name.startsWith(q) ||
    name.split(/\s+/).some((w) => w.startsWith(q))
  )
}

export function RecipientInput({ value, onChange, contacts, inputRef }: Props) {
  const id = useId()
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)

  const start = tokenStart(value)
  const query = value.slice(start).trim().toLowerCase()

  const suggestions = useMemo(() => {
    if (!query) return []
    const before = value.slice(0, start).toLowerCase()
    return contacts
      .filter((c) => matches(c, query) && !before.includes(c.email.toLowerCase()))
      .slice(0, MAX_SUGGESTIONS)
  }, [contacts, query, value, start])

  const open = focused && !dismissed && suggestions.length > 0
  const current = Math.min(active, suggestions.length - 1)

  const pick = (c: Contact) => {
    const before = value.slice(0, start)
    onChange(`${before}${before ? ' ' : ''}${format(c)}, `)
    setActive(0)
  }

  return (
    <span className="recipient">
      <input
        ref={inputRef}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${current}` : undefined}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          onChange(e.target.value)
          setDismissed(false)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (!open) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const step = e.key === 'ArrowDown' ? 1 : -1
            setActive((current + step + suggestions.length) % suggestions.length)
          } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey) {
            e.preventDefault()
            pick(suggestions[current]!)
          } else if (e.key === 'Escape') {
            // Close the list only, not the whole message.
            e.stopPropagation()
            setDismissed(true)
          }
        }}
      />
      {open && (
        <ul className="suggest" id={`${id}-list`} role="listbox">
          {suggestions.map((c, i) => (
            <li
              key={c.email}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === current}
              className={i === current ? 'is-active' : undefined}
              // Keep focus in the input so typing can continue after a click.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c)}
            >
              <span className="suggest-name">{c.name || c.email}</span>
              {c.name && <span className="suggest-email">{c.email}</span>}
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
