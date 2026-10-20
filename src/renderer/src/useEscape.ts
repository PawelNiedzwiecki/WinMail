import { useEffect, useRef } from 'react'

// Stack of open modals; Escape closes only the top one, wherever focus is.
const stack: { current: () => void }[] = []

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || stack.length === 0) return
  e.preventDefault()
  stack[stack.length - 1]!.current()
})

export function useEscape(onClose: () => void, enabled = true): void {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!enabled) return
    stack.push(ref)
    return () => {
      const i = stack.indexOf(ref)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [enabled])
}
