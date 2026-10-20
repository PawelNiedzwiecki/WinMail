import { MailMinus } from 'lucide-react'
import type { Unsubscribe } from '@shared/types'
import { Dialog } from './Dialog'

interface Props {
  sender: string
  unsubscribe: Unsubscribe
  onConfirm: () => void
  onClose: () => void
}

/** Asks before leaving a mailing list, saying how it will happen (same order as App's handler). */
export function UnsubscribeDialog(p: Props) {
  const u = p.unsubscribe
  const how =
    u.oneClick && u.url
      ? `${p.sender} will be asked to remove you from their mailing list.`
      : u.mailto
        ? `A prepared unsubscribe email to ${p.sender} will open for you to send.`
        : `${p.sender}'s unsubscribe page will open in your browser.`
  const confirm = () => {
    p.onClose()
    p.onConfirm()
  }
  return (
    <Dialog
      title={`Unsubscribe from ${p.sender}?`}
      onClose={p.onClose}
      className="dialog-confirm dialog-unsubscribe"
      icon={<MailMinus size={22} strokeWidth={1.8} aria-hidden="true" />}
      footer={
        <>
          <button className="btn" onClick={p.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" autoFocus onClick={confirm}>
            Unsubscribe
          </button>
        </>
      }
    >
      <p>{how}</p>
    </Dialog>
  )
}
