import { FileText, Image as ImageIcon, X } from 'lucide-react'
import type { Account } from '@shared/types'
import { formatSize } from '../../format'
import { removeAttachment } from '../../compose/actions'
import { isBlocked } from '../../compose/checks'
import type { ComposeAttachment } from '../../compose/sessions'

interface Props {
  sessionId: string
  attachments: ComposeAttachment[]
  account: Account | undefined
}

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i

/** Files to be sent, under the text. A spinner means the file is still being fetched. */
export function AttachmentChips({ sessionId, attachments, account }: Props) {
  if (!attachments.length) return null
  return (
    <div className="attach-chips">
      {attachments.map((a) => {
        const blocked = !a.pending && isBlocked(a.filename, account)
        const Icon = IMAGE.test(a.filename) ? ImageIcon : FileText
        return (
          <span
            key={a.id}
            className={`attach-chip${blocked ? ' is-invalid' : ''}`}
            title={blocked ? `${account?.description} doesn't allow sending this type of file` : a.filename}
          >
            {a.pending ? <span className="spinner" /> : <Icon size={14} />}
            <span className="attach-name">{a.filename}</span>
            {!a.pending && <span className="attach-size">{formatSize(a.size)}</span>}
            <button
              className="chip-x"
              aria-label={`Remove ${a.filename}`}
              onClick={() => removeAttachment(sessionId, a.id)}
            >
              <X size={12} />
            </button>
          </span>
        )
      })}
    </div>
  )
}
