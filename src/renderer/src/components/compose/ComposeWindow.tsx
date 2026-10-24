import { ExternalLink, Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { motion, useIsPresent } from 'motion/react'
import { close, expand, minimize, openInWindow, touchActive } from '../../compose/actions'
import { api } from '../../api'
import { useLastSession } from '../../compose/sessions'
import { dur, exitTransition } from '../../motion'
import { ComposeForm } from './ComposeForm'

interface Props {
  id: string
  /** Placement from the dock layout; unused when the card is full screen. */
  right: number
  width: number
  /** Doesn't fit in the dock: kept mounted but not shown, so the editor keeps what was typed. */
  parked?: boolean
}

/** A docked card: header with Minimize, Full screen and Save & close, and the form below. */
export function ComposeWindow({ id, right, width, parked }: Props) {
  const present = useIsPresent()
  const s = useLastSession(id)
  if (!s) return null
  const title = s.subject.trim() || 'New Message'
  const cls = `compose${s.minimized ? ' is-minimized' : ''}${s.expanded ? ' is-expanded' : ''}${parked ? ' is-parked' : ''}`
  // motion owns the transform (it writes it inline), so the full-screen centring lives here as x.
  const style = s.expanded
    ? { x: '-50%' }
    : { right, width: s.minimized ? undefined : width, x: 0 }

  return (
    <motion.section
      className={cls}
      style={present ? style : { ...style, pointerEvents: 'none' }}
      aria-label={title}
      aria-hidden={parked || undefined}
      data-compose={id}
      onFocusCapture={() => touchActive(id)}
      // Entrance is the CSS dock-in; closing, sending or popping out slides the card back down.
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      exit={
        s.expanded
          ? { opacity: 0, scale: 0.98, transition: exitTransition }
          : { opacity: 0, y: 40, transition: { duration: dur.base, ease: 'easeIn' } }
      }
    >
      <header className="compose-head" onClick={() => minimize(id, !s.minimized)}>
        <span className="compose-title">{title}</span>
        <button
          className="head-btn"
          title={s.minimized ? 'Restore' : 'Minimize'}
          aria-label={s.minimized ? 'Restore' : 'Minimize'}
          onClick={(e) => {
            e.stopPropagation()
            minimize(id, !s.minimized)
          }}
        >
          <Minus size={16} />
        </button>
        {api.platform !== 'browser' && (
          <button
            className="head-btn"
            title="Open in new window"
            aria-label="Open in new window"
            onClick={(e) => {
              e.stopPropagation()
              void openInWindow(id)
            }}
          >
            <ExternalLink size={15} />
          </button>
        )}
        <button
          className="head-btn"
          title={s.expanded ? 'Exit full screen' : 'Full screen'}
          aria-label={s.expanded ? 'Exit full screen' : 'Full screen'}
          onClick={(e) => {
            e.stopPropagation()
            expand(id, !s.expanded)
          }}
        >
          {s.expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button
          className="head-btn"
          title="Save & close"
          aria-label="Save and close"
          onClick={(e) => {
            e.stopPropagation()
            void close(id)
          }}
        >
          <X size={16} />
        </button>
      </header>
      {/* Stays mounted while minimized so the editor keeps its text and cursor. */}
      <div className="compose-body" hidden={s.minimized}>
        <ComposeForm id={id} showSubject />
      </div>
    </motion.section>
  )
}
