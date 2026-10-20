import { useRef, useState } from 'react'
import { providers, getProvider } from '@shared/providers'
import type { Account, AccountInput, ProviderId, ServerConfig } from '@shared/types'
import { api } from '../api'
import { useEscape } from '../useEscape'
import { Row, ServerFields, guessServers } from './forms'
import { ProviderLogo } from './ProviderLogo'

interface Props {
  existing: Account[]
  onClose: () => void
  onAdded: (a: Account) => void
}

export function AddAccount({ existing, onClose, onAdded }: Props) {
  const [step, setStep] = useState<'provider' | 'details'>('provider')
  const [providerId, setProviderId] = useState<ProviderId>('icloud')
  const provider = getProvider(providerId)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [imap, setImap] = useState<ServerConfig>(guessServers('').imap)
  const [smtp, setSmtp] = useState<ServerConfig>(guessServers('').smtp)
  const [serversTouched, setServersTouched] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usePassword, setUsePassword] = useState(false)
  const cancelled = useRef(false)

  useEscape(() => !busy && onClose())

  const isOther = providerId === 'other'
  const oauth = !!provider.oauth && !usePassword

  const googleSignIn = async () => {
    if (busy) return
    cancelled.current = false
    setBusy(true)
    setError(null)
    try {
      const account = await api.addGoogleAccount()
      if (!cancelled.current) onAdded(account)
    } catch (e) {
      if (!cancelled.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const cancelGoogle = () => {
    cancelled.current = true
    api.cancelGoogleSignIn()
  }

  const duplicate = existing.some((a) => a.email.toLowerCase() === email.trim().toLowerCase())
  const valid =
    name.trim() &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) &&
    password &&
    !duplicate &&
    (!isOther || (imap.host && imap.port && smtp.host && smtp.port))

  const onEmail = (v: string) => {
    setEmail(v)
    if (isOther && !serversTouched) {
      const g = guessServers(v)
      setImap(g.imap)
      setSmtp(g.smtp)
    }
  }

  const describe = () => {
    if (!isOther) {
      const base = provider.name === 'Google' ? 'Google' : provider.name
      return existing.some((a) => a.description === base) ? `${base} (${email.trim()})` : base
    }
    return email.split('@')[1] ?? 'Mail'
  }

  const signIn = async () => {
    if (!valid || busy) return
    const input: AccountInput = {
      provider: providerId,
      description: describe(),
      name: name.trim(),
      email: email.trim(),
      username: (isOther && username.trim()) || email.trim(),
      enabled: true,
      imap: isOther ? imap : provider.imap!,
      smtp: isOther ? smtp : provider.smtp!,
      password
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.testAccount(input)
      if (!res.ok) {
        const where = res.stage === 'smtp' ? 'Outgoing server (SMTP)' : 'Incoming server (IMAP)'
        setError(`${where}: ${res.error}`)
        return
      }
      onAdded(await api.addAccount(input))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Add Account"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && step === 'details') (oauth ? googleSignIn : signIn)()
        }}
      >
        {step === 'provider' ? (
          <>
            <h2 className="sheet-title">Choose a Mail account provider…</h2>
            <div className="provider-list" role="radiogroup">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={providerId === p.id}
                  className={`provider ${providerId === p.id ? 'is-selected' : ''} ${p.unsupported ? 'is-disabled' : ''}`}
                  title={p.unsupported}
                  disabled={!!p.unsupported}
                  onClick={() => setProviderId(p.id)}
                  onDoubleClick={() => setStep('details')}
                >
                  <ProviderLogo id={p.id} />
                  <span className={`provider-name provider-${p.id}`}>{p.name}</span>
                  {p.unsupported && <span className="provider-note">{p.unsupported}</span>}
                </button>
              ))}
            </div>
            <div className="sheet-actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => setStep('details')}>
                Continue
              </button>
            </div>
          </>
        ) : oauth ? (
          <>
            <h2 className="sheet-title">{provider.name} Account</h2>
            <p className="sheet-sub">
              WinMail opens Google in your browser. Sign in there and allow access to Gmail.
            </p>
            <div className="oauth-alt">
              <button
                className="link-btn small"
                disabled={busy}
                onClick={() => {
                  setError(null)
                  setUsePassword(true)
                }}
              >
                Use an app password instead
              </button>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="sheet-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setError(null)
                  setStep('provider')
                }}
              >
                Back
              </button>
              <span className="tb-spacer" />
              {busy ? (
                <>
                  <span className="verifying"><span className="spinner" /> Waiting for Google…</span>
                  <button className="btn" onClick={cancelGoogle}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" autoFocus onClick={googleSignIn}>
                  Sign in with Google
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h2 className="sheet-title">{isOther ? 'Add a Mail Account' : `${provider.name} Account`}</h2>
            <p className="sheet-sub">To get started, fill out the following information:</p>
            <div className="form">
              <Row label="Name:">
                <input autoFocus value={name} placeholder="Full Name" onChange={(e) => setName(e.target.value)} />
              </Row>
              <Row label="Email Address:" hint={duplicate ? 'This account is already added.' : undefined}>
                <input
                  type="email"
                  value={email}
                  placeholder="name@example.com"
                  onChange={(e) => onEmail(e.target.value)}
                />
              </Row>
              {isOther && (
                <Row label="User Name:">
                  <input
                    value={username}
                    placeholder={email || 'Same as email'}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </Row>
              )}
              <Row
                label="Password:"
                hint={
                  <>
                    {provider.passwordHelp}{' '}
                    {provider.passwordUrl && (
                      <a href={provider.passwordUrl} target="_blank" rel="noopener noreferrer">
                        Create one
                      </a>
                    )}
                  </>
                }
              >
                <input
                  type="password"
                  value={password}
                  placeholder="Required"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Row>

              {isOther && (
                <div onChange={() => setServersTouched(true)}>
                  <div className="form-group-title">Incoming Mail Server (IMAP)</div>
                  <ServerFields kind="imap" value={imap} onChange={setImap} />
                  <div className="form-group-title">Outgoing Mail Server (SMTP)</div>
                  <ServerFields kind="smtp" value={smtp} onChange={setSmtp} />
                </div>
              )}
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="sheet-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setError(null)
                  if (provider.oauth) setUsePassword(false)
                  else setStep('provider')
                }}
              >
                Back
              </button>
              <span className="tb-spacer" />
              {busy && <span className="verifying"><span className="spinner" /> Verifying…</span>}
              <button className="btn btn-primary" disabled={!valid || busy} onClick={signIn}>
                Sign In
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
