import {
  Baseline,
  Check,
  ChevronDown,
  EllipsisVertical,
  Hourglass,
  Link2,
  Paperclip,
  PenLine,
  Smile,
  Sparkles,
  Trash2
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Settings } from '@shared/types'
import { optedIn, optInOffMessage } from '@shared/contentFeatures'
import { daysLabel, WAIT_DAY_CHOICES } from '@shared/waiting'
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
import { updateSession, type ComposeSession } from '../../compose/sessions'
import { setWait } from '../../compose/waiting'
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

type Menu = { kind: 'send' | 'more' | 'templates' | 'wait'; x: number; y: number }

/** Tooltip of the Waiting for switch: what it will do, and why it turned on by itself. */
function waitTitle(w: ComposeSession['wait']): string {
  if (!w.on) return 'Wait for a reply'
  const why = w.manual ? '' : w.reason === 'followUp' ? ' (a follow-up)' : w.reason === 'question' ? ' (you asked something)' : ''
  return `Waiting for a reply${why}: nudge me in ${daysLabel(w.days)} if nobody answers`
}

/** Send (with Schedule send), formatting, attach, link, emoji, signature, More, save status and discard. */
export function ComposeFooter(p: Props) {
  const s = p.session
  const [menu, setMenu] = useState<Menu | null>(null)
  const [thinking, setThinking] = useState(false)
  const replyOn = optedIn(p.settings, 'reply')
  const sendRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const waitRef = useRef<HTMLButtonElement>(null)

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
    if (menu?.kind === 'wait') {
      const w = s.wait
      return [
        {
          label: 'Waiting for a reply',
          icon: w.on ? <Check size={14} /> : undefined,
          onSelect: () => setWait(s.id, { on: !w.on })
        },
        'separator' as const,
        { label: 'Nudge me if nobody answers in', disabled: true, onSelect: () => {} },
        ...WAIT_DAY_CHOICES.map((d) => ({
          label: daysLabel(d),
          icon: w.on && w.days === d ? <Check size={14} /> : undefined,
          onSelect: () => setWait(s.id, { days: d })
        }))
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
      <button
        ref={waitRef}
        className={`ft-btn ft-wait${s.wait.on ? ' is-on' : ''}`}
        title={waitTitle(s.wait)}
        aria-label={s.wait.on ? `Waiting for a reply, ${daysLabel(s.wait.days)}` : 'Wait for a reply'}
        aria-pressed={s.wait.on}
        aria-haspopup="menu"
        onMouseDown={noFocus}
        onClick={() => openAt('wait', waitRef.current)}
      >
        <Hourglass size={16} />
        {s.wait.on && <span className="ft-wait-days">{s.wait.days % 7 === 0 ? `${s.wait.days / 7}w` : `${s.wait.days}d`}</span>}
      </button>
      {s.reply && p.aiAvailable && (
        <button
          className={`ft-btn ft-optional${replyOn ? '' : ' is-disabled'}`}
          title={replyOn ? 'Suggest a reply (sends this message to Claude)' : 'Turn on Suggest a reply in Settings > Claude'}
          aria-label="Suggest a reply"
          disabled={thinking}
          onMouseDown={noFocus}
          onClick={async () => {
            // Off: nothing is sent; say where the switch is. A pop-out's settings date from when it opened, so ask again.
            if (!replyOn) {
              const fresh = await api.getSettings().catch(() => null)
              if (!fresh || !optedIn(fresh, 'reply')) {
                return updateSession(s.id, { banner: { tone: 'info', text: optInOffMessage('reply') } })
              }
            }
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
