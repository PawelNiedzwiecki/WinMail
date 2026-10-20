import type { ReactNode } from 'react'
import { useEscape } from '../useEscape'

interface Props {
  title: string
  onClose: () => void
  /** Extra class on the panel, for its width. */
  className?: string
  footer?: ReactNode
  children: ReactNode
}

/** A small centered dialog: closes on Escape or a click outside. */
export function Dialog(p: Props) {
  useEscape(p.onClose)
  return (
    <div className="modal-backdrop" onMouseDown={p.onClose}>
      <div
        className={`dialog ${p.className ?? ''}`}
        role="dialog"
        aria-label={p.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="dialog-title">{p.title}</h2>
        <div className="dialog-body">{p.children}</div>
        {p.footer && <div className="dialog-footer">{p.footer}</div>}
      </div>
    </div>
  )
}
