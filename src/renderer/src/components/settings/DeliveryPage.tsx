import { Plus, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import type { Account, Contact, Settings } from '@shared/types'
import { MAX_DELIVERY_TIMES, formatTime, isVip, normaliseTimes, parseTime } from '@shared/delivery'
import { isListAddress } from '@shared/waiting'
import { optedIn } from '@shared/contentFeatures'
import { api } from '../../api'
import { Select } from '../Select'
import { Group, Item, Switch } from './controls'

/** Every half hour of the day, plus any saved time that is not on one. */
function timeOptions(current: string): { value: string; label: string }[] {
  const all = Array.from({ length: 48 }, (_, i) => formatTime(i * 30))
  if (!all.includes(current)) all.push(current)
  return all.sort().map((t) => ({ value: t, label: t }))
}

/** A free half hour for a new Delivery: two hours after the last, or the first free one. */
function nextFreeTime(times: string[]): string {
  const taken = new Set(times)
  const last = parseTime(times[times.length - 1]) ?? 9 * 60
  for (let m = last + 120; m < 24 * 60; m += 30) if (!taken.has(formatTime(m))) return formatTime(m)
  for (let m = 0; m < 24 * 60; m += 30) if (!taken.has(formatTime(m))) return formatTime(m)
  return '12:00'
}

/** "Jane Doe <jane@example.com>", "jane@example.com" or "Jane <jane@…>" typed into the add field. */
function parseContact(text: string, known: Contact[]): Contact | null {
  const t = text.trim()
  const angle = /^(.*)<([^<>\s]+@[^<>\s]+)>$/.exec(t)
  const email = angle ? angle[2]! : /^[^\s@]+@[^\s@]+$/.test(t) ? t : null
  if (!email) return null
  const name = angle ? angle[1]!.trim().replace(/^"|"$/g, '') : ''
  return { name: name || known.find((c) => c.email.toLowerCase() === email.toLowerCase())?.name || '', email }
}

interface Props {
  settings: Settings
  accounts: Account[]
  onChange: (s: Settings) => void
}

export function DeliveryPage({ settings, accounts, onChange }: Props) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  const on = settings.batchDelivery
  const times = settings.deliveryTimes
  const [contacts, setContacts] = useState<Contact[]>([])
  const [adding, setAdding] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const listId = useId()

  // People from every account's contacts, best first, for suggestions and the add field.
  useEffect(() => {
    let live = true
    void Promise.all(accounts.filter((a) => a.enabled).map((a) => api.listContacts(a.id).catch(() => [] as Contact[]))).then(
      (lists) => {
        if (!live) return
        const seen = new Set<string>()
        const out: Contact[] = []
        // Take each account's best in turn, so one account's address book doesn't fill the list.
        for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) {
          for (const l of lists) {
            const c = l[i]
            if (!c || seen.has(c.email.toLowerCase())) continue
            seen.add(c.email.toLowerCase())
            out.push(c)
          }
        }
        setContacts(out)
      }
    )
    return () => {
      live = false
    }
  }, [accounts])

  const own = new Set(accounts.map((a) => a.email.toLowerCase()))
  const suggested = contacts
    .filter((c) => !isVip(c.email, settings.vips) && !own.has(c.email.toLowerCase()) && !isListAddress(c.email))
    .slice(0, 5)

  const setTime = (i: number, t: string) => set({ deliveryTimes: normaliseTimes(times.map((x, j) => (j === i ? t : x))) })
  const removeTime = (i: number) => set({ deliveryTimes: normaliseTimes(times.filter((_, j) => j !== i)) })
  const addTime = () => set({ deliveryTimes: normaliseTimes([...times, nextFreeTime(times)]) })

  const addVip = (c: Contact) => {
    if (isVip(c.email, settings.vips)) return
    set({ vips: [...settings.vips, c] })
  }
  const removeVip = (email: string) =>
    set({ vips: settings.vips.filter((v) => v.email.toLowerCase() !== email.toLowerCase()) })
  const submit = () => {
    const c = parseContact(adding, contacts)
    if (!c) {
      setAddError('Type an email address, or pick someone from the list.')
      return
    }
    addVip(c)
    setAdding('')
    setAddError(null)
  }

  return (
    <>
      <Group title="Batched delivery">
        <Item
          title="Deliver mail at set times"
          description="New Inbox mail waits and arrives together at the times below, with one notification. Nothing changes on the server, so your other devices see mail as usual."
        >
          <Switch label="Batched delivery" checked={on} onChange={(batchDelivery) => set({ batchDelivery })} />
        </Item>
      </Group>

      <Group title="Delivery times">
        <div className={on ? '' : 'st-dim'} aria-disabled={!on}>
          {times.map((t, i) => (
            <Item
              key={t}
              title={times.length === 1 ? 'Every day at' : i === 0 ? 'First delivery' : `Delivery ${i + 1}`}
              description={i === 0 ? 'Mail that arrives overnight waits for this one.' : undefined}
            >
              <span className="dl-time">
                <Select aria-label={`Delivery ${i + 1}`} value={t} onChange={(v) => setTime(i, v)} options={timeOptions(t)} />
                <button
                  type="button"
                  className="tb-btn"
                  title="Remove this delivery"
                  aria-label={`Remove the ${t} delivery`}
                  disabled={times.length === 1}
                  onClick={() => removeTime(i)}
                >
                  <X size={14} />
                </button>
              </span>
            </Item>
          ))}
          <Item title="Another delivery" description="Up to six a day, the same times every day.">
            <button className="btn" disabled={times.length >= MAX_DELIVERY_TIMES} onClick={addTime}>
              <Plus size={13} className="dl-plus" />
              Add a time
            </button>
          </Item>
        </div>
      </Group>

      <Group title="VIPs">
        <div className={on ? '' : 'st-dim'} aria-disabled={!on}>
          <Item title="Always deliver at once" description="Mail from these people is never held." stack>
            <div className="dl-vips">
              {settings.vips.length === 0 && <div className="dl-empty">No VIPs yet.</div>}
              {settings.vips.map((v) => (
                <span key={v.email} className="dl-vip" title={v.email}>
                  <span className="dl-vip-name">{v.name || v.email}</span>
                  {v.name && <span className="dl-vip-email">{v.email}</span>}
                  <button type="button" className="dl-vip-remove" aria-label={`Remove ${v.name || v.email}`} onClick={() => removeVip(v.email)}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <form
              className="st-key-form dl-add"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <input
                className="st-input"
                list={listId}
                placeholder="Name or email address"
                aria-label="Add a VIP"
                value={adding}
                onChange={(e) => {
                  setAdding(e.target.value)
                  setAddError(null)
                }}
              />
              <datalist id={listId}>
                {contacts
                  .filter((c) => !isVip(c.email, settings.vips))
                  .slice(0, 200)
                  .map((c) => (
                    <option key={c.email} value={c.name ? `${c.name} <${c.email}>` : c.email} />
                  ))}
              </datalist>
              <button className="btn" type="submit" disabled={!adding.trim()}>
                Add
              </button>
            </form>
            {addError && <div className="dl-error">{addError}</div>}
          </Item>
          {suggested.length > 0 && (
            <Item title="Suggested" description="From your contacts and the people you write to." stack>
              <div className="dl-vips">
                {suggested.map((c) => (
                  <button key={c.email} type="button" className="dl-vip dl-suggest" title={`Add ${c.email}`} onClick={() => addVip(c)}>
                    <Plus size={12} />
                    <span className="dl-vip-name">{c.name || c.email}</span>
                  </button>
                ))}
              </div>
            </Item>
          )}
        </div>
      </Group>

      <Group title="Brief">
        <div className={on ? '' : 'st-dim'} aria-disabled={!on}>
          <Item
            title="Show a Brief with each delivery"
            description="A short card at the top of the Inbox: what needs you, with the reason, and everything else grouped. Worked out on this PC."
          >
            <Switch label="Show a Brief with each delivery" checked={settings.brief} onChange={(brief) => set({ brief })} />
          </Item>
          <div className={settings.brief ? '' : 'st-dim'} aria-disabled={!settings.brief}>
            <Item
              title="Morning brief notification"
              description="Announce the day's first delivery: how many messages came and how many need you. Follows your notification settings, quiet hours included."
            >
              <Switch
                label="Morning brief notification"
                checked={settings.morningBriefNotify}
                onChange={(morningBriefNotify) => set({ morningBriefNotify })}
              />
            </Item>
          </div>
          <Item
            title="Claude-written summary"
            description={
              <>
                A paragraph from Claude at the top of the Brief. It sends message content, so it has its own switch in{' '}
                <b>Settings &gt; Claude</b>, off until you turn it on.
              </>
            }
          >
            <span className="dl-state">{optedIn(settings, 'brief') ? 'On' : 'Off'}</span>
          </Item>
        </div>
      </Group>
    </>
  )
}
