import type { ReactNode } from 'react'
import type { Security, ServerConfig } from '@shared/types'
import { Select } from './Select'

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="form-row">
      <span className="form-label">{label}</span>
      <span className="form-control">
        {children}
        {hint && <span className="form-hint">{hint}</span>}
      </span>
    </label>
  )
}

const DEFAULT_PORT: Record<'imap' | 'smtp', Record<Security, number>> = {
  imap: { tls: 993, starttls: 143, none: 143 },
  smtp: { tls: 465, starttls: 587, none: 25 }
}

export function ServerFields({
  kind,
  value,
  onChange
}: {
  kind: 'imap' | 'smtp'
  value: ServerConfig
  onChange: (v: ServerConfig) => void
}) {
  return (
    <>
      <Row label="Host Name:">
        <input
          value={value.host}
          placeholder={kind === 'imap' ? 'imap.example.com' : 'smtp.example.com'}
          onChange={(e) => onChange({ ...value, host: e.target.value.trim() })}
        />
      </Row>
      <Row label="Port:">
        <span className="form-inline">
          <input
            className="port"
            inputMode="numeric"
            value={value.port || ''}
            onChange={(e) => onChange({ ...value, port: Number(e.target.value.replace(/\D/g, '')) })}
          />
          <Select<Security>
            aria-label="Security"
            value={value.security}
            onChange={(security) => onChange({ ...value, security, port: DEFAULT_PORT[kind][security] })}
            options={[
              { value: 'tls', label: 'TLS/SSL' },
              { value: 'starttls', label: 'STARTTLS' },
              { value: 'none', label: 'None (insecure)' }
            ]}
          />
        </span>
      </Row>
      {value.security === 'none' && (
        <Row label="">
          <span className="form-warning">
            Your password and mail will be sent unencrypted. Anyone on the network can read them.
          </span>
        </Row>
      )}
    </>
  )
}

export function guessServers(email: string): { imap: ServerConfig; smtp: ServerConfig } {
  const domain = email.split('@')[1]?.trim() ?? ''
  return {
    imap: { host: domain ? `imap.${domain}` : '', port: 993, security: 'tls' },
    smtp: { host: domain ? `smtp.${domain}` : '', port: 587, security: 'starttls' }
  }
}
