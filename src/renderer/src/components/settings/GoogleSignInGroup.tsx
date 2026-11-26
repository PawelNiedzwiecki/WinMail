import { useEffect, useRef, useState } from 'react'
import type { GoogleClientInfo } from '@shared/googleClient'
import { api } from '../../api'
import { Group, Item } from './controls'

const CONSOLE = 'https://console.cloud.google.com/auth/clients'

/**
 * Which Google OAuth client sign-in uses. Releases bring one of their own; this lets a person use their own
 * instead (no rebuild), which also lifts the limit on how many people can sign in through a shared one.
 */
export function GoogleSignInGroup() {
  const [info, setInfo] = useState<GoogleClientInfo | null>(null)
  const [manual, setManual] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.getGoogleClient().then(setInfo, () => setInfo({ source: 'none', clientId: null }))
  }, [])

  const run = async (fn: () => Promise<GoogleClientInfo>) => {
    setBusy(true)
    setError(null)
    try {
      setInfo(await fn())
      setManual(false)
      setClientId('')
      setClientSecret('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const status =
    info?.source === 'custom'
      ? 'Using your own Google client'
      : info?.source === 'bundled'
        ? 'Using the Google client built into WinMail'
        : 'Google sign-in is not set up'
  const description =
    info?.source === 'none'
      ? 'This copy of WinMail has no Google client. Import the file from your own Google Cloud project to turn on Sign in with Google.'
      : info?.source === 'custom'
        ? 'Accounts signed in through a client you remove need to sign in again.'
        : 'Most people never need to change this. A Google client of your own has no sign-in limit and no "unverified app" warning for you.'

  return (
    <Group title="Google sign-in">
      <Item stack title={status} description={description}>
        {info?.clientId && <div className="st-item-desc st-mono">{info.clientId}</div>}
        <span className="st-key-form">
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) await run(async () => api.setGoogleClient({ json: await f.text() }))
            }}
          />
          <button className="btn" disabled={busy} onClick={() => file.current?.click()}>
            Import client_secret.json…
          </button>
          <button className="btn" disabled={busy} onClick={() => setManual((m) => !m)}>
            Enter ID and secret…
          </button>
          {info?.source === 'custom' && (
            <button className="btn" disabled={busy} onClick={() => run(() => api.clearGoogleClient())}>
              Remove my client
            </button>
          )}
        </span>
        {manual && (
          <span className="st-key-form">
            <input
              className="st-input"
              placeholder="123456789012-….apps.googleusercontent.com"
              aria-label="Google client ID"
              value={clientId}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setClientId(e.target.value)}
            />
            <input
              type="password"
              className="st-input"
              placeholder="Client secret"
              aria-label="Google client secret"
              value={clientSecret}
              autoComplete="off"
              onChange={(e) => setClientSecret(e.target.value)}
            />
            <button
              className="btn btn-primary"
              disabled={busy || !clientId.trim()}
              onClick={() => run(() => api.setGoogleClient({ clientId, clientSecret }))}
            >
              Save
            </button>
          </span>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="st-item-desc">
          To make one: in{' '}
          <a href={CONSOLE} target="_blank" rel="noopener noreferrer">
            Google Cloud Console
          </a>{' '}
          enable the Gmail API and People API, then create a client of type <b>Desktop app</b> and download its JSON.
          The README lists the scopes to add. The secret is stored encrypted on this PC.
        </div>
      </Item>
    </Group>
  )
}
