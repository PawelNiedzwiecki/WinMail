// Small decoding helpers for message previews.

export function decodeTransfer(raw: Buffer, encoding: string | undefined): Buffer {
  const enc = (encoding ?? '').toLowerCase()
  if (enc === 'base64') {
    // Partial fetches can cut base64 mid-quad; drop the incomplete tail.
    const s = raw.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, '')
    return Buffer.from(s.slice(0, s.length - (s.length % 4)), 'base64')
  }
  if (enc === 'quoted-printable') {
    const s = raw.toString('latin1').replace(/=\r?\n/g, '')
    const out: number[] = []
    for (let i = 0; i < s.length; i++) {
      const hex = s.slice(i + 1, i + 3)
      if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16))
        i += 2
      } else {
        out.push(s.charCodeAt(i) & 0xff)
      }
    }
    return Buffer.from(out)
  }
  return raw
}

export function decodeCharset(buf: Buffer, charset: string | undefined): string {
  try {
    return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  zwnj: '',
  zwj: '',
  pound: '£',
  euro: '€',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  times: '×',
  deg: '°'
}

// Out-of-range numeric entities (e.g. &#99999999;) would make fromCodePoint throw.
const codePoint = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '�')

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?(<\/\1>|$)/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>?/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
}

export function makePreview(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('>'))
    .join(' ')
    .replace(/[​-‍͏­﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)
}
