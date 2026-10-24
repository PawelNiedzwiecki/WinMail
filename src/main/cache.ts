import { app } from 'electron'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { existsSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { MailboxInfo, MessageDetail, MessageSummary } from '../shared/types'

/** Bumped when the tables change; an older file is rebuilt, a newer one is thrown away. */
const SCHEMA_VERSION = 2

/** Opened messages larger than this (inline images make some huge) are not kept. */
export const BODY_MAX_BYTES = 5_000_000

/** Messages kept per folder; older ones are fetched again if the folder is scrolled that far. */
const KEEP_PER_FOLDER = 500

/** A folder not opened for this long keeps its place in the sidebar but not its messages. */
const FOLDER_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000

/** Opened messages kept in total; the ones opened longest ago go first. */
const BODIES_MAX_BYTES = 250_000_000

/** Most opened messages removed in one trim, so a trim never holds up the app for long. */
const TRIM_BODIES_PER_PASS = 200

/** Write failures in a row before the file is given up on for this session. */
const MAX_WRITE_FAILURES = 3

/** SQLite result codes (low byte of `errcode`) that mean the file itself is damaged or unusable. */
const BROKEN_CODES = new Set([10 /* IOERR */, 11 /* CORRUPT */, 26 /* NOTADB */])

/** What the last LIST-STATUS said about a folder; BigInts as strings so it survives JSON. */
export interface FolderStatus {
  uidValidity: string
  uidNext: number
  messages: number
  highestModseq?: string
}

/** What the server looked like when a sync took its lock; stored with the rows it produced. */
export interface SnapState {
  uidValidity: string
  uidNext: number
  messages: number
  /** Safe lower bound for CHANGEDSINCE; null without CONDSTORE. */
  modseq: string | null
}

export interface FolderState {
  /** Bumped by every change that is not part of a sync, so a sync that raced one can tell and drop its write. */
  gen: number
  uidValidity: string | null
  uidNext: number | null
  messages: number | null
  modseq: string | null
  /** Every message the server has with a UID at or above this is cached. */
  floor: number | null
  /** Messages cached at or above the floor. */
  count: number
}

/** A saved message list, plus what it was saved under. */
export interface CachedWindow {
  messages: MessageSummary[]
  more: boolean
  uidValidity: string
}

/** The folder changed under a sync (trim, clear, reset); its write is dropped. */
class Stale extends Error {}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * A copy of mail on disk: the lists of folders already visited and the bodies of messages already opened.
 * It is only a cache: if the file is damaged it is thrown away and rebuilt, and no call here ever throws,
 * so a failing disk cannot get in the way of reading mail. Everything is synchronous.
 */
export class MailCache {
  private file: string
  private db!: DatabaseSync
  private stmts = new Map<string, StatementSync>()
  private memory = false
  private writeFailures = 0

  constructor(file = join(app.getPath('userData'), 'mail-cache.db')) {
    this.file = file
    this.open()
  }

  // ---------- Opening ----------

  private open(): void {
    const marker = `${this.file}.reset`
    if (existsSync(marker)) {
      this.deleteFiles()
      rmSync(marker, { force: true })
    }
    try {
      this.db = this.openAt(this.file)
    } catch (err) {
      console.error('[cache] unreadable, starting empty:', errorText(err))
      this.deleteFiles()
      try {
        this.db = this.openAt(this.file)
      } catch (again) {
        console.error('[cache] could not be recreated, keeping it in memory:', errorText(again))
        this.db = this.openAt(':memory:')
        this.memory = true
      }
    }
    this.stmts.clear()
  }

  private openAt(path: string): DatabaseSync {
    const db = new DatabaseSync(path, { timeout: 2000 })
    try {
      this.migrate(db)
      return db
    } catch (err) {
      try {
        db.close()
      } catch {}
      throw err
    }
  }

  private migrate(db: DatabaseSync): void {
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version > SCHEMA_VERSION) throw new Error(`file is from a newer WinMail (schema ${version})`)
    const empty = version === 0 && !db.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get()
    // Only takes effect before the first table exists.
    if (empty) db.exec('PRAGMA auto_vacuum = INCREMENTAL')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_size_limit = 16777216')
    if (version === SCHEMA_VERSION) return
    db.exec('BEGIN')
    try {
      // Version 1 has everything but the drafts table.
      db.exec(version === 0 ? SCHEMA + DRAFTS : DRAFTS)
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  private deleteFiles(): void {
    try {
      this.db?.close()
    } catch {}
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(this.file + suffix, { force: true })
      } catch (err) {
        console.error('[cache] could not remove', this.file + suffix, errorText(err))
      }
    }
  }

  // ---------- Helpers ----------

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql)
    if (!s) {
      s = this.db.prepare(sql)
      this.stmts.set(sql, s)
    }
    return s
  }

  private all<T>(sql: string, ...params: (string | number | null)[]): T[] {
    return this.stmt(sql).all(...params) as unknown as T[]
  }

  private get<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
    return this.stmt(sql).get(...params) as unknown as T | undefined
  }

  private run(sql: string, ...params: (string | number | null)[]): number {
    return Number(this.stmt(sql).run(...params).changes)
  }

  /** Runs `fn` in a transaction, or inside the one already open. Throws on failure after rolling back. */
  private tx<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn()
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {}
      throw err
    }
  }

  /** The outermost wrapper of every public method: logs, counts failures and returns `fallback` instead of throwing. */
  private guard<T>(fallback: T, write: boolean, fn: () => T): T {
    try {
      const result = fn()
      if (write) this.writeFailures = 0
      return result
    } catch (err) {
      if (err instanceof Stale) return fallback
      console.error('[cache]', errorText(err))
      const code = Number((err as { errcode?: number }).errcode) & 0xff
      if (BROKEN_CODES.has(code) || (write && ++this.writeFailures >= MAX_WRITE_FAILURES)) this.giveUp()
      return fallback
    }
  }

  /** Works from memory for the rest of the session and has the file deleted at the next start. */
  private giveUp(): void {
    if (this.memory) return
    console.error('[cache] giving up on the file for this session')
    try {
      writeFileSync(`${this.file}.reset`, '')
    } catch {}
    try {
      this.db.close()
    } catch {}
    this.memory = true
    this.db = this.openAt(':memory:')
    this.stmts.clear()
  }

  private static summary(row: { uid: number; seen: number; flagged: number; summary: string }, a: string, p: string, validity: string) {
    return {
      ...(JSON.parse(row.summary) as MessageSummary),
      key: `${a}|${p}|${row.uid}`,
      accountId: a,
      mailbox: p,
      uid: row.uid,
      seen: !!row.seen,
      flagged: !!row.flagged,
      uidValidity: validity
    } satisfies MessageSummary
  }

  /** What is stored in `messages.summary`: everything that is not a column or derived from one. */
  private static pack(m: MessageSummary): string {
    const { key: _k, accountId: _a, mailbox: _m, uid: _u, seen: _s, flagged: _f, ...rest } = m
    return JSON.stringify(rest)
  }

  private adjustUnseen(a: string, p: string, delta: number): void {
    if (!delta) return
    const row = this.get<{ info: string | null }>('SELECT info FROM folders WHERE account_id = ? AND path = ?', a, p)
    if (!row?.info) return
    const info = JSON.parse(row.info) as MailboxInfo
    info.unseen = Math.max(0, info.unseen + delta)
    this.run('UPDATE folders SET info = ? WHERE account_id = ? AND path = ?', JSON.stringify(info), a, p)
  }

  // ---------- Folders ----------

  /** A folder row has to exist before anything else about the folder can be saved. */
  ensureFolder(a: string, p: string): void {
    this.guard(undefined, true, () => {
      this.run('INSERT INTO folders (account_id, path) VALUES (?, ?) ON CONFLICT DO NOTHING', a, p)
    })
  }

  state(a: string, p: string): FolderState | null {
    return this.guard<FolderState | null>(null, false, () => {
      const r = this.get<{
        gen: number
        uid_validity: string | null
        uid_next: number | null
        messages: number | null
        modseq: string | null
        floor_uid: number | null
      }>('SELECT gen, uid_validity, uid_next, messages, modseq, floor_uid FROM folders WHERE account_id = ? AND path = ?', a, p)
      if (!r) return null
      const count =
        r.floor_uid === null
          ? 0
          : (this.get<{ n: number }>(
              'SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND path = ? AND uid >= ?',
              a,
              p,
              r.floor_uid
            )?.n ?? 0)
      return {
        gen: r.gen,
        uidValidity: r.uid_validity,
        uidNext: r.uid_next,
        messages: r.messages,
        modseq: r.modseq,
        floor: r.floor_uid,
        count
      }
    })
  }

  /** UIDs of the cached window, i.e. every cached message at or above `floor`. */
  uids(a: string, p: string, floor: number): number[] {
    return this.guard<number[]>([], false, () =>
      this.all<{ uid: number }>('SELECT uid FROM messages WHERE account_id = ? AND path = ? AND uid >= ?', a, p, floor).map((r) => r.uid)
    )
  }

  /** Previews already saved for these messages, so they are not downloaded again; only while UIDVALIDITY still matches. */
  previews(a: string, p: string, uids: number[], validity: string): Map<number, string> {
    return this.guard(new Map<number, string>(), false, () => {
      const out = new Map<number, string>()
      const f = this.get<{ uid_validity: string | null }>('SELECT uid_validity FROM folders WHERE account_id = ? AND path = ?', a, p)
      if (!f || f.uid_validity !== validity) return out
      for (let i = 0; i < uids.length; i += 200) {
        const chunk = uids.slice(i, i + 200)
        const rows = this.db
          .prepare(`SELECT uid, summary FROM messages WHERE account_id = ? AND path = ? AND uid IN (${chunk.map(() => '?').join(',')})`)
          .all(a, p, ...chunk) as unknown as { uid: number; summary: string }[]
        for (const r of rows) {
          const preview = (JSON.parse(r.summary) as MessageSummary).preview
          if (preview) out.set(r.uid, preview)
        }
      }
      return out
    })
  }

  /** The folder list of a Google or IMAP account as the last LIST returned it; folders that are gone are dropped. */
  saveMailboxes(a: string, list: MailboxInfo[], statuses: Map<string, FolderStatus>): boolean {
    return this.guard(false, true, () => {
      this.tx(() => {
        const keep = new Set(list.map((m) => m.path))
        for (const row of this.all<{ path: string }>('SELECT path FROM folders WHERE account_id = ?', a)) {
          if (!keep.has(row.path)) this.run('DELETE FROM folders WHERE account_id = ? AND path = ?', a, row.path)
        }
        list.forEach((m, i) => {
          const status = statuses.get(m.path)
          this.run(
            `INSERT INTO folders (account_id, path, listed, position, info, status) VALUES (?, ?, 1, ?, ?, ?)
             ON CONFLICT (account_id, path) DO UPDATE SET listed = 1, position = excluded.position,
               info = excluded.info, status = COALESCE(excluded.status, status)`,
            a,
            m.path,
            i,
            JSON.stringify(m),
            status ? JSON.stringify(status) : null
          )
        })
      })
      return true
    })
  }

  /** null until a real LIST has been saved for the account. */
  mailboxes(a: string): MailboxInfo[] | null {
    return this.guard<MailboxInfo[] | null>(null, false, () => {
      const rows = this.all<{ info: string }>(
        'SELECT info FROM folders WHERE account_id = ? AND listed = 1 AND info IS NOT NULL ORDER BY position',
        a
      )
      return rows.length ? rows.map((r) => JSON.parse(r.info) as MailboxInfo) : null
    })
  }

  // ---------- Message lists ----------

  /**
   * The cached top of a folder, newest first by date; null when the folder has never been synced.
   * `more` says the server had older mail than what is cached.
   */
  window(a: string, p: string, limit: number): CachedWindow | null {
    return this.guard<CachedWindow | null>(null, false, () => {
      const f = this.get<{ uid_validity: string | null; floor_uid: number | null; messages: number | null }>(
        'SELECT uid_validity, floor_uid, messages FROM folders WHERE account_id = ? AND path = ?',
        a,
        p
      )
      if (!f || f.floor_uid === null || f.uid_validity === null) return null
      const rows = this.all<{ uid: number; seen: number; flagged: number; summary: string }>(
        'SELECT uid, seen, flagged, summary FROM messages WHERE account_id = ? AND path = ? AND uid >= ? ORDER BY uid DESC LIMIT ?',
        a,
        p,
        f.floor_uid,
        limit
      )
      const messages = rows.map((r) => MailCache.summary(r, a, p, f.uid_validity!)).sort((x, y) => y.date.localeCompare(x.date))
      return { messages, more: (f.messages ?? 0) > messages.length, uidValidity: f.uid_validity }
    })
  }

  /**
   * Replaces what is cached for the folder with `rows`, which must be the server's newest messages with nothing
   * missing between them and the end of the folder. Mail below the new floor goes; so do bodies of messages above
   * it that are no longer there. A different UIDVALIDITY discards the folder first. Returns false when the folder
   * changed since `gen` was read or the write failed.
   */
  replaceWindow(a: string, p: string, gen: number, rows: MessageSummary[], snap: SnapState): boolean {
    return this.guard(false, true, () => {
      this.tx(() => {
        const f = this.get<{ uid_validity: string | null }>(
          'SELECT uid_validity FROM folders WHERE account_id = ? AND path = ? AND gen = ?',
          a,
          p,
          gen
        )
        if (!f) throw new Stale()
        if (f.uid_validity !== null && f.uid_validity !== snap.uidValidity) this.wipe(a, p)
        const floor = rows.length ? Math.min(...rows.map((m) => m.uid)) : snap.uidNext
        const present = new Set(rows.map((m) => m.uid))
        this.run('DELETE FROM messages WHERE account_id = ? AND path = ?', a, p)
        for (const b of this.all<{ uid: number }>('SELECT uid FROM bodies WHERE account_id = ? AND path = ? AND uid >= ?', a, p, floor)) {
          if (!present.has(b.uid)) this.run('DELETE FROM bodies WHERE account_id = ? AND path = ? AND uid = ?', a, p, b.uid)
        }
        for (const m of rows) {
          this.run(
            'INSERT OR REPLACE INTO messages (account_id, path, uid, seen, flagged, date, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
            a,
            p,
            m.uid,
            m.seen ? 1 : 0,
            m.flagged ? 1 : 0,
            m.date,
            MailCache.pack(m)
          )
        }
        this.run(
          `UPDATE folders SET gen = gen + 1, uid_validity = ?, uid_next = ?, messages = ?, modseq = ?, floor_uid = ?,
             visited_at = ? WHERE account_id = ? AND path = ?`,
          snap.uidValidity,
          snap.uidNext,
          snap.messages,
          snap.modseq,
          floor,
          Date.now(),
          a,
          p
        )
      })
      return true
    })
  }

  /**
   * One sync of a folder that was already cached: new messages, ones that are gone, current flags, and the state
   * the server was in when the sync began. Returns false when the folder changed since `gen` was read (a trim, a
   * reset, a clear) or the write failed; nothing is written then.
   */
  applySync(
    a: string,
    p: string,
    gen: number,
    sync: {
      upsert: MessageSummary[]
      remove: number[]
      flags: { uid: number; seen: boolean; flagged: boolean }[]
      floor: number
      snap: SnapState
    }
  ): boolean {
    return this.guard(false, true, () => {
      this.tx(() => {
        if (!this.get('SELECT 1 FROM folders WHERE account_id = ? AND path = ? AND gen = ?', a, p, gen)) throw new Stale()
        if (sync.remove.length) this.drop(a, p, sync.remove, false)
        for (const m of sync.upsert) {
          this.run(
            'INSERT OR REPLACE INTO messages (account_id, path, uid, seen, flagged, date, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
            a,
            p,
            m.uid,
            m.seen ? 1 : 0,
            m.flagged ? 1 : 0,
            m.date,
            MailCache.pack(m)
          )
        }
        for (const f of sync.flags) {
          this.run(
            'UPDATE messages SET seen = ?, flagged = ? WHERE account_id = ? AND path = ? AND uid = ?',
            f.seen ? 1 : 0,
            f.flagged ? 1 : 0,
            a,
            p,
            f.uid
          )
        }
        this.run(
          `UPDATE folders SET uid_validity = ?, uid_next = ?, messages = ?, modseq = ?, floor_uid = ?, visited_at = ?
           WHERE account_id = ? AND path = ?`,
          sync.snap.uidValidity,
          sync.snap.uidNext,
          sync.snap.messages,
          sync.snap.modseq,
          sync.floor,
          Date.now(),
          a,
          p
        )
      })
      return true
    })
  }

  /** Forgets everything cached about the folder's messages, e.g. after its UIDs were reset. */
  private wipe(a: string, p: string): void {
    this.run('DELETE FROM messages WHERE account_id = ? AND path = ?', a, p)
    this.run('DELETE FROM bodies WHERE account_id = ? AND path = ?', a, p)
    this.run('DELETE FROM views WHERE account_id = ? AND path = ?', a, p)
    this.run(
      `UPDATE folders SET gen = gen + 1, uid_validity = NULL, uid_next = NULL, messages = NULL, modseq = NULL,
         floor_uid = NULL WHERE account_id = ? AND path = ?`,
      a,
      p
    )
  }

  wipeFolder(a: string, p: string): void {
    this.guard(undefined, true, () => this.tx(() => this.wipe(a, p)))
  }

  /** Makes the next sync of the folder read every flag again, e.g. after a change the server did not confirm. */
  clearCheckpoint(a: string, p: string): void {
    this.guard(undefined, true, () => {
      this.run('UPDATE folders SET modseq = NULL WHERE account_id = ? AND path = ?', a, p)
    })
  }

  // ---------- Write-through for changes made here (call only once the server has confirmed them) ----------

  setFlags(a: string, p: string, uids: number[], flags: { seen?: boolean; flagged?: boolean }): boolean {
    return this.guard(false, true, () => {
      this.tx(() => {
        let unseen = 0
        for (const uid of uids) {
          const row = this.get<{ seen: number; flagged: number }>(
            'SELECT seen, flagged FROM messages WHERE account_id = ? AND path = ? AND uid = ?',
            a,
            p,
            uid
          )
          if (!row) continue
          const seen = flags.seen === undefined ? row.seen : flags.seen ? 1 : 0
          const flagged = flags.flagged === undefined ? row.flagged : flags.flagged ? 1 : 0
          this.run(
            'UPDATE messages SET seen = ?, flagged = ? WHERE account_id = ? AND path = ? AND uid = ?',
            seen,
            flagged,
            a,
            p,
            uid
          )
          unseen += row.seen - seen
        }
        this.adjustUnseen(a, p, unseen)
      })
      return true
    })
  }

  markAllRead(a: string, p: string): boolean {
    return this.guard(false, true, () => {
      this.tx(() => {
        this.run('UPDATE messages SET seen = 1 WHERE account_id = ? AND path = ?', a, p)
        const row = this.get<{ info: string | null }>('SELECT info FROM folders WHERE account_id = ? AND path = ?', a, p)
        if (row?.info) {
          const info = JSON.parse(row.info) as MailboxInfo
          this.run('UPDATE folders SET info = ? WHERE account_id = ? AND path = ?', JSON.stringify({ ...info, unseen: 0 }), a, p)
        }
      })
      return true
    })
  }

  /** Messages that left the folder. Their category snapshots go too, since those may still list them. */
  remove(a: string, p: string, uids: number[], keepBodies = false): boolean {
    return this.guard(false, true, () => {
      this.tx(() => this.drop(a, p, uids, keepBodies))
      return true
    })
  }

  private drop(a: string, p: string, uids: number[], keepBodies: boolean): void {
    let unseen = 0
    for (const uid of uids) {
      const row = this.get<{ seen: number }>('SELECT seen FROM messages WHERE account_id = ? AND path = ? AND uid = ?', a, p, uid)
      if (row) unseen -= row.seen ? 0 : 1
      this.run('DELETE FROM messages WHERE account_id = ? AND path = ? AND uid = ?', a, p, uid)
      if (!keepBodies) this.run('DELETE FROM bodies WHERE account_id = ? AND path = ? AND uid = ?', a, p, uid)
    }
    this.adjustUnseen(a, p, unseen)
    this.run('DELETE FROM views WHERE account_id = ? AND path = ?', a, p)
  }

  /**
   * Messages moved out of `from`. Opened ones keep their body under the new UID when the server said what that is
   * and the destination's UIDs are the ones that answer refers to; the rows in `from` are removed either way.
   */
  moved(a: string, from: string, uids: number[], to: string, uidMap: Map<number, number> | undefined, toValidity: string | undefined): boolean {
    return this.guard(false, true, () => {
      this.tx(() => {
        const dest = this.get<{ uid_validity: string | null }>('SELECT uid_validity FROM folders WHERE account_id = ? AND path = ?', a, to)
        if (uidMap && toValidity && dest?.uid_validity === toValidity) {
          for (const [src, dst] of uidMap) {
            const b = this.get<{ detail: string; opened_at: number }>(
              'SELECT detail, opened_at FROM bodies WHERE account_id = ? AND path = ? AND uid = ?',
              a,
              from,
              src
            )
            if (!b) continue
            const detail = { ...(JSON.parse(b.detail) as MessageDetail), mailbox: to, uid: dst, key: `${a}|${to}|${dst}` }
            const json = JSON.stringify(detail)
            this.run(
              'INSERT OR REPLACE INTO bodies (account_id, path, uid, size, opened_at, detail) VALUES (?, ?, ?, ?, ?, ?)',
              a,
              to,
              dst,
              Buffer.byteLength(json),
              b.opened_at,
              json
            )
          }
        }
        this.drop(a, from, uids, false)
      })
      return true
    })
  }

  // ---------- Opened messages ----------

  /** Kept only while the folder's UIDVALIDITY is still the one the message was read under. */
  saveBody(a: string, p: string, uid: number, detail: MessageDetail, validity: string): boolean {
    return this.guard(false, true, () => {
      const f = this.get<{ uid_validity: string | null }>('SELECT uid_validity FROM folders WHERE account_id = ? AND path = ?', a, p)
      if (!f || f.uid_validity !== validity) return false
      const json = JSON.stringify(detail)
      const size = Buffer.byteLength(json)
      if (size > BODY_MAX_BYTES) return false
      this.run(
        'INSERT OR REPLACE INTO bodies (account_id, path, uid, size, opened_at, detail) VALUES (?, ?, ?, ?, ?, ?)',
        a,
        p,
        uid,
        size,
        Date.now(),
        json
      )
      return true
    })
  }

  /**
   * A message opened before, with the flags it has now. `wasSeen` is false when it is still unread on the server
   * as far as is known (it was opened, then marked unread again).
   */
  body(a: string, p: string, uid: number): { detail: MessageDetail; uidValidity: string; wasSeen: boolean } | null {
    return this.guard<{ detail: MessageDetail; uidValidity: string; wasSeen: boolean } | null>(null, false, () => {
      const b = this.get<{ detail: string; uid_validity: string | null }>(
        `SELECT b.detail, f.uid_validity FROM bodies b JOIN folders f ON f.account_id = b.account_id AND f.path = b.path
         WHERE b.account_id = ? AND b.path = ? AND b.uid = ?`,
        a,
        p,
        uid
      )
      if (!b || b.uid_validity === null) return null
      const m = this.get<{ seen: number; flagged: number }>(
        'SELECT seen, flagged FROM messages WHERE account_id = ? AND path = ? AND uid = ?',
        a,
        p,
        uid
      )
      const detail = JSON.parse(b.detail) as MessageDetail
      detail.uidValidity = b.uid_validity
      if (m) {
        detail.seen = true
        detail.flagged = !!m.flagged
      }
      return { detail, uidValidity: b.uid_validity, wasSeen: m ? !!m.seen : true }
    })
  }

  /** A saved search (a Gmail category tab), with the flags the messages have now. */
  view(a: string, p: string, name: string): MessageSummary[] | null {
    return this.guard<MessageSummary[] | null>(null, false, () => {
      const v = this.get<{ rows: string }>('SELECT rows FROM views WHERE account_id = ? AND path = ? AND name = ?', a, p, name)
      if (!v) return null
      return (JSON.parse(v.rows) as MessageSummary[]).map((r) => {
        const m = this.get<{ seen: number; flagged: number }>(
          'SELECT seen, flagged FROM messages WHERE account_id = ? AND path = ? AND uid = ?',
          a,
          p,
          r.uid
        )
        return m ? { ...r, seen: !!m.seen, flagged: !!m.flagged } : r
      })
    })
  }

  /** Only kept while the folder is still under the UIDVALIDITY the result was read under. */
  saveView(a: string, p: string, name: string, rows: MessageSummary[], validity: string): boolean {
    return this.guard(false, true, () => {
      const f = this.get<{ uid_validity: string | null }>('SELECT uid_validity FROM folders WHERE account_id = ? AND path = ?', a, p)
      if (!f || f.uid_validity !== validity) return false
      this.run(
        'INSERT OR REPLACE INTO views (account_id, path, name, rows) VALUES (?, ?, ?, ?)',
        a,
        p,
        name,
        JSON.stringify(rows)
      )
      return true
    })
  }

  // ---------- Accounts and housekeeping ----------

  forgetAccount(a: string): void {
    this.guard(undefined, true, () => {
      this.run('DELETE FROM folders WHERE account_id = ?', a)
      this.run('DELETE FROM drafts WHERE account_id = ?', a)
    })
  }

  /** The UIDVALIDITY a draft's UID was handed out under, if it is remembered. */
  draftValidity(a: string, uid: number): string | undefined {
    return this.guard<string | undefined>(undefined, false, () =>
      this.get<{ validity: string }>('SELECT validity FROM drafts WHERE account_id = ? AND uid = ?', a, uid)?.validity
    )
  }

  /** Kept across restarts: a draft restored from the recovery copy still has the UID it was saved under. */
  rememberDraft(a: string, uid: number, validity: string): void {
    this.guard(undefined, true, () => {
      this.run('INSERT OR REPLACE INTO drafts (account_id, uid, validity) VALUES (?, ?, ?)', a, uid, validity)
    })
  }

  forgetDrafts(a: string, uids: number[]): void {
    this.guard(undefined, true, () => {
      for (const uid of uids) this.run('DELETE FROM drafts WHERE account_id = ? AND uid = ?', a, uid)
    })
  }

  /** Drops accounts that no longer exist, e.g. after the settings file was reset. */
  prune(accountIds: string[]): void {
    this.guard(undefined, true, () => {
      const keep = new Set(accountIds)
      for (const r of this.all<{ account_id: string }>('SELECT DISTINCT account_id FROM folders')) {
        if (!keep.has(r.account_id)) this.run('DELETE FROM folders WHERE account_id = ?', r.account_id)
      }
      for (const r of this.all<{ account_id: string }>('SELECT DISTINCT account_id FROM drafts')) {
        if (!keep.has(r.account_id)) this.run('DELETE FROM drafts WHERE account_id = ?', r.account_id)
      }
    })
  }

  /**
   * Keeps the file from growing without end: the newest `keep` messages of each folder, nothing at all for folders
   * not opened in a long time, and the most recently opened bodies up to a size. `busy` holds folders (account|path)
   * that are being synced right now and are left alone. The limits are only changed by tests.
   */
  trim(busy: Set<string>, limits: { keep?: number; maxAgeMs?: number; bodiesMax?: number } = {}): void {
    const keep = limits.keep ?? KEEP_PER_FOLDER
    const maxAge = limits.maxAgeMs ?? FOLDER_MAX_AGE_MS
    const bodiesMax = limits.bodiesMax ?? BODIES_MAX_BYTES
    this.guard(undefined, true, () => {
      let freed = false
      const folders = this.all<{ account_id: string; path: string; floor_uid: number | null; visited_at: number | null }>(
        'SELECT account_id, path, floor_uid, visited_at FROM folders WHERE floor_uid IS NOT NULL'
      )
      for (const f of folders) {
        if (busy.has(`${f.account_id}|${f.path}`)) continue
        this.tx(() => {
          if (f.visited_at !== null && Date.now() - f.visited_at > maxAge) {
            // Back to a first visit; UIDVALIDITY stays, so the bodies still opened here remain valid.
            this.run('DELETE FROM messages WHERE account_id = ? AND path = ?', f.account_id, f.path)
            this.run('DELETE FROM views WHERE account_id = ? AND path = ?', f.account_id, f.path)
            this.run(
              `UPDATE folders SET gen = gen + 1, uid_next = NULL, messages = NULL, modseq = NULL, floor_uid = NULL
               WHERE account_id = ? AND path = ?`,
              f.account_id,
              f.path
            )
            freed = true
            return
          }
          const edge = this.get<{ uid: number }>(
            'SELECT uid FROM messages WHERE account_id = ? AND path = ? AND uid >= ? ORDER BY uid DESC LIMIT 1 OFFSET ?',
            f.account_id,
            f.path,
            f.floor_uid!,
            keep
          )
          // The message just past the newest `keep`: everything at or below it goes, and the floor moves above it.
          if (!edge) return
          this.run('DELETE FROM messages WHERE account_id = ? AND path = ? AND uid <= ?', f.account_id, f.path, edge.uid)
          this.run(
            'UPDATE folders SET gen = gen + 1, floor_uid = ? WHERE account_id = ? AND path = ?',
            edge.uid + 1,
            f.account_id,
            f.path
          )
          freed = true
        })
      }
      let total = this.get<{ n: number | null }>('SELECT SUM(size) AS n FROM bodies')?.n ?? 0
      if (total > bodiesMax) {
        const oldest = this.all<{ account_id: string; path: string; uid: number; size: number }>(
          'SELECT account_id, path, uid, size FROM bodies ORDER BY opened_at LIMIT ?',
          TRIM_BODIES_PER_PASS
        )
        this.tx(() => {
          for (const b of oldest) {
            if (total <= bodiesMax) break
            this.run('DELETE FROM bodies WHERE account_id = ? AND path = ? AND uid = ?', b.account_id, b.path, b.uid)
            total -= b.size
            freed = true
          }
        })
      }
      if (freed && !this.memory) {
        this.db.exec('PRAGMA incremental_vacuum')
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      }
    })
  }

  /** Bytes on disk, including the write-ahead log. */
  size(): number {
    return this.guard(0, false, () => {
      if (this.memory) return 0
      const pages = this.get<{ page_count: number }>('PRAGMA page_count')?.page_count ?? 0
      const pageSize = this.get<{ page_size: number }>('PRAGMA page_size')?.page_size ?? 0
      const wal = existsSync(`${this.file}-wal`) ? statSync(`${this.file}-wal`).size : 0
      return pages * pageSize + wal
    })
  }

  /** Deletes the file and starts again; cheaper than emptying the tables. */
  clear(): void {
    this.guard(undefined, true, () => {
      this.memory = false
      this.writeFailures = 0
      this.deleteFiles()
      this.open()
    })
  }

  close(): void {
    try {
      this.db.close()
    } catch {}
  }
}

const DRAFTS = `
CREATE TABLE drafts (
  account_id TEXT NOT NULL,
  uid        INTEGER NOT NULL,
  validity   TEXT NOT NULL,
  PRIMARY KEY (account_id, uid)
);
`

const SCHEMA = `
CREATE TABLE folders (
  account_id   TEXT NOT NULL,
  path         TEXT NOT NULL,
  listed       INTEGER NOT NULL DEFAULT 0,
  position     INTEGER,
  gen          INTEGER NOT NULL DEFAULT 0,
  uid_validity TEXT,
  uid_next     INTEGER,
  messages     INTEGER,
  modseq       TEXT,
  floor_uid    INTEGER,
  visited_at   INTEGER,
  info         TEXT,
  status       TEXT,
  PRIMARY KEY (account_id, path)
);
CREATE TABLE messages (
  account_id TEXT NOT NULL,
  path       TEXT NOT NULL,
  uid        INTEGER NOT NULL,
  seen       INTEGER NOT NULL,
  flagged    INTEGER NOT NULL,
  date       TEXT NOT NULL,
  summary    TEXT NOT NULL,
  PRIMARY KEY (account_id, path, uid),
  FOREIGN KEY (account_id, path) REFERENCES folders ON DELETE CASCADE
);
CREATE TABLE bodies (
  account_id TEXT NOT NULL,
  path       TEXT NOT NULL,
  uid        INTEGER NOT NULL,
  size       INTEGER NOT NULL,
  opened_at  INTEGER NOT NULL,
  detail     TEXT NOT NULL,
  PRIMARY KEY (account_id, path, uid),
  FOREIGN KEY (account_id, path) REFERENCES folders ON DELETE CASCADE
);
CREATE INDEX bodies_by_opened ON bodies (opened_at);
CREATE TABLE views (
  account_id TEXT NOT NULL,
  path       TEXT NOT NULL,
  name       TEXT NOT NULL,
  rows       TEXT NOT NULL,
  PRIMARY KEY (account_id, path, name),
  FOREIGN KEY (account_id, path) REFERENCES folders ON DELETE CASCADE
);
`
