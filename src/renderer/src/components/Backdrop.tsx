import { motion, useIsPresent, type HTMLMotionProps } from 'motion/react'
import type { MouseEvent, ReactNode } from 'react'
import { dur, exitTransition } from '../motion'
import { useEscape } from '../useEscape'

/**
 * Dimmed layer behind a modal. Its CSS keyframe plays the entrance; when the modal is
 * rendered inside <AnimatePresence>, this fades it out and stops it catching clicks meanwhile.
 */
export function Backdrop(p: { onMouseDown: (e: MouseEvent) => void; children: ReactNode }) {
  const present = useIsPresent()
  return (
    <motion.div
      className="modal-backdrop"
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: dur.base, ease: 'easeIn' } }}
      style={present ? undefined : { pointerEvents: 'none' }}
      onMouseDown={present ? p.onMouseDown : undefined}
    >
      {p.children}
    </motion.div>
  )
}

/** The modal panel itself: shrinks a little as it fades out. */
export const panelExit: HTMLMotionProps<'div'> = {
  initial: false,
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.97, transition: exitTransition },
}

/** useEscape that lets go while the modal animates out, so Escape reaches whatever is underneath. */
export function useModalEscape(onClose: () => void, enabled = true): void {
  const present = useIsPresent()
  useEscape(onClose, enabled && present)
}
