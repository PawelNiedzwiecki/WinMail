import DOMPurify from 'dompurify'
import { useEffect, useMemo, useRef, useState } from 'react'

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const BASE_CSS = `
  html { color-scheme: light; }
  body {
    margin: 0;
    padding: 4px 2px 24px;
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #1d1d1f;
    background: #ffffff;
    overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  a { color: #0066cc; }
  blockquote { margin-left: 0; padding-left: 12px; border-left: 2px solid #c7c7cc; color: #555; }
`

/**
 * Most HTML mail hard-codes light colours, so recolouring it breaks layouts. Inverting the
 * whole body and inverting media back keeps designs readable and photos untouched.
 * The root background is painted outside the filter, so it is set to the dark colour directly;
 * #e1e1e1 inverts to #1e1e1e, the app's dark surface.
 */
const DARK_CSS = `
  html { color-scheme: dark; background: #1e1e1e; }
  body { background: #e1e1e1; filter: invert(1) hue-rotate(180deg); }
  img, video, picture, canvas, svg image, [style*="background-image"], [background] {
    filter: invert(1) hue-rotate(180deg);
  }
`

const REMOTE_RE = /(src|background|srcset)\s*=\s*["']?\s*(https?:)?\/\/|url\(\s*["']?\s*(https?:)?\/\//i

export function hasRemoteContent(html: string): boolean {
  return REMOTE_RE.test(html)
}

/**
 * Renders untrusted HTML mail:
 * - sanitised with DOMPurify (no scripts, forms, meta, base, link)
 * - sandboxed iframe without allow-scripts
 * - CSP in the frame blocks remote images/CSS unless allowRemote
 */
export function HtmlBody({ html, allowRemote, dark }: { html: string; allowRemote: boolean; dark: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(120)

  const doc = useMemo(() => {
    const clean = DOMPurify.sanitize(html, {
      WHOLE_DOCUMENT: true,
      FORBID_TAGS: ['script', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'base', 'link', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick']
    })
    const img = allowRemote ? 'data: https: http:' : 'data:'
    const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src ${img}; font-src data:`
    const head = `<meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${BASE_CSS}${dark ? DARK_CSS : ''}</style>`
    return clean.includes('<head>')
      ? clean.replace('<head>', `<head>${head}`)
      : `<!doctype html><html><head>${head}</head><body>${clean}</body></html>`
  }, [html, allowRemote, dark])

  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    let ro: ResizeObserver | null = null
    const measure = () => {
      const d = frame.contentDocument
      if (!d?.documentElement) return
      // Measure at zero height: mail styled with height:100% or 100vh would otherwise grow
      // with the frame, and every resize would trigger another one, forever.
      const prev = frame.style.height
      frame.style.height = '0px'
      const h = d.documentElement.scrollHeight
      frame.style.height = prev
      setHeight(h)
    }
    const onLoad = () => {
      measure()
      const d = frame.contentDocument
      if (!d) return
      ro = new ResizeObserver(measure)
      ro.observe(d.documentElement)
      d.querySelectorAll('img').forEach((i) => i.addEventListener('load', measure))
    }
    frame.addEventListener('load', onLoad)
    return () => {
      frame.removeEventListener('load', onLoad)
      ro?.disconnect()
    }
  }, [doc])

  return (
    <iframe
      ref={ref}
      className="html-body"
      title="Message"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ height }}
    />
  )
}
