import { useEffect, useRef, useState } from 'react'
import { schedule } from '../../compose/actions'
import { updateSession, type ComposeSession } from '../../compose/sessions'

const pad = (n: number) => String(n).padStart(2, '0')
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Escape closes only the popover, not the card. */
function escapeCloses(onClose: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      onClose()
    }
  }
}

/** "Pick date & time…" for Schedule send. */
export function SchedulePopover({ session, onClose }: { session: ComposeSession; onClose: () => void }) {
  const first = useRef<HTMLInputElement>(null)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(8, 0, 0, 0)
  const [date, setDate] = useState(dateValue(tomorrow))
  const [time, setTime] = useState(timeValue(tomorrow))
  const at = new Date(`${date}T${time}`)
  const valid = !Number.isNaN(at.getTime()) && at.getTime() > Date.now()
  useEffect(() => first.current?.focus(), [])

  const go = () => {
    if (!valid) return
    onClose()
    void schedule(session.id, at)
  }

  return (
    <div className="link-popover schedule-popover" role="dialog" aria-label="Schedule send" onKeyDown={escapeCloses(onClose)}>
      <label>
        <span>Date</span>
        <input ref={first} type="date" value={date} min={dateValue(new Date())} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        <span>Time</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      </label>
      {!valid && <div className="link-error">Pick a time in the future.</div>}
      <div className="link-actions">
        <span className="grow" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!valid} onClick={go}>
          Schedule Send
        </button>
      </div>
    </div>
  )
}

/** Name for a new template. */
export function NamePopover({
  initial,
  onSave,
  onClose
}: {
  initial: string
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.select(), [])
  const save = () => {
    if (!name.trim()) return
    onSave(name.trim())
    onClose()
  }
  return (
    <div className="link-popover" role="dialog" aria-label="Save as template" onKeyDown={escapeCloses(onClose)}>
      <label>
        <span>Template name</span>
        <input
          ref={first}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </label>
      <div className="link-actions">
        <span className="grow" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}

/** Clears the banner above the fields. */
export const dismissBanner = (id: string) => updateSession(id, { banner: undefined })
