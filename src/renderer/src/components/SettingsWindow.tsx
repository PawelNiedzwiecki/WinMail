import { AtSign, Keyboard, Minus, Monitor, Moon, PenLine, Plus, SlidersHorizontal, Sparkles, Sun, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useEscape } from '../useEscape'
import type { Account, Appearance, ComposeFormat, ContactsStatus, MessageAppearance, Settings } from '@shared/types'
import { getProvider } from '@shared/providers'
import { api } from '../api'
import { initials } from '../format'
import { Row, ServerFields } from './forms'
import { Select } from './Select'
import { Group, Item, KeyRow, Segmented, Switch } from './settings/controls'

export type SettingsTab = 'general' | 'composing' | 'shortcuts' | 'ai' | 'accounts'

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

const PAGES: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'composing', label: 'Composing', icon: PenLine },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'ai', label: 'Claude', icon: Sparkles },
  { id: 'accounts', label: 'Accounts', icon: AtSign }
]

export function SettingsWindow(p: Props) {
  useEscape(p.onClose)
  const page = PAGES.find((x) => x.id === p.tab) ?? PAGES[0]!
  return (
    <div className="modal-backdrop" onMouseDown={p.onClose}>
      <div className="st-window" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="st-nav" aria-label="Settings sections">
          <div className="st-nav-title">Settings</div>
          {PAGES.map((x) => (
            <button
              key={x.id}
              className={`st-nav-item${x.id === page.id ? ' is-active' : ''}`}
              aria-current={x.id === page.id ? 'page' : undefined}
              onClick={() => p.onTab(x.id)}
            >
              <x.icon size={16} strokeWidth={1.8} />
              {x.label}
            </button>
          ))}
        </nav>
        <section className="st-main">
          <header className="st-head">
            <h2>{page.label}</h2>
            <button className="tb-btn" title="Close (Esc)" aria-label="Close settings" onClick={p.onClose}>
              <X size={16} />
            </button>
          </header>
          <div className="st-scroll">
            {page.id === 'general' && <GeneralPage settings={p.settings} onChange={p.onSettings} />}
            {page.id === 'composing' && (
              <ComposingPage settings={p.settings} onChange={p.onSettings} onAccounts={() => p.onTab('accounts')} />
            )}
            {page.id === 'shortcuts' && <ShortcutsPage settings={p.settings} onChange={p.onSettings} />}
            {page.id === 'ai' && <AiPage />}
            {page.id === 'accounts' && (
              <AccountsPane accounts={p.accounts} onAdd={p.onAddAccount} onChanged={p.onAccountsChanged} />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

interface PageProps {
  settings: Settings
  onChange: (s: Settings) => void
}

function GeneralPage({ settings, onChange }: PageProps) {
  return (
    <>
      <Group title="Appearance">
        <Item title="Theme" description="Choose how WinMail looks.">
          <Segmented<Appearance>
            label="Theme"
            value={settings.appearance}
            onChange={(appearance) => onChange({ ...settings, appearance })}
            options={[
              { value: 'system', label: 'System', icon: <Monitor size={14} /> },
              { value: 'light', label: 'Light', icon: <Sun size={14} /> },
              { value: 'dark', label: 'Dark', icon: <Moon size={14} /> }
            ]}
          />
        </Item>
        <Item
          title="Message content"
          description="Dark inverts the message's colours; photos keep their original colours."
        >
          <Segmented<MessageAppearance>
            label="Message content"
            value={settings.messageAppearance}
            onChange={(messageAppearance) => onChange({ ...settings, messageAppearance })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'app', label: 'Same as app' }
            ]}
          />
        </Item>
      </Group>

      <Group title="New mail">
        <Item title="Check for new messages" description="How often WinMail looks for new mail.">
          <Select
            aria-label="Check for new messages"
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
        </Item>
        <Item title="Notifications" description="Show a notification about new mail while WinMail is in the background.">
          <Switch
            label="Notify me about new mail"
            checked={settings.notifyNewMail}
            onChange={(notifyNewMail) => onChange({ ...settings, notifyNewMail })}
          />
        </Item>
      </Group>

      <Group title="Message list">
        <Item title="Group by conversation" description="Show replies together under one entry.">
          <Switch
            label="Group messages by conversation"
            checked={settings.conversations}
            onChange={(conversations) => onChange({ ...settings, conversations })}
          />
        </Item>
      </Group>

      <Group title="Privacy">
        <Item
          title="Load remote images"
          description="Remote images can tell senders when and where you opened a message. You can still load them for one message."
        >
          <Switch
            label="Load remote content in messages"
            checked={settings.loadRemoteContent}
            onChange={(loadRemoteContent) => onChange({ ...settings, loadRemoteContent })}
          />
        </Item>
      </Group>
    </>
  )
}

function ComposingPage({ settings, onChange, onAccounts }: PageProps & { onAccounts: () => void }) {
  return (
    <>
      <Group title="Sending">
        <Item title="Undo send" description="A sent message waits this long, so you can still take it back.">
          <Select
            aria-label="Undo send"
            value={String(settings.undoSendSec)}
            onChange={(v) => onChange({ ...settings, undoSendSec: Number(v) })}
            options={[
              { value: '0', label: 'Off' },
              { value: '5', label: '5 seconds' },
              { value: '10', label: '10 seconds' },
              { value: '20', label: '20 seconds' },
              { value: '30', label: '30 seconds' }
            ]}
          />
        </Item>
      </Group>

      <Group title="Writing">
        <Item
          title="Default format"
          description="New messages start in this mode. You can switch a single message to plain text from its ⋮ menu."
        >
          <Segmented<ComposeFormat>
            label="Default format"
            value={settings.composeFormat}
            onChange={(composeFormat) => onChange({ ...settings, composeFormat })}
            options={[
              { value: 'rich', label: 'Rich text' },
              { value: 'plain', label: 'Plain text' }
            ]}
          />
        </Item>
        <Item title="Signatures" description="Each account has its own signature.">
          <button className="btn" onClick={onAccounts}>
            Edit in Accounts
          </button>
        </Item>
      </Group>
    </>
  )
}

function ShortcutsPage({ settings, onChange }: PageProps) {
  const on = settings.gmailShortcuts
  return (
    <>
      <Group title="Single-key shortcuts">
        <Item title="Gmail-style shortcuts" description="Press one key in the message list, as in Gmail.">
          <Switch
            label="Gmail-style single-key shortcuts"
            checked={on}
            onChange={(gmailShortcuts) => onChange({ ...settings, gmailShortcuts })}
          />
        </Item>
        <div className={on ? '' : 'st-dim'} aria-disabled={!on}>
          <KeyRow keys={[['j'], ['k']]} action="Next / previous message" />
          <KeyRow keys={[['e']]} action="Archive" />
          <KeyRow keys={[['#']]} action="Delete" />
          <KeyRow keys={[['!']]} action="Move to Junk" />
          <KeyRow keys={[['r'], ['a'], ['f']]} action="Reply / Reply all / Forward" />
          <KeyRow keys={[['s']]} action="Flag" />
          <KeyRow keys={[['Shift', 'I'], ['Shift', 'U']]} action="Mark as read / unread" />
          <KeyRow keys={[['x']]} action="Select" />
          <KeyRow keys={[['b']]} action="Snooze" />
          <KeyRow keys={[['v']]} action="Move to…" />
          <KeyRow keys={[['z']]} action="Undo" />
          <KeyRow keys={[['c']]} action="New message" />
          <KeyRow keys={[['/']]} action="Search" />
        </div>
      </Group>

      <Group title="Always available">
        <KeyRow keys={[['Ctrl', 'N']]} action="New message" />
        <KeyRow keys={[['Ctrl', 'R'], ['Ctrl', 'Shift', 'R'], ['Ctrl', 'Shift', 'F']]} action="Reply / Reply all / Forward" />
        <KeyRow keys={[['Ctrl', 'F']]} action="Search" />
        <KeyRow keys={[['Ctrl', ',']]} action="Settings" />
        <KeyRow keys={[['Ctrl', '.']]} action="Next open message" />
        <KeyRow keys={[['Ctrl', 'Enter']]} action="Send" />
        <KeyRow keys={[['Ctrl', 'S']]} action="Save draft" />
        <KeyRow keys={[['Esc'], ['Ctrl', 'W']]} action="Save and close a message" />
        <KeyRow keys={[['Ctrl', 'Shift', 'D']]} action="Discard draft" />
        <KeyRow keys={[['Ctrl', 'K']]} action="Insert link" />
      </Group>
    </>
  )
}

/** Claude API key for Summarise and Suggest reply; stored encrypted, never shown again. */
function AiPage() {
  const [saved, setSaved] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.aiAvailable().then(setSaved, () => setSaved(false))
  }, [])
  const save = async (value: string | null) => {
    setError(null)
    try {
      await api.setAiKey(value)
      setSaved(!!value)
      setKey('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  // Not inside a <label>: a label would pass clicks on the text to the Remove button.
  return (
    <Group title="Anthropic API key">
      <Item
        stack
        title={saved ? 'API key saved' : 'Use Claude in WinMail'}
        description="Summarise messages and suggest replies with your own Anthropic API key. The message text is sent to Anthropic only when you ask. The key is stored encrypted on this PC and is never shown again."
      >
        {saved ? (
          <button className="btn" onClick={() => save(null)}>
            Remove key
          </button>
        ) : (
          <span className="st-key-form">
            <input
              type="password"
              className="st-input"
              placeholder="sk-ant-…"
              aria-label="Anthropic API key"
              value={key}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && key.trim() && save(key)}
            />
            <button className="btn btn-primary" disabled={!key.trim()} onClick={() => save(key)}>
              Save
            </button>
          </span>
        )}
        {error && <div className="form-error">{error}</div>}
      </Item>
    </Group>
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
    <div className="st-accounts">
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
                <span className="acct-sub">{!a.enabled ? 'Inactive' : a.auth === 'oauth' ? 'Google' : 'IMAP'}</span>
              </span>
            </button>
          ))}
          {accounts.length === 0 && <div className="acct-empty">No accounts</div>}
        </div>
        <div className="acct-buttons">
          <button className="sq-btn" title="Add Account" aria-label="Add account" onClick={onAdd}>
            <Plus size={14} />
          </button>
          <button
            className="sq-btn"
            title="Remove Account"
            aria-label="Remove account"
            disabled={!selected}
            onClick={() => setConfirmRemove(true)}
          >
            <Minus size={14} />
          </button>
        </div>
      </div>

      <div className="st-acct-detail">
        {selected ? (
          confirmRemove ? (
            <div className="confirm">
              <p>
                Are you sure you want to remove “{selected.description}”? Messages are not deleted from the server.
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
  const parts = [status.source && `${status.saved} from ${status.source}`, `${status.fromMail} from your mail`].filter(Boolean)
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
      <div className="st-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'info'} className={tab === 'info' ? 'is-active' : ''} onClick={() => setTab('info')}>
          Account
        </button>
        <button role="tab" aria-selected={tab === 'server'} className={tab === 'server' ? 'is-active' : ''} onClick={() => setTab('server')}>
          Server settings
        </button>
      </div>

      {tab === 'info' ? (
        <>
          <Group>
            <Item title="Use this account" description="Turn off to stop checking this account without removing it.">
              <Switch label="Enable this account" checked={draft.enabled} onChange={(enabled) => set({ enabled })} />
            </Item>
          </Group>
          <Group title="Details">
            <div className="st-fields">
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
            </div>
          </Group>
          <Group title="Signature">
            <Item
              stack
              title="Added to new messages"
              description="It also goes above the quoted text in replies and forwards."
            >
              <textarea
                className="signature-input"
                rows={4}
                aria-label="Signature"
                value={draft.signature ?? ''}
                onChange={(e) => set({ signature: e.target.value })}
              />
            </Item>
          </Group>
        </>
      ) : (
        <>
          <Group title="Incoming mail server (IMAP)">
            <div className="st-fields">
              <Row label="User Name:">
                <input value={draft.username} readOnly={oauth} onChange={(e) => set({ username: e.target.value })} />
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
                        <span className="verifying">
                          <span className="spinner" /> Waiting for Google…
                        </span>
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
            </div>
          </Group>
          <Group title="Outgoing mail server (SMTP)">
            <div className="st-fields">
              <ServerFields kind="smtp" value={draft.smtp} onChange={(smtp) => set({ smtp })} />
            </div>
          </Group>
        </>
      )}

      {error && <div className="form-error">{error}</div>}

      <div className="st-savebar">
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
