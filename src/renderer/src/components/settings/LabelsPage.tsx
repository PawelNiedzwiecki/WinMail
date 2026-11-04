import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { LABEL_COLOURS, type Account, type AccountLabels, type LabelColour, type LabelInfo } from '@shared/types'
import { api } from '../../api'
import { ContextMenu } from '../ContextMenu'
import { LabelDot } from '../LabelChips'
import { Group, Item } from './controls'

const COLOUR_NAMES: Record<LabelColour, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  grey: 'Grey'
}

interface Props {
  accounts: Account[]
  /** accountId -> labels; missing while they load. */
  labelSets: Record<string, AccountLabels>
  /** Something changed on an account; reload its labels (and, for Gmail, its folders). */
  onChanged: (accountId: string) => Promise<void> | void
}

/** Settings > Labels: rename, recolour and delete each account's labels, or make new ones. */
export function LabelsPage(p: Props) {
  const enabled = p.accounts.filter((a) => a.enabled)
  if (!enabled.length) return <p className="st-note">Add an account to use labels.</p>
  return (
    <>
      <p className="st-note">
        Labels sort messages without moving them. On Google accounts they are your Gmail labels, which also show as
        folders. On other accounts they are saved on the server as keywords, the same ones Thunderbird uses. Colours
        are kept on this PC.
      </p>
      {enabled.map((a) => (
        <AccountLabelsGroup key={a.id} account={a} set={p.labelSets[a.id]} onChanged={() => p.onChanged(a.id)} />
      ))}
    </>
  )
}

function AccountLabelsGroup({
  account,
  set,
  onChanged
}: {
  account: Account
  set: AccountLabels | undefined
  onChanged: () => Promise<void> | void
}) {
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const gmail = set?.support === 'gmail'

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
      await onChanged()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    if (await run(() => api.createLabel(account.id, name))) setNewName('')
  }

  const title = `${account.description}${gmail ? ' · Gmail labels' : ''}`
  if (!set) {
    return (
      <Group title={title}>
        <Item title="Loading labels…">
          <span className="spinner" />
        </Item>
      </Group>
    )
  }
  if (set.support === 'none') {
    return (
      <Group title={title}>
        <Item
          title="Labels aren’t available"
          description="This account’s server doesn’t let mail apps save labels (IMAP keywords) on messages, so WinMail can’t add them. Messages there can still be sorted into folders."
        >
          <span />
        </Item>
      </Group>
    )
  }

  return (
    <Group title={title}>
      {set.labels.map((l) => (
        <LabelRow
          key={l.id}
          label={l}
          gmail={gmail}
          busy={busy}
          onColour={(colour) => run(() => api.updateLabel(account.id, l.id, { colour }))}
          onRename={(name) => run(() => api.updateLabel(account.id, l.id, { name }))}
          onDelete={() => run(() => api.deleteLabel(account.id, l.id))}
        />
      ))}
      <Item title="New label" description={gmail ? 'Creates a Gmail label.' : 'Saved on the server when you first use it.'}>
        <span className="st-key-form">
          <input
            className="st-input lbl-input"
            placeholder="Label name"
            aria-label={`New label for ${account.description}`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
          <button className="btn" disabled={!newName.trim() || busy} onClick={() => void create()}>
            <Plus size={13} /> Create
          </button>
        </span>
      </Item>
      {error && <div className="form-error lbl-error">{error}</div>}
    </Group>
  )
}

function LabelRow({
  label,
  gmail,
  busy,
  onColour,
  onRename,
  onDelete
}: {
  label: LabelInfo
  gmail: boolean
  busy: boolean
  onColour: (c: LabelColour) => Promise<boolean>
  onRename: (name: string) => Promise<boolean>
  onDelete: () => Promise<boolean>
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  const description = confirm
    ? gmail
      ? `Delete “${label.name}” from Gmail? It comes off every message; the messages stay in All Mail.`
      : `Delete “${label.name}”? It comes off every message on the server.`
    : gmail
      ? 'Gmail label'
      : /^\$label[1-5]$/.test(label.id)
        ? `Keyword ${label.id}, shared with Thunderbird`
        : `Keyword ${label.id}`

  const saveName = async () => {
    const name = renaming?.trim()
    if (!name || name === label.name) return setRenaming(null)
    if (await onRename(name)) setRenaming(null)
  }

  if (renaming !== null) {
    return (
      <Item title="Rename label" description={gmail ? 'Renames the label in Gmail too.' : 'Only the name WinMail shows changes.'}>
        <span className="st-key-form">
          <input
            className="st-input lbl-input"
            autoFocus
            aria-label="Label name"
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveName()
              if (e.key === 'Escape') {
                e.stopPropagation()
                setRenaming(null)
              }
            }}
          />
          <button className="btn" onClick={() => setRenaming(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !renaming.trim()} onClick={() => void saveName()}>
            Save
          </button>
        </span>
      </Item>
    )
  }

  return (
    <Item title={label.name} description={description}>
      {confirm ? (
        <>
          <button className="btn" disabled={busy} onClick={() => setConfirm(false)}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={busy} onClick={() => void onDelete().then((ok) => ok || setConfirm(false))}>
            Delete
          </button>
        </>
      ) : (
        <>
          <button
            className="btn lbl-colour"
            title="Colour"
            aria-label={`Colour: ${COLOUR_NAMES[label.colour]}`}
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({ x: r.left, y: r.bottom + 4 })
            }}
          >
            <LabelDot colour={label.colour} size={12} />
            {COLOUR_NAMES[label.colour]}
          </button>
          <button className="sq-btn lbl-btn" title="Rename" aria-label={`Rename ${label.name}`} onClick={() => setRenaming(label.name)}>
            <Pencil size={13} />
          </button>
          <button className="sq-btn lbl-btn is-danger" title="Delete" aria-label={`Delete ${label.name}`} onClick={() => setConfirm(true)}>
            <Trash2 size={13} />
          </button>
        </>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={LABEL_COLOURS.map((c) => ({
            label: COLOUR_NAMES[c],
            icon: <LabelDot colour={c} size={11} />,
            shortcut: c === label.colour ? '✓' : undefined,
            onSelect: () => void onColour(c)
          }))}
          onClose={() => setMenu(null)}
        />
      )}
    </Item>
  )
}
