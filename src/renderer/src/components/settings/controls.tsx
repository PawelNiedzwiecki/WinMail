import type { ReactNode } from 'react'

/** On/off setting; a real switch for assistive technology. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`st-switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="st-knob" />
    </button>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

/** A few mutually exclusive choices side by side; better than a dropdown for two or three. */
export function Segmented<T extends string>(p: {
  value: T
  options: SegmentOption<T>[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="st-seg" role="radiogroup" aria-label={p.label}>
      {p.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === p.value}
          className={o.value === p.value ? 'is-active' : ''}
          onClick={() => p.onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A titled card of related settings. */
export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="st-group">
      {title && <h3 className="st-group-title">{title}</h3>}
      <div className="st-card">{children}</div>
    </section>
  )
}

/** One setting: what it is on the left, how to change it on the right (or underneath, when `stack`). */
export function Item(p: { title: string; description?: ReactNode; children: ReactNode; stack?: boolean }) {
  return (
    <div className={`st-item${p.stack ? ' is-stack' : ''}`}>
      <div className="st-item-text">
        <div className="st-item-title">{p.title}</div>
        {p.description && <div className="st-item-desc">{p.description}</div>}
      </div>
      <div className="st-item-control">{p.children}</div>
    </div>
  )
}

/** A key as printed on a keyboard. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="st-kbd">{children}</kbd>
}

/** Shortcut line: keys on the right, what they do on the left. */
export function KeyRow({ keys, action }: { keys: string[][]; action: string }) {
  return (
    <div className="st-item st-keyrow">
      <div className="st-item-text">{action}</div>
      <div className="st-item-control st-keys">
        {keys.map((combo, i) => (
          <span key={i} className="st-combo">
            {combo.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        ))}
      </div>
    </div>
  )
}
