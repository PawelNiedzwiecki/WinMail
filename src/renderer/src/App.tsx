import {
  Archive,
  Flag,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  Reply,
  ReplyAll,
  ShieldAlert,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Account,
  MailboxInfo,
  MessageDetail,
  MessageSummary,
  MoveTarget,
  Settings
} from '@shared/types'
import { api } from './api'
import { Sidebar, inboxPath, type Selection } from './components/Sidebar'
import { MessageList } from './components/MessageList'
import { MessageView } from './components/MessageView'
import { Toolbar } from './components/Toolbar'
import { Compose, type Draft } from './components/Compose'
import { AddAccount } from './components/AddAccount'
import { SettingsWindow, type SettingsTab } from './components/SettingsWindow'
import { Welcome } from './components/Welcome'
import { ContextMenu, type MenuItem } from './components/ContextMenu'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Messages fetched per mailbox per page. */
const PAGE = 60

export default function App() {
  const [ready, setReady] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [settings, setSettings] = useState<Settings>({
    checkIntervalMin: 5,
    loadRemoteContent: false,
    appearance: 'system',
    messageAppearance: 'light'
  })
  const [mailboxes, setMailboxes] = useState<Record<string, MailboxInfo[]>>({})
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({})

  const [selection, setSelection] = useState<Selection>({ kind: 'all-inboxes' })
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  /** accountId|path -> new messages being downloaded right now */
  const [incoming, setIncoming] = useState<Record<string, number>>({})
  /** New messages the last check brought in, shown briefly once it finishes. */
  const [arrived, setArrived] = useState(0)
  const arrivedRef = useRef(0)
  const [limit, setLimit] = useState(PAGE)
  const [hasMore, setHasMore] = useState(false)

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [compose, setCompose] = useState<Draft | null>(null)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const [adding, setAdding] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)

  const enabled = useMemo(() => accounts.filter((a) => a.enabled), [accounts])
  const accountById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts])

  const showToast = useCallback((m: string) => {
    setToast(m)
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 6000)
  }, [])

  // ---------- Loading ----------

  const loadAccounts = useCallback(async () => {
    const list = await api.listAccounts()
    setAccounts(list)
    return list
  }, [])

  const loadMailboxes = useCallback(async (list: Account[]) => {
    await Promise.all(
      list
        .filter((a) => a.enabled)
        .map(async (a) => {
          try {
            const boxes = await api.listMailboxes(a.id)
            setMailboxes((m) => ({ ...m, [a.id]: boxes }))
            setAccountErrors(({ [a.id]: _, ...rest }) => rest)
          } catch (e) {
            setAccountErrors((x) => ({ ...x, [a.id]: errMsg(e) }))
          }
        })
    )
  }, [])

  const listReq = useRef(0)
  const loadMessages = useCallback(
    async (
      sel: Selection,
      list: Account[],
      boxes: Record<string, MailboxInfo[]>,
      quiet = false,
      max = PAGE
    ) => {
      const req = ++listReq.current
      if (!quiet) {
        setListLoading(true)
        setListError(null)
      }
      try {
        let result: MessageSummary[]
        let more = false
        const errors: string[] = []
        if (sel.kind === 'all-inboxes') {
          const targets = list.filter((a) => a.enabled)
          const settled = await Promise.allSettled(
            targets.map((a) => api.listMessages(a.id, inboxPath(boxes[a.id]), max))
          )
          result = settled.flatMap((s, i) => {
            if (s.status === 'fulfilled') {
              more ||= s.value.length >= max
              return s.value
            }
            errors.push(`${targets[i]!.description}: ${errMsg(s.reason)}`)
            return []
          })
          result.sort((a, b) => b.date.localeCompare(a.date))
        } else {
          result = await api.listMessages(sel.accountId, sel.path, max)
          more = result.length >= max
        }
        if (req !== listReq.current) return
        setMessages(result)
        setHasMore(more)
        setListError(errors.length ? errors.join('\n') : null)
      } catch (e) {
        if (req === listReq.current) {
          setMessages([])
          setListError(errMsg(e))
        }
      } finally {
        if (req === listReq.current) setListLoading(false)
      }
    },
    []
  )

  // Keep latest values for callbacks that run from timers/events.
  const latest = useRef({ selection, accounts, mailboxes, limit })
  latest.current = { selection, accounts, mailboxes, limit }

  /** `only` limits the folder-count reload to accounts that reported a change. */
  const refresh = useCallback(
    async (quiet = true, only?: Set<string>) => {
      const { selection: sel, accounts: list } = latest.current
      setRefreshing(true)
      setArrived(0)
      arrivedRef.current = 0
      try {
        await loadMailboxes(only ? list.filter((a) => only.has(a.id)) : list)
        await loadMessages(sel, list, latest.current.mailboxes, quiet, latest.current.limit)
      } finally {
        setRefreshing(false)
        setArrived(arrivedRef.current)
      }
    },
    [loadMailboxes, loadMessages]
  )

  useEffect(() => {
    if (!arrived) return
    const t = window.setTimeout(() => setArrived(0), 5000)
    return () => window.clearTimeout(t)
  }, [arrived])

  useEffect(
    () =>
      api.onMailProgress((e) => {
        const box = `${e.accountId}|${e.path}`
        if (e.incoming) arrivedRef.current += e.incoming
        setIncoming(({ [box]: _, ...rest }) => (e.incoming ? { ...rest, [box]: e.incoming } : rest))
      }),
    []
  )

  // Initial load
  useEffect(() => {
    ;(async () => {
      const [list, s] = await Promise.all([loadAccounts(), api.getSettings()])
      setSettings(s)
      setReady(true)
      await loadMailboxes(list)
    })().catch((e) => showToast(errMsg(e)))
  }, [loadAccounts, loadMailboxes, showToast])

  // Reload list when selection or account set changes
  const enabledKey = enabled.map((a) => a.id).join(',')
  const inboxKey = enabled.map((a) => inboxPath(mailboxes[a.id])).join(',')
  useEffect(() => {
    if (!ready) return
    setSelectedKey(null)
    setLimit(PAGE)
    loadMessages(selection, accounts, mailboxes, false, PAGE)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selection, enabledKey, inboxKey])

  // Periodic check
  useEffect(() => {
    if (!settings.checkIntervalMin || !enabled.length) return
    const t = window.setInterval(() => refresh(), settings.checkIntervalMin * 60_000)
    return () => window.clearInterval(t)
  }, [settings.checkIntervalMin, enabled.length, refresh])

  // Push from IMAP IDLE (new mail arrived)
  useEffect(() => {
    let timer: number | undefined
    let changed = new Set<string>()
    const off = api.onMailChanged((e) => {
      changed.add(e.accountId)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const only = changed
        changed = new Set()
        refresh(true, only)
      }, 800)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [refresh])

  // ---------- Selection & detail ----------

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return messages
    return messages.filter((m) =>
      [m.from.name, m.from.email, m.subject, m.preview].some((s) => s.toLowerCase().includes(q))
    )
  }, [messages, query])

  const selected = visible.find((m) => m.key === selectedKey) ?? null

  const adjustUnseen = (m: MessageSummary, delta: number) =>
    setMailboxes((all) => ({
      ...all,
      [m.accountId]: (all[m.accountId] ?? []).map((b) =>
        b.path === m.mailbox ? { ...b, unseen: Math.max(0, b.unseen + delta) } : b
      )
    }))

  const patchMessage = (key: string, patch: Partial<MessageSummary>) => {
    setMessages((list) => list.map((m) => (m.key === key ? { ...m, ...patch } : m)))
    setDetail((d) => (d && d.key === key ? { ...d, ...patch } : d))
  }

  const detailReq = useRef(0)
  useEffect(() => {
    setDetail(null)
    setDetailError(null)
    if (!selected) return
    const req = ++detailReq.current
    const t = window.setTimeout(async () => {
      try {
        const d = await api.getMessage(selected.accountId, selected.mailbox, selected.uid)
        if (req !== detailReq.current) return
        setDetail(d)
        if (!selected.seen) {
          patchMessage(selected.key, { seen: true })
          adjustUnseen(selected, -1)
        }
      } catch (e) {
        if (req === detailReq.current) setDetailError(errMsg(e))
      }
    }, 120) // small delay so arrowing through the list doesn't fetch every message
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key])

  // ---------- Actions ----------

  const moveSelected = async (target: MoveTarget, removed = selected) => {
    if (!removed) return
    const idx = visible.findIndex((m) => m.key === removed.key)
    const next = visible[idx + 1] ?? visible[idx - 1] ?? null
    setMessages((list) => list.filter((m) => m.key !== removed.key))
    setSelectedKey(next?.key ?? null)
    try {
      await api.move(removed.accountId, removed.mailbox, removed.uid, target)
      loadMailboxes([accountById[removed.accountId]!])
    } catch (e) {
      showToast(errMsg(e))
      setMessages((list) => [...list, removed].sort((a, b) => b.date.localeCompare(a.date)))
    }
  }

  const setFlags = async (m: MessageSummary, flags: { seen?: boolean; flagged?: boolean }) => {
    const before = { seen: m.seen, flagged: m.flagged }
    patchMessage(m.key, flags)
    if (flags.seen !== undefined && flags.seen !== m.seen) adjustUnseen(m, flags.seen ? -1 : 1)
    try {
      await api.setFlags(m.accountId, m.mailbox, m.uid, flags)
    } catch (e) {
      patchMessage(m.key, before)
      showToast(errMsg(e))
    }
  }

  const defaultAccountId = () => {
    if (selection.kind === 'mailbox') return selection.accountId
    return enabled[0]?.id ?? ''
  }

  const newMessage = () => {
    if (!enabled.length) return
    setCompose({ accountId: defaultAccountId(), to: '', cc: '', subject: '', body: '' })
  }

  const respond = async (mode: 'reply' | 'all' | 'forward', msg: MessageSummary | null = selected) => {
    if (!msg) return
    // The body may not be loaded yet, e.g. when replying straight from the context menu.
    const src =
      detail && detail.key === msg.key
        ? detail
        : await api.getMessage(msg.accountId, msg.mailbox, msg.uid).catch(() => null)
    const acc = accountById[msg.accountId]
    const text = src?.text ?? msg.preview
    const when = new Date(msg.date).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    const fmt = (a: { name: string; email: string }) => (a.name ? `${a.name} <${a.email}>` : a.email)
    const strip = (s: string) => s.replace(/^((re|fwd?|aw|wg):\s*)+/i, '')

    if (mode === 'forward') {
      setCompose({
        accountId: msg.accountId,
        to: '',
        cc: '',
        subject: `Fwd: ${strip(msg.subject)}`,
        body: `\n\nBegin forwarded message:\n\nFrom: ${fmt(msg.from)}\nSubject: ${msg.subject}\nDate: ${when}\nTo: ${msg.to.map(fmt).join(', ')}\n\n${text}`
      })
      return
    }

    const same = (a: string, b: string | undefined) => a.toLowerCase() === b?.toLowerCase()
    // Mailing lists and support desks set Reply-To; answers belong there, not to From.
    const to = src?.replyTo.length ? src.replyTo : [msg.from]
    const cc =
      mode === 'all' && src
        ? [...src.to, ...src.cc].filter(
            (a) => !same(a.email, acc?.email) && !to.some((t) => same(a.email, t.email))
          )
        : []
    setCompose({
      accountId: msg.accountId,
      to: to.map((a) => a.email).join(', '),
      cc: cc.map((a) => a.email).join(', '),
      subject: `Re: ${strip(msg.subject)}`,
      body: `\n\nOn ${when}, ${msg.from.name || msg.from.email} wrote:\n\n${text
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}`,
      inReplyTo: src?.messageId ?? undefined,
      references: src ? [...src.references, ...(src.messageId ? [src.messageId] : [])] : undefined
    })
  }

  const send = async (d: Draft) => {
    await api.send({
      accountId: d.accountId,
      to: d.to,
      cc: d.cc,
      subject: d.subject || '(No Subject)',
      text: d.body,
      inReplyTo: d.inReplyTo,
      references: d.references
    })
    setCompose(null)
    if (src(selection)?.specialUse === 'sent') refresh()
  }

  const src = (sel: Selection) =>
    sel.kind === 'mailbox' ? mailboxes[sel.accountId]?.find((b) => b.path === sel.path) : undefined

  const saveAttachment = async (index: number) => {
    if (!selected) return
    try {
      const path = await api.saveAttachment(selected.accountId, selected.mailbox, selected.uid, index)
      if (path) showToast(`Saved to ${path}`)
    } catch (e) {
      showToast(errMsg(e))
    }
  }

  const accountsChanged = async () => {
    const list = await loadAccounts()
    setMailboxes((m) => Object.fromEntries(Object.entries(m).filter(([id]) => list.some((a) => a.id === id))))
    setAccountErrors({})
    if (selection.kind === 'mailbox' && !list.some((a) => a.id === selection.accountId && a.enabled)) {
      setSelection({ kind: 'all-inboxes' })
    }
    await loadMailboxes(list)
  }

  const updateSettings = async (s: Settings) => {
    setSettings(s)
    try {
      setSettings(await api.setSettings(s))
    } catch (e) {
      showToast(errMsg(e))
    }
  }

  const menuItems = (m: MessageSummary): MenuItem[] => {
    const inInbox = m.mailbox === inboxPath(mailboxes[m.accountId])
    return [
      { label: 'Reply', icon: <Reply size={14} />, shortcut: 'Ctrl+R', onSelect: () => respond('reply', m) },
      { label: 'Reply All', icon: <ReplyAll size={14} />, shortcut: 'Ctrl+Shift+R', onSelect: () => respond('all', m) },
      { label: 'Forward', icon: <Forward size={14} />, shortcut: 'Ctrl+Shift+F', onSelect: () => respond('forward', m) },
      'separator',
      {
        label: m.seen ? 'Mark as Unread' : 'Mark as Read',
        icon: m.seen ? <Mail size={14} /> : <MailOpen size={14} />,
        onSelect: () => setFlags(m, { seen: !m.seen })
      },
      {
        label: m.flagged ? 'Unflag' : 'Flag',
        icon: <Flag size={14} />,
        onSelect: () => setFlags(m, { flagged: !m.flagged })
      },
      'separator',
      ...(inInbox
        ? []
        : [{ label: 'Move to Inbox', icon: <Inbox size={14} />, onSelect: () => moveSelected('inbox', m) }]),
      { label: 'Archive', icon: <Archive size={14} />, onSelect: () => moveSelected('archive', m) },
      { label: 'Move to Junk', icon: <ShieldAlert size={14} />, onSelect: () => moveSelected('junk', m) },
      { label: 'Delete', icon: <Trash2 size={14} />, shortcut: 'Del', danger: true, onSelect: () => moveSelected('trash', m) }
    ]
  }
  const menuMessage = menu ? messages.find((m) => m.key === menu.key) : undefined

  // ---------- Keyboard ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (compose || adding || settingsTab) return
      const typing = (e.target as HTMLElement).closest('input, textarea, select')
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === ',') {
        e.preventDefault()
        setSettingsTab('general')
      } else if (mod && k === 'n') {
        e.preventDefault()
        newMessage()
      } else if (mod && e.shiftKey && k === 'r') {
        e.preventDefault()
        respond('all')
      } else if (mod && k === 'r') {
        e.preventDefault()
        respond('reply')
      } else if (mod && e.shiftKey && k === 'f') {
        e.preventDefault()
        respond('forward')
      } else if (mod && k === 'f') {
        e.preventDefault()
        document.getElementById('search')?.focus()
      } else if (typing) {
        return
      } else if (e.key === 'Delete') {
        moveSelected('trash')
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const idx = visible.findIndex((m) => m.key === selectedKey)
        const next = visible[e.key === 'ArrowDown' ? idx + 1 : Math.max(0, idx - 1)]
        if (next) setSelectedKey(next.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---------- Render ----------

  const title =
    selection.kind === 'all-inboxes'
      ? enabled.length > 1
        ? 'All Inboxes'
        : 'Inbox'
      : (src(selection)?.name ?? selection.path)
  const subtitle = selection.kind === 'mailbox' ? accountById[selection.accountId]?.description : undefined
  const labels =
    selection.kind === 'all-inboxes' && enabled.length > 1
      ? Object.fromEntries(enabled.map((a) => [a.id, a.description]))
      : undefined

  const plural = (n: number) => `${n} new ${n === 1 ? 'message' : 'messages'}`
  const downloading = Object.values(incoming).reduce((a, b) => a + b, 0)
  const status = downloading
    ? { busy: true, text: `Downloading ${plural(downloading)}…` }
    : refreshing
      ? { busy: true, text: 'Checking for new mail…' }
      : listLoading && messages.length > 0
        ? { busy: true, text: 'Loading messages…' }
        : arrived
          ? { busy: false, text: plural(arrived) }
          : null

  return (
    <div className="app">
      <Sidebar
        accounts={accounts}
        mailboxes={mailboxes}
        errors={accountErrors}
        selection={selection}
        onSelect={(s) => setSelection(s)}
        onOpenSettings={() => setSettingsTab('general')}
        onAddAccount={() => setAdding(true)}
      />
      <div className="content">
        <Toolbar
          hasAccounts={enabled.length > 0}
          hasSelection={!!selected}
          selectionRead={selected?.seen ?? true}
          refreshing={refreshing}
          query={query}
          onQuery={setQuery}
          onRefresh={() => refresh(false)}
          onCompose={newMessage}
          onArchive={() => moveSelected('archive')}
          onTrash={() => moveSelected('trash')}
          onJunk={() => moveSelected('junk')}
          onReply={() => respond('reply')}
          onReplyAll={() => respond('all')}
          onForward={() => respond('forward')}
          onFlag={() => selected && setFlags(selected, { flagged: !selected.flagged })}
          onToggleRead={() => selected && setFlags(selected, { seen: !selected.seen })}
        />
        {ready && enabled.length === 0 ? (
          <Welcome onAddAccount={() => setAdding(true)} />
        ) : (
          <div className="panes">
            <MessageList
              title={title}
              subtitle={subtitle}
              messages={visible}
              selectedKey={selectedKey}
              loading={!ready || listLoading}
              status={status}
              error={listError}
              accountLabels={labels}
              hasMore={hasMore}
              onSelect={setSelectedKey}
              onContextMenu={(key, x, y) => setMenu({ key, x, y })}
              onLoadMore={() => {
                const next = limit + PAGE
                setLimit(next)
                loadMessages(selection, accounts, mailboxes, false, next)
              }}
            />
            <MessageView
              summary={selected}
              detail={detail && detail.key === selected?.key ? detail : null}
              error={detailError}
              loadRemoteByDefault={settings.loadRemoteContent}
              messageAppearance={settings.messageAppearance}
              onSaveAttachment={saveAttachment}
            />
          </div>
        )}
      </div>

      {compose && (
        <Compose initial={compose} accounts={enabled} onClose={() => setCompose(null)} onSend={send} />
      )}
      {settingsTab && (
        <SettingsWindow
          tab={settingsTab}
          accounts={accounts}
          settings={settings}
          onTab={setSettingsTab}
          onClose={() => setSettingsTab(null)}
          onAddAccount={() => setAdding(true)}
          onAccountsChanged={accountsChanged}
          onSettings={updateSettings}
        />
      )}
      {adding && (
        <AddAccount
          existing={accounts}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false)
            await accountsChanged()
          }}
        />
      )}
      {menu && menuMessage && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menuMessage)} onClose={() => setMenu(null)} />
      )}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
