import { randomUUID } from 'crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join, resolve, sep } from 'path'
import type { OutgoingAttachment, SendInput } from '../shared/types'

/** WinMail's temporary files: attachments of opened drafts and pasted images. */
export const TEMP_ROOT = join(tmpdir(), 'winmail')

/** Pasted images bigger than this have to be attached as files instead. */
export const MAX_PASTE_BYTES = 25 * 1024 * 1024

/** Temporary files are kept this long, as long as a recovered draft may still need them. */
const TEMP_MAX_AGE_MS = 7 * 24 * 60 * 60_000

const key = (path: string) => resolve(path).toLowerCase()

/**
 * Attachment paths the renderer may send: files the user picked or dropped, plus WinMail's
 * own copies. Anything else is refused, so a compromised page can't attach arbitrary files.
 */
export class AttachmentGrants {
  private granted = new Set<string>()
  private roots: string[]

  constructor(roots: string[]) {
    this.roots = roots.map((r) => key(r) + sep)
  }

  /** Checks a picked or dropped path and allows it to be attached. */
  async grant(path: string): Promise<OutgoingAttachment> {
    if (!path) throw new Error("This item can't be attached. Save it as a file first.")
    const s = await stat(path).catch(() => null)
    if (!s) throw new Error(`${basename(path)} could not be found.`)
    if (!s.isFile()) throw new Error("Folders can't be attached.")
    this.granted.add(key(path))
    return { path, filename: basename(path), size: s.size }
  }

  check(input: SendInput): void {
    for (const a of input.attachments ?? []) {
      const k = key(a.path)
      if (!this.granted.has(k) && !this.roots.some((r) => k.startsWith(r))) {
        throw new Error(`"${a.filename}" can't be attached. Remove it and add it again.`)
      }
    }
  }
}

/** Writes a pasted image to a temporary file so it can be attached like any other. */
export async function saveTempFile(name: string, bytes: Uint8Array): Promise<OutgoingAttachment> {
  if (!(bytes instanceof Uint8Array)) throw new Error('Nothing to attach.')
  if (bytes.byteLength > MAX_PASTE_BYTES) throw new Error('This image is too large to paste. Attach it as a file instead.')
  const dir = join(TEMP_ROOT, 'paste', randomUUID())
  await mkdir(dir, { recursive: true })
  const filename = basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'image.png'
  const path = join(dir, filename)
  await writeFile(path, bytes)
  return { path, filename, size: bytes.byteLength }
}

/** Removes temporary folders older than a week: opened drafts' attachments and pasted images. */
export async function cleanTemp(now = Date.now()): Promise<void> {
  const old = async (dir: string) => {
    const s = await stat(dir).catch(() => null)
    return !!s && now - s.mtimeMs > TEMP_MAX_AGE_MS
  }
  const sweep = async (root: string, skip?: string) => {
    const names = await readdir(root).catch(() => [] as string[])
    await Promise.all(
      names
        .filter((n) => n !== skip)
        .map(async (n) => {
          const dir = join(root, n)
          if (await old(dir)) await rm(dir, { recursive: true, force: true })
        })
    )
  }
  await sweep(TEMP_ROOT, 'paste')
  await sweep(join(TEMP_ROOT, 'paste'))
}
