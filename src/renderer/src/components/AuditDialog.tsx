import { Check, ExternalLink, MailMinus, RotateCw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Account, AuditResult, MailingList, UnsubscribeResult, UnsubscribeWay } from '@shared/types'
import { auditSummary } from '@shared/unsubscribe'
import { api } from '../api'
import { toast } from '../toasts'
import { Dialog } from './Dialog'

interface Props {
  accounts: Account[]
  onClose: () => void
  /** Mail was moved to the Bin: lists need reloading. */
  onMoved: () => void
}

const WAY_TEXT: Record<UnsubscribeWay, string> = { 'one-click': 'One click', email: 'By email', web: 'Web page' }
const WAY_TITLE: Record<UnsubscribeWay, string> = {
  'one-click': 'WinMail asks the sender to remove you, straight away.',
  email: 'WinMail sends the unsubscribe email for you, from the account that gets this list.',
  web: 'This list can only be left on its web page.'
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function ago(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** A list can be picked when it can be left in the background and isn't already left (unless it is still sending). */
const pickable = (l: MailingList) => (l.way === 'one-click' || l.way === 'email') && (!l.unsubscribedAt || !!l.stillSending)

/**
 * Unsubscribe audit: the mailing lists of the last 90 days, least opened first, and leaving several at once. The scan
 * and the unsubscribing happen in the main process; this only sends list keys.
 */
export function AuditDialog(p: Props) {
  const [result, setResult] = useState<AuditResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scan, setScan] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [moveToBin, setMoveToBin] = useState(false)
  const [working, setWorking] = useState(false)
  const [outcome, setOutcome] = useState<Map<string, UnsubscribeResult>>(new Map())

  useEffect(() => {
    let live = true
    setResult(null)
    setError(null)
    setPicked(new Set())
    setOutcome(new Map())
    api.scanMailingLists().then(
      (r) => live && setResult(r),
      (e) => live && setError(errMsg(e))
    )
    return () => {
      live = false
    }
  }, [scan])

  const lists = result?.lists ?? []
  const active = lists.filter((l) => !l.unsubscribedAt || l.stillSending)
  const chosen = useMemo(() => lists.filter((l) => picked.has(l.key)), [lists, picked])
  const chosenMail = chosen.reduce((n, l) => n + l.total, 0)
  const neverOpened = active.filter((l) => l.opened === 0 && pickable(l))
  const accountName = (id: string) => p.accounts.find((a) => a.id === id)?.description ?? id

  const toggle = (key: string) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const run = async () => {
    if (!chosen.length) return
    setWorking(true)
    try {
      const results = await api.unsubscribeLists(
        chosen.map((l) => l.key),
        { moveToBin }
      )
      const now = new Date().toISOString()
      setOutcome((o) => new Map([...o, ...results.map((r) => [r.key, r] as const)]))
      const left = new Set(results.filter((r) => r.ok).map((r) => r.key))
      setResult((r) =>
        r && { ...r, lists: r.lists.map((l) => (left.has(l.key) ? { ...l, unsubscribedAt: now, stillSending: false } : l)) }
      )
      setPicked((s) => new Set([...s].filter((k) => !left.has(k))))
      const failed = results.length - left.size
      const moved = results.reduce((n, r) => n + (r.moved ?? 0), 0)
      if (moved) p.onMoved()
      toast({
        text:
          `Unsubscribed from ${left.size} ${left.size === 1 ? 'list' : 'lists'}` +
          (moved ? `, ${moved} ${moved === 1 ? 'message' : 'messages'} moved to the Bin` : '') +
          (failed ? `. ${failed} couldn't be left; see the list.` : ''),
        tone: failed && !left.size ? 'error' : 'info'
      })
    } catch (e) {
      toast({ text: errMsg(e), tone: 'error' })
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Unsubscribe audit"
      onClose={p.onClose}
      className="dialog-audit"
      footer={
        <>
          <div className="au-foot-text">
            {chosen.length > 0 ? (
              <>
                <span>{auditSummary(chosen)}</span>
                <label className="au-bin">
                  <input type="checkbox" checked={moveToBin} onChange={(e) => setMoveToBin(e.target.checked)} />
                  Also move their {chosenMail} {chosenMail === 1 ? 'message' : 'messages'} from the last {result?.days ?? 90} days to
                  the Bin
                </label>
              </>
            ) : (
              <span className="au-muted">Pick the lists to leave.</span>
            )}
          </div>
          <button className="btn" onClick={p.onClose}>
            Close
          </button>
          <button className="btn btn-primary" disabled={!chosen.length || working} onClick={() => void run()}>
            {working ? 'Unsubscribing…' : chosen.length ? `Unsubscribe from ${chosen.length}` : 'Unsubscribe'}
          </button>
        </>
      }
    >
      <div className="au-head">
        <p className="au-intro">
          {error
            ? 'Could not look through your mail.'
            : !result
              ? `Looking through the last 90 days of your mail…`
              : active.length
                ? `${auditSummary(active).replace(/\.$/, '')} in the last ${result.days} days.`
                : `No mailing lists in the last ${result.days} days.`}
        </p>
        <div className="au-actions">
          {result && neverOpened.length > 0 && (
            <button className="btn au-small" onClick={() => setPicked(new Set(neverOpened.map((l) => l.key)))}>
              Pick the {neverOpened.length} never opened
            </button>
          )}
          {picked.size > 0 && (
            <button className="btn au-small" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          )}
          <button
            className="tb-btn"
            title="Look again"
            aria-label="Look through your mail again"
            disabled={!result && !error}
            onClick={() => setScan((n) => n + 1)}
          >
            <RotateCw size={14} />
          </button>
        </div>
      </div>
      {result?.errors.map((e) => (
        <div key={e.accountId} className="au-error">
          Couldn't look through {accountName(e.accountId)}: {e.error}
        </div>
      ))}
      {error && (
        <div className="au-error">
          {error}{' '}
          <button className="btn au-small" onClick={() => setScan((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      <div className="au-list" role="list" aria-busy={!result && !error}>
        {!result && !error && <AuditSkeleton />}
        {lists.map((l) => {
          const done = outcome.get(l.key)
          const canPick = pickable(l)
          const left = !!l.unsubscribedAt && !l.stillSending
          const share = l.total ? l.opened / l.total : 0
          return (
            <div key={l.key} role="listitem" className={`au-row${left ? ' is-left' : ''}${picked.has(l.key) ? ' is-picked' : ''}`}>
              <input
                type="checkbox"
                className="au-check"
                aria-label={`Pick ${l.name}`}
                checked={picked.has(l.key)}
                disabled={!canPick || working}
                onChange={() => toggle(l.key)}
              />
              <div className="au-who">
                <div className="au-name">{l.name}</div>
                <div className="au-addr" title={l.accountIds.map(accountName).join(', ')}>
                  {l.address}
                  {p.accounts.filter((a) => a.enabled).length > 1 ? ` · ${l.accountIds.map(accountName).join(', ')}` : ''}
                </div>
              </div>
              <div className="au-stats">
                <div className="au-meter" aria-hidden>
                  <span style={{ width: `${Math.round(share * 100)}%` }} />
                </div>
                <div className="au-count">
                  opened {l.opened} of {l.total}
                  <span className="au-muted"> · last {ago(l.lastAt)}</span>
                </div>
              </div>
              <div className="au-state">
                {done?.ok ? (
                  <span className="au-done">
                    <Check size={13} /> Unsubscribed
                  </span>
                ) : done && done.way !== 'web' ? (
                  <span className="au-fail" title={done.error}>
                    <X size={13} /> Failed
                  </span>
                ) : l.stillSending ? (
                  <span className="au-chip is-warn" title={`Unsubscribed ${shortDate(l.unsubscribedAt!)}, but mail still comes`}>
                    Still sending
                  </span>
                ) : left ? (
                  <span className="au-muted">Unsubscribed {shortDate(l.unsubscribedAt!)}</span>
                ) : l.way === 'web' && l.unsubscribe?.url ? (
                  <button className="btn au-small" title={WAY_TITLE.web} onClick={() => window.open(l.unsubscribe!.url, '_blank')}>
                    <ExternalLink size={12} /> Open page
                  </button>
                ) : l.way ? (
                  <span className="au-chip" title={WAY_TITLE[l.way]}>
                    {WAY_TEXT[l.way]}
                  </span>
                ) : (
                  <span className="au-muted">No way out offered</span>
                )}
              </div>
              {done && !done.ok && done.error && done.way !== 'web' && <div className="au-row-error">{done.error}</div>}
              {done?.ok && done.error && <div className="au-row-error">{done.error}</div>}
            </div>
          )
        })}
      </div>
    </Dialog>
  )
}

/** Placeholder rows with the same layout as real ones. */
function AuditSkeleton() {
  return (
    <>
      {[58, 44, 66, 40, 52, 48].map((w, i) => (
        <div key={i} className="au-row is-skel" aria-hidden>
          <span className="au-check skel-box" />
          <div className="au-who">
            <span className="skel-line" style={{ width: `${w}%` }} />
            <span className="skel-line au-skel-addr" style={{ width: `${w + 14}%` }} />
          </div>
          <div className="au-stats">
            <span className="skel-line au-skel-meter" />
            <span className="skel-line" style={{ width: '70%' }} />
          </div>
          <div className="au-state">
            <span className="skel-line" style={{ width: 58 }} />
          </div>
        </div>
      ))}
    </>
  )
}

export const AuditIcon = MailMinus
