import {
  AlarmClock,
  Archive,
  FileCode,
  Flag,
  FolderInput,
  Forward,
  Inbox,
  Info,
  Mail,
  MailCheck,
  MailOpen,
  MessagesSquare,
  Printer,
  Reply,
  ReplyAll,
  ShieldAlert,
  Sparkles,
  Tag,
  Trash2,
  User,
  UserMinus,
  UserPlus,
  Users
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  DEFAULT_SETTINGS,
  type Account,
  type AccountLabels,
  type Address,
  type Contact,
  type DeliveredItem,
  type DeliveryRecord,
  type DeliveryState,
  type GmailCategory,
  type LabelChange,
  type LabelInfo,
  type MailboxInfo,
  type MailQuery,
  type InviteAnswer,
  type MessageDetail,
  type MessageSummary,
  type MoveResult,
  type MoveTarget,
  type ScheduledInfo,
  type Settings,
  type Unsubscribe,
  type WaitingInfo
} from '@shared/types'
import { optedIn } from '@shared/contentFeatures'
import { categorize } from '@shared/categorize'
import { advance, isHeld, isVip, vipAddresses, type HoldRule } from '@shared/delivery'
import { api } from './api'
import { Sidebar, inboxPath, type Selection } from './components/Sidebar'
import { MessageList } from './components/MessageList'
import { MessageView, type AiSummaryState } from './components/MessageView'
import { Toolbar } from './components/Toolbar'
import { AiSearchBar } from './components/AiSearchBar'
import { ActionBar } from './components/ActionBar'
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
  startPopoutEvents,
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
import { LabelPicker } from './components/LabelPicker'
import { labelsFor } from './components/LabelChips'
import { WhenPicker } from './components/WhenPicker'
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog'
import { SourceDialog } from './components/SourceDialog'
import { ScheduledDialog } from './components/ScheduledDialog'
import { WaitingDialog, startFollowUp } from './components/WaitingDialog'
import { DeliveryBar } from './components/DeliveryBar'
import { BriefCard, type BriefParagraph } from './components/BriefCard'
import { makeBrief } from '@shared/brief'
import { formatWhen } from './compose/schedule'
import { groupThreads, type Thread } from './threads'
import { applyReduceMotion, dur, ease } from './motion'
import { drawAvatar, drawBadge } from './notifyArt'
import { printDocument } from './print'
import { toast } from './toasts'
import { Resizer, usePaneWidth } from './components/Resizer'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const showError = (e: unknown) => toast({ text: errMsg(e), tone: 'error' })

/** Messages fetched per mailbox per page. */
const PAGE = 60
/** Server search waits this long after the last keystroke. */
const SEARCH_DELAY_MS = 400

/** `color` tints the tab's icon, and fills it when active (white text on each). */
const CATEGORIES: { id: GmailCategory | null; label: string; icon: ReactNode; color: string }[] = [
  { id: null, label: 'All', icon: <Inbox size={14} />, color: '#475569' },
  { id: 'primary', label: 'Primary', icon: <User size={14} />, color: '#2563eb' },
  { id: 'social', label: 'Social', icon: <Users size={14} />, color: '#db2777' },
  { id: 'promotions', label: 'Promotions', icon: <Tag size={14} />, color: '#16a34a' },
  { id: 'updates', label: 'Updates', icon: <Info size={14} />, color: '#ea580c' },
  { id: 'forums', label: 'Forums', icon: <MessagesSquare size={14} />, color: '#7c3aed' }
]

/**
 * One mailbox's messages, narrowed to a category. Google accounts ask Gmail (its own sorting); other
 * accounts are sorted here from sender and headers. `raw` is how many messages the server returned,
 * for deciding whether there is more to load.
 */
async function fetchBox(
  account: Account | undefined,
  path: string,
  max: number,
  cat: GmailCategory | null,
  accountId = account?.id ?? ''
): Promise<{ items: MessageSummary[]; raw: number }> {
  if (cat && account?.provider === 'gmail') {
    const items = await api.search(accountId, path, `category:${cat}`, max)
    return { items, raw: items.length }
  }
  const all = await api.listMessages(accountId, path, max)
  if (!cat) return { items: all, raw: all.length }
  const of = (m: MessageSummary) => m.category ?? categorize({ email: m.from.email, subject: m.subject })
  return { items: all.filter((m) => of(m) === cat), raw: all.length }
}

/**
 * What is saved on this PC for one mailbox, in the same shape as `fetchBox`; null when nothing is
 * saved or it cannot be read. Never waits for the server.
 */
async function cachedBox(
  account: Account | undefined,
  path: string,
  max: number,
  cat: GmailCategory | null,
  accountId = account?.id ?? ''
): Promise<{ items: MessageSummary[]; raw: number } | null> {
  try {
    const gmailTab = cat && account?.provider === 'gmail'
    const saved = await api.cachedList(accountId, path, max, gmailTab ? `category:${cat}` : undefined)
    if (!saved) return null
    // As in fetchBox, `raw` says whether the server had more than was returned.
    const raw = saved.more ? max : saved.messages.length
    if (!cat || gmailTab) return { items: saved.messages, raw }
    const of = (m: MessageSummary) => m.category ?? categorize({ email: m.from.email, subject: m.subject })
    return { items: saved.messages.filter((m) => of(m) === cat), raw }
  } catch {
    return null
  }
}

/**
 * Batched delivery as the window last heard it, with the VIPs and the user's own addresses. Kept outside React so the
 * list loaders, which run from timers and events, read the current one.
 */
const hold: { state: DeliveryState | null; vips: Contact[]; own: string[] } = { state: null, vips: [], own: [] }

/** What holds Inbox mail right now, the same rule the main process counts with; null while batching is off. */
function holdRule(): HoldRule | null {
  const st = hold.state
  if (!st?.on || !st.deliveredUntil) return null
  return {
    // A Delivery time that has just passed counts at once, before the main process says so.
    deliveredUntil: advance(st.deliveredUntil, new Date(), st.times).deliveredUntil,
    vips: vipAddresses(hold.vips),
    own: hold.own
  }
}

/** Inbox rows without the mail held until the next Delivery. Other folders are left alone. */
function dropHeld(list: MessageSummary[], boxes: Record<string, MailboxInfo[]>): MessageSummary[] {
  const rule = holdRule()
  if (!rule) return list
  return list.filter((m) => !(m.mailbox === inboxPath(boxes[m.accountId]) && isHeld(m, rule)))
}

/** The Brief the user dismissed (its Delivery record's id); kept on this PC, so it stays dismissed after a restart. */
const BRIEF_DISMISSED_KEY = 'winmail.briefDismissed'
function dismissedBrief(): string | null {
  try {
    return localStorage.getItem(BRIEF_DISMISSED_KEY)
  } catch {
    return null
  }
}

/** A folder's UIDs were renumbered: nothing remembered about its messages can be trusted. */
function forgetFolder(accountId: string, path: string) {
  for (const k of [...listCache.keys()]) if (k.startsWith(`${accountId}/${path}|`) || k.startsWith('all:')) listCache.delete(k)
  for (const k of [...detailCache.keys()]) if (k.startsWith(`${accountId}|${path}|`)) detailCache.delete(k)
}

/** Identifies one message list: what is selected, the inbox tab, and which accounts it spans. */
function listKeyOf(sel: Selection, list: Account[], cat: GmailCategory | null): string {
  const where =
    sel.kind === 'mailbox'
      ? `${sel.accountId}/${sel.path}`
      : sel.kind === 'label'
        ? `label:${sel.accountId}/${sel.id}`
        : `all:${list.filter((a) => a.enabled).map((a) => a.id).join(',')}`
  return `${where}|${cat ?? ''}`
}

/**
 * Lists already shown this session, so going back to a folder shows it at once and then
 * checks the server quietly. Kept for the life of the window.
 */
const listCache = new Map<string, { messages: MessageSummary[]; hasMore: boolean; limit: number }>()

/** Opened messages. A message's body never changes on the server, so it only needs fetching once. */
const detailCache = new Map<string, MessageDetail>()
const DETAIL_CACHE_MAX = 200
function cacheDetail(d: MessageDetail) {
  detailCache.delete(d.key)
  detailCache.set(d.key, d)
  if (detailCache.size > DETAIL_CACHE_MAX) detailCache.delete(detailCache.keys().next().value!)
}

/** Every message with a label, wherever it is filed: the label views of keyword accounts. */
function labelQuery(id: string, base?: MailQuery): MailQuery {
  return {
    from: [],
    to: [],
    subject: [],
    words: [],
    after: null,
    before: null,
    read: null,
    flagged: false,
    hasAttachment: false,
    category: null,
    ...base,
    folder: base?.folder ?? 'all',
    labels: [...new Set([...(base?.labels ?? []), id])]
  }
}

/** The message with a label change applied. */
function relabel<T extends MessageSummary>(m: T, change: LabelChange): T {
  const next = new Set(m.labels ?? [])
  for (const l of change.add ?? []) next.add(l)
  for (const l of change.remove ?? []) next.delete(l)
  return { ...m, labels: [...next].sort() }
}

/** How a label change reads in a toast: "“Work” added to 3 messages". */
function labelToast(change: LabelChange, n: number, name: (id: string) => string): string {
  const add = change.add ?? []
  const remove = change.remove ?? []
  const what = n === 1 ? '' : ` ${n} messages`
  if (add.length === 1 && !remove.length) return `“${name(add[0]!)}” added${what ? ` to${what}` : ''}`
  if (remove.length === 1 && !add.length) return `“${name(remove[0]!)}” removed${what ? ` from${what}` : ''}`
  return n === 1 ? 'Labels changed' : `Labels changed on${what}`
}

const MOVED: Record<MoveTarget, string> = {
  trash: 'deleted',
  archive: 'archived',
  junk: 'moved to Junk',
  inbox: 'moved to Inbox'
}

type Dialog =
  | { kind: 'move'; items: MessageSummary[] }
  | { kind: 'labels'; items: MessageSummary[] }
  | { kind: 'snooze'; items: MessageSummary[] }
  | { kind: 'delete'; items: MessageSummary[] }
  | { kind: 'source'; subject: string; source: string }
  | { kind: 'scheduled' }
  | { kind: 'waiting'; focusId?: string }

/** Splits messages by the folder they are in, since IMAP acts on one folder at a time. */
function byFolder(items: MessageSummary[]): { accountId: string; mailbox: string; uids: number[]; uidValidity?: string }[] {
  const groups = new Map<string, { accountId: string; mailbox: string; uids: number[]; uidValidity?: string }>()
  for (const m of items) {
    const k = `${m.accountId}|${m.mailbox}`
    const g = groups.get(k) ?? { accountId: m.accountId, mailbox: m.mailbox, uids: [], uidValidity: m.uidValidity }
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
  /** accountId -> its labels and whether its server can keep them. */
  const [labelSets, setLabelSets] = useState<Record<string, AccountLabels>>({})
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({})

  const [selection, setSelection] = useState<Selection>({ kind: 'all-inboxes' })
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  /** A different list is loading (folder, account or tab changed): show placeholders, not the old rows. */
  const [listSwitching, setListSwitching] = useState(false)
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
  const [sidebarW, setSidebarW, resetSidebarW] = usePaneWidth('winmail.sidebarW', '--sidebar-w', 220, 180, 380)
  const [listW, setListW, resetListW] = usePaneWidth('winmail.listW', '--list-w', 340, 260, 640)
  const [adding, setAdding] = useState(false)
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const [boxMenu, setBoxMenu] = useState<{ accountId: string; path: string; x: number; y: number } | null>(null)

  /** Every selected row when more than one is; empty while a single message is selected. */
  const [checked, setChecked] = useState<Set<string>>(new Set())
  /** Where a Shift-click range starts. */
  const anchor = useRef<string | null>(null)
  /** Gmail inbox tab; null shows the whole inbox. */
  const [category, setCategory] = useState<GmailCategory | null>(null)
  /** The list shows only unread messages (the "Unread" filter in its header). */
  const [unreadOnly, setUnreadOnly] = useState(false)
  /** Server search results; null while the search box is empty. */
  const [searchResults, setSearchResults] = useState<MessageSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  /** The search box asks Claude (Enter) instead of searching as you type. */
  const [aiMode, setAiMode] = useState(false)
  /** The question Claude last answered and the search it made of it, edited through the chips. */
  const [aiSearch, setAiSearch] = useState<{ question: string; query: MailQuery } | null>(null)
  const [asking, setAsking] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [scheduled, setScheduled] = useState<ScheduledInfo[]>([])
  /** Sent messages waiting for a reply (Waiting for). */
  const [waiting, setWaiting] = useState<WaitingInfo[]>([])
  /** Batched delivery: whether it is on and when the next Delivery is. */
  const [delivery, setDelivery] = useState<DeliveryState | null>(null)
  /** Saved Deliveries, newest first; the newest gives the Brief. */
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([])
  const [briefDismissed, setBriefDismissed] = useState<string | null>(dismissedBrief)
  /** The Claude paragraph of each Brief, by Delivery record id. */
  const [briefTexts, setBriefTexts] = useState<Record<string, BriefParagraph>>({})
  /** Bumped by "Try again" on a failed Claude paragraph. */
  const [briefRetry, setBriefRetry] = useState(0)
  /** Messages of the open Gmail conversation from other folders, e.g. your replies in Sent. */
  const [threadExtra, setThreadExtra] = useState<{ key: string; list: MessageSummary[] } | null>(null)
  const [aiSummary, setAiSummary] = useState<AiSummaryState | null>(null)
  /** Takes back the last move, for the z shortcut. */
  const lastUndo = useRef<(() => void) | null>(null)
  /** A message to select once the list has loaded, e.g. from a notification. */
  const pendingOpen = useRef<string | null>(null)

  const enabled = useMemo(() => accounts.filter((a) => a.enabled), [accounts])
  hold.vips = settings.vips
  hold.own = accounts.map((a) => a.email.trim().toLowerCase())
  const accountById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts])

  // ---------- Loading ----------

  const loadAccounts = useCallback(async () => {
    const list = await api.listAccounts()
    setAccounts(list)
    return list
  }, [])

  /** Labels follow the folder list: Gmail labels are folders, and keyword support is read from the inbox. */
  const loadLabels = useCallback(async (accountId: string): Promise<AccountLabels | null> => {
    try {
      const set = await api.listLabels(accountId)
      setLabelSets((all) => ({ ...all, [accountId]: set }))
      return set
    } catch {
      // Offline with nothing saved: chips fall back to plain names until the server answers.
      return null
    }
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
          await loadLabels(a.id)
        })
    )
  }, [loadLabels])

  /** The lists the selection spans, as saved on this PC; null unless every one of them is saved. */
  const savedList = useCallback(
    async (sel: Selection, list: Account[], boxes: Record<string, MailboxInfo[]>, max: number, cat: GmailCategory | null) => {
      if (sel.kind === 'mailbox') {
        const got = await cachedBox(list.find((a) => a.id === sel.accountId), sel.path, max, cat, sel.accountId)
        const items = got && dropHeld(got.items, boxes)
        return got && items && { result: items, more: got.raw >= max, byAccount: { [sel.accountId]: items } }
      }
      // A label view is a search across folders; nothing of it is saved.
      if (sel.kind === 'label') return null
      const targets = list.filter((a) => a.enabled)
      const got = await Promise.all(targets.map((a) => cachedBox(a, inboxPath(boxes[a.id]), max, cat)))
      if (!targets.length || got.some((g) => !g)) return null
      const byAccount: Record<string, MessageSummary[]> = {}
      targets.forEach((a, i) => (byAccount[a.id] = dropHeld(got[i]!.items, boxes)))
      return {
        result: Object.values(byAccount).flat().sort((a, b) => b.date.localeCompare(a.date)),
        more: got.some((g) => g!.raw >= max),
        byAccount
      }
    },
    []
  )

  const listReq = useRef(0)
  /** The cache key of the list on screen; null while it holds nothing worth keeping. */
  const shownKey = useRef<string | null>(null)
  const loadMessages = useCallback(
    async (
      sel: Selection,
      list: Account[],
      boxes: Record<string, MailboxInfo[]>,
      quiet = false,
      max = PAGE,
      cat: GmailCategory | null = null,
      /** First visit to a list this session: show what is saved on this PC while the server is asked. */
      fromDisk = false
    ) => {
      const req = ++listReq.current
      // Rows painted from disk stay on screen if the server cannot be reached, like a quiet refresh.
      let painted: Record<string, MessageSummary[]> | null = null
      if (fromDisk) {
        const saved = await savedList(sel, list, boxes, max, cat)
        if (req !== listReq.current) return
        if (saved) {
          painted = saved.byAccount
          shownKey.current = listKeyOf(sel, list, cat)
          setMessages(saved.result)
          setHasMore(saved.more)
          setListSwitching(false)
        }
      }
      if (!quiet) {
        setListLoading(true)
        setListError(null)
        // A page of the same size is a new list; a larger one is "load more" and keeps its rows.
        if (max === PAGE && !painted) setListSwitching(true)
      }
      const keepRows = quiet || !!painted
      try {
        let result: MessageSummary[]
        let more = false
        const errors: string[] = []
        if (sel.kind === 'all-inboxes') {
          const targets = list.filter((a) => a.enabled)
          const settled = await Promise.allSettled(
            targets.map((a) => fetchBox(a, inboxPath(boxes[a.id]), max, cat))
          )
          result = settled.flatMap((s, i) => {
            if (s.status === 'fulfilled') {
              more ||= s.value.raw >= max
              return s.value.items
            }
            const a = targets[i]!
            errors.push(`${a.description}: ${errMsg(s.reason)}`)
            // An account that cannot be reached keeps the rows it has, instead of vanishing from the list.
            if (!keepRows) return []
            const inbox = inboxPath(boxes[a.id])
            return painted?.[a.id] ?? latest.current.messages.filter((m) => m.accountId === a.id && m.mailbox === inbox)
          })
          result = dropHeld(result, boxes)
          result.sort((a, b) => b.date.localeCompare(a.date))
        } else if (sel.kind === 'label') {
          result = await api.searchQuery(sel.accountId, inboxPath(boxes[sel.accountId]), labelQuery(sel.id), max)
          more = result.length >= max
        } else {
          const got = await fetchBox(list.find((a) => a.id === sel.accountId), sel.path, max, cat, sel.accountId)
          result = dropHeld(got.items, boxes)
          more = got.raw >= max
        }
        if (req !== listReq.current) return
        shownKey.current = listKeyOf(sel, list, cat)
        setMessages(result)
        setHasMore(more)
        setListError(errors.length ? errors.join('\n') : null)
      } catch (e) {
        if (req === listReq.current) {
          // A background check that fails keeps the rows already shown, e.g. while offline.
          if (!keepRows) {
            shownKey.current = null
            setMessages([])
          }
          setListError(errMsg(e))
        }
      } finally {
        if (req === listReq.current) {
          setListLoading(false)
          setListSwitching(false)
        }
      }
    },
    []
  )

  // Keep latest values for callbacks that run from timers/events.
  const latest = useRef({ selection, accounts, mailboxes, limit, category, messages, searchResults })
  latest.current = { selection, accounts, mailboxes, limit, category, messages, searchResults }

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

  useEffect(() => applyReduceMotion(settings.reduceMotion), [settings.reduceMotion])

  // Notifications ask this window for sender pictures; the taskbar button shows unread inbox mail.
  useEffect(() => api.onNotificationAvatar(drawAvatar), [])
  const unreadInbox = settings.taskbarBadge
    ? enabled.reduce((n, a) => n + (mailboxes[a.id]?.find((b) => b.specialUse === 'inbox')?.unseen ?? 0), 0)
    : 0
  useEffect(() => api.setTaskbarBadge(unreadInbox, drawBadge(unreadInbox)), [unreadInbox])

  // Initial load
  useEffect(() => {
    ;(async () => {
      const [list, s, d] = await Promise.all([loadAccounts(), api.getSettings(), api.getDelivery().catch(() => null)])
      // Held mail must be known before the first list is shown, or it would flash up and go.
      hold.state = d
      hold.vips = s.vips
      hold.own = list.map((a) => a.email.trim().toLowerCase())
      setDelivery(d)
      setSettings(s)
      if (d?.on) api.listDeliveries().then(setDeliveries, () => {})
      // Folders and unread counts saved on this PC show before any server answers; a failure here changes nothing.
      const saved = await Promise.all(
        list.filter((a) => a.enabled).map(async (a) => [a.id, await api.cachedMailboxes(a.id).catch(() => null)] as const)
      )
      const seeded: Record<string, MailboxInfo[]> = {}
      for (const [id, boxes] of saved) if (boxes) seeded[id] = boxes
      setMailboxes((m) => ({ ...seeded, ...m }))
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
    // A list seen before shows at once and is brought up to date in the background.
    const key = listKeyOf(selection, accounts, category)
    const cached = listCache.get(key)
    if (cached) {
      shownKey.current = key
      setMessages(cached.messages)
      setHasMore(cached.hasMore)
      setLimit(cached.limit)
      setListError(null)
      loadMessages(selection, accounts, mailboxes, true, cached.limit, category)
      return
    }
    // Until the new list arrives, the rows on screen belong to the old one; leave its cache entry alone.
    shownKey.current = null
    setLimit(PAGE)
    loadMessages(selection, accounts, mailboxes, false, PAGE, category, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selection, enabledKey, inboxKey, category])

  // Moves, flag changes and refreshes all go through `messages`, so the cache follows them.
  useEffect(() => {
    if (shownKey.current) listCache.set(shownKey.current, { messages, hasMore, limit })
  }, [messages, hasMore, limit])

  // Turning the tabs off must also drop an active category filter.
  useEffect(() => {
    if (!settings.inboxCategories) setCategory(null)
  }, [settings.inboxCategories])

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

  // Waiting for: the list for the sidebar entry. A nudge that comes while the window is in use gets a toast here;
  // the main process shows a Windows notification only while WinMail is in the background.
  const nudgedSeen = useRef<Set<string> | null>(null)
  useEffect(() => {
    const load = () =>
      api.listWaiting().then((list) => {
        setWaiting(list)
        const known = nudgedSeen.current
        const fresh = list.filter((w) => w.nudgedAt && known && !known.has(w.id))
        nudgedSeen.current = new Set(list.filter((w) => w.nudgedAt).map((w) => w.id))
        if (!fresh.length || !document.hasFocus()) return
        const one = fresh.length === 1 ? fresh[0]! : null
        toast({
          text: one ? `No reply to “${one.subject || '(No Subject)'}”` : `No reply to ${fresh.length} messages`,
          duration: 0,
          actions: one
            ? [
                { label: 'Follow Up', run: () => void startFollowUp(one.id) },
                { label: 'Open', run: () => setDialog({ kind: 'waiting', focusId: one.id }) }
              ]
            : [{ label: 'Open', run: () => setDialog({ kind: 'waiting' }) }]
        })
      }, () => {})
    load()
    const offChanged = api.onWaitingChanged(load)
    // A nudge notification was clicked, or its Follow up button.
    const offOpen = api.onWaitingOpen((e) => {
      if (e.followUp && e.id) void startFollowUp(e.id)
      else setDialog({ kind: 'waiting', focusId: e.id })
    })
    return () => {
      offChanged()
      offOpen()
    }
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
      // In a conversation, its row is the newest message's.
      setSelectedKey(threads.get(key)?.latest.key ?? key)
    }
  }, [messages])

  // Server search: the loaded list is filtered at once, then the server is asked for older matches.
  const searchReq = useRef(0)
  useEffect(() => {
    if (aiMode) return
    const q = query.trim()
    const req = ++searchReq.current
    if (q.length < 2) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    // A label view is already a search across folders; typing narrows it here.
    if (selection.kind === 'label') {
      setSearchResults(null)
      setSearching(false)
      return
    }
    const t = window.setTimeout(async () => {
      const { selection: sel, accounts: list, mailboxes: boxes } = latest.current
      if (sel.kind === 'label') return
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
  }, [query, selection, enabledKey, aiMode])

  // AI search: Claude's query (or the chips' edit of it) runs on the server, in the same places as a search.
  useEffect(() => {
    if (!aiMode) return
    // Shares the counter with the search above, so a search still running when the mode changed is ignored.
    const req = ++searchReq.current
    if (!aiSearch) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    const { selection: sel, accounts: list, mailboxes: boxes } = latest.current
    // In a label view the question is asked of that label's messages.
    const targets =
      sel.kind === 'mailbox'
        ? [{ accountId: sel.accountId, path: sel.path, query: aiSearch.query }]
        : sel.kind === 'label'
          ? [{ accountId: sel.accountId, path: inboxPath(boxes[sel.accountId]), query: labelQuery(sel.id, aiSearch.query) }]
          : list.filter((a) => a.enabled).map((a) => ({ accountId: a.id, path: inboxPath(boxes[a.id]), query: aiSearch.query }))
    setSearching(true)
    void Promise.allSettled(targets.map((x) => api.searchQuery(x.accountId, x.path, x.query, PAGE))).then((settled) => {
      if (req !== searchReq.current) return
      const found = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
      const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
      if (failed && !found.length) showError(failed.reason)
      found.sort((a, b) => b.date.localeCompare(a.date))
      setSearchResults(found)
      setSearching(false)
    })
  }, [aiSearch, aiMode, selection, enabledKey])

  const askReq = useRef(0)
  const askClaude = () => {
    const question = query.trim()
    if (!question || asking) return
    const req = ++askReq.current
    setAsking(true)
    api
      .aiSearch(question)
      .then((q) => req === askReq.current && setAiSearch({ question, query: q }))
      .catch(showError)
      .finally(() => req === askReq.current && setAsking(false))
  }
  const switchAiMode = (on: boolean) => {
    ++askReq.current
    setAsking(false)
    setAiSearch(null)
    setSearchResults(null)
    setAiMode(on)
  }
  const onQuery = (q: string) => {
    setQuery(q)
    // Clearing the box ends the AI search and brings the mailbox back; the mode stays for the next question.
    if (!q.trim() && aiMode) {
      ++askReq.current
      setAsking(false)
      setAiSearch(null)
    }
  }

  // Batched delivery: a Delivery, Deliver Now, or new times or VIPs change which Inbox mail shows, and the counts.
  useEffect(
    () =>
      api.onDeliveryChanged(() => {
        void api.getDelivery().then((d) => {
          hold.state = d
          setDelivery(d)
          void refresh(true)
        }, showError)
        api.listDeliveries().then(setDeliveries, () => {})
      }),
    [refresh]
  )
  const deliverNow = async () => {
    try {
      const d = await api.deliverNow()
      hold.state = d
      setDelivery(d)
      api.listDeliveries().then(setDeliveries, () => {})
      await refresh(true)
    } catch (e) {
      showError(e)
    }
  }

  /**
   * The Brief of the newest Delivery, while batching and the Brief are on, until it is dismissed or the next Delivery
   * comes. A Delivery that brought nothing has no Brief, and replaces the one before.
   */
  const brief = useMemo(() => {
    const r = deliveries[0]
    if (!delivery?.on || !settings.brief || !r || !r.items.length || r.id === briefDismissed) return null
    return makeBrief(
      r,
      { own: accounts.map((a) => a.email), vips: settings.vips, waitingIds: waiting.map((w) => w.messageId) },
      { records: deliveries, waiting }
    )
  }, [deliveries, delivery?.on, settings.brief, settings.vips, briefDismissed, accounts, waiting])
  const dismissBrief = (id: string) => {
    setBriefDismissed(id)
    try {
      localStorage.setItem(BRIEF_DISMISSED_KEY, id)
    } catch {
      // Not saved: it stays dismissed until WinMail restarts.
    }
  }

  // The Brief's Claude paragraph, only with the Brief Content opt-in on and a key saved. The local Brief shows at once
  // and never waits for it; the main process refuses it too while the opt-in is off.
  const briefId = brief?.recordId ?? null
  const briefAi = optedIn(settings, 'brief')
  useEffect(() => {
    if (!briefId || !briefAi) return
    // A failed one is asked again when the opt-in is turned back on or the user tries again.
    const st = briefTexts[briefId]
    if (st && (st.state === 'loading' || st.state === 'done')) return
    let live = true
    void api.aiAvailable().then((ok) => {
      if (!live || !ok) return
      setBriefTexts((m) => ({ ...m, [briefId]: { state: 'loading' } }))
      api.briefSummary(briefId).then(
        (text) => setBriefTexts((m) => ({ ...m, [briefId]: { state: 'done', text } })),
        (e) => setBriefTexts((m) => ({ ...m, [briefId]: { state: 'error', error: e instanceof Error ? e.message : String(e) } }))
      )
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefId, briefAi, briefRetry])
  const briefParagraph: BriefParagraph = (briefAi && briefId && briefTexts[briefId]) || { state: 'off' }

  /** Opens a message from the Brief: selected in the list when it is there, otherwise in its own Inbox. */
  const openDelivered = (item: DeliveredItem) => {
    const key = `${item.accountId}|${item.mailbox}|${item.uid}`
    if (messages.some((m) => m.key === key)) {
      setChecked(new Set())
      // In a conversation, its row is the newest message's.
      setSelectedKey(threads.get(key)?.latest.key ?? key)
      return
    }
    pendingOpen.current = key
    // A category tab may leave it out: show them all.
    if (category) setCategory(null)
    if (selection.kind === 'all-inboxes' || (selection.kind === 'mailbox' && selection.accountId === item.accountId && selection.path === item.mailbox)) {
      void refresh(true)
    } else select({ kind: 'mailbox', accountId: item.accountId, path: item.mailbox })
  }

  // The Morning brief notification was clicked: All Inboxes, where the Brief is.
  useEffect(
    () =>
      api.onShowBrief(() => {
        setQuery('')
        if (latest.current.selection.kind !== 'all-inboxes') select({ kind: 'all-inboxes' })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  /** Adds someone to the VIPs, whose mail is never held, or takes them off. */
  const toggleVip = (who: Address) => {
    const name = who.name || who.email
    const vip = isVip(who.email, settings.vips)
    const vips = vip
      ? settings.vips.filter((v) => v.email.trim().toLowerCase() !== who.email.trim().toLowerCase())
      : [...settings.vips, { name: who.name, email: who.email }]
    void updateSettings({ ...settings, vips })
    toast(vip ? `${name} is no longer a VIP` : `${name} is a VIP: their mail comes through at once`)
  }
  /** "Add Jamie to VIPs" for a message from someone else, while batching is on. */
  const vipItem = (m: MessageSummary | null | undefined): MenuItem[] => {
    if (!m || !settings.batchDelivery || !m.from.email || hold.own.includes(m.from.email.trim().toLowerCase())) return []
    const first = (m.from.name || m.from.email).split(/\s+/)[0]!
    return isVip(m.from.email, settings.vips)
      ? [{ label: `Remove ${first} from VIPs`, icon: <UserMinus size={14} />, onSelect: () => toggleVip(m.from) }]
      : [{ label: `Add ${first} to VIPs`, icon: <UserPlus size={14} />, onSelect: () => toggleVip(m.from) }]
  }

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
      if (e.reset) {
        // The server renumbered this folder: what was remembered about its messages is about other ones now.
        forgetFolder(e.accountId, e.path)
        setSelectedKey((k) => (k && k.startsWith(`${e.accountId}|${e.path}|`) ? null : k))
        setChecked(new Set())
        setDetailError(null)
      }
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
    // A question isn't a filter; the list changes once Claude has answered.
    if (aiMode) return aiSearch ? (searchResults ?? []) : messages
    const q = query.trim().toLowerCase()
    if (!q) return messages
    if (searchResults) return searchResults
    return messages.filter((m) =>
      [m.from.name, m.from.email, m.subject, m.preview].some((s) => s.toLowerCase().includes(q))
    )
  }, [messages, query, searchResults, aiMode, aiSearch])

  /** Conversations, when grouping is on; each message key maps to its conversation. */
  const threads = useMemo(() => {
    const map = new Map<string, Thread>()
    if (!settings.conversations) return map
    for (const t of groupThreads(visible)) for (const m of t.members) map.set(m.key, t)
    return map
  }, [visible, settings.conversations])

  /** One row per conversation: the newest message, unread while any message is, flagged while any is. */
  const threadRows = useMemo(() => {
    if (!settings.conversations) return visible
    return visible.flatMap((m) => {
      const t = threads.get(m.key)
      if (!t || t.members.length === 1) return [m]
      if (t.latest.key !== m.key) return []
      const labels = [...new Set(t.members.flatMap((x) => x.labels ?? []))].sort()
      return [{ ...m, seen: t.members.every((x) => x.seen), flagged: t.members.some((x) => x.flagged), labels }]
    })
  }, [visible, threads, settings.conversations])

  /** What the list shows (folder, category, search); when it changes, rows swap without animating. */
  const listView = [
    selection.kind === 'mailbox'
      ? `${selection.accountId}/${selection.path}`
      : selection.kind === 'label'
        ? `label:${selection.accountId}/${selection.id}`
        : 'all',
    category ?? '',
    query.trim(),
    searchResults ? 'server' : '',
    aiSearch ? `ai:${JSON.stringify(aiSearch.query)}` : '',
    unreadOnly ? 'unread' : ''
  ].join('|')

  /**
   * Rows listed while the "Unread" filter is on. One that gets read (opened, or marked) stays until the
   * list, tab or filter changes, so reading mail doesn't pull rows out from under the pointer.
   */
  const keptRead = useRef({ view: '', keys: new Set<string>() })
  const rows = useMemo(() => {
    if (!unreadOnly) return threadRows
    const kept = keptRead.current
    if (kept.view !== listView) keptRead.current = { view: listView, keys: new Set() }
    const keys = keptRead.current.keys
    return threadRows.filter((m) => {
      if (m.seen && !keys.has(m.key) && m.key !== selectedKey) return false
      keys.add(m.key)
      return true
    })
  }, [threadRows, unreadOnly, listView, selectedKey])
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
    const keys = checked.size > 0 ? checked : new Set(selectedKey ? [selectedKey] : [])
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
  // A layout effect, so a cached message is on screen in the same frame as the selection.
  useLayoutEffect(() => {
    setDetail(null)
    setDetailError(null)
    if (!selected || multi) return
    const req = ++detailReq.current
    // Flags may have changed since it was cached; the list row has the current ones.
    const cached = detailCache.get(selected.key)
    if (cached) setDetail({ ...cached, ...selected })
    const t = window.setTimeout(async () => {
      try {
        let d: MessageDetail
        if (cached) {
          d = { ...cached, ...selected }
          // getMessage is what marks a message read, so a cached one is marked here instead.
          if (!selected.seen) void api.setFlags(selected.accountId, selected.mailbox, [selected.uid], { seen: true }, selected.uidValidity).catch(showError)
        } else {
          d = await api.getMessage(selected.accountId, selected.mailbox, selected.uid, selected.uidValidity)
          cacheDetail(d)
        }
        if (req !== detailReq.current) return
        setDetail(d)
        // Opening a conversation reads all of it, as in Gmail; getMessage already marked this one.
        const unread = withThread([selected]).filter((m) => !m.seen)
        if (unread.length) {
          patchMessages(new Set(unread.map((m) => m.key)), { seen: true })
          unread.forEach((m) => adjustUnseen(m, -1))
          const others = unread.filter((m) => m.key !== selected.key)
          for (const g of byFolder(others)) void api.setFlags(g.accountId, g.mailbox, g.uids, { seen: true }, g.uidValidity).catch(showError)
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
            ? await api.move(g.accountId, g.mailbox, g.uids, to, g.uidValidity)
            : await api.moveTo(g.accountId, g.mailbox, g.uids, to.path, g.uidValidity)
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
            for (const d of done) await api.moveTo(d.accountId, d.res.path, d.res.uids, d.from, d.res.uidValidity)
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
      for (const g of byFolder(items)) await api.snooze(g.accountId, g.mailbox, g.uids, at.toISOString(), g.uidValidity)
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
      for (const g of byFolder(changed)) await api.setFlags(g.accountId, g.mailbox, g.uids, flags, g.uidValidity)
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

  // ---------- Labels ----------

  const labelSupport = (accountId: string) => labelSets[accountId]?.support
  const labelName = (accountId: string, id: string) =>
    labelSets[accountId]?.labels.find((l) => l.id === id)?.name ?? id

  /** Puts labels on messages and takes them off. Shown at once, rolled back with an error if the server refuses. */
  const applyLabels = async (items: MessageSummary[], change: LabelChange, undoable = true): Promise<boolean> => {
    const add = change.add ?? []
    const remove = change.remove ?? []
    const changed = items.filter(
      (m) => add.some((l) => !m.labels?.includes(l)) || remove.some((l) => m.labels?.includes(l))
    )
    if (!changed.length) return true
    const before = new Map(changed.map((m) => [m.key, m.labels]))
    const keys = new Set(before.keys())
    const patch = (fn: <T extends MessageSummary>(m: T) => T) => {
      mapLists((list) => list.map((m) => (keys.has(m.key) ? fn(m) : m)))
      setDetail((d) => (d && keys.has(d.key) ? fn(d) : d))
      setDialog((d) => (d?.kind === 'labels' ? { ...d, items: d.items.map((m) => (keys.has(m.key) ? fn(m) : m)) } : d))
      for (const k of keys) {
        const c = detailCache.get(k)
        if (c) detailCache.set(k, fn(c))
      }
    }
    const restore = <T extends MessageSummary>(m: T): T => ({ ...m, labels: before.get(m.key) })
    // Rows the change takes out of the list: a label view losing its label, or a Gmail label folder losing its own.
    const sel = latest.current.selection
    const leaves = (m: MessageSummary) =>
      (sel.kind === 'label' && sel.accountId === m.accountId && remove.includes(sel.id)) ||
      (labelSupport(m.accountId) === 'gmail' && remove.includes(m.mailbox))
    const gone = changed.filter(leaves)
    patch((m) => relabel(m, change))
    if (gone.length) takeOut(gone)
    const moved: { accountId: string; res: MoveResult }[] = []
    try {
      for (const g of byFolder(changed)) {
        const res = await api.setLabels(g.accountId, g.mailbox, g.uids, change, g.uidValidity)
        if (res && res.uids.length) moved.push({ accountId: g.accountId, res })
      }
    } catch (e) {
      patch(restore)
      if (gone.length) putBack(gone.map(restore))
      showError(e)
      return false
    }
    if (!undoable) return true
    const accountId = changed[0]!.accountId
    const inverse: LabelChange = { add: remove, remove: add }
    const undo = async () => {
      lastUndo.current = null
      try {
        // Messages that left their folder (a Gmail label taken off in its own folder) are found where they went.
        const left = new Set(moved.length ? gone.map((m) => m.key) : [])
        for (const g of byFolder(changed.filter((m) => !left.has(m.key)))) {
          await api.setLabels(g.accountId, g.mailbox, g.uids, inverse, g.uidValidity)
        }
        for (const d of moved) await api.setLabels(d.accountId, d.res.path, d.res.uids, inverse, d.res.uidValidity)
        patch(restore)
        if (gone.length && !moved.length) putBack(gone.map(restore))
        if (moved.length) void refresh(true, new Set(changed.map((m) => m.accountId)))
        toast('Labels undone')
      } catch (e) {
        showError(e)
        void refresh(true, new Set(changed.map((m) => m.accountId)))
      }
    }
    lastUndo.current = undo
    labelToastId.current = toast({
      id: labelToastId.current ?? undefined,
      text: labelToast(change, changed.length, (id) => labelName(accountId, id)),
      actions: [{ label: 'Undo', run: () => void undo() }]
    })
    return true
  }
  /** One toast for a run of changes in the label picker, so ticking several labels doesn't stack them up. */
  const labelToastId = useRef<number | null>(null)

  const askLabels = (items = targets()) => {
    if (!oneAccount(items)) return
    const accountId = items[0]!.accountId
    if (!labelSets[accountId]) void loadLabels(accountId)
    labelToastId.current = null
    setDialog({ kind: 'labels', items })
  }

  /** Shows every message with a label: on Gmail that is the label's own folder, elsewhere a label view. */
  const openLabel = (accountId: string, label: LabelInfo) => {
    onQuery('')
    if (labelSupport(accountId) === 'gmail') select({ kind: 'mailbox', accountId, path: label.id })
    else select({ kind: 'label', accountId, id: label.id })
  }

  /** A label was made, renamed, recoloured or deleted in Settings or the picker. */
  const labelsChanged = async (accountId: string, reloadList = true) => {
    const gmail = labelSupport(accountId) === 'gmail'
    // Gmail labels are folders: the folder list changes with them.
    let boxes = latest.current.mailboxes[accountId]
    if (gmail) {
      try {
        boxes = await api.listMailboxes(accountId)
        setMailboxes((m) => ({ ...m, [accountId]: boxes! }))
      } catch (e) {
        showError(e)
      }
    }
    const set = await loadLabels(accountId)
    const sel = latest.current.selection
    // The label on screen is gone (deleted, or renamed on Gmail): back to the inboxes.
    if (set && sel.kind === 'label' && sel.accountId === accountId && !set.labels.some((l) => l.id === sel.id)) {
      select({ kind: 'all-inboxes' })
    } else if (
      gmail &&
      sel.kind === 'mailbox' &&
      sel.accountId === accountId &&
      !boxes?.some((b) => b.path === sel.path)
    ) {
      select({ kind: 'all-inboxes' })
    } else if (reloadList) {
      // Renames and deletions change what saved rows carry.
      void loadMessages(sel, latest.current.accounts, latest.current.mailboxes, true, latest.current.limit, latest.current.category)
    }
  }

  const createAndApply = async (items: MessageSummary[], name: string) => {
    const accountId = items[0]?.accountId
    if (!accountId) return
    try {
      const label = await api.createLabel(accountId, name)
      // A new label is on no message yet, so the list needn't be read again (that could race the change below).
      await labelsChanged(accountId, false)
      await applyLabels(items, { add: [label.id] })
    } catch (e) {
      showError(e)
    }
  }

  /** Move to… lists one account's folders, so the selection must be in one account. */
  const oneAccount = (items: MessageSummary[]) => items.length > 0 && items.every((m) => m.accountId === items[0]!.accountId)
  const askMove = (items = targets()) => oneAccount(items) && setDialog({ kind: 'move', items })
  /** Moves to the Bin, after a confirmation when Settings asks for one. */
  const askTrash = (items = targets()) => {
    if (!items.length) return
    if (settings.confirmDelete) setDialog({ kind: 'delete', items })
    else void moveMessages(items, 'trash')
  }
  const askSnooze =(items = targets()) => items.length && setDialog({ kind: 'snooze', items })

  const defaultAccountId = () => {
    if (selection.kind !== 'all-inboxes') return selection.accountId
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
      const path = await api.saveAttachment(selected.accountId, selected.mailbox, selected.uid, index, selected.uidValidity)
      if (path) toast(`Saved to ${path}`)
    } catch (e) {
      showError(e)
    }
  }

  const allowRemoteFor = (m: MessageSummary | null) => settings.loadRemoteContent || (!!m && remoteKeys.has(m.key))

  const answerInvite = async (answer: InviteAnswer) => {
    if (!selected || !detail?.invite) return
    const m = selected
    try {
      const invite = await api.answerInvite(m.accountId, m.mailbox, m.uid, answer, m.uidValidity)
      setDetail((d) => {
        if (!d || d.key !== m.key) return d
        const next = { ...d, invite }
        cacheDetail(next)
        return next
      })
      toast(`Answer sent to ${invite.organizer?.name || invite.organizer?.email || 'the organiser'}`)
    } catch (e) {
      showError(e)
      throw e
    }
  }

  const openInvite = () => {
    if (!selected) return
    api.openInvite(selected.accountId, selected.mailbox, selected.uid, selected.uidValidity).catch(showError)
  }

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
      const source = await api.getSource(selected.accountId, selected.mailbox, selected.uid, selected.uidValidity)
      setDialog({ kind: 'source', subject: selected.subject, source })
    } catch (e) {
      showError(e)
    }
  }

  const summarise = async () => {
    if (!detail) return
    const key = detail.key
    // Without its Content opt-in nothing is sent; the panel points to the switch instead (ADR 0001).
    if (!optedIn(settings, 'summarise')) return setAiSummary({ key, text: null, error: null, off: true })
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
    ...(selected && labelSupport(selected.accountId) !== 'none'
      ? [{ label: 'Labels…', icon: <Tag size={14} />, shortcut: settings.gmailShortcuts ? 'L' : undefined, onSelect: () => askLabels() }]
      : []),
    { label: 'Snooze…', icon: <AlarmClock size={14} />, shortcut: settings.gmailShortcuts ? 'B' : undefined, onSelect: () => askSnooze() },
    ...vipItem(selected)
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
      ...(items.some((x) => labelSupport(x.accountId) !== 'none')
        ? [
            {
              label: 'Labels…',
              icon: <Tag size={14} />,
              shortcut: settings.gmailShortcuts ? 'L' : undefined,
              disabled: !oneAccount(items),
              onSelect: () => askLabels(items)
            }
          ]
        : []),
      { label: 'Snooze…', icon: <AlarmClock size={14} />, onSelect: () => askSnooze(items) },
      { label: 'Move to Junk', icon: <ShieldAlert size={14} />, onSelect: () => moveMessages(items, 'junk') },
      { label: 'Delete', icon: <Trash2 size={14} />, shortcut: 'Del', danger: true, onSelect: () => askTrash(items) },
      ...(single && vipItem(m).length ? (['separator', ...vipItem(m)] as MenuItem[]) : [])
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
    focusList: () =>
      (document.querySelector<HTMLElement>('.row.is-selected') ?? document.querySelector<HTMLElement>('.list-scroll'))?.focus(),
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
  useEffect(() => startPopoutEvents(), [])
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
  // Summarise was switched on in Settings: the "it is off" panel has done its job.
  useEffect(() => {
    if (aiSummary?.off && optedIn(settings, 'summarise')) setAiSummary(null)
  }, [settings.contentOptIns])
  // The key was removed in Settings: back to normal search.
  useEffect(() => {
    if (!aiAvailable && aiMode) switchAiMode(false)
  }, [aiAvailable])

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
      } else if (isKey(e, { key: 'z', ctrl: true })) {
        // Not while typing, so text fields keep their own undo.
        if (lastUndo.current) {
          e.preventDefault()
          lastUndo.current()
        }
      } else if (e.key === 'Enter' && selected && isDraftsBox(selected)) {
        e.preventDefault()
        void openFromDrafts(selected)
      } else if (e.key === 'Delete') {
        askTrash()
      } else if (e.key === 'Escape' && checked.size > 0) {
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
    const step = (dir: 1 | -1, extend = false, keepMarks = false) => {
      const idx = rows.findIndex((m) => m.key === selectedKey)
      const next = rows[idx < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, idx + dir))]
      if (!next) return
      if (extend) onSelectRow(next.key, { toggle: false, range: true })
      else if (keepMarks && checked.size > 0) setSelectedKey(next.key) // j/k move on, the rows marked with x stay
      else onSelectRow(next.key)
    }
    /** x: add the current row to the marked rows, or take it out again. */
    const markRow = (key: string) => {
      const cur = new Set(checked)
      if (cur.has(key)) cur.delete(key)
      else cur.add(key)
      anchor.current = key
      setChecked(cur)
    }
    // Gmail's single-key shortcuts; letters by e.key, symbols by physical key, never with Ctrl or Alt.
    const gmailKey = (e: KeyboardEvent) => {
      const run = (fn: () => unknown) => {
        e.preventDefault()
        fn()
      }
      if (isKey(e, { key: 'j' })) run(() => step(1, false, true))
      else if (isKey(e, { key: 'k' })) run(() => step(-1, false, true))
      else if (isKey(e, { key: 'e' })) run(() => moveMessages(targets(), 'archive'))
      else if (isKey(e, { code: 'Digit3', shift: true })) run(() => askTrash())
      else if (isKey(e, { code: 'Digit1', shift: true })) run(() => moveMessages(targets(), 'junk'))
      else if (isKey(e, { key: 'r' })) run(() => respond('reply'))
      else if (isKey(e, { key: 'a' })) run(() => respond('all'))
      else if (isKey(e, { key: 'f' })) run(() => respond('forward'))
      else if (isKey(e, { key: 's' })) run(() => toggleFlag())
      else if (isKey(e, { key: 'i', shift: true })) run(() => setFlagsMany(targets(), { seen: true }))
      else if (isKey(e, { key: 'u', shift: true })) run(() => setFlagsMany(targets(), { seen: false }))
      else if (isKey(e, { key: 'x' })) run(() => selectedKey && markRow(selectedKey))
      else if (isKey(e, { key: 'b' })) run(() => askSnooze())
      else if (isKey(e, { key: 'v' })) run(() => askMove())
      else if (isKey(e, { key: 'l' })) run(() => askLabels())
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
      : selection.kind === 'label'
        ? labelName(selection.accountId, selection.id)
        : (src(selection)?.name ?? selection.path)
  const subtitle = selection.kind !== 'all-inboxes' ? accountById[selection.accountId]?.description : undefined
  // The label the list is about isn't repeated on every row.
  const hideLabel =
    selection.kind === 'label'
      ? selection.id
      : selection.kind === 'mailbox' && labelSupport(selection.accountId) === 'gmail' && !src(selection)?.specialUse
        ? selection.path
        : undefined
  const selectedLabels = selected
    ? labelsFor({ ...selected, labels: [...new Set(withThread([selected]).flatMap((m) => m.labels ?? []))] }, labelSets)
    : []
  const canLabelSelected = !!selected && !multi && !!labelSets[selected.accountId] && labelSupport(selected.accountId) !== 'none'
  const anyLabels = enabled.some((a) => labelSupport(a.id) !== undefined && labelSupport(a.id) !== 'none')
  const labels =
    selection.kind === 'all-inboxes' && enabled.length > 1
      ? Object.fromEntries(enabled.map((a) => [a.id, a.description]))
      : undefined

  const box = src(selection)
  const inboxView = selection.kind === 'all-inboxes' || (selection.kind === 'mailbox' && box?.specialUse === 'inbox')
  const showCategories = settings.inboxCategories && inboxView
  // The chosen tab widens to show its name; the tinted pill slides over from the previous one.
  const categoryTabs = showCategories ? (
    <div className="cat-tabs" role="tablist" aria-label="Inbox categories">
      {CATEGORIES.map((c) => (
        <motion.button
          key={c.label}
          layout
          transition={{ layout: { duration: dur.slow, ease: ease.out } }}
          role="tab"
          aria-selected={category === c.id}
          title={c.label}
          style={{ '--tab': c.color } as CSSProperties}
          className={`cat-tab ${category === c.id ? 'is-active' : ''}`}
          onClick={() => setCategory(c.id)}
        >
          {category === c.id && (
            <motion.span layoutId="cat-pill" className="cat-pill" transition={{ duration: dur.slow, ease: ease.out }} />
          )}
          <motion.span layout="position" className="cat-icon">
            {c.icon}
          </motion.span>
          <motion.span layout="position" className="cat-label">
            {c.label}
          </motion.span>
        </motion.button>
      ))}
    </div>
  ) : undefined

  const plural = (n: number) => `${n} new ${n === 1 ? 'message' : 'messages'}`
  const downloading = Object.values(incoming).reduce((a, b) => a + b, 0)
  const status = asking
    ? { busy: true, text: 'Asking Claude…' }
    : searching
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
        waitingCount={waiting.length}
        nudgedCount={waiting.filter((w) => w.nudgedAt).length}
        onOpenWaiting={() => setDialog({ kind: 'waiting' })}
        onMailboxMenu={(accountId, path, x, y) => setBoxMenu({ accountId, path, x, y })}
        labelSets={labelSets}
      />
      <Resizer width={sidebarW} onResize={setSidebarW} onReset={resetSidebarW} label="Resize sidebar" />
      <div className="content">
        <Toolbar
          hasAccounts={enabled.length > 0}
          refreshing={refreshing}
          query={query}
          onQuery={onQuery}
          aiAvailable={aiAvailable}
          aiMode={aiMode}
          onAiMode={switchAiMode}
          onAsk={askClaude}
          asking={asking}
          onRefresh={() => refresh(false)}
          onCompose={newMessage}
        />
        {ready && enabled.length === 0 ? (
          <Welcome onAddAccount={() => setAdding(true)} />
        ) : (
          <div className="panes">
            <MessageList
              previewLines={settings.listPreviewLines || 2}
              density={settings.listDensity}
              title={title}
              subtitle={subtitle}
              messages={rows}
              selectedKey={selectedKey}
              checkedKeys={checked}
              threadCounts={threadCounts}
              tabs={
                aiSearch ? (
                  <AiSearchBar
                    question={aiSearch.question}
                    query={aiSearch.query}
                    onChange={(q) => setAiSearch({ ...aiSearch, query: q })}
                    onClose={() => {
                      switchAiMode(false)
                      setQuery('')
                    }}
                  />
                ) : (
                  <>
                    {inboxView && delivery?.on && !searchResults && (
                      <DeliveryBar state={delivery} onDeliverNow={deliverNow} briefShown={!!brief} />
                    )}
                    {inboxView && brief && !searchResults && (
                      <BriefCard
                        key={brief.recordId}
                        brief={brief}
                        paragraph={briefParagraph}
                        onOpen={openDelivered}
                        onOpenWaiting={(w) => setDialog({ kind: 'waiting', focusId: w.id })}
                        onRetry={() => setBriefRetry((n) => n + 1)}
                        onDismiss={() => dismissBrief(brief.recordId)}
                      />
                    )}
                    {categoryTabs}
                  </>
                )
              }
              view={listView}
              unreadOnly={unreadOnly}
              onUnreadOnly={setUnreadOnly}
              loading={!ready || listLoading || (!!aiSearch && !searchResults)}
              switching={listSwitching}
              status={status}
              error={listError}
              accountLabels={labels}
              hasMore={hasMore && !searchResults && !aiSearch}
              draftKeys={draftKeys}
              onSelect={onSelectRow}
              onOpen={(key) => {
                const m = visible.find((x) => x.key === key)
                if (!m) return
                if (isDraftsBox(m)) void openFromDrafts(m)
                else api.openMessageWindow(m).catch(showError)
              }}
              onContextMenu={(key, x, y) => setMenu({ key, x, y })}
              labelSets={labelSets}
              hideLabel={hideLabel}
              onOpenLabel={openLabel}
              onLoadMore={() => {
                const next = limit + PAGE
                setLimit(next)
                loadMessages(selection, accounts, mailboxes, false, next, category)
              }}
            />
            <Resizer width={listW} onResize={setListW} onReset={resetListW} label="Resize message list" />
            <div className="reader">
            <ActionBar
              hasSelection={!!selected || multi}
              count={multi ? checked.size : 0}
              selectionRead={targets().every((m) => m.seen)}
              canMove={oneAccount(targets())}
              onArchive={() => moveMessages(targets(), 'archive')}
              onTrash={() => askTrash()}
              onJunk={() => moveMessages(targets(), 'junk')}
              onMove={() => askMove()}
              onSnooze={() => askSnooze()}
              onReply={() => respond('reply')}
              onReplyAll={() => respond('all')}
              onForward={() => respond('forward')}
              onFlag={() => toggleFlag()}
              onToggleRead={() => toggleSeen()}
              onLabels={anyLabels ? () => askLabels() : undefined}
              canLabel={oneAccount(targets()) && labelSupport(targets()[0]!.accountId) !== 'none'}
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
              onOpenAiSettings={() => setSettingsTab('ai')}
              onUnsubscribe={unsubscribe}
              onAnswerInvite={answerInvite}
              onOpenInvite={openInvite}
              labels={selectedLabels}
              onEditLabels={canLabelSelected ? () => askLabels() : undefined}
              onOpenLabel={(l) => selected && openLabel(selected.accountId, l)}
              onRemoveLabel={
                canLabelSelected ? (l) => selected && void applyLabels(withThread([selected]), { remove: [l.id] }) : undefined
              }
            />
            </div>
          </div>
        )}
      </div>

      <ComposeDock />
      {/* Modals fade out on close; each one plays its own entrance. */}
      <AnimatePresence>
        {settingsTab && (
          <SettingsWindow
            key="settings"
            tab={settingsTab}
            accounts={accounts}
            settings={settings}
            onTab={setSettingsTab}
            onClose={() => setSettingsTab(null)}
            onAddAccount={() => setAdding(true)}
            onAccountsChanged={accountsChanged}
            onSettings={updateSettings}
            labelSets={labelSets}
            onLabelsChanged={labelsChanged}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {adding && (
          <AddAccount
            key="add-account"
            existing={accounts}
            onClose={() => setAdding(false)}
            onAdded={async () => {
              setAdding(false)
              await accountsChanged()
            }}
          />
        )}
      </AnimatePresence>
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
      <AnimatePresence>
        {dialog?.kind === 'move' && (
          <FolderPicker
            key="move"
            mailboxes={mailboxes[dialog.items[0]!.accountId] ?? []}
            current={dialog.items[0]!.mailbox}
            onPick={(path) => void moveMessages(dialog.items, { path })}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'labels' && (
          <LabelPicker
            key="labels"
            labels={labelSets[dialog.items[0]!.accountId] ?? null}
            items={dialog.items}
            onToggle={(label, on) => {
              const items = dialog.items
              void applyLabels(items, on ? { add: [label.id] } : { remove: [label.id] })
            }}
            onCreate={(name) => createAndApply(dialog.items, name)}
            onManage={() => {
              setDialog(null)
              setSettingsTab('labels')
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'snooze' && (
          <WhenPicker
            key="snooze"
            title={`Snooze ${dialog.items.length === 1 ? 'until' : `${dialog.items.length} messages until`}`}
            onPick={(at) => void snoozeMessages(dialog.items, at)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'delete' && (
          <ConfirmDeleteDialog
            key="delete"
            count={dialog.items.length}
            onConfirm={() => void moveMessages(dialog.items, 'trash')}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'source' && (
          <SourceDialog key="source" subject={dialog.subject} source={dialog.source} onClose={() => setDialog(null)} />
        )}
        {dialog?.kind === 'scheduled' && (
          <ScheduledDialog key="scheduled" items={scheduled} accounts={accounts} onClose={() => setDialog(null)} />
        )}
        {dialog?.kind === 'waiting' && (
          <WaitingDialog key="waiting" items={waiting} accounts={accounts} focusId={dialog.focusId} onClose={() => setDialog(null)} />
        )}
      </AnimatePresence>
      <ToastStack />
    </div>
  )

  return <ComposeContext.Provider value={{ accounts: enabled, settings, aiAvailable }}>{app}</ComposeContext.Provider>
}
