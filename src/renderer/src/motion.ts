import type { Transition, Variants } from 'motion/react'
import { useSyncExternalStore } from 'react'

const osQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
let appReduce = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
osQuery.addEventListener('change', notify)

/** Applies the in-app "Reduce animations" setting: CSS reads the attribute, JS reads useReduceMotion. */
export function applyReduceMotion(on: boolean): void {
  appReduce = on
  document.documentElement.dataset.motion = on ? 'reduce' : ''
  notify()
}

/** True when the app setting or Windows' "Animation effects" asks for less motion. */
export const reduceMotionNow = () => appReduce || osQuery.matches

export function useReduceMotion(): boolean {
  return useSyncExternalStore((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, reduceMotionNow)
}

// Shared motion values, matching the --dur-* / --ease-* tokens in styles.css.
export const ease = {
  out: [0.2, 0.9, 0.3, 1],
  spring: [0.34, 1.4, 0.64, 1],
} as const

export const dur = { fast: 0.1, base: 0.16, slow: 0.22 }

/** Exits are quicker than entrances so nothing feels sticky. */
export const exitTransition: Transition = { duration: dur.fast, ease: 'easeIn' }

/** Floating panels: dialogs, menus, popovers. */
export const fadeScale: Variants = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1, transition: { duration: dur.base, ease: ease.out } },
  exit: { opacity: 0, scale: 0.97, transition: exitTransition },
}

/** Backdrops and scrims. */
export const fade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: dur.base, ease: 'easeOut' } },
  exit: { opacity: 0, transition: exitTransition },
}

/** Blocks that grow and shrink in place, e.g. banners and expanding sections (see Collapse). */
export const collapse: Variants = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto', transition: { duration: dur.base, ease: ease.out } },
  exit: { opacity: 0, height: 0, transition: { duration: dur.base, ease: 'easeIn' } },
}

/** Toasts and docked cards. */
export const slideUp: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.slow, ease: ease.out } },
  exit: { opacity: 0, y: 12, transition: exitTransition },
}

/** Spread on a motion element to use a variant set. */
export const presence = { initial: 'initial', animate: 'animate', exit: 'exit' } as const
