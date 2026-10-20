import { useState } from 'react'
import { formatWhen } from '../compose/schedule'
import { Dialog } from './Dialog'

interface Preset {
  label: string
  at: Date
}

/** Gmail's Snooze choices: later today, tomorrow, this weekend, next week. */
export function snoozePresets(now = new Date()): Preset[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  const list: Preset[] = []
  if (now.getHours() < 17) {
    const later = new Date(now)
    later.setHours(now.getHours() + 3, 0, 0, 0)
    list.push({ label: 'Later today', at: later })
  }
  list.push({ label: 'Tomorrow', at: at(1, 8) })
  const day = now.getDay()
  if (day >= 1 && day <= 4) list.push({ label: 'This weekend', at: at(6 - day, 8) })
  list.push({ label: 'Next week', at: at((8 - day) % 7 || 7, 8) })
  return list
}

/** A datetime-local value for `d` in local time. */
const localValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Props {
  title: string
  onPick: (at: Date) => void
  onClose: () => void
}

/** Picks a moment in the future: presets, or a date and time. */
export function WhenPicker(p: Props) {
  const presets = snoozePresets()
  const [custom, setCustom] = useState(() => localValue(presets[0]!.at))
  const customDate = new Date(custom)
  const valid = !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now()

  const pick = (d: Date) => {
    p.onClose()
    p.onPick(d)
  }

  return (
    <Dialog
      title={p.title}
      onClose={p.onClose}
      className="dialog-picker"
      footer={
        <>
          <input
            type="datetime-local"
            className="dialog-date"
            value={custom}
            min={localValue(new Date())}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button className="btn btn-primary" disabled={!valid} onClick={() => pick(customDate)}>
            Snooze
          </button>
        </>
      }
    >
      <div className="picker-list">
        {presets.map((x, i) => (
          <button key={x.label} className="picker-item when-item" autoFocus={i === 0} onClick={() => pick(x.at)}>
            <span>{x.label}</span>
            <span className="when-time">{formatWhen(x.at)}</span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}
