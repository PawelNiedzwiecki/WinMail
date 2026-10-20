import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, Contact } from '@shared/types'
import { api } from '../../api'
import { chipLabel, type Chip } from '../../compose/addresses'
import { updateSession, type ComposeSession, type RecipientField as Field } from '../../compose/sessions'
import * as autosave from '../../compose/autosave'
import { changeFrom } from '../../compose/actions'
import { Select } from '../Select'
import { RecipientField } from './RecipientField'

interface Props {
  session: ComposeSession
  accounts: Account[]
  /** Called with a function that puts the cursor in a field, or opens the From list. */
  controls: React.MutableRefObject<{ focus(f: Field): void; openFrom(): void } | null>
}

const LABEL = { to: 'To', cc: 'Cc', bcc: 'Bcc' } as const

/** From, To, Cc and Bcc rows; folds to one line when you move on to the subject or body. */
export function RecipientsBlock({ session: s, accounts, controls }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [folded, setFolded] = useState(!!s.reply && s.to.length > 0)
  const rows = useRef<HTMLDivElement>(null)
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({})
  const fromButton = useRef<HTMLDivElement>(null)

  // Suggestions come from the From account; reload when its contacts finish loading.
  useEffect(() => {
    let live = true
    const load = () =>
      api
        .listContacts(s.accountId)
        .then((c) => live && setContacts(c))
        .catch((err) => console.error('Could not load contacts:', err))
    load()
    const off = api.onContactsChanged((id) => id === s.accountId && load())
    return () => {
      live = false
      off()
    }
  }, [s.accountId])

  const taken = useMemo(
    () => new Set([...s.to, ...s.cc, ...s.bcc].map((c) => c.email.toLowerCase())),
    [s.to, s.cc, s.bcc]
  )

  const set = (patch: Partial<ComposeSession>) => {
    updateSession(s.id, patch)
    autosave.touch(s.id)
  }
  const setField = (f: Field, chips: Chip[], typing: string) =>
    set({ [f]: chips, typing: { ...s.typing, [f]: typing } } as Partial<ComposeSession>)

  const focusField = (f: Field) => {
    if (f === 'cc' && !s.showCc) updateSession(s.id, { showCc: true })
    if (f === 'bcc' && !s.showBcc) updateSession(s.id, { showBcc: true })
    setFolded(false)
    requestAnimationFrame(() => inputs.current[f]?.focus())
  }
  controls.current = {
    focus: focusField,
    openFrom: () => {
      setFolded(false)
      requestAnimationFrame(() => fromButton.current?.querySelector('button')?.click())
    }
  }

  const moveChip = (from: Field, index: number, to: Field) => {
    const chip = s[from][index]
    if (!chip) return
    const exists = s[to].some((c) => c.email.toLowerCase() === chip.email.toLowerCase())
    set({
      [from]: s[from].filter((_, i) => i !== index),
      [to]: exists ? s[to] : [...s[to], chip],
      showCc: s.showCc || to === 'cc',
      showBcc: s.showBcc || to === 'bcc'
    } as Partial<ComposeSession>)
  }

  const foldNow = () => {
    const bad = [...s.to, ...s.cc, ...s.bcc].some((c) => !c.valid)
    const typing = Object.values(s.typing).some((t) => t.trim())
    if (s.to.length && !bad && !typing) setFolded(true)
  }

  // Focus leaving the rows (to the subject or body) folds them, as Gmail does.
  const onBlur = (e: React.FocusEvent) => {
    if (e.relatedTarget && !rows.current?.contains(e.relatedTarget as Node) && (e.relatedTarget as HTMLElement).closest('[data-compose]')) foldNow()
  }

  if (folded) {
    const parts = [
      s.to.length && `To: ${s.to.map(chipLabel).join(', ')}`,
      s.cc.length && `Cc: ${s.cc.map(chipLabel).join(', ')}`,
      s.bcc.length && `Bcc: ${s.bcc.map(chipLabel).join(', ')}`
    ].filter(Boolean)
    return (
      <button className="recipients-line" onClick={() => focusField('to')} onFocus={() => focusField('to')}>
        <span className="recipients-text">{parts.join(' · ') || 'Recipients'}</span>
      </button>
    )
  }

  const row = (f: Field) => (
    <div className="compose-row" key={f}>
      <label className="compose-label" htmlFor={`${s.id}-${f}`}>
        {LABEL[f]}
      </label>
      <RecipientField
        field={f}
        chips={s[f]}
        typing={s.typing[f]}
        contacts={contacts}
        taken={taken}
        inputRef={(el) => {
          inputs.current[f] = el
          if (el) el.id = `${s.id}-${f}`
        }}
        onChange={(chips, typing) => setField(f, chips, typing)}
        onDropChip={(from, index) => moveChip(from, index, f)}
      />
      {f === 'to' && (
        <span className="cc-links">
          {!s.showCc && (
            <button className="link-btn small" tabIndex={-1} onClick={() => focusField('cc')} title="Add Cc (Ctrl+Shift+C)">
              Cc
            </button>
          )}
          {!s.showBcc && (
            <button className="link-btn small" tabIndex={-1} onClick={() => focusField('bcc')} title="Add Bcc (Ctrl+Shift+B)">
              Bcc
            </button>
          )}
        </span>
      )}
    </div>
  )

  return (
    <div className="recipients" ref={rows} onBlur={onBlur}>
      {accounts.length > 1 && (
        <div className="compose-row">
          <span className="compose-label">From</span>
          <div className="compose-from" ref={fromButton}>
            <Select
              className="select-plain"
              aria-label="From"
              value={s.accountId}
              options={accounts.map((a) => ({ value: a.id, label: `${a.name} <${a.email}>` }))}
              onChange={(id) => changeFrom(s.id, id)}
            />
          </div>
        </div>
      )}
      {row('to')}
      {s.showCc && row('cc')}
      {s.showBcc && row('bcc')}
    </div>
  )
}
