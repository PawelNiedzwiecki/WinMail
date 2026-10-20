import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type MenuItem =
  | {
      label: string
      icon?: ReactNode
      shortcut?: string
      danger?: boolean
      disabled?: boolean
      onSelect: () => void
    }
  | 'separator'

interface Props {
  /** Where the pointer was when the menu was asked for. */
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** Margin kept from the window edge. */
const EDGE = 8

/**
 * Right-click menu drawn at the pointer, flipped to stay inside the window. Renders in
 * a portal and closes on outside click, scroll, resize, window blur or Escape.
 */
export function ContextMenu(p: Props) {
  const ref = useRef<HTMLUListElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [active, setActive] = useState(-1)

  const enabled = p.items.flatMap((it, i) => (it !== 'separator' && !it.disabled ? [i] : []))

  const choose = (i: number) => {
    const it = p.items[i]
    if (!it || it === 'separator' || it.disabled) return
    p.onClose()
    it.onSelect()
  }

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    const left = p.x + r.width > window.innerWidth - EDGE ? Math.max(EDGE, p.x - r.width) : p.x
    const top = p.y + r.height > window.innerHeight - EDGE ? Math.max(EDGE, p.y - r.height) : p.y
    setPos({ left, top })
    setActive(-1)
  }, [p.x, p.y])

  // Latest values for the window listeners below.
  const latest = useRef({ active, enabled, choose, onClose: p.onClose })
  latest.current = { active, enabled, choose, onClose: p.onClose }

  useEffect(() => {
    const close = () => latest.current.onClose()
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    // Capture phase so the app's own shortcuts (arrows, Delete) don't fire underneath.
    const onKey = (e: KeyboardEvent) => {
      const { active, enabled, choose } = latest.current
      e.stopPropagation()
      const at = enabled.indexOf(active)
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault()
        close()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive(enabled[(at + 1) % enabled.length] ?? -1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive(enabled[at <= 0 ? enabled.length - 1 : at - 1] ?? -1)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        if (active >= 0) choose(active)
      }
    }
    document.addEventListener('mousedown', outside, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', outside, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [])

  return createPortal(
    <ul
      ref={ref}
      role="menu"
      className="context-menu"
      style={pos ?? { visibility: 'hidden', left: 0, top: 0 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {p.items.map((it, i) =>
        it === 'separator' ? (
          <li key={i} role="separator" className="context-sep" />
        ) : (
          <li
            key={i}
            role="menuitem"
            aria-disabled={it.disabled || undefined}
            className={`${i === active ? 'is-active' : ''} ${it.danger ? 'is-danger' : ''}`}
            onMouseEnter={() => setActive(it.disabled ? -1 : i)}
            onMouseLeave={() => setActive(-1)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(i)}
          >
            <span className="context-icon">{it.icon}</span>
            <span className="context-label">{it.label}</span>
            {it.shortcut && <span className="context-shortcut">{it.shortcut}</span>}
          </li>
        )
      )}
    </ul>,
    document.body
  )
}
