import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface WindowState {
  /** Size and position when not maximized. */
  bounds: Rectangle
  maximized: boolean
}

const file = () => join(app.getPath('userData'), 'window-state.json')

/** At least this much of the window must be on a screen, or it counts as lost (monitor unplugged). */
const MIN_VISIBLE_W = 200
const MIN_VISIBLE_H = 100
const SAVE_DELAY_MS = 500

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function onScreen(b: Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x)
    const h = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y)
    return w >= MIN_VISIBLE_W && h >= MIN_VISIBLE_H
  })
}

/** The last size and position, or null the first time, or when that spot is no longer on any screen. */
export function loadWindowState(minWidth: number, minHeight: number): WindowState | null {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<WindowState>
    const b = raw.bounds
    if (!b || !num(b.x) || !num(b.y) || !num(b.width) || !num(b.height)) return null
    const bounds = { x: b.x, y: b.y, width: Math.max(minWidth, b.width), height: Math.max(minHeight, b.height) }
    return onScreen(bounds) ? { bounds, maximized: raw.maximized === true } : null
  } catch {
    return null
  }
}

/** Remembers the window's size, position and maximized state as it changes. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined
  const save = () => {
    clearTimeout(timer)
    if (win.isDestroyed() || win.isFullScreen()) return
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
    try {
      const tmp = `${file()}.tmp`
      writeFileSync(tmp, JSON.stringify(state), 'utf8')
      renameSync(tmp, file())
    } catch (err) {
      console.error('Could not save the window position:', err instanceof Error ? err.message : err)
    }
  }
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY_MS)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('maximize', later)
  win.on('unmaximize', later)
  win.on('close', save)
}
