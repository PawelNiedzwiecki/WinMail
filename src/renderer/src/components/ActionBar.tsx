import { useRef, useState } from 'react'
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
import { TbButton } from './Toolbar'
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

/** Per-message actions, shown above the reading pane. */
export function ActionBar(p: Props) {
  const d = !p.hasSelection
  const more = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const items: MenuItem[] = [
    { label: 'Move to…', icon: <FolderInput size={15} />, disabled: d || !p.canMove, onSelect: p.onMove },
    {
      label: p.selectionRead ? 'Mark as Unread' : 'Mark as Read',
      icon: p.selectionRead ? <Mail size={15} /> : <MailOpen size={15} />,
      disabled: d,
      onSelect: p.onToggleRead
    },
    { label: 'Flag', icon: <Flag size={15} />, disabled: d, onSelect: p.onFlag },
    'separator',
    { label: 'Move to Junk', icon: <ShieldAlert size={15} />, disabled: d, onSelect: p.onJunk }
  ]

  return (
    <div className="action-bar" role="toolbar" aria-label="Message actions">
      <div className="tb-group">
        <TbButton title="Archive" disabled={d} onClick={p.onArchive}>
          <Archive size={17} />
        </TbButton>
        <TbButton title="Delete (Del)" disabled={d} onClick={p.onTrash}>
          <Trash2 size={17} />
        </TbButton>
        <TbButton title="Snooze" disabled={d} onClick={p.onSnooze}>
          <AlarmClock size={17} />
        </TbButton>
      </div>
      <span className="tb-divider" />
      <div className="tb-group">
        <TbButton title="Reply (Ctrl+R)" disabled={d} onClick={p.onReply}>
          <Reply size={17} />
        </TbButton>
        <TbButton title="Reply All (Ctrl+Shift+R)" disabled={d} onClick={p.onReplyAll}>
          <ReplyAll size={17} />
        </TbButton>
        <TbButton title="Forward (Ctrl+Shift+F)" disabled={d} onClick={p.onForward}>
          <Forward size={17} />
        </TbButton>
      </div>
      <span className="tb-divider" />
      <div className="tb-group">
        <TbButton title="Flag" disabled={d} onClick={p.onFlag}>
          <Flag size={17} />
        </TbButton>
        <TbButton
          title={p.selectionRead ? 'Mark as Unread' : 'Mark as Read'}
          disabled={d}
          onClick={p.onToggleRead}
        >
          {p.selectionRead ? <Mail size={17} /> : <MailOpen size={17} />}
        </TbButton>
        <button
          ref={more}
          className="tb-btn"
          title="More"
          aria-label="More actions"
          aria-haspopup="menu"
          disabled={d}
          onClick={() => {
            const r = more.current!.getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 4 })
          }}
        >
          <Ellipsis size={17} />
        </button>
      </div>
      {p.count > 1 && <span className="action-count">{p.count} selected</span>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}
