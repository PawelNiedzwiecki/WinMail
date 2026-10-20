import { useSyncExternalStore } from 'react'

export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
  actions: ToastAction[]
  /** Spinner before the text, e.g. while a message is being sent. */
  busy: boolean
  /** Milliseconds; 0 keeps it until dismissed or replaced. */
  duration: number
}

export type ToastInput =
  | string
  | {
      text: string
      tone?: Toast['tone']
      actions?: ToastAction[]
      busy?: boolean
      duration?: number
      /** Replaces the toast with this id, e.g. "Sending…" becoming "Message sent". */
      id?: number
    }

/** At most this many show at once; older ones drop off. */
const MAX_TOASTS = 3
const INFO_MS = 6000
const ERROR_MS = 10_000

let list: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const timers = new Map<number, number>()

const emit = () => listeners.forEach((l) => l())

/** Shows a notification at the bottom left and returns its id, for updating or dismissing it. */
export function toast(input: ToastInput): number {
  const t = typeof input === 'string' ? { text: input } : input
  const id = t.id ?? nextId++
  const tone = t.tone ?? 'info'
  const item: Toast = {
    id,
    text: t.text,
    tone,
    actions: t.actions ?? [],
    busy: t.busy ?? false,
    duration: t.duration ?? (tone === 'error' ? ERROR_MS : INFO_MS)
  }
  list = list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? item : x)) : [...list, item].slice(-MAX_TOASTS)
  window.clearTimeout(timers.get(id))
  timers.delete(id)
  if (item.duration > 0) timers.set(id, window.setTimeout(() => dismiss(id), item.duration))
  emit()
  return id
}

export function dismiss(id: number): void {
  window.clearTimeout(timers.get(id))
  timers.delete(id)
  if (!list.some((x) => x.id === id)) return
  list = list.filter((x) => x.id !== id)
  emit()
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => list)
}
