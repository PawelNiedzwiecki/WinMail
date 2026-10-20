import { Dialog } from './Dialog'

interface Props {
  count: number
  onConfirm: () => void
  onClose: () => void
}

/** Asks before moving messages to the Bin, when Settings > Confirm before deleting is on. */
export function ConfirmDeleteDialog(p: Props) {
  const confirm = () => {
    p.onClose()
    p.onConfirm()
  }
  return (
    <Dialog
      title={p.count === 1 ? 'Delete this message?' : `Delete ${p.count} messages?`}
      onClose={p.onClose}
      className="dialog-confirm"
      icon={
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
          <path d="M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14" />
          <path d="M10 11v5M14 11v5" />
        </svg>
      }
      footer={
        <>
          <button className="btn" onClick={p.onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" autoFocus onClick={confirm}>
            Delete
          </button>
        </>
      }
    >
      <p>{p.count === 1 ? 'It will be moved to the Bin.' : 'They will be moved to the Bin.'}</p>
    </Dialog>
  )
}
