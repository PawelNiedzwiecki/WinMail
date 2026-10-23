import {
  Mail,
  Paperclip,
  Flag,
  ImageOff,
  Reply,
  ReplyAll,
  Forward,
  SquarePen,
  Ellipsis,
  MailMinus,
  Sparkles,
  X,
  Layers
} from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import type { Address, InviteAnswer, MessageAppearance, MessageDetail, MessageSummary, Unsubscribe } from '@shared/types'
import { api } from '../api'
import { Collapse } from './Collapse'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { formatFullDate, formatSize, initials } from '../format'
import { usePrefersDark } from '../usePrefersDark'
import { canReplyAll } from '../compose/actions'
import type { ReplyMode } from '../compose/sessions'
import { HtmlBody, hasRemoteContent } from './HtmlBody'
import { InviteCard } from './InviteCard'
import { InlineReply } from './compose/InlineReply'
import { UnsubscribeDialog } from './UnsubscribeDialog'

interface Props {
  summary: MessageSummary | null
  detail: MessageDetail | null
  error: string | null
  /** Remote images may load: the setting, or this message's "Load Remote Content". */
  allowRemote: boolean
  onAllowRemote: () => void
  messageAppearance: MessageAppearance
  onSaveAttachment: (index: number) => void
  /** The reply open under this message, if any. */
  inlineReplyId: string | null
  /** A message in a Drafts folder: opens for editing instead of replying. */
  isDraft: boolean
  onReply: (mode: ReplyMode) => void
  onEditDraft: () => void
  /** Other messages of the conversation, oldest first. */
  thread?: MessageSummary[]
  /** More than one message selected. */
  multiCount?: number
  /** The "…" menu: print, show original, summarise, move, snooze. */
  moreItems?: () => MenuItem[]
  /** AI summary of this message, while asked for or shown. */
  aiSummary?: { text: string | null; error: string | null } | null
  onCloseSummary?: () => void
  onUnsubscribe?: (u: Unsubscribe) => void
  /** RSVP to the message's calendar invitation; rejects when it couldn't be sent. */
  onAnswerInvite?: (answer: InviteAnswer) => Promise<void>
  onOpenInvite?: () => void
}

const fmtList = (list: Address[]) =>
  list.map((a) => (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email)).join(', ')

export function MessageView({
  summary,
  detail,
  error,
  allowRemote,
  onAllowRemote,
  messageAppearance,
  onSaveAttachment,
  inlineReplyId,
  isDraft,
  onReply,
  onEditDraft,
  thread,
  multiCount = 0,
  moreItems,
  aiSummary: ai,
  onCloseSummary,
  onUnsubscribe,
  onAnswerInvite,
  onOpenInvite
}: Props) {
  const appDark = usePrefersDark()
  const dark = messageAppearance === 'app' ? appDark : messageAppearance === 'dark'
  const [more, setMore] = useState<{ x: number; y: number } | null>(null)
  // The list banner stays closed for the message it was dismissed (or unsubscribed) on.
  const [listHidden, setListHidden] = useState<string | null>(null)
  const [confirmUnsub, setConfirmUnsub] = useState(false)

  if (multiCount > 1) {
    return (
      <section className="viewer viewer-empty">
        <Layers size={48} strokeWidth={1} />
        <p>{multiCount} Messages Selected</p>
      </section>
    )
  }

  if (!summary) {
    return (
      <section className="viewer viewer-empty">
        <Mail size={48} strokeWidth={1} />
        <p>No Message Selected</p>
      </section>
    )
  }

  const m = detail ?? summary
  const remote = detail?.html ? hasRemoteContent(detail.html) : false
  const sender = m.from.name || m.from.email

  return (
    <section className="viewer">
      <div className="viewer-scroll">
        {thread && thread.length > 0 && (
          <div className="thread">
            {thread.map((t) => (
              <ThreadItem key={t.key} m={t} allowRemote={allowRemote} dark={dark} appDark={appDark} />
            ))}
          </div>
        )}
        <header className="msg-header">
          <div className="avatar">{initials(m.from.name || m.from.email)}</div>
          <div className="msg-meta">
            <div className="msg-line">
              <span className="msg-from" title={m.from.email}>
                {m.from.name || m.from.email}
              </span>
              <span className="msg-date">{formatFullDate(m.date)}</span>
            </div>
            <div className="msg-subject">
              {m.subject}
              {m.flagged && <Flag size={12} className="msg-flag" fill="currentColor" />}
            </div>
            <div className="msg-to">
              To: <span>{fmtList(m.to) || '(undisclosed recipients)'}</span>
            </div>
            {detail && detail.cc.length > 0 && (
              <div className="msg-to">
                Cc: <span>{fmtList(detail.cc)}</span>
              </div>
            )}
            {detail && detail.bcc.length > 0 && (
              <div className="msg-to">
                Bcc: <span>{fmtList(detail.bcc)}</span>
              </div>
            )}
          </div>
          {moreItems && (
            <button
              className="tb-btn msg-more"
              title="More"
              aria-label="More"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setMore({ x: r.right - 200, y: r.bottom + 4 })
              }}
            >
              <Ellipsis size={17} />
            </button>
          )}
        </header>
        {more && moreItems && <ContextMenu x={more.x} y={more.y} items={moreItems()} onClose={() => setMore(null)} />}

        {/* Banners grow in when they arrive or close; keyed by message so switching swaps them instantly. */}
        <Collapse key={`ai-${summary.key}`} open={!!ai}>
          {ai && (
            <div className="ai-summary">
              <div className="ai-summary-head">
                <Sparkles size={14} />
                <span>Summary</span>
                <button className="sq-btn" title="Close" aria-label="Close summary" onClick={onCloseSummary}>
                  <X size={13} />
                </button>
              </div>
              {ai.error ? (
                <div className="ai-summary-error">{ai.error}</div>
              ) : ai.text === null ? (
                <div className="ai-summary-loading">
                  <span className="spinner" /> Summarising…
                </div>
              ) : (
                <div className="ai-summary-text">{ai.text}</div>
              )}
            </div>
          )}
        </Collapse>

        <Collapse key={`list-${summary.key}`} open={!!detail?.unsubscribe && !!onUnsubscribe && listHidden !== summary.key}>
          <div className="list-banner">
            <div className="list-banner-icon">
              <MailMinus size={15} />
            </div>
            <div className="list-banner-text">
              <strong>Mailing list</strong>
              <span>Not interested? Stop getting emails from {sender}.</span>
            </div>
            <button className="list-banner-action" onClick={() => setConfirmUnsub(true)}>
              Unsubscribe
            </button>
            <button
              className="sq-btn list-banner-close"
              title="Dismiss"
              aria-label="Dismiss"
              onClick={() => setListHidden(summary.key)}
            >
              <X size={13} />
            </button>
          </div>
        </Collapse>
        <AnimatePresence>
          {confirmUnsub && detail?.unsubscribe && onUnsubscribe && (
            <UnsubscribeDialog
              key="unsubscribe"
              sender={sender}
              unsubscribe={detail.unsubscribe}
              onClose={() => setConfirmUnsub(false)}
              onConfirm={() => {
                setListHidden(summary.key)
                onUnsubscribe(detail.unsubscribe!)
              }}
            />
          )}
        </AnimatePresence>

        <Collapse key={`remote-${summary.key}`} open={remote && !allowRemote}>
          <div className="remote-banner">
            <ImageOff size={14} />
            <span>This message contains remote content.</span>
            <button className="btn btn-small" onClick={onAllowRemote}>
              Load Content
            </button>
          </div>
        </Collapse>

        {detail?.invite && onAnswerInvite && onOpenInvite && (
          <InviteCard invite={detail.invite} onAnswer={onAnswerInvite} onOpen={onOpenInvite} />
        )}

        {/* Attachments sit above the body, so they're found without scrolling past a long message. */}
        {detail && detail.attachments.length > 0 && (
          <div className="attachments">
            {detail.attachments.map((a) => (
              <button
                key={a.index}
                className="attachment"
                title={`Save ${a.filename}`}
                onClick={() => onSaveAttachment(a.index)}
              >
                <Paperclip size={14} />
                <span>{a.filename}</span>
                <span className="attachment-size">{formatSize(a.size)}</span>
              </button>
            ))}
          </div>
        )}

        {error && <div className="list-error">{error}</div>}
        {!detail && !error && <MessageSkeleton />}

        {detail &&
          (detail.html ? (
            <div className={`msg-body-html ${dark ? 'is-dark' : ''}`}>
              <HtmlBody html={detail.html} allowRemote={allowRemote} dark={dark} />
            </div>
          ) : (
            // Plain text follows the app unless the setting asks for the other look.
            <article
              className={`msg-body ${dark === appDark ? '' : `msg-body-card ${dark ? 'is-dark' : 'is-light'}`}`}
            >
              {linkify(detail.text)}
            </article>
          ))}

        {/* Stays mounted while the message loads, so a reply being written is never lost. */}
        {isDraft ? (
          <div className="draft-bar">
            <span>This message is a draft.</span>
            <button className="btn btn-primary" onClick={onEditDraft}>
              <SquarePen size={14} /> Continue Editing
            </button>
          </div>
        ) : inlineReplyId ? (
          <InlineReply id={inlineReplyId} />
        ) : detail ? (
          <div className="reply-buttons">
            <button className="reply-btn" onClick={() => onReply('reply')}>
              <Reply size={15} /> Reply
            </button>
            {canReplyAll(summary, detail) && (
              <button className="reply-btn" onClick={() => onReply('all')}>
                <ReplyAll size={15} /> Reply All
              </button>
            )}
            <button className="reply-btn" onClick={() => onReply('forward')}>
              <Forward size={15} /> Forward
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** Generic paragraphs in grey, shown until the message text arrives. */
const SKELETON: (number | null)[] = [92, 100, 86, 64, null, 98, 90, 72, null, 100, 95, 40]

function MessageSkeleton({ compact }: { compact?: boolean }) {
  const lines = compact ? SKELETON.slice(0, 4) : SKELETON
  return (
    <div className={`msg-skeleton ${compact ? 'is-compact' : ''}`} role="status" aria-busy="true" aria-label="Loading message">
      {!compact && <div className="skel-banner" />}
      {lines.map((w, i) =>
        w === null ? <div key={i} className="msg-skeleton-gap" /> : <div key={i} className="skel-line" style={{ width: `${w}%` }} />
      )}
    </div>
  )
}

/** An earlier message of the conversation: a one-line summary that opens to its body. */
function ThreadItem({ m, allowRemote, dark, appDark }: { m: MessageSummary; allowRemote: boolean; dark: boolean; appDark: boolean }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || detail) return
    let live = true
    api
      .getMessage(m.accountId, m.mailbox, m.uid, m.uidValidity)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [open, detail, m.accountId, m.mailbox, m.uid])

  return (
    <div className={`thread-item ${open ? 'is-open' : ''}`}>
      <button className="thread-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="avatar avatar-small">{initials(m.from.name || m.from.email)}</span>
        <span className="thread-from">{m.from.name || m.from.email}</span>
        {!open && <span className="thread-preview">{m.preview}</span>}
        <span className="thread-date">{formatFullDate(m.date)}</span>
      </button>
      <Collapse open={open}>
        <div className="thread-body">
          {error && <div className="list-error">{error}</div>}
          {!detail && !error && <MessageSkeleton compact />}
          {detail &&
            (detail.html ? (
              <div className={`msg-body-html ${dark ? 'is-dark' : ''}`}>
                <HtmlBody html={detail.html} allowRemote={allowRemote} dark={dark} />
              </div>
            ) : (
              <article className={`msg-body ${dark === appDark ? '' : `msg-body-card ${dark ? 'is-dark' : 'is-light'}`}`}>
                {linkify(detail.text)}
              </article>
            ))}
        </div>
      </Collapse>
    </div>
  )
}

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    )
  )
}
