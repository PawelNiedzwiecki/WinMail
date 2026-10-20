import {
  Baseline,
  Check,
  ChevronDown,
  EllipsisVertical,
  Link2,
  Paperclip,
  PenLine,
  Smile,
  Sparkles,
  Trash2
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Settings } from '@shared/types'
import { api } from '../../api'
import {
  deleteTemplate,
  discard,
  insertTemplate,
  pickAttachments,
  schedule,
  send,
  setPlain,
  suggestReply,
  toggleSignature
} from '../../compose/actions'
import { formatWhen, schedulePresets } from '../../compose/schedule'
import type { ComposeSession } from '../../compose/sessions'
import { ContextMenu, type MenuItem } from '../ContextMenu'

interface Props {
  session: ComposeSession
  settings: Settings
  hasSignature: boolean
  formatOpen: boolean
  aiAvailable: boolean
  onToggleFormat: () => void
  onLink: () => void
  onSchedulePick: () => void
  onSaveTemplate: () => void
}

const STATUS: Record<ComposeSession['status'], string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Draft saved',
  error: "Couldn't save draft",
  unsupported: 'Drafts unavailable'
}

type Menu = { kind: 'send' | 'more' | 'templates'; x: number; y: number }

/** Send (with Schedule send), formatting, attach, link, emoji, signature, More, save status and discard. */
export function ComposeFooter(p: Props) {
  const s = p.session
  const [menu, setMenu] = useState<Menu | null>(null)
  const [thinking, setThinking] = useState(false)
  const sendRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)

  // Closes the menu if the card goes away under it.
  useEffect(() => () => setMenu(null), [s.id])

  const openAt = (kind: Menu['kind'], el: HTMLElement | null) => {
    const r = el?.getBoundingClientRect()
    if (r) setMenu({ kind, x: r.left, y: r.top })
  }

  const items = (): MenuItem[] => {
    if (menu?.kind === 'send') {
      return [
        { label: 'Schedule send', disabled: true, onSelect: () => {} },
        ...schedulePresets().map((pr) => ({
          label: `${pr.label}  ·  ${formatWhen(pr.at)}`,
          onSelect: () => void schedule(s.id, pr.at)
        })),
        { label: 'Pick date & time…', onSelect: p.onSchedulePick }
      ]
    }
    if (menu?.kind === 'templates') {
      const t = p.settings.templates
      return [
        { label: 'Insert template', disabled: true, onSelect: () => {} },
        ...(t.length ? t.map((x) => ({ label: x.name, onSelect: () => insertTemplate(s.id, x.text) })) : [{ label: 'No templates yet', disabled: true, onSelect: () => {} }]),
        'separator' as const,
        { label: 'Save draft as template…', onSelect: p.onSaveTemplate },
        ...t.map((x) => ({ label: `Delete “${x.name}”`, danger: true, onSelect: () => deleteTemplate(x.id) }))
      ]
    }
    return [
      {
        label: 'Plain text mode',
        icon: s.plain ? <Check size={14} /> : undefined,
        onSelect: () => setPlain(s.id, !s.plain)
      },
      { label: 'Templates', onSelect: () => setTimeout(() => openAt('templates', moreRef.current), 0) },
      'separator',
      { label: 'Insert link', disabled: s.plain, shortcut: 'Ctrl+K', onSelect: p.onLink },
      { label: 'Insert emoji', onSelect: () => api.showEmojiPanel() },
      {
        label: p.hasSignature ? 'Insert or remove signature' : 'Signature (add one in Settings)',
        disabled: !p.hasSignature || s.plain,
        onSelect: () => toggleSignature(s.id)
      }
    ]
  }

  const noFocus = (e: React.MouseEvent) => e.preventDefault() // keep the cursor in the editor
  const icon = (label: string, el: React.ReactNode, onClick: () => void, extra = '', pressed?: boolean) => (
    <button
      className={`ft-btn ${extra}`}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onMouseDown={noFocus}
      onClick={onClick}
    >
      {el}
    </button>
  )

  return (
    <div className="compose-footer">
      <div className="send-split" ref={sendRef}>
        <button className="send-main" onClick={() => void send(s.id)} title="Send (Ctrl+Enter)">
          Send
        </button>
        <button
          className="send-more"
          aria-label="More send options"
          title="More send options"
          onClick={() => openAt('send', sendRef.current)}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {!s.plain && icon('Formatting options', <Baseline size={18} />, p.onToggleFormat, '', p.formatOpen)}
      {icon('Attach files', <Paperclip size={17} />, () => void pickAttachments(s.id))}
      {!s.plain && icon('Insert link (Ctrl+K)', <Link2 size={17} />, p.onLink, 'ft-optional')}
      {icon('Insert emoji', <Smile size={17} />, () => api.showEmojiPanel(), 'ft-optional')}
      {!s.plain &&
        icon(
          p.hasSignature ? 'Insert or remove signature' : 'Add a signature in Settings > Accounts',
          <PenLine size={17} />,
          () => p.hasSignature && toggleSignature(s.id),
          `ft-optional${p.hasSignature ? '' : ' is-disabled'}`
        )}
      {s.reply && p.aiAvailable && (
        <button
          className="ft-btn ft-optional"
          title="Suggest a reply"
          aria-label="Suggest a reply"
          disabled={thinking}
          onMouseDown={noFocus}
          onClick={async () => {
            setThinking(true)
            await suggestReply(s.id)
            setThinking(false)
          }}
        >
          {thinking ? <span className="spinner" /> : <Sparkles size={17} />}
        </button>
      )}
      <button
        ref={moreRef}
        className="ft-btn"
        title="More options"
        aria-label="More options"
        onMouseDown={noFocus}
        onClick={() => openAt('more', moreRef.current)}
      >
        <EllipsisVertical size={17} />
      </button>
      <span className={`ft-status${s.status === 'error' || s.status === 'unsupported' ? ' is-error' : ''}`} title={s.statusError} role="status">
        {STATUS[s.status]}
      </span>
      <button className="ft-btn ft-discard" title="Discard draft (Ctrl+Shift+D)" aria-label="Discard draft" onClick={() => void discard(s.id)}>
        <Trash2 size={17} />
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items()} onClose={() => setMenu(null)} />}
    </div>
  )
}
