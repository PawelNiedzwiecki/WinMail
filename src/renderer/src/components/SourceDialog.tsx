import { api } from '../api'
import { toast } from '../toasts'
import { Dialog } from './Dialog'

interface Props {
  subject: string
  source: string
  onClose: () => void
}

/** "Show original": the raw message with its headers, to copy or save. */
export function SourceDialog(p: Props) {
  const copy = async () => {
    await navigator.clipboard.writeText(p.source)
    toast('Copied to the clipboard')
  }
  const save = async () => {
    try {
      const name = `${(p.subject || 'message').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'message'}.eml`
      const path = await api.saveText(name, p.source)
      if (path) toast(`Saved to ${path}`)
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : String(e), tone: 'error' })
    }
  }
  return (
    <Dialog
      title="Original message"
      onClose={p.onClose}
      className="dialog-source"
      footer={
        <>
          <button className="btn" onClick={copy}>
            Copy
          </button>
          <button className="btn" onClick={save}>
            Save…
          </button>
          <button className="btn btn-primary" onClick={p.onClose}>
            Done
          </button>
        </>
      }
    >
      <pre className="source-text">{p.source}</pre>
    </Dialog>
  )
}
