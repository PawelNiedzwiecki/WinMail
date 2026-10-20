import DOMPurify from 'dompurify'
import type { Address, MessageDetail } from '@shared/types'
import { formatFullDate } from './format'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const fmt = (list: Address[]) =>
  list.map((a) => (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email)).join(', ')

/**
 * A complete document for printing one message: a header block, then the sanitised body.
 * The print window runs no scripts; the CSP keeps remote images off unless the reader allowed them.
 */
export function printDocument(d: MessageDetail, allowRemote: boolean): string {
  const img = allowRemote ? 'data: cid: https: http:' : 'data: cid:'
  const rows: [string, string][] = [
    ['From', fmt([d.from])],
    ['To', fmt(d.to)],
    ...(d.cc.length ? ([['Cc', fmt(d.cc)]] as [string, string][]) : []),
    ['Date', formatFullDate(d.date)],
    ['Subject', d.subject]
  ]
  const body = d.html
    ? DOMPurify.sanitize(d.html, { FORBID_TAGS: ['form', 'input', 'button'] })
    : `<pre class="text">${esc(d.text)}</pre>`
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${img}; style-src 'unsafe-inline'">
<title>${esc(d.subject)}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px; color: #000; margin: 0; }
  .head { border-bottom: 1px solid #999; padding-bottom: 10px; margin-bottom: 16px; }
  .head h1 { font-size: 18px; margin: 0 0 8px; }
  .head div { margin: 2px 0; }
  .head b { display: inline-block; min-width: 64px; color: #444; }
  .text { white-space: pre-wrap; font-family: inherit; }
  img { max-width: 100%; height: auto; }
</style></head><body>
<div class="head"><h1>${esc(d.subject)}</h1>${rows.map(([k, v]) => `<div><b>${k}:</b> ${esc(v)}</div>`).join('')}</div>
${body}
</body></html>`
}
