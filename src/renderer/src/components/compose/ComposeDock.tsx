import { ChevronUp } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { activate, expand } from '../../compose/actions'
import { layoutDock, MORE_W } from '../../compose/dockLayout'
import { getSession, useSessionList } from '../../compose/sessions'
import { exitTransition } from '../../motion'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { ComposeWindow } from './ComposeWindow'

/** Docked cards along the bottom edge, bottom right first; those that don't fit go behind "+N". */
export function ComposeDock() {
  const entries = useSessionList()
  const [width, setWidth] = useState(window.innerWidth)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const docked = useMemo(() => entries.filter((e) => e.host === 'docked' && !e.hidden), [entries])
  const full = docked.find((e) => e.expanded)
  const layout = useMemo(() => layoutDock(docked.filter((e) => !e.expanded), width), [docked, width])

  const hiddenItems: MenuItem[] = layout.hidden.map((id) => ({
    label: getSession(id)?.subject.trim() || 'New Message',
    onSelect: () => activate(id)
  }))

  // Rendered even when empty, so the last card can animate out.
  return (
    <div className="dock">
      <AnimatePresence>
        {full && (
          <motion.div
            key="scrim"
            className="compose-scrim"
            onMouseDown={() => expand(full.id, false)}
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: exitTransition }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {docked.map((e) => {
          // Cards that don't fit stay mounted (same element, so nothing remounts), just not shown.
          const parked = full?.id !== e.id && layout.right[e.id] === undefined
          return (
            <ComposeWindow
              key={e.id}
              id={e.id}
              right={full?.id === e.id || parked ? 0 : layout.right[e.id]!}
              width={layout.cardWidth}
              parked={parked}
            />
          )
        })}
      </AnimatePresence>
      {layout.moreRight !== null && (
        <button
          className="dock-more"
          style={{ right: layout.moreRight, width: MORE_W - 8 }}
          title={`${layout.hidden.length} more`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ x: r.left, y: r.top })
          }}
        >
          <ChevronUp size={14} />+{layout.hidden.length}
        </button>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={hiddenItems} onClose={() => setMenu(null)} />}
    </div>
  )
}
