import { ChevronDown, Forward, Reply, ReplyAll, SquareArrowOutUpRight, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { canReplyAll, close, popOut, switchReplyMode } from '../../compose/actions'
import { useSession, type ReplyMode } from '../../compose/sessions'
import { initials } from '../../format'
import { reduceMotionNow } from '../../motion'
import { useComposeCtx } from '../../compose/ComposeContext'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { ComposeForm } from './ComposeForm'

const ICON = { reply: Reply, all: ReplyAll, forward: Forward }

/** A reply under the message being read, with the reply-type menu and a pop-out to a docked card. */
export function InlineReply({ id }: { id: string }) {
  const s = useSession(id)
  const ctx = useComposeCtx()
  const root = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // Bring it into view when it opens, without animation for people who asked for none.
  useEffect(() => {
    root.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotionNow() ? 'auto' : 'smooth' })
  }, [])

  if (!s?.reply) return null
  const { mode, summary, detail } = s.reply
  const Icon = ICON[mode]
  const account = ctx.accounts.find((a) => a.id === s.accountId)

  const items: MenuItem[] = [
    { label: 'Reply', icon: <Reply size={14} />, onSelect: () => switchReplyMode(id, 'reply') },
    { label: 'Reply All', icon: <ReplyAll size={14} />, disabled: !canReplyAll(summary, detail), onSelect: () => switchReplyMode(id, 'all') },
    { label: 'Forward', icon: <Forward size={14} />, onSelect: () => switchReplyMode(id, 'forward') },
    'separator',
    { label: 'Edit Subject', onSelect: () => popOut(id, 'subject') },
    { label: 'Pop Out Reply', icon: <SquareArrowOutUpRight size={14} />, onSelect: () => popOut(id) }
  ]
  const label: Record<ReplyMode, string> = { reply: 'Reply', all: 'Reply all', forward: 'Forward' }

  return (
    <div className="inline-reply compose" ref={root} data-compose={id}>
      <header className="inline-head">
        <span className="avatar small" title={account?.email}>
          {initials(account?.name || account?.description || '?')}
        </span>
        <button
          className="reply-type"
          title="Type of response"
          aria-label={`Type of response: ${label[mode]}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 4 })
          }}
        >
          <Icon size={15} />
          <ChevronDown size={13} />
        </button>
        <span className="grow" />
        <button className="head-btn" title="Pop out reply" aria-label="Pop out reply" onClick={() => popOut(id)}>
          <SquareArrowOutUpRight size={15} />
        </button>
        <button className="head-btn" title="Save & close" aria-label="Save and close" onClick={() => void close(id)}>
          <X size={16} />
        </button>
      </header>
      <ComposeForm id={id} showSubject={false} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}
