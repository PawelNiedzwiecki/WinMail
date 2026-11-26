/** Google OAuth client credentials a person can bring themselves (Settings > Accounts > Google sign-in). */
export interface GoogleClientCredentials {
  clientId: string
  clientSecret: string
}

/** Where WinMail's Google client comes from, shown in Settings. The secret is never sent to the window. */
export interface GoogleClientInfo {
  source: 'custom' | 'bundled' | 'none'
  /** The client ID in use, if any. */
  clientId: string | null
}

/** Client IDs look like `123456789012-abc123.apps.googleusercontent.com`. */
export function isValidClientId(id: string): boolean {
  return /^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(id.trim())
}

export type ParsedClient = { ok: true; client: GoogleClientCredentials } | { ok: false; error: string }

/**
 * Reads the `client_secret_*.json` file Google Cloud Console offers when a client is created.
 * Only "Desktop app" clients (the `installed` key) can use the loopback sign-in WinMail does.
 */
export function parseClientSecretJson(text: string): ParsedClient {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not valid JSON. Pick the client_secret file you downloaded from Google.' }
  }
  const root = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (root.web) {
    return {
      ok: false,
      error: 'That is a Web application client. Create a client of type "Desktop app" in Google Cloud Console instead.'
    }
  }
  const installed = root.installed as Record<string, unknown> | undefined
  const clientId = typeof installed?.client_id === 'string' ? installed.client_id.trim() : ''
  const clientSecret = typeof installed?.client_secret === 'string' ? installed.client_secret.trim() : ''
  if (!clientId) return { ok: false, error: 'No Desktop app client found in that file.' }
  if (!isValidClientId(clientId)) return { ok: false, error: 'The client ID in that file does not look right.' }
  return { ok: true, client: { clientId, clientSecret } }
}

/** Checks a client ID and secret typed or pasted by hand. */
export function checkClient(clientId: string, clientSecret: string): ParsedClient {
  const id = clientId.trim()
  if (!isValidClientId(id)) {
    return { ok: false, error: 'The client ID should end in .apps.googleusercontent.com.' }
  }
  return { ok: true, client: { clientId: id, clientSecret: clientSecret.trim() } }
}
