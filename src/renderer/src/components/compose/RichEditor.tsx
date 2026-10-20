import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { addFiles, pasteImages } from '../../compose/actions'
import { touch } from '../../compose/autosave'
import { exec, insertHtml, insertText, toggleQuote } from '../../compose/editorCommands'
import { isKey, KEYS } from '../../compose/keys'
import { sanitizeHtml } from '../../compose/sanitize'
import { registerEditor, updateSession, type EditorHandle } from '../../compose/sessions'

interface Props {
  id: string
  /** Content to show; set again whenever `revision` changes or the mode switches. */
  body: string
  plain: boolean
  revision: number
  onLink: (anchor?: HTMLAnchorElement) => void
}

/**
 * The message body: an uncontrolled contentEditable, so typing never re-renders React. Its content
 * is copied into the session only when something needs it (saving, sending, moving the card),
 * and again if the editor unmounts.
 */
export function RichEditor({ id, body, plain, revision, onLink }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const plainPaste = useRef(false)
  const draggingHere = useRef(false)

  const read = () => {
    const el = ref.current
    if (!el) return ''
    return plain ? el.innerText.replace(/ /g, ' ') : el.innerHTML
  }
  const latest = useRef({ read, plain })
  latest.current = { read, plain }

  // Show the session's content on mount and whenever it is replaced from outside.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (plain) el.textContent = body
    else el.innerHTML = body
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, plain])

  useLayoutEffect(() => {
    const handle: EditorHandle = {
      flush() {
        const body = latest.current.read()
        updateSession(id, (s) => (s.body === body ? {} : { body }))
      },
      read: () => latest.current.read(),
      focus(where) {
        const el = ref.current
        if (!el) return
        el.focus()
        const r = document.createRange()
        r.selectNodeContents(el)
        r.collapse(where === 'start')
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(r)
      },
      root: () => ref.current
    }
    const off = registerEditor(id, handle)
    return () => {
      // React 18 runs this before the node leaves the page, so the text can still be read.
      handle.flush()
      off()
    }
  }, [id])

  // Right-click and drag handlers see only the editor's own drags.
  useEffect(() => {
    const end = () => (draggingHere.current = false)
    window.addEventListener('dragend', end)
    return () => window.removeEventListener('dragend', end)
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    const run = (fn: () => void) => {
      e.preventDefault()
      fn()
      touch(id)
    }
    if (isKey(e, KEYS.plainPaste)) plainPaste.current = true
    if (plain) {
      if (isKey(e, KEYS.link)) e.preventDefault()
      return
    }
    if (isKey(e, KEYS.link)) {
      e.preventDefault()
      onLink()
    } else if (isKey(e, KEYS.numbered)) run(() => exec('insertOrderedList'))
    else if (isKey(e, KEYS.bulleted)) run(() => exec('insertUnorderedList'))
    else if (isKey(e, KEYS.quote)) run(() => ref.current && toggleQuote(ref.current))
    else if (isKey(e, KEYS.outdent)) run(() => exec('outdent'))
    else if (isKey(e, KEYS.indent)) run(() => exec('indent'))
    else if (isKey(e, KEYS.removeFormat)) run(() => exec('removeFormat'))
    else if (isKey(e, KEYS.strike)) run(() => exec('strikeThrough'))
  }

  const onPaste = (e: ClipboardEvent) => {
    const data = e.clipboardData
    const text = data.getData('text/plain')
    const html = data.getData('text/html')
    const files = Array.from(data.files)
    const asPlain = plainPaste.current
    plainPaste.current = false
    // A screenshot or copied file arrives with no text; copied web content has both.
    if (files.length && !text.trim()) {
      e.preventDefault()
      const images = files.filter((f) => f.type.startsWith('image/'))
      if (images.length) void pasteImages(id, images)
      void addFiles(id, files.filter((f) => !f.type.startsWith('image/')))
      return
    }
    e.preventDefault()
    if (plain || asPlain || !html) insertText(text)
    else insertHtml(sanitizeHtml(html))
    touch(id)
  }

  const onDrop = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) return // the card takes files
    if (draggingHere.current || plain) return // moving text inside the editor: the browser does it
    const html = e.dataTransfer.getData('text/html')
    const text = e.dataTransfer.getData('text/plain')
    if (!html && !text) return
    e.preventDefault()
    const at = document.caretRangeFromPoint(e.clientX, e.clientY)
    if (at) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(at)
    }
    if (html) insertHtml(sanitizeHtml(html))
    else insertText(text)
    touch(id)
  }

  return (
    <div
      ref={ref}
      className={`rte${plain ? ' is-plain' : ''}`}
      contentEditable={plain ? 'plaintext-only' : true}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Message body"
      spellCheck
      onInput={() => touch(id)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDrop={onDrop}
      onDragStart={() => (draggingHere.current = true)}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (a && !plain) onLink(a)
      }}
    />
  )
}
