import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { dur, ease, exitTransition } from '../motion'
import { dismiss, useToasts } from '../toasts'

/** Notifications at the bottom left, newest at the bottom. Choosing an action also dismisses it. */
export function ToastStack() {
  const toasts = useToasts()
  // The region stays mounted so the last toast can animate out.
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      <AnimatePresence initial={false} mode="popLayout">
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            // Enter, leave and reflow are driven here, so the CSS entrance is switched off.
            // Position only: a toast whose text changes ("Sending…" → "Sent") must not stretch.
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, x: 0, transition: { duration: dur.slow, ease: ease.out } }}
            exit={{ opacity: 0, x: -16, transition: exitTransition }}
            transition={{ layout: { duration: dur.base, ease: ease.out } }}
            style={{ animation: 'none' }}
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
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
