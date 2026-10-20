import {
  SquarePen,
  Archive,
  Trash2,
  ShieldAlert,
  Reply,
  ReplyAll,
  Forward,
  Flag,
  Search,
  Mail,
  MailOpen,
  RefreshCw,
  FolderInput,
  AlarmClock
} from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  hasAccounts: boolean
  hasSelection: boolean
  selectionRead: boolean
  refreshing: boolean
  query: string
  onQuery: (q: string) => void
  onRefresh: () => void
  onCompose: () => void
  onArchive: () => void
  onTrash: () => void
  onJunk: () => void
  onMove: () => void
  onSnooze: () => void
  /** Move to… needs all selected messages in one account. */
  canMove: boolean
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onFlag: () => void
  onToggleRead: () => void
}

export function Toolbar(p: Props) {
  const d = !p.hasSelection
  return (
    <div className="toolbar">
      <div className="tb-group">
        <TbButton title="Get New Mail" disabled={!p.hasAccounts} onClick={p.onRefresh}>
          <RefreshCw size={16} className={p.refreshing ? 'spin' : ''} />
        </TbButton>
        <TbButton title="New Message (Ctrl+N)" disabled={!p.hasAccounts} onClick={p.onCompose}>
          <SquarePen size={17} />
        </TbButton>
      </div>
      <div className="tb-group">
        <TbButton title="Archive" disabled={d} onClick={p.onArchive}>
          <Archive size={17} />
        </TbButton>
        <TbButton title="Delete (Del)" disabled={d} onClick={p.onTrash}>
          <Trash2 size={17} />
        </TbButton>
        <TbButton title="Move to Junk" disabled={d} onClick={p.onJunk}>
          <ShieldAlert size={17} />
        </TbButton>
        <TbButton title="Move to…" disabled={d || !p.canMove} onClick={p.onMove}>
          <FolderInput size={17} />
        </TbButton>
        <TbButton title="Snooze" disabled={d} onClick={p.onSnooze}>
          <AlarmClock size={17} />
        </TbButton>
      </div>
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
      </div>
      <div className="tb-spacer" />
      <label className="search">
        <Search size={13} />
        <input
          id="search"
          placeholder="Search"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
        />
      </label>
    </div>
  )
}

function TbButton(props: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      className="tb-btn"
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
