import type { Settings } from './types'

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Whether `now` falls in the quiet hours; a span like 22:00–07:00 runs past midnight. Equal times mean never. */
export function inQuietHours(s: Pick<Settings, 'quietHours' | 'quietStart' | 'quietEnd'>, now = new Date()): boolean {
  if (!s.quietHours) return false
  const t = now.getHours() * 60 + now.getMinutes()
  const start = minutes(s.quietStart)
  const end = minutes(s.quietEnd)
  if (start === end) return false
  return start < end ? t >= start && t < end : t >= start || t < end
}
