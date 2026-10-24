import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Backdrop, panelExit, useModalEscape } from './Backdrop'

interface Props {
  title: string
  onClose: () => void
  /** Extra class on the panel, for its width. */
  className?: string
  footer?: ReactNode
  /** Optional badge shown above the title (used by confirmation dialogs). */
  icon?: ReactNode
  children: ReactNode
}

/**
 * A small centered dialog: closes on Escape or a click outside. Render it inside
 * <AnimatePresence> for it to fade out on close.
 */
export function Dialog(p: Props) {
  useModalEscape(p.onClose)
  return (
    <Backdrop onMouseDown={p.onClose}>
      <motion.div
        {...panelExit}
        className={`dialog ${p.className ?? ''}`}
        role="dialog"
        aria-label={p.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {p.icon && <div className="dialog-icon">{p.icon}</div>}
        <h2 className="dialog-title">{p.title}</h2>
        <div className="dialog-body">{p.children}</div>
        {p.footer && <div className="dialog-footer">{p.footer}</div>}
      </motion.div>
    </Backdrop>
  )
}
