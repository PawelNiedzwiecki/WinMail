import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  nativeTheme,
  screen,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'path'
import { release } from 'os'
import { Store } from './store'
import { MailService } from './mail'
import { registerIpc } from './ipc'
import { Contacts } from './contacts'
import { Outbox } from './outbox'
import { Notifier } from './notifications'
import { cleanTemp } from './attachments'
import { loadWindowState, trackWindowState } from './windowState'
import type { MessageSummary, OpenMessageEvent } from '../shared/types'

const CONTACTS_SCAN_DELAY_MS = 20_000
/** How often snoozed mail and scheduled sends are checked. */
const TIMER_MS = 30_000
/** How long a closing window waits for the renderer to save drafts. */
const CLOSE_TIMEOUT_MS = 10_000
/** Quitting never takes longer than this, even with a dead network. */
const QUIT_TIMEOUT_MS = 15_000
const MIN_WIDTH = 900
const MIN_HEIGHT = 560
/** A pop-out compose window: opening size, smallest size, and the title bar the header sits under. */
const POPOUT_WIDTH = 780
const POPOUT_HEIGHT = 680
const POPOUT_MIN_WIDTH = 520
const POPOUT_MIN_HEIGHT = 420
const POPOUT_BAR = 40
/** Each further pop-out opens this far down and right of the last, so they don't hide each other. */
const POPOUT_CASCADE = 28
/** A message in a window of its own (double-click in the list). */
const READER_WIDTH = 860
const READER_HEIGHT = 780
const READER_MIN_WIDTH = 480
const READER_MIN_HEIGHT = 400
const READER_BAR = 40
/** A crashed page reloads at most this often before the window is left as it is. */
const MAX_RELOADS = 3
const RELOAD_WINDOW_MS = 60_000

let mail: MailService | null = null
let outbox: Outbox | null = null
let mainWin: BrowserWindow | null = null
/** Pop-out compose windows by web contents id, with what each was opened with. */
const popouts = new Map<number, { win: BrowserWindow; payload: unknown }>()
/** Message windows by web contents id, with the message each shows. */
const readers = new Map<number, { win: BrowserWindow; summary: MessageSummary }>()
const mainWindow = () => (mainWin && !mainWin.isDestroyed() ? mainWin : null)
/** Windows whose renderer has saved its drafts, or can't, so they may close. */
const mayClose = new WeakSet<BrowserWindow>()

/**
 * Electron's default menu binds Ctrl+R to reload and Ctrl+W to close, which would reload the
 * window on Reply and lose open drafts. Keep only the edit commands, plus DevTools in development.
 */
function setMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ]
  if (!app.isPackaged) template.push({ label: 'View', submenu: [{ role: 'toggleDevTools' }] })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Right-click in a text field: spelling suggestions and the usual edit commands. */
function showContextMenu(win: BrowserWindow, p: Electron.ContextMenuParams): void {
  const items: MenuItemConstructorOptions[] = []
  if (p.isEditable) {
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) })
      }
      if (!p.dictionarySuggestions.length) items.push({ label: 'No Suggestions', enabled: false })
      items.push(
        {
          label: 'Add to Dictionary',
          click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord)
        },
        { type: 'separator' }
      )
    }
    const f = p.editFlags
    items.push(
      { role: 'undo', enabled: f.canUndo },
      { role: 'redo', enabled: f.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: f.canCut },
      { role: 'copy', enabled: f.canCopy },
      { role: 'paste', enabled: f.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: f.canSelectAll }
    )
  } else if (p.selectionText.trim()) {
    items.push({ role: 'copy' })
  }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
}

function overlay(height = 52) {
  return {
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
    height
  }
}

const isWin = process.platform === 'win32'
// Mica needs Windows 11 (build 22000+). Windows 10 gets a solid sidebar.
const mica = isWin && Number(release().split('.')[2] ?? 0) >= 22000

const webPreferences = () => ({
  preload: join(__dirname, '../preload/index.js'),
  additionalArguments: [mica ? '--winmail-mica=1' : '--winmail-mica=0'],
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false
})

/** What every window does alike: keep links out, save drafts before closing, recover from crashes. */
function wireWindow(win: BrowserWindow, overlayHeight?: number): void {
  // Links in emails open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault()
      if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    }
  })

  const theme = () => {
    if (isWin && !win.isDestroyed()) win.setTitleBarOverlay(overlay(overlayHeight))
  }
  nativeTheme.on('updated', theme)
  win.on('closed', () => nativeTheme.off('updated', theme))

  // Let the renderer save open drafts first; it answers with app:close-ready.
  win.on('close', (e) => {
    // Nothing to save while the page is still loading or after it crashed.
    if (mayClose.has(win) || win.webContents.isCrashed() || win.webContents.isLoadingMainFrame()) return
    e.preventDefault()
    win.webContents.send('app:close-requested')
    setTimeout(() => {
      mayClose.add(win)
      if (!win.isDestroyed()) win.close()
    }, CLOSE_TIMEOUT_MS)
  })

  // A crashed renderer comes back; Compose restores its drafts from the recovery copy. Lasting
  // failures (it can't start, security software blocks it) aren't retried forever.
  const reloads: number[] = []
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] gone:', details.reason)
    // Nothing left in the page to wait for when the window closes.
    mayClose.add(win)
    const now = Date.now()
    while (reloads.length && now - reloads[0]! > RELOAD_WINDOW_MS) reloads.shift()
    const retry = ['crashed', 'oom', 'killed', 'abnormal-exit', 'memory-eviction'].includes(details.reason)
    if (!retry || reloads.length >= MAX_RELOADS || win.isDestroyed()) return
    reloads.push(now)
    win.webContents.reload()
  })
  // A fresh page can ask before closing again.
  win.webContents.on('did-finish-load', () => mayClose.delete(win))

  win.webContents.on('context-menu', (_e, p) => showContextMenu(win, p))
}

function loadRenderer(win: BrowserWindow, hash?: string): void {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) win.loadURL(hash ? `${dev}#${hash}` : dev)
  else win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

function createWindow(): BrowserWindow {

  // Reopen where it was last; the first time (or if that spot is gone) open large on big screens:
  // most of the usable area, but never smaller than the old default.
  const saved = loadWindowState(MIN_WIDTH, MIN_HEIGHT)
  const area = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(area.width, Math.max(1280, Math.round(area.width * 0.85)))
  const height = Math.min(area.height, Math.max(820, Math.round(area.height * 0.9)))

  const win = new BrowserWindow({
    ...(saved ? saved.bounds : { width, height }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: 'WinMail',
    titleBarStyle: 'hidden',
    titleBarOverlay: isWin ? overlay() : undefined,
    backgroundMaterial: mica ? 'mica' : undefined,
    backgroundColor: mica ? '#00000000' : undefined,
    webPreferences: webPreferences()
  })

  if (saved?.maximized) win.maximize()
  trackWindowState(win)
  win.once('ready-to-show', () => win.show())

  wireWindow(win)
  // Pop-out compose and message windows belong to this one: they close with it, each saving its draft first.
  win.on('closed', () => {
    for (const { win: p } of [...popouts.values(), ...readers.values()]) if (!p.isDestroyed()) p.close()
  })
  loadRenderer(win)
  return win
}

/**
 * A secondary window over the middle of the main one, the `index`-th a little below and right of
 * the one before, kept on the screen.
 */
interface ChildSize {
  width: number
  height: number
  minWidth: number
  minHeight: number
  /** Height of the title bar the page draws under the window buttons. */
  bar: number
}

function childWindow(title: string, size: ChildSize, index: number): BrowserWindow {
  const parent = mainWindow()
  const area = screen.getDisplayMatching(parent?.getBounds() ?? screen.getPrimaryDisplay().bounds).workArea
  const width = Math.min(size.width, area.width)
  const height = Math.min(size.height, area.height)
  const around = parent?.getBounds() ?? area
  const shift = (index % 6) * POPOUT_CASCADE
  const x = Math.round(around.x + (around.width - width) / 2 + shift)
  const y = Math.round(around.y + (around.height - height) / 2 + shift)

  return new BrowserWindow({
    width,
    height,
    x: Math.max(area.x, Math.min(x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - height)),
    minWidth: Math.min(size.minWidth, width),
    minHeight: Math.min(size.minHeight, height),
    show: false,
    title,
    titleBarStyle: 'hidden',
    titleBarOverlay: isWin ? overlay(size.bar) : undefined,
    backgroundMaterial: mica ? 'mica' : undefined,
    backgroundColor: mica ? '#00000000' : undefined,
    webPreferences: webPreferences()
  })
}

/** Opens a compose card in a window of its own, a little below and right of the last one. */
function createPopout(payload: unknown): void {
  const win = childWindow(
    'New Message',
    { width: POPOUT_WIDTH, height: POPOUT_HEIGHT, minWidth: POPOUT_MIN_WIDTH, minHeight: POPOUT_MIN_HEIGHT, bar: POPOUT_BAR },
    popouts.size
  )
  const id = win.webContents.id
  popouts.set(id, { win, payload })
  win.on('closed', () => popouts.delete(id))
  win.once('ready-to-show', () => win.show())
  wireWindow(win, POPOUT_BAR)
  loadRenderer(win, 'popout')
}

/** Opens a message in a window of its own, or brings forward the window already showing it. */
function openReader(summary: MessageSummary): void {
  if (!summary || typeof summary.key !== 'string' || typeof summary.accountId !== 'string') {
    throw new Error('No message to open.')
  }
  for (const r of readers.values()) {
    if (r.summary.key !== summary.key || r.win.isDestroyed()) continue
    if (r.win.isMinimized()) r.win.restore()
    r.win.focus()
    return
  }
  const win = childWindow(
    summary.subject || 'Message',
    { width: READER_WIDTH, height: READER_HEIGHT, minWidth: READER_MIN_WIDTH, minHeight: READER_MIN_HEIGHT, bar: READER_BAR },
    readers.size
  )
  const id = win.webContents.id
  readers.set(id, { win, summary })
  win.on('closed', () => readers.delete(id))
  win.once('ready-to-show', () => win.show())
  wireWindow(win, READER_BAR)
  loadRenderer(win, 'message')
}

/** The compose session id inside a pop-out payload (`{ session: { id } }`), if it has one. */
function idOf(payload: unknown): string {
  const id = (payload as { session?: { id?: unknown } } | null)?.session?.id
  return typeof id === 'string' ? id : ''
}

/** Pop-out windows: the main window opens them, they hand things back to it. */
function registerPopouts(): void {
  const answer = (fn: () => unknown) => {
    try {
      return { ok: true, value: fn() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  ipcMain.handle('popout:open', (e, payload: unknown) =>
    answer(() => {
      if (e.sender !== mainWindow()?.webContents) throw new Error('Pop-out windows open from the main window.')
      createPopout(payload)
    })
  )
  ipcMain.handle('popout:payload', (e) => answer(() => popouts.get(e.sender.id)?.payload ?? null))
  ipcMain.handle('reader:open', (e, summary: MessageSummary) =>
    answer(() => {
      if (e.sender !== mainWindow()?.webContents) throw new Error('Message windows open from the main window.')
      openReader(summary)
    })
  )
  ipcMain.handle('reader:payload', (e) => answer(() => readers.get(e.sender.id)?.summary ?? null))
  ipcMain.handle('popout:list', () => answer(() => [...popouts.values()].map((p) => idOf(p.payload)).filter(Boolean)))
  // Only pop-outs and message windows speak to the main window this way; it has its own channels.
  ipcMain.on('popout:send', (e, message: unknown) => {
    if (popouts.has(e.sender.id) || readers.has(e.sender.id)) mainWindow()?.webContents.send('popout:message', message)
  })
}

// A second copy would share winmail.json and the IMAP connections; focus the first instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    // Windows shows notifications only for an app with an AppUserModelID; match the installer's appId.
    if (process.platform === 'win32') app.setAppUserModelId('com.pawel.winmail')
    let store: Store
    try {
      store = new Store()
    } catch (err) {
      dialog.showErrorBox('WinMail could not start', err instanceof Error ? err.message : String(err))
      app.quit()
      return
    }
    // Drives prefers-color-scheme in the renderer and the title bar buttons.
    nativeTheme.themeSource = store.getSettings().appearance
    const send = (channel: string, payload?: unknown) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
    }
    const open = (e: OpenMessageEvent) => {
      const w = mainWindow()
      if (!w) return
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
      w.webContents.send('mail:open', e)
    }
    // The notifier needs the outbox, which needs the mail service; it is set just below.
    let notifier: Notifier | null = null
    const announce = (accountId: string, list: MessageSummary[]) => void notifier?.announce(accountId, list)
    const mailService = new MailService(
      store,
      (e) => send('mail:changed', e),
      (e) => send('mail:progress', e),
      announce
    )
    mail = mailService
    const contacts = new Contacts(store, mailService, (id) => send('contacts:changed', id))
    const queue = new Outbox(
      store,
      mailService,
      () => send('outbox:changed'),
      (e) => send('outbox:event', e),
      (input) => contacts.recordSent(input.accountId, input.to, input.cc, input.bcc)
    )
    outbox = queue
    notifier = new Notifier({
      store,
      mail: mailService,
      outbox: queue,
      contacts,
      window: mainWindow,
      open,
      changed: (e) => send('mail:changed', e)
    })
    setMenu()
    registerIpc(store, mailService, contacts, queue)
    ipcMain.on('app:close-ready', (e) => {
      const w = BrowserWindow.fromWebContents(e.sender)
      if (!w) return
      mayClose.add(w)
      w.close()
    })
    queue.resume()
    void queue.cleanup()
    void cleanTemp()
    const tick = () => {
      void mailService.wakeSnoozed()
      void queue.sendDue()
    }
    setTimeout(tick, CONTACTS_SCAN_DELAY_MS)
    setInterval(tick, TIMER_MS)
    registerPopouts()
    const win = (mainWin = createWindow())
    // Let the first mailbox load finish before scanning mail for contacts.
    setTimeout(() => void contacts.scan(), CONTACTS_SCAN_DELAY_MS)
    if (store.recoveredFrom) {
      const backup = store.recoveredFrom
      win.once('ready-to-show', () =>
        dialog.showMessageBox(win, {
          type: 'warning',
          message: 'Your WinMail settings could not be read',
          detail: `WinMail started with empty settings. The damaged file was kept at:\n${backup}`
        })
      )
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow()
    })
  })
}

let quitting = false
// Messages still inside the undo delay go out now, then connections close; all within a deadline.
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  const work = (async () => {
    await outbox?.flush().catch((err) => console.error('[outbox] flush failed:', err))
    await mail?.disconnectAll()
  })()
  const deadline = new Promise((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS))
  void Promise.race([work, deadline]).finally(() => app.exit(0))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
