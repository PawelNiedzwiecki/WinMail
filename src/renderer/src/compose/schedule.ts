export interface SchedulePreset {
  label: string
  at: Date
}

/** Gmail's Schedule send choices: tomorrow 08:00 and 13:00, and next Monday 08:00 unless that is tomorrow. */
export function schedulePresets(now = new Date()): SchedulePreset[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  const list = [
    { label: 'Tomorrow morning', at: at(1, 8) },
    { label: 'Tomorrow afternoon', at: at(1, 13) }
  ]
  const toMonday = (8 - now.getDay()) % 7 || 7
  if (toMonday > 1) list.push({ label: 'Monday morning', at: at(toMonday, 8) })
  return list
}

export const formatWhen = (d: Date) =>
  d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
