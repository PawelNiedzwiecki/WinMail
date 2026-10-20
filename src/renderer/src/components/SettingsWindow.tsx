import {
  AtSign,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Monitor,
  Moon,
  Palette,
  PenLine,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Sun,
  X,
  type LucideIcon
} from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Backdrop, panelExit, useModalEscape } from './Backdrop'
import type { Account, Appearance, ComposeFormat, ContactsStatus, ListDensity, MessageAppearance, Settings } from '@shared/types'
import { getProvider } from '@shared/providers'
import { api } from '../api'
import { Row, ServerFields } from './forms'
import { ProviderLogo } from './ProviderLogo'
import { Select } from './Select'
import { Group, Item, KeyRow, Segmented, Switch } from './settings/controls'

export type SettingsTab = 'general' | 'appearance' | 'composing' | 'shortcuts' | 'ai' | 'accounts'

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
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'composing', label: 'Composing', icon: PenLine },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'ai', label: 'Claude', icon: Sparkles },
  { id: 'accounts', label: 'Accounts', icon: AtSign }
]

export function SettingsWindow(p: Props) {
  useModalEscape(p.onClose)
  const page = PAGES.find((x) => x.id === p.tab) ?? PAGES[0]!
  return (
    <Backdrop onMouseDown={p.onClose}>
      <motion.div {...panelExit} className="st-window" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
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
            {page.id === 'appearance' && <AppearancePage settings={p.settings} onChange={p.onSettings} />}
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
      </motion.div>
    </Backdrop>
  )
}

interface PageProps {
  settings: Settings
  onChange: (s: Settings) => void
}

function GeneralPage({ settings, onChange }: PageProps) {
  return (
    <>
      <Group title="New mail">
        <Item title="Check for new messages" description="How often WinMail looks for mail.">
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
        <Item title="Notifications" description="Notify me about new mail while WinMail is in the background.">
          <Switch
            label="Notify me about new mail"
            checked={settings.notifyNewMail}
            onChange={(notifyNewMail) => onChange({ ...settings, notifyNewMail })}
          />
        </Item>
      </Group>

      <Group title="Inbox">
        <Item title="Group by conversation" description="Show replies together under one entry.">
          <Switch
            label="Group messages by conversation"
            checked={settings.conversations}
            onChange={(conversations) => onChange({ ...settings, conversations })}
          />
        </Item>
        <Item
          title="Inbox categories"
          description="Primary, Social, Promotions and more. Non-Google accounts are sorted by WinMail and may be wrong."
        >
          <Switch
            label="Show inbox categories"
            checked={settings.inboxCategories}
            onChange={(inboxCategories) => onChange({ ...settings, inboxCategories })}
          />
        </Item>
        <Item title="Confirm before deleting" description="Ask before moving messages to the Bin.">
          <Switch
            label="Confirm before deleting"
            checked={settings.confirmDelete}
            onChange={(confirmDelete) => onChange({ ...settings, confirmDelete })}
          />
        </Item>
      </Group>

      <Group title="Privacy">
        <Item
          title="Load remote images"
          description="Senders can see when and where you opened a message. You can still load them per message."
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

function AppearancePage({ settings, onChange }: PageProps) {
  return (
    <>
      <Group title="Theme">
        <Item title="App theme" description="Choose how WinMail looks.">
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
        <Item title="Message content" description="Dark inverts message colours; photos stay as they are.">
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

      <Group title="Message list">
        <Item title="Layout" description="Compact is one line per message; Comfortable adds a preview.">
          <Segmented<ListDensity>
            label="List layout"
            value={settings.listDensity}
            onChange={(listDensity) => onChange({ ...settings, listDensity })}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' }
            ]}
          />
        </Item>
        {settings.listDensity === 'comfortable' && (
          <Item title="Preview length" description="Lines of text shown under the title.">
            <Select
              aria-label="Preview length"
              value={String(settings.listPreviewLines || 2)}
              onChange={(v) => onChange({ ...settings, listPreviewLines: Number(v) as Settings['listPreviewLines'] })}
              options={[
                { value: '1', label: '1 line' },
                { value: '2', label: '2 lines' },
                { value: '3', label: '3 lines' }
              ]}
            />
          </Item>
        )}
      </Group>

      <Group title="Motion">
        <Item title="Reduce animations" description="Skip movement and fades. Also follows Windows' animation setting.">
          <Switch
            label="Reduce animations"
            checked={settings.reduceMotion}
            onChange={(reduceMotion) => onChange({ ...settings, reduceMotion })}
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = accounts.find((a) => a.id === selectedId) ?? null

  if (selected) {
    return (
      <AccountDetail
        key={selected.id}
        account={selected}
        onBack={() => setSelectedId(null)}
        onChanged={onChanged}
        onRemoved={() => {
          setSelectedId(null)
          onChanged()
        }}
      />
    )
  }

  return (
    <div className="acct-page">
      <div className="acct-intro">
        <p>Mail accounts WinMail checks and sends from. Select one to edit its details, signature and servers.</p>
        <button className="btn btn-primary acct-add" onClick={onAdd}>
          <Plus size={14} strokeWidth={2.2} />
          Add account
        </button>
      </div>
      {accounts.length === 0 ? (
        <div className="acct-empty">
          <AtSign size={22} strokeWidth={1.6} />
          <p>No accounts yet. Add one to start using WinMail.</p>
        </div>
      ) : (
        <div className="st-card acct-cards">
          {accounts.map((a) => (
            <button key={a.id} className="acct-card" onClick={() => setSelectedId(a.id)}>
              <ProviderLogo id={a.provider} />
              <span className="acct-text">
                <span className="acct-name">{a.description}</span>
                <span className="acct-sub">{a.email}</span>
              </span>
              <span className={`acct-chip${a.enabled ? ' is-on' : ''}`}>{a.enabled ? 'Active' : 'Paused'}</span>
              <ChevronRight size={16} className="acct-chevron" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AccountDetail({
  account,
  onBack,
  onChanged,
  onRemoved
}: {
  account: Account
  onBack: () => void
  onChanged: () => void
  onRemoved: () => void
}) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)

  const remove = async () => {
    setRemoving(true)
    try {
      await api.removeAccount(account.id)
      onRemoved()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="st-acct-detail">
      <div className="acct-head">
        <button className="acct-back" onClick={onBack}>
          <ChevronLeft size={16} />
          Accounts
        </button>
        <div className="acct-id">
          <ProviderLogo id={account.provider} />
          <span className="acct-text">
            <span className="acct-name">{account.description}</span>
            <span className="acct-sub">{account.email}</span>
          </span>
        </div>
      </div>

      <AccountEditor
        account={account}
        onSaved={onChanged}
        footer={
          <Group title="Remove">
            <Item
              title="Remove this account"
              description={
                confirmRemove
                  ? `Remove “${account.description}” from WinMail? Messages stay on the server.`
                  : 'Stops WinMail using this account. Messages stay on the server.'
              }
            >
              {confirmRemove ? (
                <>
                  <button className="btn" disabled={removing} onClick={() => setConfirmRemove(false)}>
                    Cancel
                  </button>
                  <button className="btn btn-danger" disabled={removing} onClick={remove}>
                    Remove
                  </button>
                </>
              ) : (
                <button className="btn btn-quiet-danger" onClick={() => setConfirmRemove(true)}>
                  Remove…
                </button>
              )}
            </Item>
          </Group>
        }
      />
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

function AccountEditor({
  account,
  onSaved,
  footer
}: {
  account: Account
  onSaved: () => void
  footer?: ReactNode
}) {
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
      <Segmented<'info' | 'server'>
        label="Account section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'info', label: 'General' },
          { value: 'server', label: 'Servers' }
        ]}
      />

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
          {footer}
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

      {(dirty || saved) && (
        <div className="st-savebar">
          {dirty ? <span className="st-unsaved">Unsaved changes</span> : <span className="saved">Saved</span>}
          <span className="tb-spacer" />
          {dirty && (
            <>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setDraft(account)
                  setPassword('')
                  setError(null)
                }}
              >
                Revert
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={save}>
                {busy ? 'Verifying…' : 'Save'}
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}
