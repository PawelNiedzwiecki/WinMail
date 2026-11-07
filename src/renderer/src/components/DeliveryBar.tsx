import { Clock } from 'lucide-react'
import { useState } from 'react'
import type { DeliveryState } from '@shared/types'
import { hhmm, sameDay } from '@shared/delivery'

interface Props {
  state: DeliveryState
  onDeliverNow: () => Promise<void>
  /** The Brief is shown below, and says when the last Delivery was. */
  briefShown?: boolean
}

/** "13:00", "tomorrow at 09:00", or a weekday for anything further off. */
function when(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (sameDay(d, now)) return hhmm(d)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12)
  if (sameDay(d, tomorrow)) return `tomorrow at ${hhmm(d)}`
  return d.toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
}

/**
 * Above the Inbox while Batched delivery is on: when the next Delivery is, and Deliver Now. It never says how much is
 * held, so there is nothing to check on between Deliveries.
 */
export function DeliveryBar({ state, onDeliverNow, briefShown }: Props) {
  const [busy, setBusy] = useState(false)
  if (!state.nextAt) return null
  const last = !briefShown && state.last && sameDay(new Date(state.last.at), new Date()) ? state.last : null
  return (
    <div className="delivery-bar" role="status">
      <Clock size={13} className="delivery-bar-icon" aria-hidden />
      <span className="delivery-bar-text">
        Next delivery at {when(state.nextAt)}
        {last && <span className="delivery-bar-last"> · last at {hhmm(new Date(last.at))}</span>}
      </span>
      <button
        type="button"
        className="delivery-bar-now"
        disabled={busy}
        title="Show the mail that is waiting for the next delivery"
        onClick={async () => {
          setBusy(true)
          try {
            await onDeliverNow()
          } finally {
            setBusy(false)
          }
        }}
      >
        Deliver Now
      </button>
    </div>
  )
}
