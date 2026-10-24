import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { collapse, presence, useReduceMotion } from '../motion'

interface Props {
  open: boolean
  children: ReactNode
  className?: string
  /** Animate on first render too; off by default so pages don't unfold on load. */
  initial?: boolean
}

/** Shows or hides a block by growing and shrinking its height, instead of popping it in and out. */
export function Collapse({ open, children, className, initial = false }: Props) {
  // MotionConfig's reducedMotion only stops transforms, not height, so opt out here.
  const reduce = useReduceMotion()
  const firstRender = useRef(true)
  useEffect(() => {
    firstRender.current = false
  }, [])
  if (reduce) return open ? <div className={className}>{children}</div> : null
  return (
    <AnimatePresence initial={initial}>
      {open && (
        <Body key="body" className={className} animatesIn={initial || !firstRender.current}>
          {children}
        </Body>
      )}
    </AnimatePresence>
  )
}

/**
 * Clipped only while moving, so a dropdown inside (recipient suggestions) can overflow once
 * it's open. Done by hand because transitionEnd doesn't fire for height: 'auto'. flow-root
 * keeps the child's margins inside, so nothing shifts when clipping ends.
 */
function Body(p: { animatesIn: boolean; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // Fixed at mount: React never rewrites it, so the handlers below own it from then on.
  const [overflow] = useState(p.animatesIn ? 'hidden' : 'visible')
  const setOverflow = (v: string) => {
    if (ref.current) ref.current.style.overflow = v
  }
  return (
    <motion.div
      ref={ref}
      className={p.className}
      variants={collapse}
      {...presence}
      style={{ display: 'flow-root', overflow }}
      onAnimationStart={() => setOverflow('hidden')}
      onAnimationComplete={(def) => def === 'animate' && setOverflow('visible')}
    >
      {p.children}
    </motion.div>
  )
}
