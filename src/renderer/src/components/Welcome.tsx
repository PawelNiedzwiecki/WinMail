import { Mail } from 'lucide-react'
import type { ProviderId } from '@shared/types'

export function Welcome({ onAddAccount }: { onAddAccount: (provider?: ProviderId) => void }) {
  return (
    <section className="welcome">
      <div className="welcome-icon">
        <Mail size={40} strokeWidth={1.4} />
      </div>
      <h1>Welcome to WinMail</h1>
      <p>Sign in with Google, or add your iCloud, Yahoo! or any IMAP account to get started.</p>
      <div className="welcome-actions">
        <button className="btn btn-primary btn-large" onClick={() => onAddAccount('gmail')}>
          Sign in with Google
        </button>
        <button className="btn btn-large" onClick={() => onAddAccount()}>
          Add Other Account…
        </button>
      </div>
    </section>
  )
}
