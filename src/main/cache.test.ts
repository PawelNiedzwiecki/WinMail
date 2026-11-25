import { mkdtempSync, rmSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const { MailCache } = await import('./cache')

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A schema 3 file with one newsletter and one reply saved the way #69 saved them. */
function version3File(): string {
  const dir = mkdtempSync(join(tmpdir(), 'winmail-cache-'))
  dirs.push(dir)
  const file = join(dir, 'mail-cache.db')
  new MailCache(file).close()
  const db = new DatabaseSync(file)
  db.exec(`INSERT INTO folders (account_id, path) VALUES ('a', 'INBOX')`)
  const insert = db.prepare(
    `INSERT INTO messages (account_id, path, uid, seen, flagged, date, summary) VALUES ('a', 'INBOX', ?, 0, 0, '2026-11-01', ?)`
  )
  insert.run(1, JSON.stringify({ subject: 'Weekly', parents: ['<weekly.lists.example.com>', '<mailto:leave@lists.example.com>', '<https://lists.example.com/u/abc>'] }))
  insert.run(2, JSON.stringify({ subject: 'Re: plans', parents: ['<a@example.com>', '<team.lists.example.com>'] }))
  insert.run(3, JSON.stringify({ subject: 'Hello', parents: [] }))
  db.exec(`INSERT INTO views (account_id, path, name, rows) VALUES ('a', 'INBOX', 'promotions', '[]')`)
  db.exec('PRAGMA user_version = 3')
  db.close()
  return file
}

describe('MailCache schema 4', () => {
  it('drops List-Id and List-Unsubscribe values from saved parents and keeps the rest', () => {
    const file = version3File()
    new MailCache(file).close()

    const db = new DatabaseSync(file)
    const parents = (db.prepare('SELECT uid, summary FROM messages ORDER BY uid').all() as { uid: number; summary: string }[]).map(
      (r) => (JSON.parse(r.summary) as { parents: string[] }).parents
    )
    expect(parents).toEqual([[], ['<a@example.com>'], []])
    expect(db.prepare('SELECT COUNT(*) AS n FROM views').get()).toEqual({ n: 0 })
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 })
    db.close()
  })
})
