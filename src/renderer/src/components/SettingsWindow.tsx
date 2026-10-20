import { AtSign, Settings as Gear, X, Plus, Minus } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useEscape } from '../useEscape'
import type { Account, Appearance, ContactsStatus, MessageAppearance, Settings } from '@shared/types'
import { getProvider } from '@shared/providers'
import { api } from '../api'
import { initials } from '../format'
import { Row, ServerFields } from './forms'
import { Select } from './Select'

export type SettingsTab = 'general' | 'accounts'

interface Props {
  tab: SettingsTab
  accounts: Account[]
  settings: Settings
  onTab: (t: SettingsTab) => void
  onClose: () => void
  onAddAccount: () => void
  onAccountsChanged: () => void
  onSettings: (s: Settings) => void
}

export function SettingsWindow(p: Props) {
  useEscape(p.onClose)
  return (
    <div className="modal-backdrop" onMouseDown={p.onClose}>
      <div
        className="settings"
        role="dialog"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-bar">
          <button className="tb-btn" title="Close (Esc)" onClick={p.onClose}>
            <X size={16} />
          </button>
          <div className="settings-title">{p.tab === 'general' ? 'General' : 'Accounts'}</div>
          <div className="settings-tabs">
            <TabButton active={p.tab === 'general'} onClick={() => p.onTab('general')} label="General">
              <Gear size={20} strokeWidth={1.6} />
            </TabButton>
            <TabButton active={p.tab === 'accounts'} onClick={() => p.onTab('accounts')} label="Accounts">
              <AtSign size={20} strokeWidth={1.6} />
            </TabButton>
          </div>
        </div>
        {p.tab === 'general' ? (
          <GeneralPane settings={p.settings} onChange={p.onSettings} />
        ) : (
          <AccountsPane
            accounts={p.accounts}
            onAdd={p.onAddAccount}
            onChanged={p.onAccountsChanged}
          />
        )}
      </div>
    </div>
  )
}

function TabButton(props: { active: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button className={`settings-tab ${props.active ? 'is-active' : ''}`} onClick={props.onClick}>
      {props.children}
      <span>{props.label}</span>
    </button>
  )
}

function GeneralPane({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  return (
    <div className="settings-body general">
      <div className="form">
        <Row label="Appearance:">
          <Select<Appearance>
            value={settings.appearance}
            onChange={(appearance) => onChange({ ...settings, appearance })}
            options={[
              { value: 'system', label: 'Use system setting' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' }
            ]}
          />
        </Row>
        <Row
          label="Message content:"
          hint="Dark inverts the message's colours; photos keep their original colours."
        >
          <Select<MessageAppearance>
            value={settings.messageAppearance}
            onChange={(messageAppearance) => onChange({ ...settings, messageAppearance })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'app', label: 'Same as app' }
            ]}
          />
        </Row>
        <Row label="Check for new messages:">
          <Select
            value={String(settings.checkIntervalMin)}
            onChange={(v) => onChange({ ...settings, checkIntervalMin: Number(v) })}
            options={[
              { value: '1', label: 'Every minute' },
              { value: '5', label: 'Every 5 minutes' },
              { value: '15', label: 'Every 15 minutes' },
              { value: '30', label: 'Every 30 minutes' },
              { value: '60', label: 'Every hour' },
              { value: '0', label: 'Manually' }
            ]}
          />
        </Row>
        <Row label="Privacy:" hint="Remote images can tell senders when and where you opened a message.">
          <span className="check">
            <input
              type="checkbox"
              checked={settings.loadRemoteContent}
              onChange={(e) => onChange({ ...settings, loadRemoteContent: e.target.checked })}
            />
            Load remote content in messages
          </span>
        </Row>
      </div>
    </div>
  )
}

function AccountsPane({
  accounts,
  onAdd,
  onChanged
}: {
  accounts: Account[]
  onAdd: () => void
  onChanged: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(accounts[0]?.id ?? null)
  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0] ?? null
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (!accounts.some((a) => a.id === selectedId)) setSelectedId(accounts[0]?.id ?? null)
  }, [accounts, selectedId])

  const remove = async () => {
    if (!selected) return
    await api.removeAccount(selected.id)
    setConfirmRemove(false)
    onChanged()
  }

  return (
    <div className="settings-body accounts">
      <div className="acct-list-wrap">
        <div className="acct-list">
          {accounts.map((a) => (
            <button
              key={a.id}
              className={`acct-row ${a.id === selected?.id ? 'is-selected' : ''}`}
              onClick={() => {
                setSelectedId(a.id)
                setConfirmRemove(false)
              }}
            >
              <span className={`acct-icon provider-bg-${a.provider}`}>{initials(a.description)}</span>
              <span className="acct-text">
                <span className="acct-name">{a.description}</span>
                <span className="acct-sub">
                  {!a.enabled ? 'Inactive' : a.auth === 'oauth' ? 'Google' : 'IMAP'}
                </span>
              </span>
            </button>
          ))}
          {accounts.length === 0 && <div className="acct-empty">No accounts</div>}
        </div>
        <div className="acct-buttons">
          <button className="sq-btn" title="Add Account" onClick={onAdd}>
            <Plus size={14} />
          </button>
          <button
            className="sq-btn"
            title="Remove Account"
            disabled={!selected}
            onClick={() => setConfirmRemove(true)}
          >
            <Minus size={14} />
          </button>
        </div>
      </div>

      <div className="acct-detail">
        {selected ? (
          confirmRemove ? (
            <div className="confirm">
              <p>
                Are you sure you want to remove “{selected.description}”? Messages are not deleted
                from the server.
              </p>
              <div className="sheet-actions">
                <button className="btn" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={remove}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <AccountEditor key={selected.id} account={selected} onSaved={onChanged} />
          )
        ) : (
          <div className="acct-placeholder">
            <p>Add an account to start using WinMail.</p>
            <button className="btn btn-primary" onClick={onAdd}>
              Add Account…
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ContactsRow({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<ContactsStatus | null>(null)

  useEffect(() => {
    let live = true
    const load = () => api.contactsStatus(accountId).then((s) => live && setStatus(s))
    load()
    const off = api.onContactsChanged((id) => id === accountId && load())
    return () => {
      live = false
      off()
    }
  }, [accountId])

  if (!status) return null
  const parts = [
    status.source && `${status.saved} from ${status.source}`,
    `${status.fromMail} from your mail`
  ].filter(Boolean)
  return (
    <Row label="Contacts:" hint={status.error ?? undefined}>
      <span className="form-static">{status.loading ? 'Loading…' : parts.join(', ')}</span>
    </Row>
  )
}

function AccountEditor({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const [tab, setTab] = useState<'info' | 'server'>('info')
  const [draft, setDraft] = useState(account)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const oauth = account.auth === 'oauth'

  const googleSignIn = async () => {
    setSigningIn(true)
    setError(null)
    try {
      const acc = await api.reauthGoogleAccount(account.id)
      setDraft(acc)
      setPassword('')
      setSaved(true)
      onSaved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!/cancelled/.test(msg)) setError(msg)
    } finally {
      setSigningIn(false)
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(account) || password.length > 0
  const serverChanged =
    password.length > 0 ||
    draft.username !== account.username ||
    JSON.stringify([draft.imap, draft.smtp]) !== JSON.stringify([account.imap, account.smtp])

  const set = (patch: Partial<Account>) => {
    setSaved(false)
    setDraft((d) => ({ ...d, ...patch }))
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      if (serverChanged && password) {
        const res = await api.testAccount({ ...draft, password })
        if (!res.ok) {
          setError(`${res.stage === 'smtp' ? 'Outgoing' : 'Incoming'} server: ${res.error}`)
          return
        }
      }
      await api.updateAccount({ account: draft, password: password || undefined })
      setPassword('')
      setSaved(true)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="segmented">
        <button className={tab === 'info' ? 'is-active' : ''} onClick={() => setTab('info')}>
          Account Information
        </button>
        <button className={tab === 'server' ? 'is-active' : ''} onClick={() => setTab('server')}>
          Server Settings
        </button>
      </div>

      <div className="form">
        {tab === 'info' ? (
          <>
            <Row label="">
              <span className="check">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => set({ enabled: e.target.checked })}
                />
                Enable this account
              </span>
            </Row>
            <Row label="Description:">
              <input value={draft.description} onChange={(e) => set({ description: e.target.value })} />
            </Row>
            <Row label="Email Address:">
              <input value={draft.email} onChange={(e) => set({ email: e.target.value })} />
            </Row>
            <Row label="Full Name:">
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Row>
            <Row label="Provider:">
              <span className="form-static">{getProvider(draft.provider).name}</span>
            </Row>
            <ContactsRow accountId={account.id} />

          </>
        ) : (
          <>
            <div className="form-group-title">Incoming Mail Server (IMAP)</div>
            <Row label="User Name:">
              <input
                value={draft.username}
                readOnly={oauth}
                onChange={(e) => set({ username: e.target.value })}
              />
            </Row>
            {!oauth && (
              <Row label="Password:" hint="Leave empty to keep the saved password.">
                <input
                  type="password"
                  value={password}
                  placeholder="••••••••"
                  onChange={(e) => {
                    setSaved(false)
                    setPassword(e.target.value)
                  }}
                />
              </Row>
            )}
            {getProvider(draft.provider).oauth && (
              <Row
                label="Authentication:"
                hint={oauth ? 'Signed in with Google.' : 'Sign in with Google instead of an app password.'}
              >
                <span className="form-inline">
                  <button
                    className="btn"
                    disabled={signingIn || busy}
                    onClick={(e) => {
                      e.preventDefault() // the Row is a <label>
                      googleSignIn()
                    }}
                  >
                    {oauth ? 'Sign In Again…' : 'Sign in with Google…'}
                  </button>
                  {signingIn && (
                    <>
                      <span className="verifying"><span className="spinner" /> Waiting for Google…</span>
                      <button
                        className="link-btn small"
                        onClick={(e) => {
                          e.preventDefault()
                          api.cancelGoogleSignIn()
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </span>
              </Row>
            )}
            <ServerFields kind="imap" value={draft.imap} onChange={(imap) => set({ imap })} />
            <div className="form-group-title">Outgoing Mail Server (SMTP)</div>
            <ServerFields kind="smtp" value={draft.smtp} onChange={(smtp) => set({ smtp })} />
          </>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="sheet-actions">
        {saved && !dirty && <span className="saved">Saved</span>}
        <span className="tb-spacer" />
        <button
          className="btn"
          disabled={!dirty || busy}
          onClick={() => {
            setDraft(account)
            setPassword('')
            setError(null)
          }}
        >
          Revert
        </button>
        <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Verifying…' : 'Save'}
        </button>
      </div>
    </>
  )
}
