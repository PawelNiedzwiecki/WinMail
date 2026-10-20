import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net } from 'electron'
import { writeFile } from 'fs/promises'
import type {
  AccountInput,
  AccountUpdate,
  AiInput,
  MoveTarget,
  SendInput,
  Settings
} from '../shared/types'
import type { MailService } from './mail'
import type { Store } from './store'
import { cancelSignIn, revoke } from './google'
import type { Contacts } from './contacts'
import type { Outbox } from './outbox'
import { runAi } from './ai'
import { AttachmentGrants, TEMP_ROOT, saveTempFile } from './attachments'

type Handler = (...args: never[]) => unknown
type Flags = { seen?: boolean; flagged?: boolean }

/** Errors go back as plain data so the renderer gets clean messages. */
function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await (fn as (...a: unknown[]) => unknown)(...args) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

async function saveDialog(defaultPath: string) {
  const win = BrowserWindow.getFocusedWindow()
  const opts = { defaultPath }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  return res.canceled || !res.filePath ? null : res.filePath
}

/** Prints a document in a hidden window with scripts off; the system print dialog does the rest. */
async function printHtml(html: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false, contextIsolation: true, nodeIntegration: false }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise<void>((resolve, reject) =>
      win.webContents.print({}, (ok, reason) => (ok || reason === 'cancelled' ? resolve() : reject(new Error(reason))))
    )
  } finally {
    win.destroy()
  }
}

export function registerIpc(store: Store, mail: MailService, contacts: Contacts, outbox: Outbox): void {
  const attachments = new AttachmentGrants([store.outboxDir, TEMP_ROOT])

  handle('accounts:list', () => store.listAccounts())
  handle('accounts:test', (input: AccountInput) => mail.test(input))
  handle('accounts:add', (input: AccountInput) => store.addAccount(input))
  handle('accounts:update', async (u: AccountUpdate) => {
    const before = store.getAccount(u.account.id)
    const acc = store.updateAccount(u)
    // Reconnect only when the connection itself changed, not for a new name or signature.
    const server =
      !!u.password ||
      before.username !== acc.username ||
      before.enabled !== acc.enabled ||
      JSON.stringify([before.imap, before.smtp]) !== JSON.stringify([acc.imap, acc.smtp])
    if (server) await mail.disconnect(acc.id)
    if (u.password) contacts.rescan(acc.id)
    return acc
  })
  handle('accounts:remove', async (id: string) => {
    await mail.disconnect(id)
    if (store.listAccounts().find((a) => a.id === id)?.auth === 'oauth') void revoke(store.getPassword(id))
    store.removeAccount(id)
  })
  handle('accounts:addGoogle', () => mail.addGoogleAccount())
  handle('accounts:reauthGoogle', async (id: string) => {
    const acc = await mail.reauthGoogleAccount(id)
    contacts.rescan(id) // the new sign-in may allow Google Contacts
    return acc
  })
  handle('accounts:cancelGoogle', () => cancelSignIn())

  handle('settings:get', () => store.getSettings())
  handle('settings:set', (s: Settings) => {
    const saved = store.setSettings(s)
    nativeTheme.themeSource = saved.appearance
    return saved
  })

  handle('mail:mailboxes', (id: string) => mail.listMailboxes(id))
  handle('mail:messages', (id: string, path: string, limit?: number) => mail.listMessages(id, path, limit))
  handle('mail:search', (id: string, path: string, q: string, limit?: number) => mail.search(id, path, q, limit))
  handle('mail:thread', (id: string, threadId: string) => mail.listThread(id, threadId))
  handle('mail:message', (id: string, path: string, uid: number) => mail.getMessage(id, path, uid))
  handle('mail:source', (id: string, path: string, uid: number) => mail.getSource(id, path, uid))
  handle('mail:flags', (id: string, path: string, uids: number[], f: Flags) => mail.setFlags(id, path, uids, f))
  handle('mail:markAllRead', (id: string, path: string) => mail.markAllRead(id, path))
  handle('mail:move', (id: string, path: string, uids: number[], t: MoveTarget) => mail.move(id, path, uids, t))
  handle('mail:moveTo', (id: string, path: string, uids: number[], dest: string) => mail.moveTo(id, path, uids, dest))
  handle('mail:snooze', (id: string, path: string, uids: number[], until: string) =>
    mail.snooze(id, path, uids, until)
  )
  handle('mail:saveAttachment', async (id: string, path: string, uid: number, index: number) => {
    const { filename, content } = await mail.getAttachment(id, path, uid, index)
    const file = await saveDialog(filename)
    if (file) await writeFile(file, content)
    return file
  })
  handle('file:saveText', async (name: string, text: string) => {
    const file = await saveDialog(name)
    if (file) await writeFile(file, text, 'utf8')
    return file
  })
  handle('file:print', (html: string) => printHtml(html))
  handle('mail:unsubscribe', async (url: string) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Only secure unsubscribe links are supported.')
    const res = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click'
    })
    if (!res.ok) throw new Error(`The sender's server answered ${res.status}. Try the link in the message instead.`)
  })

  handle('compose:pickAttachments', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled) return []
    return Promise.all(res.filePaths.map((path) => attachments.grant(path)))
  })
  // Paths come from webUtils.getPathForFile in the preload, so only real dropped files get here.
  handle('compose:addFiles', (paths: string[]) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) throw new Error('Nothing to attach.')
    return Promise.all(paths.map((path) => attachments.grant(path)))
  })
  handle('compose:saveImage', (name: string, bytes: Uint8Array) => saveTempFile(name, bytes))
  handle('mail:send', async (input: SendInput) => {
    attachments.check(input)
    await mail.send(input)
    contacts.recordSent(input.accountId, input.to, input.cc, input.bcc)
  })
  handle('mail:saveDraft', (input: SendInput) => {
    attachments.check(input)
    return mail.saveDraft(input)
  })
  handle('mail:deleteDraft', (id: string, uid: number) => mail.deleteDraft(id, uid))
  handle('mail:openDraft', (id: string, path: string, uid: number) => mail.openDraft(id, path, uid))
  handle('outbox:schedule', (input: SendInput, sendAt: string) => {
    attachments.check(input)
    return outbox.schedule(input, sendAt)
  })
  handle('outbox:queue', (input: SendInput) => {
    attachments.check(input)
    return outbox.queue(input)
  })
  handle('outbox:takeFailed', () => outbox.takeFailed())
  handle('outbox:list', () => outbox.list())
  handle('outbox:cancel', (id: string) => outbox.cancel(id))
  ipcMain.on('app:emoji', () => app.showEmojiPanel())

  handle('ai:available', () => store.hasAiKey())
  handle('ai:setKey', (key: string | null) => store.setAiKey(key?.trim() || null))
  handle('ai:run', (input: AiInput) => runAi(store, input))

  handle('contacts:list', (id: string) => contacts.list(id))
  handle('contacts:status', (id: string) => contacts.status(id))
}
