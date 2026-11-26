import { describe, expect, it } from 'vitest'
import { checkClient, isValidClientId, parseClientSecretJson } from './googleClient'

const ID = '123456789012-abc123def456.apps.googleusercontent.com'

describe('isValidClientId', () => {
  it('accepts Google client IDs', () => {
    expect(isValidClientId(ID)).toBe(true)
    expect(isValidClientId(`  ${ID}  `)).toBe(true)
  })
  it('rejects anything else', () => {
    expect(isValidClientId('')).toBe(false)
    expect(isValidClientId('abc')).toBe(false)
    expect(isValidClientId('123-abc.example.com')).toBe(false)
  })
})

describe('parseClientSecretJson', () => {
  it('reads a Desktop app client', () => {
    const json = JSON.stringify({ installed: { client_id: ID, client_secret: 'GOCSPX-x', project_id: 'p' } })
    expect(parseClientSecretJson(json)).toEqual({ ok: true, client: { clientId: ID, clientSecret: 'GOCSPX-x' } })
  })
  it('refuses a Web application client', () => {
    const r = parseClientSecretJson(JSON.stringify({ web: { client_id: ID, client_secret: 's' } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Desktop app/)
  })
  it('refuses text that is not JSON, empty objects and bad IDs', () => {
    expect(parseClientSecretJson('nope').ok).toBe(false)
    expect(parseClientSecretJson('{}').ok).toBe(false)
    expect(parseClientSecretJson('null').ok).toBe(false)
    expect(parseClientSecretJson(JSON.stringify({ installed: { client_id: 'x', client_secret: 'y' } })).ok).toBe(false)
  })
})

describe('checkClient', () => {
  it('trims and validates', () => {
    expect(checkClient(` ${ID} `, ' s ')).toEqual({ ok: true, client: { clientId: ID, clientSecret: 's' } })
    expect(checkClient('nope', 's').ok).toBe(false)
  })
})
