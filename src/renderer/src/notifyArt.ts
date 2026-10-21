import { initials } from './format'

/** Avatar gradients, top to bottom; a sender always gets the same one. */
const PALETTE: [string, string][] = [
  ['#ff8a65', '#f4511e'],
  ['#ffb74d', '#f57c00'],
  ['#81c784', '#388e3c'],
  ['#4dd0e1', '#0097a7'],
  ['#64b5f6', '#1976d2'],
  ['#9575cd', '#5e35b1'],
  ['#f06292', '#c2185b'],
  ['#a1887f', '#6d4c41'],
  ['#90a4ae', '#546e7a']
]
const FONT = '"Inter Variable", "Segoe UI", sans-serif'
/** Drawn large so the notification stays sharp on high-DPI screens. */
const AVATAR_PX = 128
/** The taskbar overlay is 16 px; drawn at twice that. */
const BADGE_PX = 32
const BADGE_RED = '#d13438'

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function canvas(px: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = px
  return [c, c.getContext('2d')!]
}

/** The sender's initials on a coloured circle, as a PNG data URL for a notification. */
export async function drawAvatar(name: string, email: string): Promise<string> {
  await document.fonts.load(`600 48px ${FONT}`).catch(() => [])
  const [c, g] = canvas(AVATAR_PX)
  const half = AVATAR_PX / 2
  const [top, bottom] = PALETTE[hash(email.toLowerCase()) % PALETTE.length]!
  const fill = g.createLinearGradient(0, 0, 0, AVATAR_PX)
  fill.addColorStop(0, top)
  fill.addColorStop(1, bottom)
  g.fillStyle = fill
  g.beginPath()
  g.arc(half, half, half, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#fff'
  g.font = `600 ${AVATAR_PX * 0.4}px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(initials(name || email), half, half + AVATAR_PX * 0.02)
  return c.toDataURL('image/png')
}

/** A red dot with the unread count for the taskbar button; null when there's nothing unread. */
export function drawBadge(count: number): string | null {
  if (count <= 0) return null
  const label = count > 99 ? '99+' : String(count)
  const [c, g] = canvas(BADGE_PX)
  const half = BADGE_PX / 2
  g.fillStyle = BADGE_RED
  g.beginPath()
  g.arc(half, half, half, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#fff'
  g.font = `700 ${[0, 22, 18, 12][label.length]}px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(label, half, half + 1)
  return c.toDataURL('image/png')
}
