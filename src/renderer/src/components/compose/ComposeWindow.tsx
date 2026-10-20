import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { close, expand, minimize, touchActive } from '../../compose/actions'
import { useSession } from '../../compose/sessions'
import { ComposeForm } from './ComposeForm'

interface Props {
  id: string
  /** Placement from the dock layout; unused when the card is full screen. */
  right: number
  width: number
}

/** A docked card: header with Minimize, Full screen and Save & close, and the form below. */
export function ComposeWindow({ id, right, width }: Props) {
  const s = useSession(id)
  if (!s) return null
  const title = s.subject.trim() || 'New Message'
  const cls = `compose${s.minimized ? ' is-minimized' : ''}${s.expanded ? ' is-expanded' : ''}`
  const style = s.expanded ? undefined : { right, width: s.minimized ? undefined : width }

  return (
    <section
      className={cls}
      style={style}
      aria-label={title}
      data-compose={id}
      onFocusCapture={() => touchActive(id)}
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
    </section>
  )
}
