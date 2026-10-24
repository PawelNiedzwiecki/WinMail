import {
  AlarmClock,
  Inbox,
  Flag,
  File,
  Send,
  ShieldAlert,
  Trash2,
  Archive,
  Folder,
  Mails,
  ChevronDown,
  Settings,
  Plus,
  TriangleAlert,
  Clock,
  type LucideIcon
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Account, MailboxInfo, SpecialUse } from '@shared/types'
import { Collapse } from './Collapse'

export type Selection = { kind: 'all-inboxes' } | { kind: 'mailbox'; accountId: string; path: string }

const ICONS: Record<SpecialUse, LucideIcon> = {
  inbox: Inbox,
  drafts: File,
  sent: Send,
  junk: ShieldAlert,
  trash: Trash2,
  archive: Archive,
  all: Mails,
  flagged: Flag,
  snoozed: AlarmClock
}

/** Mailboxes where an unread count is useful. */
const COUNTED = new Set<SpecialUse | null>(['inbox', 'junk', null])

interface Props {
  accounts: Account[]
  mailboxes: Record<string, MailboxInfo[]>
  errors: Record<string, string>
  selection: Selection
  onSelect: (s: Selection) => void
  onOpenSettings: () => void
  onAddAccount: () => void
  /** Messages waiting for Schedule send; the Scheduled entry shows while there are any. */
  scheduledCount: number
  onOpenScheduled: () => void
  /** Right-click on a mailbox. */
  onMailboxMenu: (accountId: string, path: string, x: number, y: number) => void
}

export function inboxPath(boxes: MailboxInfo[] | undefined): string {
  return boxes?.find((b) => b.specialUse === 'inbox')?.path ?? 'INBOX'
}

export function Sidebar(p: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggle = (k: string) => setCollapsed((c) => ({ ...c, [k]: !c[k] }))
  const enabled = p.accounts.filter((a) => a.enabled)

  const isSel = (accountId: string, path: string) =>
    p.selection.kind === 'mailbox' &&
    p.selection.accountId === accountId &&
    p.selection.path === path

  const totalInbox = enabled.reduce((n, a) => {
    const box = p.mailboxes[a.id]?.find((b) => b.specialUse === 'inbox')
    return n + (box?.unseen ?? 0)
  }, 0)

  return (
    <aside className="sidebar">
      <div className="sidebar-drag">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 256 256" aria-hidden>
            <defs>
              <linearGradient id="brand-tile" x1="0" y1="0" x2="0.35" y2="1">
                <stop offset="0" stopColor="#52B4FF" />
                <stop offset="1" stopColor="#0A5BD3" />
              </linearGradient>
            </defs>
            <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#brand-tile)" />
            <rect x="42" y="72" width="172" height="120" rx="16" fill="#fff" />
            <path
              d="M52 84l76 58 76-58"
              fill="none"
              stroke="#0A5BD3"
              strokeOpacity="0.6"
              strokeWidth="14"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="brand-name">Winmail</span>
        </div>
      </div>
      <nav className="sb-scroll">
        {enabled.length > 0 && (
          <Section title="Favourites" open={!collapsed.fav} onToggle={() => toggle('fav')}>
            <Item
              icon={Inbox}
              label="Inbox"
              count={totalInbox}
              selected={p.selection.kind === 'all-inboxes'}
              onClick={() => p.onSelect({ kind: 'all-inboxes' })}
              expander={
                enabled.length > 1
                  ? { open: !collapsed.inboxes, onToggle: () => toggle('inboxes') }
                  : undefined
              }
            />
            <Collapse open={enabled.length > 1 && !collapsed.inboxes}>
              {enabled.map((a) => {
                const path = inboxPath(p.mailboxes[a.id])
                const box = p.mailboxes[a.id]?.find((b) => b.path === path)
                return (
                  <Item
                    key={a.id}
                    icon={Inbox}
                    label={a.description}
                    depth={1}
                    count={box?.unseen}
                    selected={isSel(a.id, path)}
                    onClick={() => p.onSelect({ kind: 'mailbox', accountId: a.id, path })}
                    onContextMenu={(x, y) => p.onMailboxMenu(a.id, path, x, y)}
                  />
                )
              })}
            </Collapse>
            <Collapse open={p.scheduledCount > 0}>
              <Item icon={Clock} label="Scheduled" count={p.scheduledCount} selected={false} onClick={p.onOpenScheduled} />
            </Collapse>
          </Section>
        )}

        {enabled.map((a) => (
          <Section
            key={a.id}
            title={a.description}
            warning={p.errors[a.id]}
            open={!collapsed[a.id]}
            onToggle={() => toggle(a.id)}
          >
            {!p.mailboxes[a.id] && !p.errors[a.id] && <div className="sb-loading" role="status" aria-label="Loading folders">
                {[62, 48, 70, 54].map((w, i) => (
                  <span key={i} className="skel-line" style={{ width: `${w}%` }} />
                ))}
              </div>}
            {p.mailboxes[a.id]?.map((b) => (
              <Item
                key={b.path}
                icon={b.specialUse ? ICONS[b.specialUse] : Folder}
                label={b.name}
                depth={b.depth}
                count={COUNTED.has(b.specialUse) ? b.unseen : 0}
                selected={isSel(a.id, b.path)}
                onClick={() => p.onSelect({ kind: 'mailbox', accountId: a.id, path: b.path })}
                onContextMenu={(x, y) => p.onMailboxMenu(a.id, b.path, x, y)}
              />
            ))}
          </Section>
        ))}
      </nav>
      <div className="sb-footer">
        <button className="sb-footer-btn" title="Add Account" onClick={p.onAddAccount}>
          <Plus size={16} />
        </button>
        <button className="sb-footer-btn" title="Settings (Ctrl+,)" onClick={p.onOpenSettings}>
          <Settings size={16} />
        </button>
      </div>
    </aside>
  )
}

function Item(props: {
  icon: LucideIcon
  label: string
  count?: number
  depth?: number
  selected: boolean
  onClick: () => void
  expander?: { open: boolean; onToggle: () => void }
  onContextMenu?: (x: number, y: number) => void
}) {
  const Icon = props.icon
  return (
    <button
      className={`sb-item ${props.selected ? 'is-selected' : ''}`}
      style={{ paddingLeft: 8 + (props.depth ?? 0) * 16 }}
      onClick={props.onClick}
      onContextMenu={(e) => {
        if (!props.onContextMenu) return
        e.preventDefault()
        props.onContextMenu(e.clientX, e.clientY)
      }}
    >
      <Icon size={16} strokeWidth={1.8} className="sb-icon" />
      <span className="sb-label">{props.label}</span>
      {/* Keyed by the number so it ticks when new mail arrives or a message is read. */}
      {props.count ? (
        <span key={props.count} className="sb-count">
          {props.count}
        </span>
      ) : null}
      {props.expander && (
        <span
          className="sb-expander"
          role="button"
          aria-label={props.expander.open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            props.expander!.onToggle()
          }}
        >
          <ChevronDown
            size={12}
            className="sb-expander-chevron"
            style={{ transform: props.expander.open ? 'none' : 'rotate(-90deg)' }}
          />
        </span>
      )}
    </button>
  )
}

function Section(props: {
  title: string
  open: boolean
  warning?: string
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="sb-section">
      <button className="sb-section-title" onClick={props.onToggle}>
        <span className="sb-section-name">
          {props.title}
          {props.warning && (
            <span title={props.warning} className="sb-warning">
              <TriangleAlert size={12} />
            </span>
          )}
        </span>
        <ChevronDown
          size={12}
          className="sb-chevron"
          style={{ transform: props.open ? 'none' : 'rotate(-90deg)' }}
        />
      </button>
      <Collapse open={props.open}>
        {props.children}
        {props.warning && <div className="sb-error">{props.warning}</div>}
      </Collapse>
    </div>
  )
}
