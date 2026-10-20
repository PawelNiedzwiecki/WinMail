import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { WinMailApi } from '../shared/types'

const mica = process.argv.includes('--winmail-mica=1')

/** Pasted images bigger than this have to be attached as files instead; matches main. */
const MAX_PASTE_BYTES = 25 * 1024 * 1024

window.addEventListener('DOMContentLoaded', () => {
  if (mica) document.documentElement.classList.add('has-mica')
})

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as
    | { ok: true; value: T }
    | { ok: false; error: string }
  if (!res.ok) throw new Error(res.error)
  return res.value
}

/** Subscribes to an event from the main process; returns the unsubscribe function. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const h = (_e: IpcRendererEvent, d: T) => cb(d)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api: WinMailApi = {
  platform: process.platform,
  mica,

  listAccounts: () => call('accounts:list'),
  testAccount: (input) => call('accounts:test', input),
  addAccount: (input) => call('accounts:add', input),
  updateAccount: (u) => call('accounts:update', u),
  removeAccount: (id) => call('accounts:remove', id),
  addGoogleAccount: () => call('accounts:addGoogle'),
  reauthGoogleAccount: (id) => call('accounts:reauthGoogle', id),
  cancelGoogleSignIn: () => call('accounts:cancelGoogle'),

  getSettings: () => call('settings:get'),
  setSettings: (s) => call('settings:set', s),

  listMailboxes: (id) => call('mail:mailboxes', id),
  listMessages: (id, path, limit) => call('mail:messages', id, path, limit),
  search: (id, path, q, limit) => call('mail:search', id, path, q, limit),
  listThread: (id, threadId) => call('mail:thread', id, threadId),
  getMessage: (id, path, uid) => call('mail:message', id, path, uid),
  getSource: (id, path, uid) => call('mail:source', id, path, uid),
  setFlags: (id, path, uids, flags) => call('mail:flags', id, path, uids, flags),
  markAllRead: (id, path) => call('mail:markAllRead', id, path),
  move: (id, path, uids, target) => call('mail:move', id, path, uids, target),
  moveTo: (id, path, uids, dest) => call('mail:moveTo', id, path, uids, dest),
  snooze: (id, path, uids, until) => call('mail:snooze', id, path, uids, until),
  saveAttachment: (id, path, uid, index) => call('mail:saveAttachment', id, path, uid, index),
  saveText: (name, text) => call('file:saveText', name, text),
  print: (html) => call('file:print', html),
  unsubscribe: (url) => call('mail:unsubscribe', url),

  pickAttachments: () => call('compose:pickAttachments'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  addDroppedFiles: async (files) => {
    // A page can pass any object; only a real array is copied into this world, and every
    // element must be a genuine File or getPathForFile throws.
    if (!Array.isArray(files)) throw new TypeError('Expected a list of files.')
    return call('compose:addFiles', Array.from(files, (f) => webUtils.getPathForFile(f)))
  },
  saveClipboardImage: async (file) => {
    if (file.size > MAX_PASTE_BYTES) throw new Error('This image is too large to paste. Attach it as a file instead.')
    return call('compose:saveImage', file.name || 'image.png', new Uint8Array(await file.arrayBuffer()))
  },
  send: (input) => call('mail:send', input),
  queueSend: (input) => call('outbox:queue', input),
  takeFailedSends: () => call('outbox:takeFailed'),
  onOutbox: (cb) => on('outbox:event', cb),
  saveDraft: (input) => call('mail:saveDraft', input),
  deleteDraft: (id, uid) => call('mail:deleteDraft', id, uid),
  openDraft: (id, path, uid) => call('mail:openDraft', id, path, uid),
  scheduleSend: (input, sendAt) => call('outbox:schedule', input, sendAt),
  listScheduled: () => call('outbox:list'),
  cancelScheduled: (id) => call('outbox:cancel', id),
  onScheduledChanged: (cb) => on('outbox:changed', cb),

  aiAvailable: () => call('ai:available'),
  setAiKey: (key) => call('ai:setKey', key),
  ai: (input) => call('ai:run', input),

  listContacts: (id) => call('contacts:list', id),
  contactsStatus: (id) => call('contacts:status', id),
  onContactsChanged: (cb) => on('contacts:changed', cb),

  onMailChanged: (cb) => on('mail:changed', cb),
  onMailProgress: (cb) => on('mail:progress', cb),
  onOpenMessage: (cb) => on('mail:open', cb),

  showEmojiPanel: () => ipcRenderer.send('app:emoji'),
  onCloseRequested: (cb) => on('app:close-requested', cb),
  closeReady: () => ipcRenderer.send('app:close-ready'),

  openComposeWindow: (payload) => call('popout:open', payload),
  popoutPayload: () => call('popout:payload'),
  listPopouts: () => call('popout:list'),
  popoutSend: (message) => ipcRenderer.send('popout:send', message),
  onPopoutMessage: (cb) => on('popout:message', cb)
}

contextBridge.exposeInMainWorld('winmail', api)
