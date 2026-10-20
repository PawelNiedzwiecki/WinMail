import { ChevronUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { activate, expand } from '../../compose/actions'
import { layoutDock, MORE_W } from '../../compose/dockLayout'
import { getSession, useSessionList } from '../../compose/sessions'
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

  if (!docked.length) return null

  const hiddenItems: MenuItem[] = layout.hidden.map((id) => ({
    label: getSession(id)?.subject.trim() || 'New Message',
    onSelect: () => activate(id)
  }))

  return (
    <div className="dock">
      {full && <div className="compose-scrim" onMouseDown={() => expand(full.id, false)} />}
      {docked.map((e) =>
        // Hidden cards stay mounted but out of sight, so their editors keep what was typed.
        full?.id === e.id ? (
          <ComposeWindow key={e.id} id={e.id} right={0} width={layout.cardWidth} />
        ) : layout.right[e.id] !== undefined ? (
          <ComposeWindow key={e.id} id={e.id} right={layout.right[e.id]!} width={layout.cardWidth} />
        ) : (
          <div key={e.id} className="dock-parked" aria-hidden>
            <ComposeWindow id={e.id} right={0} width={layout.cardWidth} />
          </div>
        )
      )}
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
