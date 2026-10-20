import { Clock } from 'lucide-react'
import type { Account, ScheduledInfo } from '@shared/types'
import { api } from '../api'
import { openInput } from '../compose/actions'
import { formatWhen } from '../compose/schedule'
import { toast } from '../toasts'
import { Dialog } from './Dialog'

interface Props {
  items: ScheduledInfo[]
  accounts: Account[]
  onClose: () => void
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Messages waiting for Schedule send; each can be edited or cancelled until it goes out. */
export function ScheduledDialog(p: Props) {
  const label = (id: string) => p.accounts.find((a) => a.id === id)?.description ?? ''

  const edit = async (it: ScheduledInfo) => {
    try {
      openInput(await api.cancelScheduled(it.id))
      p.onClose()
    } catch (e) {
      toast({ text: errText(e), tone: 'error' })
    }
  }

  const cancel = async (it: ScheduledInfo) => {
    try {
      const input = await api.cancelScheduled(it.id)
      toast({
        text: 'Scheduled send cancelled',
        actions: [
          {
            label: 'Undo',
            run: () => void api.scheduleSend(input, it.sendAt).catch((e) => toast({ text: errText(e), tone: 'error' }))
          },
          { label: 'Edit', run: () => openInput(input) }
        ]
      })
    } catch (e) {
      toast({ text: errText(e), tone: 'error' })
    }
  }

  return (
    <Dialog
      title="Scheduled"
      onClose={p.onClose}
      className="dialog-scheduled"
      footer={
        <>
          <span className="dialog-note">WinMail must be running to send scheduled mail.</span>
          <button className="btn btn-primary" onClick={p.onClose}>
            Done
          </button>
        </>
      }
    >
      {p.items.length === 0 && <div className="picker-empty">Nothing scheduled</div>}
      <ul className="scheduled-list">
        {p.items.map((it) => (
          <li key={it.id} className="scheduled-item">
            <Clock size={16} className="scheduled-icon" />
            <div className="scheduled-main">
              <div className="scheduled-subject">{it.subject || '(no subject)'}</div>
              <div className="scheduled-sub">
                To {it.to || '(no recipients)'} · {label(it.accountId)}
              </div>
              <div className="scheduled-when">{formatWhen(new Date(it.sendAt))}</div>
              {it.error && <div className="scheduled-error">Last try failed: {it.error}</div>}
            </div>
            <div className="scheduled-actions">
              <button className="btn" onClick={() => edit(it)}>
                Edit
              </button>
              <button className="btn" onClick={() => cancel(it)}>
                Cancel Send
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
