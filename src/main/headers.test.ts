import { describe, expect, it } from 'vitest'
import { headerValue, isReplyHeaders, parentIds } from './headers'

// Summary headers as imapflow returns them: only the fields WinMail asked for, folded lines kept.
const newsletter = [
  'List-Id: Weekly Digest <weekly.lists.example.com>',
  'List-Unsubscribe: <mailto:leave@lists.example.com>,',
  ' <https://lists.example.com/u/abc>',
  'Precedence: bulk',
  ''
].join('\r\n')

const reply = [
  'References: <a@example.com>',
  ' <b@example.com>',
  'List-Id: Team <team.lists.example.com>',
  ''
].join('\r\n')

describe('parentIds', () => {
  it('does not take List-Id or List-Unsubscribe values as parents', () => {
    expect(parentIds(newsletter, undefined)).toEqual([])
    expect(isReplyHeaders(newsletter, undefined)).toBe(false)
  })

  it('keeps folded References and In-Reply-To, without repeats', () => {
    expect(parentIds(reply, '<b@example.com>')).toEqual(['<a@example.com>', '<b@example.com>'])
    expect(parentIds('', '<c@example.com>')).toEqual(['<c@example.com>'])
    expect(isReplyHeaders(reply, undefined)).toBe(true)
  })

  it('two newsletters from one list share no parent', () => {
    const a = parentIds(newsletter, undefined)
    const b = parentIds(newsletter.replace('abc', 'xyz'), undefined)
    expect(a.filter((id) => b.includes(id))).toEqual([])
  })
})

describe('headerValue', () => {
  it('joins folded lines and ignores case', () => {
    expect(headerValue(newsletter, 'list-unsubscribe')).toBe('<mailto:leave@lists.example.com>, <https://lists.example.com/u/abc>')
    expect(headerValue(newsletter, 'references')).toBeNull()
  })
})
