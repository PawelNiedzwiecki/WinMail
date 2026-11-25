import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { NewsletterRuleEntry, Settings } from '@shared/types'
import { api } from '../../api'
import { toast } from '../../toasts'
import { Select } from '../Select'
import { Group, Item, Segmented, Switch } from './controls'

interface Props {
  settings: Settings
  onChange: (s: Settings) => void
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The one-time move: counting, a count, moving, or done. */
type Existing =
  | { state: 'counting' }
  | { state: 'ready'; count: number }
  | { state: 'moving'; count: number }
  | { state: 'moved'; count: number }
  | { state: 'failed'; error: string }

export function MagazinePage({ settings, onChange }: Props) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  const on = settings.newsletters
  const [existing, setExisting] = useState<Existing | null>(null)

  // Newsletters already in the Inboxes, counted each time the page opens with the feature on.
  useEffect(() => {
    if (!on) {
      setExisting(null)
      return
    }
    let live = true
    setExisting({ state: 'counting' })
    api.countInboxNewsletters().then(
      (count) => live && setExisting({ state: 'ready', count }),
      (e) => live && setExisting({ state: 'failed', error: e instanceof Error ? e.message : String(e) })
    )
    return () => {
      live = false
    }
  }, [on])

  const moveExisting = async (count: number) => {
    setExisting({ state: 'moving', count })
    try {
      const moved = await api.moveInboxNewsletters()
      setExisting({ state: 'moved', count: moved })
      toast(moved === 1 ? '1 newsletter moved to the Magazine' : `${moved} newsletters moved to the Magazine`)
    } catch (e) {
      setExisting({ state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  }

  const always = settings.newsletterRules.filter((r) => r.rule === 'always')
  const never = settings.newsletterRules.filter((r) => r.rule === 'never')
  const forget = (r: NewsletterRuleEntry) =>
    api.setNewsletterRule({ name: r.name ?? '', email: r.email }, null).catch((e) => toast({ text: e instanceof Error ? e.message : String(e), tone: 'error' }))

  return (
    <>
      <Group title="Newsletter magazine">
        <Item
          title="Read newsletters as a magazine"
          description="New newsletters leave the Inbox on the server and collect in a Newsletters folder (a label on Gmail), so every device gets a calmer Inbox. Read them here as one issue at a time. Receipts, codes and mail from people stay in the Inbox."
        >
          <Switch label="Newsletter magazine" checked={on} onChange={(newsletters) => set({ newsletters })} />
        </Item>
      </Group>

      <Group title="Issues">
        <div className={on ? '' : 'st-dim'} aria-disabled={!on}>
          <Item title="A new issue" description="Newsletters are grouped by the day or week they arrived.">
            <Segmented<'day' | 'week'>
              label="How often a new issue starts"
              value={settings.magazinePeriod}
              options={[
                { value: 'day', label: 'Every day' },
                { value: 'week', label: 'Every week' }
              ]}
              onChange={(magazinePeriod) => set({ magazinePeriod })}
            />
          </Item>
          {settings.magazinePeriod === 'week' && (
            <Item title="Weekly issues start on">
              <Select
                aria-label="Weekly issues start on"
                value={String(settings.magazineWeekday)}
                options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
                onChange={(v) => set({ magazineWeekday: Number(v) })}
              />
            </Item>
          )}
        </div>
      </Group>

      {on && existing && (
        <Group title="Already in your Inbox">
          <Item
            title={
              existing.state === 'counting'
                ? 'Looking for newsletters…'
                : existing.state === 'failed'
                  ? 'Could not look in the Inbox'
                  : existing.state === 'moved'
                    ? 'Done'
                    : existing.count === 0
                      ? 'No newsletters in your Inbox'
                      : `${existing.count} ${existing.count === 1 ? 'newsletter' : 'newsletters'} in your Inbox`
            }
            description={
              existing.state === 'failed'
                ? existing.error
                : existing.state === 'moved'
                  ? `${existing.count} moved to the Magazine.`
                  : 'Only new newsletters move by themselves. These arrived before, among the newest 2,000 messages of each Inbox.'
            }
          >
            {existing.state === 'counting' && <span className="skel-line mg-count-skel" aria-hidden />}
            {(existing.state === 'ready' || existing.state === 'moving') && existing.count > 0 && (
              <button className="btn" disabled={existing.state === 'moving'} onClick={() => void moveExisting(existing.count)}>
                {existing.state === 'moving' ? 'Moving…' : `Move ${existing.count === 1 ? 'it' : `all ${existing.count}`}`}
              </button>
            )}
          </Item>
        </Group>
      )}

      <Group title="Senders">
        <Item title="Always a newsletter" description="Their mail goes to the Magazine, whatever it looks like." stack>
          <RuleChips list={always} empty="None. Use Always a Newsletter on a message in the Inbox." onRemove={forget} />
        </Item>
        <Item title="Never a newsletter" description="Their mail stays in the Inbox." stack>
          <RuleChips list={never} empty="None. Use Not a Newsletter on a message in the Magazine." onRemove={forget} />
        </Item>
      </Group>
    </>
  )
}

function RuleChips({ list, empty, onRemove }: { list: NewsletterRuleEntry[]; empty: string; onRemove: (r: NewsletterRuleEntry) => void }) {
  return (
    <div className="dl-vips">
      {list.length === 0 && <div className="dl-empty">{empty}</div>}
      {list.map((r) => (
        <span key={r.email} className="dl-vip" title={r.email}>
          <span className="dl-vip-name">{r.name || r.email}</span>
          {r.name && <span className="dl-vip-email">{r.email}</span>}
          <button type="button" className="dl-vip-remove" aria-label={`Forget the rule for ${r.name || r.email}`} onClick={() => onRemove(r)}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  )
}
