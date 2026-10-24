import { Check, ChevronsUpDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { exitTransition } from '../motion'
import { useEscape } from '../useEscape'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  /** Extra class on the button, e.g. "select-plain" inside the compose header. */
  className?: string
  'aria-label'?: string
}

/** Popup gap from the button, and the margin kept from the window edge. */
const GAP = 4
const EDGE = 8

/** Closes whichever Select is open; only one list is shown at a time. */
let closeOpen: (() => void) | null = null

/**
 * Dropdown styled like the rest of the app; the native <select> popup is drawn by
 * Chromium and can't be themed. The list renders in a portal so modals can't clip it,
 * and so clicks on it never reach the <label> rows that wrap form controls.
 */
export function Select<T extends string>(p: Props<T>) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number; maxHeight: number } | null>(null)

  const selectedIndex = Math.max(0, p.options.findIndex((o) => o.value === p.value))
  const selected = p.options[selectedIndex]

  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }
  useEscape(close, open)

  const show = () => {
    setActive(selectedIndex)
    setOpen(true)
  }

  const choose = (i: number) => {
    const o = p.options[i]
    if (o && o.value !== p.value) p.onChange(o.value)
    close()
  }

  // Place below the button, or above it when there isn't room. The last position is kept
  // after closing so the list fades out where it was.
  useLayoutEffect(() => {
    if (!open) return
    const b = buttonRef.current!.getBoundingClientRect()
    const height = listRef.current?.scrollHeight ?? 0
    const below = window.innerHeight - b.bottom - GAP - EDGE
    const above = b.top - GAP - EDGE
    const up = height > below && above > below
    const maxHeight = Math.min(320, up ? above : below)
    setPos({
      left: Math.min(b.left, window.innerWidth - EDGE - b.width),
      top: up ? b.top - GAP - Math.min(height, maxHeight) : b.bottom + GAP,
      minWidth: b.width,
      maxHeight
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const hide = () => setOpen(false)
    closeOpen?.()
    closeOpen = hide
    const outside = (e: Event) => {
      const t = e.target as Node
      if (!buttonRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onResize = () => setOpen(false)
    // Capture phase: modals stop mousedown propagation, which would otherwise leave this
    // list open while another Select opens on top of it.
    document.addEventListener('mousedown', outside, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onResize)
    return () => {
      if (closeOpen === hide) closeOpen = null
      document.removeEventListener('mousedown', outside, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onResize)
    }
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active, pos])

  const onKeyDown = (e: KeyboardEvent) => {
    const last = p.options.length - 1
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    const move = (i: number) => {
      e.preventDefault()
      setActive(Math.max(0, Math.min(last, i)))
    }
    if (e.key === 'ArrowDown') move(active + 1)
    else if (e.key === 'ArrowUp') move(active - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(last)
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1) {
      // Type-ahead: jump to the next option starting with the typed letter.
      const k = e.key.toLowerCase()
      const order = [...p.options.keys()].map((i) => (active + 1 + i) % p.options.length)
      const hit = order.find((i) => p.options[i]!.label.toLowerCase().startsWith(k))
      if (hit !== undefined) move(hit)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`select ${p.className ?? ''}`}
        aria-label={p['aria-label']}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={(e) => {
          e.preventDefault() // inside a <label>, don't let the click be re-dispatched
          if (open) close()
          else show()
        }}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{selected?.label}</span>
        <ChevronsUpDown size={13} className="select-chevron" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.ul
              ref={listRef}
              id={id}
              role="listbox"
              className="select-list"
              style={pos ?? { visibility: 'hidden', left: 0, top: 0 }}
              // The CSS keyframe plays the entrance; this adds a quick fade on close.
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: exitTransition }}
            >
              {p.options.map((o, i) => (
                <li
                  key={o.value}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={o.value === p.value}
                  className={i === active ? 'is-active' : ''}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()} // keep focus on the button
                  onClick={() => choose(i)}
                >
                  <span className="select-check">{o.value === p.value && <Check size={13} />}</span>
                  {o.label}
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
