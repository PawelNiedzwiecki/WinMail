import { X } from 'lucide-react'
import { dismiss, useToasts } from '../toasts'

/** Notifications at the bottom left, newest at the bottom. Choosing an action also dismisses it. */
export function ToastStack() {
  const toasts = useToasts()
  if (!toasts.length) return null
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast${t.tone === 'error' ? ' is-error' : ''}`}
          role={t.tone === 'error' ? 'alert' : 'status'}
        >
          {t.busy && <span className="spinner" />}
          <span className="toast-text">{t.text}</span>
          {t.actions.map((a) => (
            <button
              key={a.label}
              className="toast-action"
              onClick={() => {
                dismiss(t.id)
                a.run()
              }}
            >
              {a.label}
            </button>
          ))}
          <button className="toast-close" title="Dismiss" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
