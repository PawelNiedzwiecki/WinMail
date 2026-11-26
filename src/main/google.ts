import { BrowserWindow, shell } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { createServer, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import type { GoogleClientCredentials, GoogleClientInfo } from '../shared/googleClient'

// The OAuth client built into this copy of WinMail: set in .env.local for dev builds, by CI for releases (see README).
const BUNDLED: GoogleClientCredentials = {
  clientId: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID ?? '',
  clientSecret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET ?? ''
}

/** The person's own client (Settings > Accounts > Google sign-in); read from the store on each use. */
let customSource: () => GoogleClientCredentials | null = () => null

export function useCustomClientFrom(source: () => GoogleClientCredentials | null): void {
  customSource = source
}

/** The client new sign-ins use: the person's own, else the one built in. */
export function activeClient(): GoogleClientCredentials | null {
  const custom = customSource()
  if (custom?.clientId) return custom
  return BUNDLED.clientId ? BUNDLED : null
}

export function clientInfo(): GoogleClientInfo {
  const custom = customSource()
  if (custom?.clientId) return { source: 'custom', clientId: custom.clientId }
  if (BUNDLED.clientId) return { source: 'bundled', clientId: BUNDLED.clientId }
  return { source: 'none', clientId: null }
}

/**
 * The client that issued an account's refresh token. Google ties a refresh token to its client, so an account keeps
 * using its own even after the person switches clients. Accounts from before this was recorded used the built-in one.
 */
function clientFor(clientId?: string): GoogleClientCredentials | null {
  const candidates = [customSource(), BUNDLED].filter((c): c is GoogleClientCredentials => !!c?.clientId)
  if (!clientId) return BUNDLED.clientId ? BUNDLED : null
  return candidates.find((c) => c.clientId === clientId) ?? null
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const MAIL_SCOPE = 'https://mail.google.com/'
// Contacts power recipient autocomplete; "other" are addresses Gmail saved automatically.
const SCOPES = [
  MAIL_SCOPE,
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'openid',
  'email',
  'profile'
].join(' ')

const SIGN_IN_TIMEOUT_MS = 5 * 60_000
/** Refresh access tokens this long before Google says they expire. */
const EXPIRY_MARGIN_MS = 60_000

export const REAUTH_MESSAGE = 'Google sign-in expired or was revoked. Sign in again in Settings > Accounts.'

export interface GoogleSignIn {
  /** The client the sign-in went through; saved on the account. */
  clientId: string
  email: string
  name: string
  refreshToken: string
  accessToken: string
  expiresAt: number
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
  scope?: string
  error?: string
  error_description?: string
}

const b64url = (b: Buffer) => b.toString('base64url')

async function tokenRequest(client: GoogleClientCredentials, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({ client_id: client.clientId, ...params })
  if (client.clientSecret) body.set('client_secret', client.clientSecret)
  let res: Response
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', body })
  } catch {
    throw new Error('Could not reach Google. Check your internet connection.')
  }
  const data = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant' || data.error === 'invalid_client') throw new Error(REAUTH_MESSAGE)
    throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`)
  }
  return data
}

function page(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(
    `<!doctype html><meta charset="utf-8"><title>WinMail</title>` +
      `<body style="font:15px system-ui;display:grid;place-items:center;height:90vh;color:#333">` +
      `<p>${message}</p></body>`
  )
}

let cancelCurrent: (() => void) | null = null

export function cancelSignIn(): void {
  cancelCurrent?.()
}

/**
 * Signs in through the system browser: loopback redirect to 127.0.0.1 with PKCE,
 * the flow Google requires for desktop apps.
 */
export async function signIn(loginHint?: string): Promise<GoogleSignIn> {
  const client = activeClient()
  if (!client) {
    throw new Error('Google sign-in is not set up yet. Add your own Google client in Settings > Accounts > Google sign-in.')
  }
  cancelSignIn()

  const verifier = b64url(randomBytes(32))
  const state = b64url(randomBytes(16))
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const url = new URL(AUTH_URL)
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    // Offline access with forced consent so Google always returns a refresh token, and the account picker so a
    // second account can be added while the browser is signed in to the first.
    access_type: 'offline',
    prompt: 'consent select_account',
    ...(loginHint ? { login_hint: loginHint } : {})
  }).toString()

  let timer: NodeJS.Timeout | undefined
  let code: string
  try {
    code = await new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Google sign-in timed out.')), SIGN_IN_TIMEOUT_MS)
      cancelCurrent = () => reject(new Error('Google sign-in was cancelled.'))
      server.on('request', (req, res) => {
        const q = new URL(req.url ?? '/', redirectUri).searchParams
        // Ignore favicon requests and anything that isn't our redirect.
        if (q.get('state') !== state) return page(res, 404, 'Not found.')
        const error = q.get('error')
        const got = q.get('code')
        if (error || !got) {
          page(res, 200, 'Sign-in was cancelled. You can close this tab.')
          reject(new Error(error === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed: ${error}`))
          return
        }
        page(res, 200, 'You are signed in. You can close this tab and go back to WinMail.')
        resolve(got)
      })
      shell.openExternal(url.toString()).catch(reject)
    })
  } finally {
    clearTimeout(timer)
    cancelCurrent = null
    server.close()
  }

  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }

  const t = await tokenRequest(client, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri
  })
  // Google's consent screen lets people untick individual permissions.
  if (!t.scope?.split(' ').includes(MAIL_SCOPE)) {
    throw new Error('WinMail needs permission to read, send and delete your Gmail. Sign in again and allow it.')
  }
  if (!t.refresh_token) throw new Error('Google did not return a refresh token. Try again.')
  if (!t.id_token) throw new Error('Google did not return your account details. Try again.')

  // Received straight from Google's token endpoint over TLS, so no signature check needed.
  const claims = JSON.parse(Buffer.from(t.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
    email?: string
    name?: string
  }
  if (!claims.email) throw new Error('Google did not return your email address.')
  return {
    clientId: client.clientId,
    email: claims.email,
    name: claims.name || claims.email,
    refreshToken: t.refresh_token,
    accessToken: t.access_token!,
    expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000
  }
}

/** Best effort: removes WinMail from the account's third-party access list. */
export async function revoke(refreshToken: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, { method: 'POST', body: new URLSearchParams({ token: refreshToken }) })
  } catch (err) {
    console.error('Could not revoke Google token:', err)
  }
}

/** Short-lived access tokens per account, refreshed from the stored refresh token. */
export class GoogleTokens {
  private cache = new Map<string, { token: string; expiresAt: number }>()

  remember(accountId: string, token: string, expiresAt: number): void {
    this.cache.set(accountId, { token, expiresAt })
  }

  forget(accountId: string): void {
    this.cache.delete(accountId)
  }

  async get(accountId: string, refreshToken: string, clientId?: string): Promise<string> {
    const c = this.cache.get(accountId)
    if (c && c.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return c.token
    const client = clientFor(clientId)
    if (!client) throw new Error(REAUTH_MESSAGE)
    const t = await tokenRequest(client, { grant_type: 'refresh_token', refresh_token: refreshToken })
    this.remember(accountId, t.access_token!, Date.now() + (t.expires_in ?? 3600) * 1000)
    return t.access_token!
  }
}
