import { Mail, Paperclip, Flag, ImageOff } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { Address, MessageAppearance, MessageDetail, MessageSummary } from '@shared/types'
import { formatFullDate, formatSize, initials } from '../format'
import { usePrefersDark } from '../usePrefersDark'
import { HtmlBody, hasRemoteContent } from './HtmlBody'

interface Props {
  summary: MessageSummary | null
  detail: MessageDetail | null
  error: string | null
  loadRemoteByDefault: boolean
  messageAppearance: MessageAppearance
  onSaveAttachment: (index: number) => void
}

const fmtList = (list: Address[]) =>
  list.map((a) => (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email)).join(', ')

export function MessageView({
  summary,
  detail,
  error,
  loadRemoteByDefault,
  messageAppearance,
  onSaveAttachment
}: Props) {
  const [allowRemote, setAllowRemote] = useState(loadRemoteByDefault)
  const appDark = usePrefersDark()
  const dark = messageAppearance === 'app' ? appDark : messageAppearance === 'dark'
  useEffect(() => setAllowRemote(loadRemoteByDefault), [summary?.key, loadRemoteByDefault])

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

  return (
    <section className="viewer">
      <div className="viewer-scroll">
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
          </div>
        </header>

        {remote && !allowRemote && (
          <div className="remote-banner">
            <ImageOff size={14} />
            <span>This message contains remote content.</span>
            <button className="link-btn" onClick={() => setAllowRemote(true)}>
              Load Remote Content
            </button>
          </div>
        )}

        {error && <div className="list-error">{error}</div>}
        {!detail && !error && <div className="msg-loading">Loading…</div>}

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
      </div>
    </section>
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
