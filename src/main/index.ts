import { app, BrowserWindow, dialog, shell, nativeTheme, Notification } from 'electron'
import { join } from 'path'
import { release } from 'os'
import { Store } from './store'
import { MailService } from './mail'
import { registerIpc } from './ipc'
import { Contacts } from './contacts'
import { Outbox } from './outbox'
import type { MessageSummary, OpenMessageEvent } from '../shared/types'

const CONTACTS_SCAN_DELAY_MS = 20_000
/** How often snoozed mail and scheduled sends are checked. */
const TIMER_MS = 30_000
/** More new messages than this are announced as one notification. */
const MAX_NOTIFICATIONS = 3

let mail: MailService | null = null

function overlay() {
  return {
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
    height: 52
  }
}

function createWindow(): BrowserWindow {
  const isWin = process.platform === 'win32'
  // Mica needs Windows 11 (build 22000+). Windows 10 gets a solid sidebar.
  const mica = isWin && Number(release().split('.')[2] ?? 0) >= 22000

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'WinMail',
    titleBarStyle: 'hidden',
    titleBarOverlay: isWin ? overlay() : undefined,
    backgroundMaterial: mica ? 'mica' : undefined,
    backgroundColor: mica ? '#00000000' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments: [mica ? '--winmail-mica=1' : '--winmail-mica=0'],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())

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

  nativeTheme.on('updated', () => {
    if (isWin && !win.isDestroyed()) win.setTitleBarOverlay(overlay())
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

// A second copy would share winmail.json and the IMAP connections; focus the first instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
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
      const w = BrowserWindow.getAllWindows()[0]
      if (!w) return
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
      w.webContents.send('mail:open', e)
    }
    const announce = (accountId: string, list: MessageSummary[]) => {
      const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
      if (!store.getSettings().notifyNewMail || focused || !Notification.isSupported()) return
      const account = store.listAccounts().find((a) => a.id === accountId)
      if (list.length > MAX_NOTIFICATIONS) {
        const n = new Notification({ title: `${list.length} new messages`, body: account?.description ?? '' })
        n.on('click', () => open({ accountId, path: list[0]!.mailbox, uid: list[0]!.uid }))
        n.show()
        return
      }
      for (const m of list) {
        const n = new Notification({ title: m.from.name || m.from.email, subtitle: m.subject, body: `${m.subject}
${m.preview}` })
        n.on('click', () => open({ accountId, path: m.mailbox, uid: m.uid }))
        n.show()
      }
    }
    const mailService = new MailService(
      store,
      (e) => send('mail:changed', e),
      (e) => send('mail:progress', e),
      announce
    )
    mail = mailService
    const contacts = new Contacts(store, mailService, (id) => send('contacts:changed', id))
    const outbox = new Outbox(store, mailService, () => send('outbox:changed'))
    registerIpc(store, mailService, contacts, outbox)
    void outbox.cleanup()
    const tick = () => {
      void mailService.wakeSnoozed()
      void outbox.sendDue()
    }
    setTimeout(tick, CONTACTS_SCAN_DELAY_MS)
    setInterval(tick, TIMER_MS)
    const win = createWindow()
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
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  mail?.disconnectAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
