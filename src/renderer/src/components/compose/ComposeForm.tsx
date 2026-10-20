import { Paperclip } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { addFiles, answerConfirm, close, discard, focusList, save, send, unfoldQuote } from '../../compose/actions'
import { touch } from '../../compose/autosave'
import { useComposeCtx } from '../../compose/ComposeContext'
import { isKey, KEYS } from '../../compose/keys'
import { editorOf, updateSession, useSession, type RecipientField as Field } from '../../compose/sessions'
import { hasEscapeLayer } from '../../useEscape'
import { AttachmentChips } from './AttachmentChips'
import { ComposeFooter } from './ComposeFooter'
import { FormatBar } from './FormatBar'
import { LinkPopover } from './LinkPopover'
import { RecipientsBlock } from './RecipientsBlock'
import { RichEditor } from './RichEditor'
import { NamePopover, SchedulePopover } from './SmallPopovers'
import { saveTemplate } from '../../compose/actions'

const FORMAT_KEY = 'winmail.compose.format'

const readFormatOpen = () => {
  try {
    return localStorage.getItem(FORMAT_KEY) !== 'off'
  } catch {
    return true
  }
}

type Popover = { kind: 'link'; anchor?: HTMLAnchorElement } | { kind: 'schedule' } | { kind: 'template' } | null

/** Everything inside a card or inline reply: fields, editor, attachments, footer. */
export function ComposeForm({ id, showSubject }: { id: string; showSubject: boolean }) {
  const s = useSession(id)
  const ctx = useComposeCtx()
  const [formatOpen, setFormatOpen] = useState(readFormatOpen)
  const [popover, setPopover] = useState<Popover>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const controls = useRef<{ focus(f: Field): void; openFrom(): void } | null>(null)
  const subject = useRef<HTMLInputElement>(null)

  // Put the cursor where the message needs it when the card appears or comes back from minimized.
  const hidden = !s || s.minimized
  useEffect(() => {
    if (hidden || !s) return
    const t = window.setTimeout(() => {
      if (s.focus === 'to') controls.current?.focus('to')
      else if (s.focus === 'subject') subject.current?.focus()
      else editorOf(id)?.focus('start')
    }, 30)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, s?.host, id])

  if (!s) return null
  const account = ctx.accounts.find((a) => a.id === s.accountId)
  const hasSignature = !!account?.signature?.trim()

  const toggleFormat = () => {
    setFormatOpen((open) => {
      try {
        localStorage.setItem(FORMAT_KEY, open ? 'off' : 'on')
      } catch {
        // Not remembered; fine.
      }
      return !open
    })
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    const stop = (fn: () => void) => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    }
    if (isKey(e, KEYS.send)) stop(() => void send(id))
    else if (isKey(e, KEYS.save)) stop(() => void save(id))
    else if (isKey(e, KEYS.close)) stop(() => void close(id))
    else if (isKey(e, KEYS.discard)) stop(() => void discard(id))
    else if (isKey(e, KEYS.cc)) stop(() => controls.current?.focus('cc'))
    else if (isKey(e, KEYS.bcc)) stop(() => controls.current?.focus('bcc'))
    else if (isKey(e, KEYS.from)) stop(() => controls.current?.openFrom())
    else if (e.key === 'Escape' && e.shiftKey) stop(focusList)
    else if (e.key === 'Escape' && !hasEscapeLayer()) {
      // Full screen steps back to the dock, a card closes and saves, an inline reply hands focus to the list.
      stop(() => {
        if (s.host === 'inline') focusList()
        else if (s.expanded) updateSession(id, { expanded: false })
        else void close(id)
      })
    }
  }

  const isFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const dragProps = {
    onDragEnter: (e: DragEvent) => {
      if (!isFiles(e)) return
      dragDepth.current++
      setDragging(true)
    },
    onDragLeave: (e: DragEvent) => {
      if (!isFiles(e)) return
      if (--dragDepth.current <= 0) {
        dragDepth.current = 0
        setDragging(false)
      }
    },
    onDragOver: (e: DragEvent) => isFiles(e) && e.preventDefault(),
    onDrop: (e: DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      void addFiles(id, Array.from(e.dataTransfer.files))
    }
  }

  return (
    <div className="compose-form" data-compose={id} onKeyDown={onKeyDown} {...dragProps}>
      {s.banner && (
        <div className={`compose-banner is-${s.banner.tone}`} role={s.banner.tone === 'error' ? 'alert' : 'status'}>
          {s.banner.text}
        </div>
      )}
      {s.confirm && (
        <div className="compose-confirm" role="alertdialog">
          <span>{s.confirm.text}</span>
          <span className="confirm-actions">
            {s.confirm.alt && (
              <button className="btn" onClick={() => answerConfirm(id, 'alt')}>
                {s.confirm.alt.label}
              </button>
            )}
            <button className="btn" onClick={() => answerConfirm(id, 'cancel')}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => answerConfirm(id, 'ok')}>
              {s.confirm.ok}
            </button>
          </span>
        </div>
      )}
      <RecipientsBlock session={s} accounts={ctx.accounts} controls={controls} />
      {showSubject && (
        <div className="compose-row">
          <label className="compose-label" htmlFor={`${id}-subject`}>
            Subject
          </label>
          <input
            id={`${id}-subject`}
            ref={subject}
            className="compose-subject"
            value={s.subject}
            onChange={(e) => {
              updateSession(id, { subject: e.target.value })
              touch(id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                editorOf(id)?.focus('start')
              }
            }}
          />
        </div>
      )}
      <div className="compose-scroll">
        <RichEditor
          id={id}
          body={s.body}
          plain={s.plain}
          revision={s.revision}
          onLink={(anchor) => setPopover({ kind: 'link', anchor })}
        />
        {s.quote && (
          <button className="quote-pill" title="Show trimmed content" aria-label="Show trimmed content" onClick={() => unfoldQuote(id)}>
            ···
          </button>
        )}
        <AttachmentChips sessionId={id} attachments={s.attachments} account={account} />
      </div>
      {popover?.kind === 'link' && (
        <LinkPopover id={id} anchor={popover.anchor} onClose={() => setPopover(null)} />
      )}
      {popover?.kind === 'schedule' && <SchedulePopover session={s} onClose={() => setPopover(null)} />}
      {popover?.kind === 'template' && (
        <NamePopover initial={s.subject} onSave={(name) => saveTemplate(id, name)} onClose={() => setPopover(null)} />
      )}
      {formatOpen && !s.plain && <FormatBar id={id} onLink={() => setPopover({ kind: 'link' })} />}
      <ComposeFooter
        session={s}
        settings={ctx.settings}
        hasSignature={hasSignature}
        formatOpen={formatOpen}
        aiAvailable={ctx.aiAvailable}
        onToggleFormat={toggleFormat}
        onLink={() => setPopover({ kind: 'link' })}
        onSchedulePick={() => setPopover({ kind: 'schedule' })}
        onSaveTemplate={() => setPopover({ kind: 'template' })}
      />
      {dragging && (
        <div className="drop-overlay">
          <Paperclip size={22} />
          Drop files here
        </div>
      )}
    </div>
  )
}
