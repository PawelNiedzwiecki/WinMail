import {
  AlarmClock,
  Archive,
  FileCode,
  Flag,
  FolderInput,
  Forward,
  Inbox,
  Mail,
  MailCheck,
  MailOpen,
  Printer,
  Reply,
  ReplyAll,
  ShieldAlert,
  Sparkles,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  type Account,
  type GmailCategory,
  type MailboxInfo,
  type MessageDetail,
  type MessageSummary,
  type MoveResult,
  type MoveTarget,
  type ScheduledInfo,
  type Settings,
  type Unsubscribe
} from '@shared/types'
import { api } from './api'
import { Sidebar, inboxPath, type Selection } from './components/Sidebar'
import { MessageList } from './components/MessageList'
import { MessageView } from './components/MessageView'
import { Toolbar } from './components/Toolbar'
import { ComposeDock } from './components/compose/ComposeDock'
import { ComposeContext } from './compose/ComposeContext'
import {
  flushAll,
  focusNext,
  leaveInline,
  newMessage as composeNew,
  openFromDrafts,
  openInput,
  reply as composeReply,
  restoreRecovered,
  setComposeEnv,
  startComposeEvents,
  stash
} from './compose/actions'
import { isKey, KEYS } from './compose/keys'
import { useSessionList, type ReplyMode } from './compose/sessions'
import { AddAccount } from './components/AddAccount'
import { SettingsWindow, type SettingsTab } from './components/SettingsWindow'
import { Welcome } from './components/Welcome'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { ToastStack } from './components/ToastStack'
import { FolderPicker } from './components/FolderPicker'
import { WhenPicker } from './components/WhenPicker'
import { SourceDialog } from './components/SourceDialog'
import { ScheduledDialog } from './components/ScheduledDialog'
import { formatWhen } from './compose/schedule'
import { groupThreads, type Thread } from './threads'
import { printDocument } from './print'
import { toast } from './toasts'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const showError = (e: unknown) => toast({ text: errMsg(e), tone: 'error' })

/** Messages fetched per mailbox per page. */
const PAGE = 60
/** Server search waits this long after the last keystroke. */
const SEARCH_DELAY_MS = 400

const CATEGORIES: { id: GmailCategory | null; label: string }[] = [
  { id: null, label: 'All' },
  { id: 'primary', label: 'Primary' },
  { id: 'social', label: 'Social' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'updates', label: 'Updates' },
  { id: 'forums', label: 'Forums' }
]

const MOVED: Record<MoveTarget, string> = {
  trash: 'deleted',
  archive: 'archived',
  junk: 'moved to Junk',
  inbox: 'moved to Inbox'
}

type Dialog =
  | { kind: 'move'; items: MessageSummary[] }
  | { kind: 'snooze'; items: MessageSummary[] }
  | { kind: 'source'; subject: string; source: string }
  | { kind: 'scheduled' }

/** Splits messages by the folder they are in, since IMAP acts on one folder at a time. */
function byFolder(items: MessageSummary[]): { accountId: string; mailbox: string; uids: number[] }[] {
  const groups = new Map<string, { accountId: string; mailbox: string; uids: number[] }>()
  for (const m of items) {
    const k = `${m.accountId}|${m.mailbox}`
    const g = groups.get(k) ?? { accountId: m.accountId, mailbox: m.mailbox, uids: [] }
    g.uids.push(m.uid)
    groups.set(k, g)
  }
  return [...groups.values()]
}

const count = (n: number) => (n === 1 ? 'Message' : `${n} messages`)

export default function App() {
  const [ready, setReady] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
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
  /** Messages whose remote images the reader chose to load. */
  const [remoteKeys, setRemoteKeys] = useState<Set<string>>(new Set())
  const [aiAvailable, setAiAvailable] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const [adding, setAdding] = useState(false)
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const [boxMenu, setBoxMenu] = useState<{ accountId: string; path: string; x: number; y: number } | null>(null)

  /** Every selected row when more than one is; empty while a single message is selected. */
  const [checked, setChecked] = useState<Set<string>>(new Set())
  /** Where a Shift-click range starts. */
  const anchor = useRef<string | null>(null)
  /** Gmail inbox tab; null shows the whole inbox. */
  const [category, setCategory] = useState<GmailCategory | null>(null)
  /** Server search results; null while the search box is empty. */
  const [searchResults, setSearchResults] = useState<MessageSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [scheduled, setScheduled] = useState<ScheduledInfo[]>([])
  /** Messages of the open Gmail conversation from other folders, e.g. your replies in Sent. */
  const [threadExtra, setThreadExtra] = useState<{ key: string; list: MessageSummary[] } | null>(null)
  const [aiSummary, setAiSummary] = useState<{ key: string; text: string | null; error: string | null } | null>(null)
  /** Takes back the last move, for the z shortcut. */
  const lastUndo = useRef<(() => void) | null>(null)
  /** A message to select once the list has loaded, e.g. from a notification. */
  const pendingOpen = useRef<string | null>(null)

  const enabled = useMemo(() => accounts.filter((a) => a.enabled), [accounts])
  const accountById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts])

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
      max = PAGE,
      cat: GmailCategory | null = null
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
          result = cat
            ? await api.search(sel.accountId, sel.path, `category:${cat}`, max)
            : await api.listMessages(sel.accountId, sel.path, max)
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
  const latest = useRef({ selection, accounts, mailboxes, limit, category })
  latest.current = { selection, accounts, mailboxes, limit, category }

  /** `only` limits the folder-count reload to accounts that reported a change. */
  const refresh = useCallback(
    async (quiet = true, only?: Set<string>) => {
      const { selection: sel, accounts: list } = latest.current
      setRefreshing(true)
      setArrived(0)
      arrivedRef.current = 0
      try {
        await loadMailboxes(only ? list.filter((a) => only.has(a.id)) : list)
        await loadMessages(sel, list, latest.current.mailboxes, quiet, latest.current.limit, latest.current.category)
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

  // The window asks before closing so open drafts can be saved first.
  useEffect(
    () =>
      api.onCloseRequested(async () => {
        await flushAll().catch(console.error)
        api.closeReady()
      }),
    []
  )
  // A reload or crash keeps whatever was typed in the recovery copy.
  useEffect(() => {
    window.addEventListener('beforeunload', stash)
    return () => window.removeEventListener('beforeunload', stash)
  }, [])
  // A drop outside a card must not navigate the window to the file; cards and text fields handle their own.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (!(e.target as HTMLElement).closest?.('input, textarea, [contenteditable], [data-compose]')) e.preventDefault()
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => {
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
    }
  }, [])

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
    })().catch(showError)
  }, [loadAccounts, loadMailboxes])

  // Reload list when selection or account set changes
  const enabledKey = enabled.map((a) => a.id).join(',')
  const inboxKey = enabled.map((a) => inboxPath(mailboxes[a.id])).join(',')
  useEffect(() => {
    if (!ready) return
    setSelectedKey(null)
    setChecked(new Set())
    setLimit(PAGE)
    loadMessages(selection, accounts, mailboxes, false, PAGE, category)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selection, enabledKey, inboxKey, category])

  const select = (s: Selection) => {
    setCategory(null)
    setSelection(s)
  }

  // Scheduled sends, for the sidebar entry.
  useEffect(() => {
    const load = () => api.listScheduled().then(setScheduled, () => {})
    load()
    return api.onScheduledChanged(load)
  }, [])

  // A notification was clicked: show that message.
  useEffect(
    () =>
      api.onOpenMessage((e) => {
        const key = `${e.accountId}|${e.path}|${e.uid}`
        const { selection: sel, mailboxes: boxes } = latest.current
        pendingOpen.current = key
        setQuery('')
        if (sel.kind === 'all-inboxes' && e.path === inboxPath(boxes[e.accountId])) void refresh(true)
        else if (sel.kind === 'mailbox' && sel.accountId === e.accountId && sel.path === e.path) void refresh(true)
        else select({ kind: 'mailbox', accountId: e.accountId, path: e.path })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refresh]
  )
  useEffect(() => {
    const key = pendingOpen.current
    if (key && messages.some((m) => m.key === key)) {
      pendingOpen.current = null
      setChecked(new Set())
      setSelectedKey(key)
    }
  }, [messages])

  // Server search: the loaded list is filtered at once, then the server is asked for older matches.
  const searchReq = useRef(0)
  useEffect(() => {
    const q = query.trim()
    const req = ++searchReq.current
    if (q.length < 2) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    const t = window.setTimeout(async () => {
      const { selection: sel, accounts: list, mailboxes: boxes } = latest.current
      const targets =
        sel.kind === 'mailbox'
          ? [{ accountId: sel.accountId, path: sel.path }]
          : list.filter((a) => a.enabled).map((a) => ({ accountId: a.id, path: inboxPath(boxes[a.id]) }))
      setSearching(true)
      const settled = await Promise.allSettled(targets.map((x) => api.search(x.accountId, x.path, q, PAGE)))
      if (req !== searchReq.current) return
      const found = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
      const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
      if (failed && !found.length) showError(failed.reason)
      found.sort((a, b) => b.date.localeCompare(a.date))
      setSearchResults(found)
      setSearching(false)
    }, SEARCH_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [query, selection, enabledKey])

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
    if (searchResults) return searchResults
    return messages.filter((m) =>
      [m.from.name, m.from.email, m.subject, m.preview].some((s) => s.toLowerCase().includes(q))
    )
  }, [messages, query, searchResults])

  /** Conversations, when grouping is on; each message key maps to its conversation. */
  const threads = useMemo(() => {
    const map = new Map<string, Thread>()
    if (!settings.conversations) return map
    for (const t of groupThreads(visible)) for (const m of t.members) map.set(m.key, t)
    return map
  }, [visible, settings.conversations])

  /** One row per conversation: the newest message, unread while any message is, flagged while any is. */
  const rows = useMemo(() => {
    if (!settings.conversations) return visible
    return visible.flatMap((m) => {
      const t = threads.get(m.key)
      if (!t || t.members.length === 1) return [m]
      if (t.latest.key !== m.key) return []
      return [{ ...m, seen: t.members.every((x) => x.seen), flagged: t.members.some((x) => x.flagged) }]
    })
  }, [visible, threads, settings.conversations])
  const threadCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of new Set(threads.values())) if (t.members.length > 1) map.set(t.latest.key, t.members.length)
    return map
  }, [threads])

  const selected = visible.find((m) => m.key === selectedKey) ?? null
  const multi = checked.size > 1

  /** A message and the rest of its conversation, when grouping is on. */
  const withThread = (list: MessageSummary[]) => {
    const out = new Map<string, MessageSummary>()
    for (const m of list) for (const x of threads.get(m.key)?.members ?? [m]) out.set(x.key, x)
    return [...out.values()]
  }

  /** What toolbar buttons and shortcuts act on: every selected row, with whole conversations. */
  const targets = (): MessageSummary[] => {
    const keys = multi ? checked : new Set(selectedKey ? [selectedKey] : [])
    return withThread(visible.filter((m) => keys.has(m.key)))
  }

  const onSelectRow = (key: string, mods?: { toggle: boolean; range: boolean }) => {
    if (mods?.range && anchor.current) {
      const a = rows.findIndex((m) => m.key === anchor.current)
      const b = rows.findIndex((m) => m.key === key)
      if (a >= 0 && b >= 0) {
        const range = rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((m) => m.key)
        setChecked(range.length > 1 ? new Set(range) : new Set())
        setSelectedKey(key)
        return
      }
    }
    if (mods?.toggle) {
      const cur = new Set(multi ? checked : selectedKey ? [selectedKey] : [])
      if (cur.has(key)) cur.delete(key)
      else cur.add(key)
      anchor.current = key
      setChecked(cur.size > 1 ? cur : new Set())
      setSelectedKey(cur.has(key) ? key : ([...cur][0] ?? null))
      return
    }
    anchor.current = key
    setChecked(new Set())
    setSelectedKey(key)
  }

  /** Applies a change to the loaded list and to search results. */
  const mapLists = (fn: (list: MessageSummary[]) => MessageSummary[]) => {
    setMessages(fn)
    setSearchResults((r) => r && fn(r))
  }

  const adjustUnseen = (m: MessageSummary, delta: number) =>
    setMailboxes((all) => ({
      ...all,
      [m.accountId]: (all[m.accountId] ?? []).map((b) =>
        b.path === m.mailbox ? { ...b, unseen: Math.max(0, b.unseen + delta) } : b
      )
    }))

  const patchMessages = (keys: Set<string>, patch: Partial<MessageSummary>) => {
    mapLists((list) => list.map((m) => (keys.has(m.key) ? { ...m, ...patch } : m)))
    setDetail((d) => (d && keys.has(d.key) ? { ...d, ...patch } : d))
  }
  const patchMessage = (key: string, patch: Partial<MessageSummary>) => patchMessages(new Set([key]), patch)

  const detailReq = useRef(0)
  useEffect(() => {
    setDetail(null)
    setDetailError(null)
    if (!selected || multi) return
    const req = ++detailReq.current
    const t = window.setTimeout(async () => {
      try {
        const d = await api.getMessage(selected.accountId, selected.mailbox, selected.uid)
        if (req !== detailReq.current) return
        setDetail(d)
        // Opening a conversation reads all of it, as in Gmail; getMessage already marked this one.
        const unread = withThread([selected]).filter((m) => !m.seen)
        if (unread.length) {
          patchMessages(new Set(unread.map((m) => m.key)), { seen: true })
          unread.forEach((m) => adjustUnseen(m, -1))
          const others = unread.filter((m) => m.key !== selected.key)
          for (const g of byFolder(others)) void api.setFlags(g.accountId, g.mailbox, g.uids, { seen: true }).catch(showError)
        }
      } catch (e) {
        if (req === detailReq.current) setDetailError(errMsg(e))
      }
    }, 120) // small delay so arrowing through the list doesn't fetch every message
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key, multi])

  // Gmail keeps your replies in Sent; fetch the whole conversation from All Mail.
  useEffect(() => {
    const threadId = selected?.threadId
    if (!settings.conversations || !selected || !threadId || multi) return
    const key = selected.key
    let live = true
    api
      .listThread(selected.accountId, threadId)
      .then((list) => live && setThreadExtra({ key, list }))
      .catch(() => {})
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key, settings.conversations, multi])

  /** The open conversation's other messages, oldest first; the same message in two folders shows once. */
  const threadAbove = useMemo(() => {
    if (!selected || !settings.conversations) return []
    const seen = new Set<string>([selected.messageId ?? selected.key])
    const out: MessageSummary[] = []
    const extra = threadExtra?.key === selected.key ? threadExtra.list : []
    for (const m of [...(threads.get(selected.key)?.members ?? []), ...extra]) {
      const id = m.messageId ?? m.key
      if (seen.has(id)) continue
      seen.add(id)
      out.push(m)
    }
    return out.filter((m) => m.date <= selected.date).sort((a, b) => a.date.localeCompare(b.date))
  }, [selected, threads, threadExtra, settings.conversations])

  // ---------- Actions ----------

  /** Removes messages from the list and moves the selection to the next row. */
  const takeOut = (items: MessageSummary[]) => {
    const keys = new Set(items.map((m) => m.key))
    const idx = rows.findIndex((m) => keys.has(m.key) || checked.has(m.key))
    const next = rows.slice(idx + 1).find((m) => !keys.has(m.key) && !checked.has(m.key)) ??
      rows.slice(0, Math.max(0, idx)).reverse().find((m) => !keys.has(m.key))
    mapLists((list) => list.filter((m) => !keys.has(m.key)))
    setChecked(new Set())
    setSelectedKey(next?.key ?? null)
    anchor.current = next?.key ?? null
    return keys
  }
  const putBack = (items: MessageSummary[]) =>
    mapLists((list) => [...list, ...items].sort((a, b) => b.date.localeCompare(a.date)))

  const folderName = (accountId: string, path: string) =>
    mailboxes[accountId]?.find((b) => b.path === path)?.name ?? path

  /** Moves messages to a special folder or any folder, with Undo. */
  const moveMessages = async (items: MessageSummary[], to: MoveTarget | { path: string }) => {
    if (!items.length) return
    takeOut(items)
    const done: { accountId: string; from: string; res: MoveResult }[] = []
    try {
      for (const g of byFolder(items)) {
        const res =
          typeof to === 'string'
            ? await api.move(g.accountId, g.mailbox, g.uids, to)
            : await api.moveTo(g.accountId, g.mailbox, g.uids, to.path)
        if (res && res.uids.length) done.push({ accountId: g.accountId, from: g.mailbox, res })
      }
    } catch (e) {
      showError(e)
      putBack(items)
      void refresh(true, new Set(items.map((m) => m.accountId)))
      return
    }
    const accountIds = new Set(items.map((m) => m.accountId))
    void loadMailboxes(accounts.filter((a) => accountIds.has(a.id)))
    const what = typeof to === 'string' ? MOVED[to] : `moved to ${folderName(items[0]!.accountId, to.path)}`
    const undo = done.length
      ? async () => {
          lastUndo.current = null
          try {
            for (const d of done) await api.moveTo(d.accountId, d.res.path, d.res.uids, d.from)
            toast('Move undone')
          } catch (e) {
            showError(e)
          }
          void refresh(true, accountIds)
        }
      : null
    lastUndo.current = undo
    toast({ text: `${count(items.length)} ${what}`, actions: undo ? [{ label: 'Undo', run: () => void undo() }] : [] })
  }

  const snoozeMessages = async (items: MessageSummary[], at: Date) => {
    if (!items.length) return
    takeOut(items)
    try {
      for (const g of byFolder(items)) await api.snooze(g.accountId, g.mailbox, g.uids, at.toISOString())
      lastUndo.current = null
      toast(`${count(items.length)} snoozed until ${formatWhen(at)}`)
    } catch (e) {
      showError(e)
      putBack(items)
    }
    const accountIds = new Set(items.map((m) => m.accountId))
    void loadMailboxes(accounts.filter((a) => accountIds.has(a.id)))
  }

  const setFlagsMany = async (items: MessageSummary[], flags: { seen?: boolean; flagged?: boolean }) => {
    const changed = items.filter(
      (m) => (flags.seen !== undefined && m.seen !== flags.seen) || (flags.flagged !== undefined && m.flagged !== flags.flagged)
    )
    if (!changed.length) return
    const before = changed.map((m) => ({ key: m.key, seen: m.seen, flagged: m.flagged }))
    patchMessages(new Set(changed.map((m) => m.key)), flags)
    if (flags.seen !== undefined) for (const m of changed) if (m.seen !== flags.seen) adjustUnseen(m, flags.seen ? -1 : 1)
    try {
      for (const g of byFolder(changed)) await api.setFlags(g.accountId, g.mailbox, g.uids, flags)
    } catch (e) {
      for (const b of before) patchMessage(b.key, { seen: b.seen, flagged: b.flagged })
      showError(e)
    }
  }

  /** Toggles read or flagged for the selection: all read (or flagged) turns it off, else on. */
  const toggleSeen = (items = targets()) => items.length && setFlagsMany(items, { seen: !items.every((m) => m.seen) })
  const toggleFlag = (items = targets()) => items.length && setFlagsMany(items, { flagged: !items.some((m) => m.flagged) })

  const markAllRead = async (accountId: string, path: string) => {
    try {
      await api.markAllRead(accountId, path)
      mapLists((list) => list.map((m) => (m.accountId === accountId && m.mailbox === path ? { ...m, seen: true } : m)))
      setMailboxes((all) => ({
        ...all,
        [accountId]: (all[accountId] ?? []).map((b) => (b.path === path ? { ...b, unseen: 0 } : b))
      }))
    } catch (e) {
      showError(e)
    }
  }

  /** Move to… lists one account's folders, so the selection must be in one account. */
  const oneAccount = (items: MessageSummary[]) => items.length > 0 && items.every((m) => m.accountId === items[0]!.accountId)
  const askMove = (items = targets()) => oneAccount(items) && setDialog({ kind: 'move', items })
  const askSnooze = (items = targets()) => items.length && setDialog({ kind: 'snooze', items })

  const defaultAccountId = () => {
    if (selection.kind === 'mailbox') return selection.accountId
    return enabled[0]?.id ?? ''
  }

  const isDraftsBox = (m: MessageSummary) =>
    mailboxes[m.accountId]?.find((b) => b.path === m.mailbox)?.specialUse === 'drafts'

  const newMessage = () => {
    if (enabled.length) composeNew()
  }

  const respond = (mode: ReplyMode, msg: MessageSummary | null = selected) => {
    if (!msg) return
    if (isDraftsBox(msg)) return void openFromDrafts(msg)
    const d = detail && detail.key === msg.key ? detail : null
    void composeReply(mode, msg, d, settings.loadRemoteContent || remoteKeys.has(msg.key))
  }

  const src = (sel: Selection) =>
    sel.kind === 'mailbox' ? mailboxes[sel.accountId]?.find((b) => b.path === sel.path) : undefined

  const saveAttachment = async (index: number) => {
    if (!selected) return
    try {
      const path = await api.saveAttachment(selected.accountId, selected.mailbox, selected.uid, index)
      if (path) toast(`Saved to ${path}`)
    } catch (e) {
      showError(e)
    }
  }

  const allowRemoteFor = (m: MessageSummary | null) => settings.loadRemoteContent || (!!m && remoteKeys.has(m.key))

  const printMessage = async () => {
    if (!detail) return
    try {
      await api.print(printDocument(detail, allowRemoteFor(selected)))
    } catch (e) {
      showError(e)
    }
  }

  const showOriginal = async () => {
    if (!selected) return
    try {
      const source = await api.getSource(selected.accountId, selected.mailbox, selected.uid)
      setDialog({ kind: 'source', subject: selected.subject, source })
    } catch (e) {
      showError(e)
    }
  }

  const summarise = async () => {
    if (!detail) return
    const key = detail.key
    setAiSummary({ key, text: null, error: null })
    try {
      const text = await api.ai({
        task: 'summarise',
        from: detail.from.name ? `${detail.from.name} <${detail.from.email}>` : detail.from.email,
        subject: detail.subject,
        text: detail.text
      })
      setAiSummary((s) => (s?.key === key ? { key, text, error: null } : s))
    } catch (e) {
      setAiSummary((s) => (s?.key === key ? { key, text: null, error: errMsg(e) } : s))
    }
  }

  const unsubscribe = async (u: Unsubscribe) => {
    if (!selected) return
    const sender = selected.from.name || selected.from.email
    if (u.oneClick && u.url) {
      const id = toast({ text: `Unsubscribing from ${sender}…`, busy: true, duration: 0 })
      try {
        await api.unsubscribe(u.url)
        toast({ id, text: `Unsubscribed from ${sender}` })
      } catch (e) {
        toast({ id, text: errMsg(e), tone: 'error' })
      }
    } else if (u.mailto) {
      // mailto:list@example.com?subject=unsubscribe&body=...
      const url = new URL(u.mailto)
      const to = decodeURIComponent(url.pathname)
      openInput(
        {
          accountId: selected.accountId,
          to,
          subject: url.searchParams.get('subject') ?? 'unsubscribe',
          text: url.searchParams.get('body') ?? 'unsubscribe'
        },
        true
      )
      toast('Send this message to unsubscribe')
    } else if (u.url) {
      window.open(u.url, '_blank')
    }
  }

  const moreItems = (): MenuItem[] => [
    { label: 'Print…', icon: <Printer size={14} />, disabled: !detail, onSelect: () => void printMessage() },
    { label: 'Show Original', icon: <FileCode size={14} />, onSelect: () => void showOriginal() },
    ...(aiAvailable
      ? [{ label: 'Summarise', icon: <Sparkles size={14} />, disabled: !detail, onSelect: () => void summarise() }]
      : []),
    'separator',
    { label: 'Move to…', icon: <FolderInput size={14} />, shortcut: settings.gmailShortcuts ? 'V' : undefined, onSelect: () => askMove() },
    { label: 'Snooze…', icon: <AlarmClock size={14} />, shortcut: settings.gmailShortcuts ? 'B' : undefined, onSelect: () => askSnooze() }
  ]

  const accountsChanged = async () => {
    const list = await loadAccounts()
    setMailboxes((m) => Object.fromEntries(Object.entries(m).filter(([id]) => list.some((a) => a.id === id))))
    setAccountErrors({})
    if (selection.kind === 'mailbox' && !list.some((a) => a.id === selection.accountId && a.enabled)) {
      select({ kind: 'all-inboxes' })
    }
    await loadMailboxes(list)
  }

  const updateSettings = async (s: Settings) => {
    setSettings(s)
    try {
      setSettings(await api.setSettings(s))
    } catch (e) {
      showError(e)
    }
  }

  const menuItems = (m: MessageSummary): MenuItem[] => {
    // A row inside a multiple selection acts on all of it; any other row on its conversation.
    const items = checked.has(m.key) ? targets() : withThread([m])
    const n = items.length
    const inInbox = items.every((x) => x.mailbox === inboxPath(mailboxes[x.accountId]))
    const allSeen = items.every((x) => x.seen)
    const anyFlagged = items.some((x) => x.flagged)
    const single = n === 1 || !checked.has(m.key)
    return [
      ...(single
        ? ([
            { label: 'Reply', icon: <Reply size={14} />, shortcut: 'Ctrl+R', onSelect: () => respond('reply', m) },
            { label: 'Reply All', icon: <ReplyAll size={14} />, shortcut: 'Ctrl+Shift+R', onSelect: () => respond('all', m) },
            { label: 'Forward', icon: <Forward size={14} />, shortcut: 'Ctrl+Shift+F', onSelect: () => respond('forward', m) },
            'separator'
          ] as MenuItem[])
        : []),
      {
        label: allSeen ? 'Mark as Unread' : 'Mark as Read',
        icon: allSeen ? <Mail size={14} /> : <MailOpen size={14} />,
        onSelect: () => setFlagsMany(items, { seen: !allSeen })
      },
      {
        label: anyFlagged ? 'Unflag' : 'Flag',
        icon: <Flag size={14} />,
        onSelect: () => setFlagsMany(items, { flagged: !anyFlagged })
      },
      'separator',
      ...(inInbox
        ? []
        : [{ label: 'Move to Inbox', icon: <Inbox size={14} />, onSelect: () => moveMessages(items, 'inbox') }]),
      { label: 'Archive', icon: <Archive size={14} />, onSelect: () => moveMessages(items, 'archive') },
      {
        label: 'Move to…',
        icon: <FolderInput size={14} />,
        disabled: !oneAccount(items),
        onSelect: () => askMove(items)
      },
      { label: 'Snooze…', icon: <AlarmClock size={14} />, onSelect: () => askSnooze(items) },
      { label: 'Move to Junk', icon: <ShieldAlert size={14} />, onSelect: () => moveMessages(items, 'junk') },
      { label: 'Delete', icon: <Trash2 size={14} />, shortcut: 'Del', danger: true, onSelect: () => moveMessages(items, 'trash') }
    ]
  }
  const menuMessage = menu ? visible.find((m) => m.key === menu.key) : undefined

  // ---------- Compose ----------

  const sessionEntries = useSessionList()
  const inlineReplyId =
    sessionEntries.find((e) => e.host === 'inline' && !e.hidden && e.replyKey === selected?.key)?.id ?? null
  const draftKeys = useMemo(
    () => new Set(sessionEntries.flatMap((e) => (e.replyKey && !e.hidden ? [e.replyKey] : []))),
    [sessionEntries]
  )

  setComposeEnv({
    accounts: enabled,
    settings,
    defaultAccountId,
    refreshIfShowing: (accountId, use) => {
      const { selection: sel, mailboxes: boxes } = latest.current
      if (
        sel.kind === 'mailbox' &&
        sel.accountId === accountId &&
        boxes[accountId]?.find((b) => b.path === sel.path)?.specialUse === use
      ) {
        refresh()
      }
    },
    selectMailbox: (accountId, use) => {
      const path = latest.current.mailboxes[accountId]?.find((b) => b.specialUse === use)?.path
      if (path) setSelection({ kind: 'mailbox', accountId, path })
    },
    setSettings: updateSettings,
    focusList: () => document.querySelector<HTMLElement>('.row.is-selected, .list-scroll')?.focus(),
    selectedKey: () => selectedKey
  })

  // An inline reply belongs to the message it answers: once another message is shown, an edited
  // reply moves to the dock and an untouched one is dropped.
  useEffect(() => {
    for (const e of sessionEntries) {
      if (e.host === 'inline' && !e.hidden && e.replyKey !== selected?.key) leaveInline(e.id)
    }
  }, [sessionEntries, selected?.key])

  useEffect(() => startComposeEvents(), [])
  const recovered = useRef(false)
  useEffect(() => {
    if (!ready || recovered.current || !enabled.length) return
    recovered.current = true
    restoreRecovered()
  }, [ready, enabled.length])
  useEffect(() => {
    api
      .aiAvailable()
      .then(setAiAvailable)
      .catch(() => setAiAvailable(false))
  }, [settingsTab])

  // ---------- Keyboard ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (adding || settingsTab || dialog || e.defaultPrevented) return
      const t = e.target as HTMLElement
      // Portals of a card (menus, pickers) count as the card, so their keys never reach the list.
      const inCompose = !!t.closest?.('.compose, [data-compose], [data-compose-popup]')
      const typing = inCompose || t.isContentEditable || !!t.closest?.('input, textarea, select')
      if (isKey(e, KEYS.settings)) {
        e.preventDefault()
        setSettingsTab('general')
      } else if (isKey(e, KEYS.newMessage)) {
        e.preventDefault()
        newMessage()
      } else if (isKey(e, KEYS.nextCompose)) {
        e.preventDefault()
        focusNext()
      } else if (inCompose) {
        return // the card handles its own keys, including Ctrl+Shift+F (From) and Ctrl+R
      } else if (isKey(e, KEYS.replyAll)) {
        e.preventDefault()
        respond('all')
      } else if (isKey(e, KEYS.reply)) {
        e.preventDefault()
        respond('reply')
      } else if (isKey(e, KEYS.forward)) {
        e.preventDefault()
        respond('forward')
      } else if (isKey(e, KEYS.search)) {
        e.preventDefault()
        document.getElementById('search')?.focus()
      } else if (typing) {
        return
      } else if (e.key === 'Enter' && selected && isDraftsBox(selected)) {
        e.preventDefault()
        void openFromDrafts(selected)
      } else if (e.key === 'Delete') {
        void moveMessages(targets(), 'trash')
      } else if (e.key === 'Escape' && multi) {
        setChecked(new Set())
      } else if (isKey(e, { key: 'a', ctrl: true })) {
        e.preventDefault()
        if (rows.length > 1) setChecked(new Set(rows.map((m) => m.key)))
        if (!selectedKey && rows[0]) setSelectedKey(rows[0].key)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        step(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey)
      } else if (settings.gmailShortcuts) {
        gmailKey(e)
      }
    }
    /** Moves the selection one row; with Shift, extends the selection instead. */
    const step = (dir: 1 | -1, extend = false) => {
      const idx = rows.findIndex((m) => m.key === selectedKey)
      const next = rows[idx < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, idx + dir))]
      if (!next) return
      if (extend) onSelectRow(next.key, { toggle: false, range: true })
      else onSelectRow(next.key)
    }
    // Gmail's single-key shortcuts; letters by e.key, symbols by physical key, never with Ctrl or Alt.
    const gmailKey = (e: KeyboardEvent) => {
      const run = (fn: () => unknown) => {
        e.preventDefault()
        fn()
      }
      if (isKey(e, { key: 'j' })) run(() => step(1))
      else if (isKey(e, { key: 'k' })) run(() => step(-1))
      else if (isKey(e, { key: 'e' })) run(() => moveMessages(targets(), 'archive'))
      else if (isKey(e, { code: 'Digit3', shift: true })) run(() => moveMessages(targets(), 'trash'))
      else if (isKey(e, { code: 'Digit1', shift: true })) run(() => moveMessages(targets(), 'junk'))
      else if (isKey(e, { key: 'r' })) run(() => respond('reply'))
      else if (isKey(e, { key: 'a' })) run(() => respond('all'))
      else if (isKey(e, { key: 'f' })) run(() => respond('forward'))
      else if (isKey(e, { key: 's' })) run(() => toggleFlag())
      else if (isKey(e, { key: 'i', shift: true })) run(() => setFlagsMany(targets(), { seen: true }))
      else if (isKey(e, { key: 'u', shift: true })) run(() => setFlagsMany(targets(), { seen: false }))
      else if (isKey(e, { key: 'x' })) run(() => selectedKey && onSelectRow(selectedKey, { toggle: true, range: false }))
      else if (isKey(e, { key: 'b' })) run(() => askSnooze())
      else if (isKey(e, { key: 'v' })) run(() => askMove())
      else if (isKey(e, { key: 'z' })) run(() => lastUndo.current?.())
      else if (isKey(e, { key: 'c' })) run(newMessage)
      else if (isKey(e, { code: 'Slash' })) run(() => document.getElementById('search')?.focus())
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

  const box = src(selection)
  const gmailInbox =
    selection.kind === 'mailbox' &&
    accountById[selection.accountId]?.provider === 'gmail' &&
    box?.specialUse === 'inbox'
  const categoryTabs = gmailInbox ? (
    <div className="cat-tabs" role="tablist">
      {CATEGORIES.map((c) => (
        <button
          key={c.label}
          role="tab"
          aria-selected={category === c.id}
          className={`cat-tab ${category === c.id ? 'is-active' : ''}`}
          onClick={() => setCategory(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  ) : undefined

  const plural = (n: number) => `${n} new ${n === 1 ? 'message' : 'messages'}`
  const downloading = Object.values(incoming).reduce((a, b) => a + b, 0)
  const status = searching
    ? { busy: true, text: 'Searching the server…' }
    : downloading
    ? { busy: true, text: `Downloading ${plural(downloading)}…` }
    : refreshing
      ? { busy: true, text: 'Checking for new mail…' }
      : listLoading && messages.length > 0
        ? { busy: true, text: 'Loading messages…' }
        : arrived
          ? { busy: false, text: plural(arrived) }
          : null

  const app = (
    <div className="app">
      <Sidebar
        accounts={accounts}
        mailboxes={mailboxes}
        errors={accountErrors}
        selection={selection}
        onSelect={select}
        onOpenSettings={() => setSettingsTab('general')}
        onAddAccount={() => setAdding(true)}
        scheduledCount={scheduled.length}
        onOpenScheduled={() => setDialog({ kind: 'scheduled' })}
        onMailboxMenu={(accountId, path, x, y) => setBoxMenu({ accountId, path, x, y })}
      />
      <div className="content">
        <Toolbar
          hasAccounts={enabled.length > 0}
          hasSelection={!!selected || multi}
          selectionRead={targets().every((m) => m.seen)}
          refreshing={refreshing}
          query={query}
          onQuery={setQuery}
          onRefresh={() => refresh(false)}
          onCompose={newMessage}
          onArchive={() => moveMessages(targets(), 'archive')}
          onTrash={() => moveMessages(targets(), 'trash')}
          onJunk={() => moveMessages(targets(), 'junk')}
          onMove={() => askMove()}
          onSnooze={() => askSnooze()}
          canMove={oneAccount(targets())}
          onReply={() => respond('reply')}
          onReplyAll={() => respond('all')}
          onForward={() => respond('forward')}
          onFlag={() => toggleFlag()}
          onToggleRead={() => toggleSeen()}
        />
        {ready && enabled.length === 0 ? (
          <Welcome onAddAccount={() => setAdding(true)} />
        ) : (
          <div className="panes">
            <MessageList
              title={title}
              subtitle={subtitle}
              messages={rows}
              selectedKey={selectedKey}
              checkedKeys={checked}
              threadCounts={threadCounts}
              tabs={categoryTabs}
              loading={!ready || listLoading}
              status={status}
              error={listError}
              accountLabels={labels}
              hasMore={hasMore && !searchResults}
              draftKeys={draftKeys}
              onSelect={onSelectRow}
              onOpen={(key) => {
                const m = visible.find((x) => x.key === key)
                if (m && isDraftsBox(m)) void openFromDrafts(m)
              }}
              onContextMenu={(key, x, y) => setMenu({ key, x, y })}
              onLoadMore={() => {
                const next = limit + PAGE
                setLimit(next)
                loadMessages(selection, accounts, mailboxes, false, next, category)
              }}
            />
            <MessageView
              summary={selected}
              detail={detail && detail.key === selected?.key ? detail : null}
              error={detailError}
              allowRemote={allowRemoteFor(selected)}
              onAllowRemote={() => selected && setRemoteKeys((k) => new Set(k).add(selected.key))}
              messageAppearance={settings.messageAppearance}
              onSaveAttachment={saveAttachment}
              inlineReplyId={inlineReplyId}
              isDraft={!!selected && isDraftsBox(selected)}
              onReply={(mode) => respond(mode)}
              onEditDraft={() => selected && void openFromDrafts(selected)}
              thread={threadAbove}
              multiCount={multi ? checked.size : 0}
              moreItems={moreItems}
              aiSummary={aiSummary && aiSummary.key === selected?.key ? aiSummary : null}
              onCloseSummary={() => setAiSummary(null)}
              onUnsubscribe={unsubscribe}
            />
          </div>
        )}
      </div>

      <ComposeDock />
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
      {boxMenu && (
        <ContextMenu
          x={boxMenu.x}
          y={boxMenu.y}
          items={[
            {
              label: 'Mark All as Read',
              icon: <MailCheck size={14} />,
              onSelect: () => void markAllRead(boxMenu.accountId, boxMenu.path)
            }
          ]}
          onClose={() => setBoxMenu(null)}
        />
      )}
      {dialog?.kind === 'move' && (
        <FolderPicker
          mailboxes={mailboxes[dialog.items[0]!.accountId] ?? []}
          current={dialog.items[0]!.mailbox}
          onPick={(path) => void moveMessages(dialog.items, { path })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'snooze' && (
        <WhenPicker
          title={`Snooze ${dialog.items.length === 1 ? 'until' : `${dialog.items.length} messages until`}`}
          onPick={(at) => void snoozeMessages(dialog.items, at)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'source' && (
        <SourceDialog subject={dialog.subject} source={dialog.source} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'scheduled' && (
        <ScheduledDialog items={scheduled} accounts={accounts} onClose={() => setDialog(null)} />
      )}
      <ToastStack />
    </div>
  )

  return <ComposeContext.Provider value={{ accounts: enabled, settings, aiAvailable }}>{app}</ComposeContext.Provider>
}
