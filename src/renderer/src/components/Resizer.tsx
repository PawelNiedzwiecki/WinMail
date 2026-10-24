import { useCallback, useEffect, useState } from 'react'

/** A persisted pixel width that is mirrored into a CSS variable on the root element. */
export function usePaneWidth(key: string, cssVar: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(key))
      if (v >= min && v <= max) return v
    } catch {
      /* storage unavailable */
    }
    return initial
  })

  useEffect(() => {
    document.documentElement.style.setProperty(cssVar, `${width}px`)
    try {
      localStorage.setItem(key, String(width))
    } catch {
      /* storage unavailable */
    }
  }, [key, cssVar, width])

  const set = useCallback((w: number) => setWidth(Math.min(max, Math.max(min, Math.round(w)))), [min, max])
  return [width, set, () => set(initial)] as const
}

interface Props {
  width: number
  onResize: (width: number) => void
  onReset: () => void
  label: string
}

/** Draggable divider; sits at the right edge of the pane it resizes. Arrow keys nudge, double-click resets. */
export function Resizer({ width, onResize, onReset, label }: Props) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    el.classList.add('dragging')
    document.body.classList.add('resizing')
    const move = (ev: PointerEvent) => onResize(startW + ev.clientX - startX)
    const up = () => {
      el.classList.remove('dragging')
      document.body.classList.remove('resizing')
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  return (
    <div className="resizer">
      <div
        className="resizer-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onDoubleClick={onReset}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onResize(width - 16)
          else if (e.key === 'ArrowRight') onResize(width + 16)
          else return
          e.preventDefault()
        }}
      />
    </div>
  )
}
