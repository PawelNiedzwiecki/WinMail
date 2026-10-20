import { useEffect, useRef, useState } from 'react'
import { touch } from '../../compose/autosave'
import { createLink, insertHtml, unlink } from '../../compose/editorCommands'
import { escapeHtml } from '../../compose/sanitize'
import { editorOf } from '../../compose/sessions'

interface Props {
  id: string
  /** The link being edited; none inserts a new one at the cursor. */
  anchor?: HTMLAnchorElement
  onClose: () => void
}

/** Only web and mail addresses become links; `x@y` is mail, and a bare host gets https://. */
export function normalizeUrl(input: string): string | null {
  const v = input.trim()
  if (!v) return null
  if (/^(https?:|mailto:)/i.test(v)) return v
  if (/^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(v)) return `mailto:${v}`
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null // javascript:, file:, …
  return `https://${v}`
}

/** Ctrl+K: text to display and a link, or Go to link / Change / Remove for an existing one. */
export function LinkPopover({ id, anchor, onClose }: Props) {
  const root = editorOf(id)?.root() ?? null
  // The selection is lost when focus moves into the popover, so keep it.
  const saved = useRef<Range | null>(null)
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const first = useRef<HTMLInputElement>(null)
  const bad = url.trim() !== '' && normalizeUrl(url) === null

  useEffect(() => {
    if (anchor) {
      setText(anchor.textContent ?? '')
      setUrl(anchor.getAttribute('href') ?? '')
    } else {
      const sel = window.getSelection()
      if (sel?.rangeCount && root?.contains(sel.anchorNode)) {
        saved.current = sel.getRangeAt(0).cloneRange()
        setText(sel.toString())
      }
    }
    first.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const restore = () => {
    root?.focus()
    const range = saved.current ?? (anchor && root?.contains(anchor) ? (() => {
      const r = document.createRange()
      r.selectNodeContents(anchor)
      return r
    })() : null)
    if (range) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }

  const done = () => {
    onClose()
    root?.focus()
  }

  const apply = () => {
    const href = normalizeUrl(url)
    if (!href) return
    restore()
    const label = text.trim() || url.trim()
    const selected = window.getSelection()?.toString() ?? ''
    if (selected && selected === label) createLink(href)
    else insertHtml(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)
    touch(id)
    onClose()
  }

  const remove = () => {
    restore()
    unlink()
    touch(id)
    onClose()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      done()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      apply()
    }
  }

  const go = anchor?.getAttribute('href')

  return (
    <div className="link-popover" role="dialog" aria-label="Edit link" onKeyDown={onKey}>
      <label>
        <span>Text to display</span>
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label>
        <span>Link (web or email address)</span>
        <input ref={first} value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
      </label>
      {bad && <div className="link-error">Only web and email addresses can be linked.</div>}
      <div className="link-actions">
        {anchor && go && (
          <button className="link-btn small" onClick={() => window.open(go, '_blank')}>
            Go to link
          </button>
        )}
        {anchor && (
          <button className="link-btn small" onClick={remove}>
            Remove
          </button>
        )}
        <span className="grow" />
        <button className="btn" onClick={done}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!normalizeUrl(url)} onClick={apply}>
          OK
        </button>
      </div>
    </div>
  )
}
