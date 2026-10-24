import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  Trash2,
  ShieldAlert,
  Reply,
  ReplyAll,
  Forward,
  Flag,
  Mail,
  MailOpen,
  FolderInput,
  AlarmClock,
  Ellipsis
} from 'lucide-react'
import { ContextMenu, type MenuItem } from './ContextMenu'

interface Props {
  hasSelection: boolean
  /** Number of messages acted on when more than one is checked. */
  count: number
  selectionRead: boolean
  /** Move to… needs all selected messages in one account. */
  canMove: boolean
  onArchive: () => void
  onTrash: () => void
  onJunk: () => void
  onMove: () => void
  onSnooze: () => void
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onFlag: () => void
  onToggleRead: () => void
}

interface Action {
  id: string
  group: number
  /** Lower hides first when the bar runs out of room. */
  hideOrder: number
  title: string
  /** Label used in the overflow menu. */
  label: string
  icon: ReactNode
  disabled: boolean
  danger?: boolean
  run: () => void
}

// Layout constants — keep in sync with .action-bar / .ab-group / .ab-btn in styles.css.
const BTN_W = 30
const BTN_GAP = 1
const GROUP_PAD = 4
const GROUP_GAP = 8
const BAR_PAD = 28
const COUNT_W = 96

const ICON = 16

/** Per-message actions, shown above the reading pane. Collapses into "…" as the pane narrows. */
export function ActionBar(p: Props) {
  const d = !p.hasSelection
  const bar = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [width, setWidth] = useState(Infinity)

  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const actions: Action[] = [
    { id: 'archive', group: 0, hideOrder: 3, title: 'Archive', label: 'Archive', icon: <Archive size={ICON} />, disabled: d, run: p.onArchive },
    { id: 'trash', group: 0, hideOrder: 2, title: 'Delete (Del)', label: 'Delete', icon: <Trash2 size={ICON} />, disabled: d, danger: true, run: p.onTrash },
    { id: 'snooze', group: 0, hideOrder: 8, title: 'Snooze', label: 'Snooze', icon: <AlarmClock size={ICON} />, disabled: d, run: p.onSnooze },
    { id: 'reply', group: 1, hideOrder: 1, title: 'Reply (Ctrl+R)', label: 'Reply', icon: <Reply size={ICON} />, disabled: d, run: p.onReply },
    { id: 'replyAll', group: 1, hideOrder: 5, title: 'Reply All (Ctrl+Shift+R)', label: 'Reply All', icon: <ReplyAll size={ICON} />, disabled: d, run: p.onReplyAll },
    { id: 'forward', group: 1, hideOrder: 4, title: 'Forward (Ctrl+Shift+F)', label: 'Forward', icon: <Forward size={ICON} />, disabled: d, run: p.onForward },
    { id: 'flag', group: 2, hideOrder: 6, title: 'Flag', label: 'Flag', icon: <Flag size={ICON} />, disabled: d, run: p.onFlag },
    {
      id: 'read',
      group: 2,
      hideOrder: 7,
      title: p.selectionRead ? 'Mark as Unread' : 'Mark as Read',
      label: p.selectionRead ? 'Mark as Unread' : 'Mark as Read',
      icon: p.selectionRead ? <Mail size={ICON} /> : <MailOpen size={ICON} />,
      disabled: d,
      run: p.onToggleRead
    },
    { id: 'move', group: 2, hideOrder: 9, title: 'Move to…', label: 'Move to…', icon: <FolderInput size={ICON} />, disabled: d || !p.canMove, run: p.onMove },
    { id: 'junk', group: 3, hideOrder: 10, title: 'Move to Junk', label: 'Move to Junk', icon: <ShieldAlert size={ICON} />, disabled: d, run: p.onJunk }
  ]

  // Hide actions (least important first) until what's left fits next to the "…" button.
  const fits = (visible: Action[], overflow: boolean): boolean => {
    const groups = new Map<number, number>()
    for (const a of visible) groups.set(a.group, (groups.get(a.group) ?? 0) + 1)
    let w = BAR_PAD + (p.count > 1 ? COUNT_W : 0)
    for (const n of groups.values()) w += n * BTN_W + (n - 1) * BTN_GAP + GROUP_PAD
    if (overflow) groups.set(-1, 1)
    w += Math.max(0, groups.size - 1) * GROUP_GAP
    if (overflow) w += BTN_W + GROUP_PAD - 0
    return w <= width
  }
  const byHide = [...actions].sort((a, b) => a.hideOrder - b.hideOrder)
  let hidden: Action[] = []
  while (hidden.length < byHide.length) {
    const hideIds = new Set(hidden.map((a) => a.id))
    const visible = actions.filter((a) => !hideIds.has(a.id))
    if (fits(visible, hidden.length > 0)) break
    // hide the next-most-expendable action (hideOrder is descending: highest hides first)
    hidden = byHide.slice(byHide.length - hidden.length - 1)
  }
  const hideIds = new Set(hidden.map((a) => a.id))
  const visible = actions.filter((a) => !hideIds.has(a.id))
  const groups = [...new Set(visible.map((a) => a.group))].map((g) => visible.filter((a) => a.group === g))

  const items: MenuItem[] = actions
    .filter((a) => hideIds.has(a.id))
    .map((a) => ({ label: a.label, icon: a.icon, disabled: a.disabled, onSelect: a.run }))

  return (
    <div ref={bar} className="action-bar" role="toolbar" aria-label="Message actions">
      {groups.map((g) => (
        <div className="ab-group" key={g[0].group}>
          {g.map((a) => (
            <button
              key={a.id}
              className={a.danger ? 'ab-btn is-danger' : 'ab-btn'}
              title={a.title}
              aria-label={a.title}
              disabled={a.disabled}
              onClick={a.run}
            >
              {a.icon}
            </button>
          ))}
        </div>
      ))}
      {hidden.length > 0 && (
        <div className="ab-group">
          <button
            ref={more}
            className="ab-btn"
            title="More"
            aria-label="More actions"
            aria-haspopup="menu"
            disabled={d}
            onClick={() => {
              const r = more.current!.getBoundingClientRect()
              setMenu({ x: r.left, y: r.bottom + 6 })
            }}
          >
            <Ellipsis size={ICON} />
          </button>
        </div>
      )}
      {p.count > 1 && <span className="action-count">{p.count} selected</span>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}
