import { Hourglass, MailQuestionMark } from 'lucide-react'
import { useState } from 'react'
import type { Account, WaitingInfo } from '@shared/types'
import { daysLabel, WAIT_DAY_CHOICES } from '@shared/waiting'
import { api } from '../api'
import { followUp } from '../compose/actions'
import { parseList } from '../compose/addresses'
import { formatWhen } from '../compose/schedule'
import { toast } from '../toasts'
import { ContextMenu } from './ContextMenu'
import { Dialog } from './Dialog'

interface Props {
  items: WaitingInfo[]
  accounts: Account[]
  /** The item a nudge notification pointed at, shown highlighted. */
  focusId?: string
  onClose: () => void
}

const DAY_MS = 24 * 60 * 60_000
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const sentDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** "Priya Shah", "Priya Shah and Sam Okafor", "Priya Shah and 2 others": names where the address has one. */
function people(to: string): string {
  const names = parseList(to).map((c) => c.name || c.email)
  if (names.length <= 2) return names.join(' and ') || '(no recipients)'
  return `${names[0]} and ${names.length - 1} others`
}

/** "no reply for 4 days", "no reply since yesterday". */
function silence(sentAt: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(sentAt)) / DAY_MS)
  if (days < 1) return 'no reply yet'
  if (days === 1) return 'no reply since yesterday'
  return `no reply for ${days} days`
}

/** Opens a follow-up to a waited-for message: reply all to the sent copy, waiting again. */
export async function startFollowUp(id: string): Promise<boolean> {
  try {
    const sent = await api.waitingMessage(id)
    if (!sent) {
      toast({ text: "The sent message isn't in Sent any more, so there is nothing to follow up.", tone: 'error' })
      return false
    }
    return !!(await followUp(sent))
  } catch (e) {
    toast({ text: errText(e), tone: 'error' })
    return false
  }
}

/**
 * Waiting for: sent messages expecting a reply. Those nobody answered in time come first, with Follow Up, Wait
 * Longer and Done; the rest show when they come back. Clicking a subject opens the sent message.
 */
export function WaitingDialog(p: Props) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const label = (id: string) => p.accounts.find((a) => a.id === id)?.description ?? ''
  const several = new Set(p.items.map((w) => w.accountId)).size > 1 || p.accounts.length > 1
  const nudged = p.items.filter((w) => w.nudgedAt)
  const waiting = p.items.filter((w) => !w.nudgedAt)

  const open = async (w: WaitingInfo) => {
    try {
      const sent = await api.waitingMessage(w.id)
      if (sent) await api.openMessageWindow(sent)
      else toast({ text: "The sent message isn't in Sent any more.", tone: 'error' })
    } catch (e) {
      toast({ text: errText(e), tone: 'error' })
    }
  }

  const follow = async (w: WaitingInfo) => {
    if (await startFollowUp(w.id)) p.onClose()
  }

  const stop = async (w: WaitingInfo) => {
    try {
      const item = await api.stopWaiting(w.id)
      toast({
        text: 'Stopped waiting for a reply',
        actions: [{ label: 'Undo', run: () => void api.restoreWaiting(item).catch((e) => toast({ text: errText(e), tone: 'error' })) }]
      })
    } catch (e) {
      toast({ text: errText(e), tone: 'error' })
    }
  }

  const longer = async (id: string, days: number) => {
    try {
      const next = await api.waitLonger(id, days)
      toast(`Nudge on ${formatWhen(new Date(next.dueAt))} if nobody answers`)
    } catch (e) {
      toast({ text: errText(e), tone: 'error' })
    }
  }

  const row = (w: WaitingInfo) => (
    <li key={w.id} className={`scheduled-item waiting-item${w.id === p.focusId ? ' is-focus' : ''}`}>
      {w.nudgedAt ? <MailQuestionMark size={16} className="scheduled-icon waiting-icon-due" /> : <Hourglass size={16} className="scheduled-icon" />}
      <div className="scheduled-main">
        <button className="waiting-subject scheduled-subject" title="Open the sent message" onClick={() => void open(w)}>
          {w.subject || '(No Subject)'}
        </button>
        <div className="scheduled-sub" title={w.to}>
          To {people(w.to)}
          {several ? ` · ${label(w.accountId)}` : ''}
        </div>
        <div className="scheduled-when">
          Sent {sentDay(w.sentAt)} ·{' '}
          {w.nudgedAt ? <span className="waiting-due">{silence(w.sentAt)}</span> : `nudge ${formatWhen(new Date(w.dueAt))}`}
        </div>
      </div>
      <div className="scheduled-actions">
        {w.nudgedAt && (
          <button className="btn btn-primary" onClick={() => void follow(w)}>
            Follow Up
          </button>
        )}
        <button
          className="btn"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ id: w.id, x: r.left, y: r.bottom + 4 })
          }}
        >
          {w.nudgedAt ? 'Wait Longer' : 'Change'}
        </button>
        <button className="btn" onClick={() => void stop(w)}>
          {w.nudgedAt ? 'Done' : 'Stop Waiting'}
        </button>
      </div>
    </li>
  )

  return (
    <Dialog
      title="Waiting for"
      onClose={p.onClose}
      className="dialog-scheduled dialog-waiting"
      footer={
        <>
          <span className="dialog-note">Replies are noticed as WinMail checks your mail. Nothing changes on the server.</span>
          <button className="btn btn-primary" onClick={p.onClose}>
            Close
          </button>
        </>
      }
    >
      {p.items.length === 0 && (
        <div className="picker-empty">
          Nothing is waiting for a reply. When you send a question, the hourglass in Compose turns on by itself.
        </div>
      )}
      {nudged.length > 0 && (
        <>
          <h3 className="waiting-head">No reply yet</h3>
          <ul className="scheduled-list">{nudged.map(row)}</ul>
        </>
      )}
      {waiting.length > 0 && (
        <>
          <h3 className="waiting-head">Waiting</h3>
          <ul className="scheduled-list">{waiting.map(row)}</ul>
        </>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Nudge me again in', disabled: true, onSelect: () => {} },
            ...WAIT_DAY_CHOICES.map((d) => ({ label: daysLabel(d), onSelect: () => void longer(menu.id, d) }))
          ]}
        />
      )}
    </Dialog>
  )
}
