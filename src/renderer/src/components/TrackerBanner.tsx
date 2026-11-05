import { ChevronDown, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { trackerDetails, trackerHeadline, type TrackerReport } from '@shared/trackers'
import { Collapse } from './Collapse'

/**
 * Says what the Tracker shield found in the message: "Tracked by Mailchimp · 3 tracked links". Quiet like the
 * remote-content notice and not dismissible; Details lists what was removed, cleaned and marked.
 */
export function TrackerBanner({ report }: { report: TrackerReport }) {
  const [open, setOpen] = useState(false)
  const headline = trackerHeadline(report)
  if (!headline) return null
  const lines = trackerDetails(report)
  return (
    <div className="tracker-banner" role="status">
      <div className="tracker-banner-row">
        <ShieldCheck size={14} />
        <span className="tracker-banner-text">{headline}</span>
        <button className="tracker-banner-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Details
          <ChevronDown size={13} className={open ? 'is-open' : ''} />
        </button>
      </div>
      <Collapse open={open}>
        <ul className="tracker-details">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Collapse>
    </div>
  )
}
