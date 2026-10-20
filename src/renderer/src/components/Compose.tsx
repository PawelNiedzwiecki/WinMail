import { Send, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Account, Contact } from '@shared/types'
import { api } from '../api'
import { useEscape } from '../useEscape'
import { RecipientInput } from './RecipientInput'
import { Select } from './Select'

export interface Draft {
  accountId: string
  to: string
  cc: string
  subject: string
  body: string
  inReplyTo?: string
  references?: string[]
}

interface Props {
  initial: Draft
  accounts: Account[]
  onClose: () => void
  onSend: (d: Draft) => Promise<void>
}

export function Compose({ initial, accounts, onClose, onSend }: Props) {
  const [draft, setDraft] = useState(initial)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [showCc, setShowCc] = useState(!!initial.cc)
  const [contacts, setContacts] = useState<Contact[]>([])

  // Suggestions come from the From account; reload when its contacts finish loading.
  useEffect(() => {
    let live = true
    const load = () =>
      api
        .listContacts(draft.accountId)
        .then((c) => live && setContacts(c))
        .catch((err) => console.error('Could not load contacts:', err))
    load()
    const off = api.onContactsChanged((id) => id === draft.accountId && load())
    return () => {
      live = false
      off()
    }
  }, [draft.accountId])

  useEffect(() => {
    if (initial.to) {
      bodyRef.current?.focus()
      bodyRef.current?.setSelectionRange(0, 0)
    } else toRef.current?.focus()
  }, [initial.to])

  useEscape(() => !sending && onClose())

  const canSend = draft.to.trim().length > 0 && !sending
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const send = async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      await onSend(draft)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSending(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !sending && onClose()}>
      <div
        className="compose"
        role="dialog"
        aria-label="New Message"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send()
        }}
      >
        <div className="compose-bar">
          <button className="tb-btn" title="Close (Esc)" onClick={onClose} disabled={sending}>
            <X size={16} />
          </button>
          <span className="compose-title">{draft.subject || 'New Message'}</span>
          <button
            className="tb-btn send-btn"
            title="Send (Ctrl+Enter)"
            disabled={!canSend}
            onClick={send}
          >
            {sending ? <span className="spinner" /> : <Send size={16} />}
          </button>
        </div>
        {error && <div className="compose-error">{error}</div>}
        <Field label="To:">
          <RecipientInput
            inputRef={toRef}
            value={draft.to}
            contacts={contacts}
            onChange={(to) => set({ to })}
          />
          {!showCc && (
            <button className="link-btn small" onClick={() => setShowCc(true)}>
              Cc
            </button>
          )}
        </Field>
        {showCc && (
          <Field label="Cc:">
            <RecipientInput value={draft.cc} contacts={contacts} onChange={(cc) => set({ cc })} />
          </Field>
        )}
        <Field label="Subject:">
          <input value={draft.subject} onChange={(e) => set({ subject: e.target.value })} />
        </Field>
        {accounts.length > 1 && (
          <Field label="From:">
            <Select
              className="select-plain"
              aria-label="From"
              value={draft.accountId}
              onChange={(accountId) => set({ accountId })}
              options={accounts.map((a) => ({ value: a.id, label: `${a.name} – ${a.email}` }))}
            />
          </Field>
        )}
        <textarea
          ref={bodyRef}
          className="compose-body"
          value={draft.body}
          onChange={(e) => set({ body: e.target.value })}
        />
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="compose-field">
      <span>{label}</span>
      {children}
    </label>
  )
}
