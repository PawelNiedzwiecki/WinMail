import type { Transition, Variants } from 'motion/react'
import { ease } from '@/motion'

// The app's motion language (100–220 ms) is tuned for triage. The page uses the same ease-out curve, stretched to
// reading pace: things arrive as they scroll in, and nothing waits on an animation to be clicked.
export const siteEase = ease.out

export const reveal: Transition = { duration: 0.7, ease: siteEase }

/** Rises into place and sharpens: section headings, cards, the hero. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 28, filter: 'blur(6px)' },
  shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: reveal }
}

/** Slides in from the right: rows of the privacy card. */
export const slideIn: Variants = {
  hidden: { opacity: 0, x: 20 },
  shown: { opacity: 1, x: 0, transition: { duration: 0.5, ease: siteEase } }
}

/** A parent that plays its children one after another. */
export const stagger = (gap = 0.08, delay = 0): Variants => ({
  hidden: {},
  shown: { transition: { staggerChildren: gap, delayChildren: delay } }
})

/** Plays once, when a fifth of the element is on screen. */
export const onScroll = { initial: 'hidden', whileInView: 'shown', viewport: { once: true, amount: 0.2 } } as const
