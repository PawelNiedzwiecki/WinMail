import { Mail } from 'lucide-react'

export function Welcome({ onAddAccount }: { onAddAccount: () => void }) {
  return (
    <section className="welcome">
      <div className="welcome-icon">
        <Mail size={40} strokeWidth={1.4} />
      </div>
      <h1>Welcome to WinMail</h1>
      <p>Add your iCloud, Google, Yahoo! or any IMAP account to get started.</p>
      <button className="btn btn-primary btn-large" onClick={onAddAccount}>
        Add Account…
      </button>
    </section>
  )
}
