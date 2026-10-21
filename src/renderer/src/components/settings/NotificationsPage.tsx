import { useState } from 'react'
import type { Account, NotifyFilter, NotifyPreview, Settings } from '@shared/types'
import { inQuietHours } from '@shared/quietHours'
import { api } from '../../api'
import { ProviderLogo } from '../ProviderLogo'
import { Select } from '../Select'
import { Group, Item, Segmented, Switch } from './controls'

const FILTER_HINT: Record<NotifyFilter, string> = {
  all: 'Every new message in your inbox.',
  primary: 'Only mail in the Primary category; not Social, Promotions, Updates or Forums.',
  people: 'Only mail from saved contacts and people you have written to.'
}

const PREVIEW_HINT: Record<NotifyPreview, string> = {
  full: 'Sender, subject and the first lines of the message.',
  sender: 'Only who it is from. Handy when your screen is shared.',
  none: 'Just “New message”, without the sender or the reply box.'
}

/** Every half hour of the day, for the quiet hours schedule. */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const t = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`
  return { value: t, label: t }
})

interface Props {
  settings: Settings
  accounts: Account[]
  onChange: (s: Settings) => void
}

export function NotificationsPage({ settings, accounts, onChange }: Props) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  const on = settings.notifyNewMail
  const muted = new Set(settings.notifyMutedAccounts)
  const quietNow = inQuietHours(settings)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)

  const test = async () => {
    setTesting(true)
    setTestError(null)
    try {
      await api.testNotification()
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e))
    } finally {
      setTesting(false)
    }
  }

  const toggleAccount = (id: string, notify: boolean) => {
    const next = new Set(muted)
    if (notify) next.delete(id)
    else next.add(id)
    set({ notifyMutedAccounts: [...next] })
  }

  return (
    <>
      <Group title="New mail">
        <Item title="Show notifications" description="A Windows notification when mail arrives while WinMail is in the background.">
          <Switch label="Show new mail notifications" checked={on} onChange={(notifyNewMail) => set({ notifyNewMail })} />
        </Item>
        <div className={on ? '' : 'st-dim'} aria-disabled={!on}>
          <Item title="Notify me about" description={FILTER_HINT[settings.notifyFilter]}>
            <Select<NotifyFilter>
              aria-label="Notify me about"
              value={settings.notifyFilter}
              onChange={(notifyFilter) => set({ notifyFilter })}
              options={[
                { value: 'all', label: 'All new mail' },
                { value: 'primary', label: 'Primary only' },
                { value: 'people', label: 'People I know' }
              ]}
            />
          </Item>
        </div>
      </Group>

      {accounts.length > 0 && (
        <Group title="Accounts">
          <div className={on ? '' : 'st-dim'} aria-disabled={!on}>
            {accounts.map((a) => (
              <div key={a.id} className="st-item">
                <div className="st-item-text st-item-with-icon">
                  <ProviderLogo id={a.provider} />
                  <span className="acct-text">
                    <span className="st-item-title">{a.description}</span>
                    <span className="st-item-desc">{a.enabled ? a.email : `${a.email} · paused`}</span>
                  </span>
                </div>
                <div className="st-item-control">
                  <Switch
                    label={`Notifications for ${a.description}`}
                    checked={!muted.has(a.id)}
                    onChange={(v) => toggleAccount(a.id, v)}
                  />
                </div>
              </div>
            ))}
          </div>
        </Group>
      )}

      <Group title="Style">
        <div className={on ? '' : 'st-dim'} aria-disabled={!on}>
          <Item title="Preview" description={PREVIEW_HINT[settings.notifyPreview]}>
            <Segmented<NotifyPreview>
              label="Notification preview"
              value={settings.notifyPreview}
              onChange={(notifyPreview) => set({ notifyPreview })}
              options={[
                { value: 'full', label: 'Full' },
                { value: 'sender', label: 'Sender' },
                { value: 'none', label: 'Hidden' }
              ]}
            />
          </Item>
          <Item title="Sound" description="Play the Windows notification sound.">
            <Switch label="Notification sound" checked={settings.notifySound} onChange={(notifySound) => set({ notifySound })} />
          </Item>
        </div>
        <Item
          title="Try it"
          description={testError ?? 'Shows a sample notification with these settings, even while WinMail is open.'}
        >
          <button className="btn" disabled={testing} onClick={test}>
            Send test notification
          </button>
        </Item>
      </Group>

      <Group title="Quiet hours">
        <div className={on ? '' : 'st-dim'} aria-disabled={!on}>
          <Item
            title="Mute on a schedule"
            description={
              settings.quietHours && quietNow
                ? 'Quiet now. Mail still arrives; it just doesn’t notify.'
                : 'No notifications at night or whenever you choose. Mail still arrives.'
            }
          >
            <Switch label="Quiet hours" checked={settings.quietHours} onChange={(quietHours) => set({ quietHours })} />
          </Item>
          <div className={settings.quietHours ? '' : 'st-dim'} aria-disabled={!settings.quietHours}>
            <Item title="Schedule" description="Times cross midnight, so 22:00 to 07:00 covers the night.">
              <span className="st-time-range">
                <Select aria-label="Quiet from" value={settings.quietStart} onChange={(quietStart) => set({ quietStart })} options={TIMES} />
                <span aria-hidden>to</span>
                <Select aria-label="Quiet until" value={settings.quietEnd} onChange={(quietEnd) => set({ quietEnd })} options={TIMES} />
              </span>
            </Item>
          </div>
        </div>
      </Group>

      <Group title="Taskbar">
        <Item title="Unread count" description="Show how many inbox messages are unread on WinMail’s taskbar button.">
          <Switch label="Unread count on the taskbar" checked={settings.taskbarBadge} onChange={(taskbarBadge) => set({ taskbarBadge })} />
        </Item>
      </Group>
    </>
  )
}
