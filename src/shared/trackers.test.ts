import { describe, expect, it } from 'vitest'
import {
  addLink,
  addPixel,
  cleanedText,
  cleanLink,
  findTrackingPixel,
  newReport,
  shieldText,
  trackerDetails,
  trackerHeadline
} from './trackers'

const b64url = (s: string) => Buffer.from(s).toString('base64url')

describe('findTrackingPixel', () => {
  it('drops a known open-tracking address at any size', () => {
    const p = findTrackingPixel({ src: 'https://acme.us12.list-manage.com/track/open.php?u=1&id=2&e=3', width: '600' })
    expect(p).toEqual({ service: 'Mailchimp', host: 'acme.us12.list-manage.com' })
  })

  it('drops tiny and hidden images and names an unknown service by its host', () => {
    expect(findTrackingPixel({ src: 'https://www.example.com/a.png', width: '1', height: '1' })).toEqual({
      service: null,
      host: 'example.com'
    })
    expect(findTrackingPixel({ src: 'https://x.example/a.png', style: 'width:1px;height:1px' })).not.toBeNull()
    expect(findTrackingPixel({ src: 'https://x.example/a.png', style: 'display: none' })).not.toBeNull()
    expect(findTrackingPixel({ src: 'https://x.example/a.png', style: 'visibility:hidden' })).not.toBeNull()
    expect(findTrackingPixel({ src: 'https://x.example/a.png', style: 'opacity:0;' })).not.toBeNull()
    expect(findTrackingPixel({ src: 'https://x.example/a.png', width: '0', height: '0' })).not.toBeNull()
  })

  it('drops open-tracking paths unless the image says it is bigger than a speck', () => {
    expect(findTrackingPixel({ src: 'https://news.example/open?id=9' })).not.toBeNull()
    expect(findTrackingPixel({ src: 'https://news.example/track/open/abc.gif' })).not.toBeNull()
    expect(findTrackingPixel({ src: 'https://news.example/o.gif?x=1' })).not.toBeNull()
    expect(findTrackingPixel({ src: 'https://github.com/notifications/beacon/AB12.gif' })?.service).toBe('GitHub')
    expect(findTrackingPixel({ src: 'https://news.example/pixel', width: '300', height: '200' })).toBeNull()
  })

  it('keeps real images that merely sit in a directory named like a tracker', () => {
    expect(findTrackingPixel({ src: 'https://cdn.shop.example/tracking/map.png' })).toBeNull()
    expect(findTrackingPixel({ src: 'https://cdn.shop.example/pixel/logo.png' })).toBeNull()
    expect(findTrackingPixel({ src: 'https://cdn.shop.example/track/route.jpg' })).toBeNull()
    // but the open-tracking shapes of those directories still are pixels
    expect(findTrackingPixel({ src: 'https://x.example/pixel' })).not.toBeNull()
    expect(findTrackingPixel({ src: 'https://x.example/beacon/abc123' })).not.toBeNull()
    expect(findTrackingPixel({ src: 'https://x.example/pixel/a.gif' })).not.toBeNull()
    expect(findTrackingPixel({ src: 'https://github.com/notifications/beacon/AB12.gif' })?.service).toBe('GitHub')
  })

  it('catches white-labelled SendGrid and Amazon SES addresses', () => {
    expect(findTrackingPixel({ src: 'https://links.brand.example/wf/open?upn=abc123' })?.service).toBe('SendGrid')
    expect(findTrackingPixel({ src: 'https://r.eu-west-1.awstrack.me/I0/0102abc/def', width: '5' })?.service).toBe('Amazon SES')
  })

  it('keeps real images, also from a tracking service host', () => {
    expect(findTrackingPixel({ src: 'https://mcusercontent.com/logo.png', width: '200', height: '60' })).toBeNull()
    expect(findTrackingPixel({ src: 'https://us12.list-manage.com/logo.png', width: '200', height: '60' })).toBeNull()
    expect(findTrackingPixel({ src: 'https://cdn.example/divider.gif', width: '600', height: '1' })).toBeNull()
    expect(findTrackingPixel({ src: 'https://cdn.example/photo.jpg' })).toBeNull()
    expect(findTrackingPixel({ src: 'https://cdn.example/open-source.png' })).toBeNull()
  })

  it('ignores images that reach no server', () => {
    expect(findTrackingPixel({ src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', width: '1', height: '1' })).toBeNull()
    expect(findTrackingPixel({ src: 'cid:logo@mail', width: '1', height: '1' })).toBeNull()
    expect(findTrackingPixel({ src: '/relative.gif', width: '1', height: '1' })).toBeNull()
  })
})

describe('cleanLink: tracking parameters', () => {
  it('strips tracking parameters and keeps the rest, the order and the hash', () => {
    const r = cleanLink('https://shop.example/p/1?color=red&utm_source=news&utm_medium=email&fbclid=AB&size=m#reviews')
    expect(r).toMatchObject({ change: 'stripped', href: 'https://shop.example/p/1?color=red&size=m#reviews' })
  })

  it('drops the question mark when nothing is left, and handles prefixes', () => {
    expect(cleanLink('https://a.example/x?utm_campaign=z&__hstc=1&_hsenc=2&mc_eid=3&vero_id=4').href).toBe('https://a.example/x')
    expect(cleanLink('https://a.example/x?gclid=1').change).toBe('stripped')
  })

  it('leaves clean links exactly as written', () => {
    for (const l of ['https://a.example', 'https://a.example/?q=a%20b&page=2', 'mailto:me@example.com', 'not a url', '#top']) {
      expect(cleanLink(l)).toEqual({ href: l, change: 'none', via: null, service: null })
    }
  })

  it('strips LinkedIn tracking only on LinkedIn', () => {
    expect(cleanLink('https://www.linkedin.com/comm/jobs/view/1?trackingId=a&trk=b&eid=c&keep=1').href).toBe(
      'https://www.linkedin.com/comm/jobs/view/1?keep=1'
    )
    expect(cleanLink('https://a.example/?trk=b&eid=c').change).toBe('none')
  })
})

describe('cleanLink: unwrapping', () => {
  const dest = 'https://example.org/article?id=7&utm_source=x'
  const cleaned = 'https://example.org/article?id=7'

  it('unwraps known redirects whose destination is in the link, then strips parameters', () => {
    const cases: [string, string][] = [
      [`https://www.google.com/url?sa=D&q=${encodeURIComponent(dest)}&usg=x`, 'www.google.com'],
      [`https://l.facebook.com/l.php?u=${encodeURIComponent(dest)}&h=abc`, 'l.facebook.com'],
      [`https://www.linkedin.com/safety/go?url=${encodeURIComponent(dest)}`, 'www.linkedin.com'],
      [`https://www.youtube.com/redirect?q=${encodeURIComponent(dest)}&event=x`, 'www.youtube.com'],
      [`https://slack-redir.net/link?url=${encodeURIComponent(dest)}`, 'slack-redir.net']
    ]
    for (const [wrapped, via] of cases) {
      expect(cleanLink(wrapped)).toMatchObject({ change: 'unwrapped', href: cleaned, via })
    }
  })

  it('unwraps Substack, Amazon SES and ?url= on a known click host', () => {
    const sub = `https://substack.com/redirect/2/${b64url(JSON.stringify({ e: dest, p: 1 }))}.sig`
    expect(cleanLink(sub)).toMatchObject({ change: 'unwrapped', href: cleaned, service: 'Substack' })
    const ses = `https://r.us-east-1.awstrack.me/L0/${encodeURIComponent(dest)}/1/0100/abc-def`
    expect(cleanLink(ses)).toMatchObject({ change: 'unwrapped', href: cleaned, service: 'Amazon SES' })
    // What SES really writes: a literal colon, then encoded slashes.
    const sesReal = 'https://r.us-east-2.awstrack.me/L0/https:%2F%2Fexample.org%2Farticle%3Fid=7%26utm_source=x/1/0100abc-def'
    expect(cleanLink(sesReal)).toMatchObject({ change: 'unwrapped', href: cleaned, service: 'Amazon SES' })
    const mj = `https://x.mjt.lu/lnk/AAA/BBB/1/C/${'D'}?url=${encodeURIComponent(dest)}`
    expect(cleanLink(mj)).toMatchObject({ change: 'unwrapped', href: cleaned, service: 'Mailjet' })
    const b64 = `https://email.mg.example.mailgun.org/c/abc?target=${b64url(dest)}`
    expect(cleanLink(b64)).toMatchObject({ change: 'unwrapped', href: cleaned, service: 'Mailgun' })
  })

  it('unwraps up to three layers', () => {
    const l1 = `https://www.google.com/url?q=${encodeURIComponent(dest)}`
    const l2 = `https://l.facebook.com/l.php?u=${encodeURIComponent(l1)}`
    const l3 = `https://slack-redir.net/link?url=${encodeURIComponent(l2)}`
    expect(cleanLink(l3)).toMatchObject({ change: 'unwrapped', href: cleaned, via: 'slack-redir.net' })
    const l4 = `https://www.youtube.com/redirect?q=${encodeURIComponent(l3)}`
    // A fourth layer is not taken: the three outer ones come off and the Google link is left as it was.
    expect(cleanLink(l4)).toMatchObject({ change: 'unwrapped', href: l1, via: 'www.youtube.com' })
  })

  it('never reads a destination that is not a web address', () => {
    expect(cleanLink('https://www.google.com/url?q=javascript:alert(1)').change).toBe('none')
    expect(cleanLink('https://www.google.com/url?q=' + encodeURIComponent('file:///etc/passwd')).change).toBe('none')
    expect(cleanLink(`https://www.google.com/url?q=${b64url('javascript:alert(1)//aaaa')}`).change).toBe('none')
  })

  it('does not unwrap share buttons or other links that merely carry a url', () => {
    expect(cleanLink('https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fexample.org%2Fa').change).toBe('none')
    expect(cleanLink('https://shop.example/redirect?url=https%3A%2F%2Fexample.org%2Fa').change).toBe('none')
  })

  it('leaves the reader’s own security scanners alone', () => {
    const safe = `https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent(dest)}&data=05&utm_source=x`
    expect(cleanLink(safe)).toEqual({ href: safe, change: 'none', via: null, service: null })
    const pf = `https://urldefense.com/v3/__${dest}__;!!abc$`
    expect(cleanLink(pf).change).toBe('none')
    const inner = `https://www.google.com/url?q=${encodeURIComponent(safe)}`
    expect(cleanLink(inner)).toMatchObject({ change: 'unwrapped', href: safe })
  })
})

describe('cleanLink: marked links', () => {
  it('marks click links whose destination is not in the link and leaves them as written', () => {
    const l = 'https://acme.us12.list-manage.com/track/click?u=1234567890&id=abcdef&e=0123'
    expect(cleanLink(l)).toEqual({ href: l, change: 'marked', via: 'acme.us12.list-manage.com', service: 'Mailchimp' })
    expect(cleanLink('https://u123.ct.sendgrid.net/ls/click?upn=abc').service).toBe('SendGrid')
    expect(cleanLink('https://links.brand.example/ls/click?upn=abc').change).toBe('marked')
    expect(cleanLink('https://abc.hubspotlinks.com/Ctc/ZR+113/abc').service).toBe('HubSpot')
  })

  it('marks every link on hosts that exist only to count clicks', () => {
    expect(cleanLink('https://click.convertkit-mail2.com/abc/def/ghi').service).toBe('ConvertKit')
    expect(cleanLink('https://via.intercom-clicks.com/anything/at/all').service).toBe('Intercom')
  })

  it('does not mark HubSpot’s own site, only its link and mail hosts', () => {
    expect(cleanLink('https://www.hubspot.com/Doc/guide').change).toBe('none')
    expect(cleanLink('https://blog.hubspot.com/Ctc/not-a-tracker').change).toBe('none')
    expect(cleanLink('https://abc.hubspotlinks.com/Ctc/ZR+113/abc').change).toBe('marked')
    expect(cleanLink('https://abc.hubspotemail.net/e2t/c/*abc').change).toBe('marked')
    // its pixel is still recognised on any host
    expect(findTrackingPixel({ src: 'https://track.brand.example/__ptq.gif?a=1', width: '50' })?.service).toBe('HubSpot')
  })

  it('does not mark a service’s ordinary pages', () => {
    expect(cleanLink('https://us12.list-manage.com/unsubscribe?u=1&id=2').change).toBe('none')
    expect(cleanLink('https://substack.com/@writer').change).toBe('none')
  })

  it('marks what is left after unwrapping', () => {
    const inner = 'https://acme.us12.list-manage.com/track/click?u=1&id=2&e=3'
    const r = cleanLink(`https://www.google.com/url?q=${encodeURIComponent(inner)}`)
    expect(r).toMatchObject({ change: 'marked', href: inner, service: 'Mailchimp' })
  })
})

describe('report and wording', () => {
  const report = () => {
    const r = newReport()
    addPixel(r, 'https://a.list-manage.com/track/open.php?u=1', { service: 'Mailchimp', host: 'a.list-manage.com' })
    for (const l of [
      'https://a.example/?utm_source=x',
      'https://a.example/?utm_source=x', // the same link twice counts once
      'https://a.list-manage.com/track/click?u=1&id=2',
      `https://www.google.com/url?q=${encodeURIComponent('https://b.example/')}`
    ]) {
      addLink(r, l, cleanLink(l))
    }
    return r
  }

  it('counts each distinct link once', () => {
    expect(report().links).toHaveLength(3)
    expect(trackerHeadline(report())).toBe('Tracked by Mailchimp · 3 tracked links')
  })

  it('words one link, links only, an unknown pixel, and many services', () => {
    const one = newReport()
    addLink(one, 'https://a.example/?gclid=1', cleanLink('https://a.example/?gclid=1'))
    expect(trackerHeadline(one)).toBe('1 tracked link')

    const px = newReport()
    addPixel(px, 'https://t.example/a.gif', { service: null, host: 't.example' })
    expect(trackerHeadline(px)).toBe('Tracked by t.example')

    const many = newReport()
    for (const [i, s] of ['A', 'B', 'C', 'D'].entries()) addPixel(many, `https://${s}.example/${i}`, { service: s, host: `${s}.example` })
    expect(trackerHeadline(many)).toBe('Tracked by A, B and 2 others')
    addLink(many, 'https://x.example/?fbclid=1', cleanLink('https://x.example/?fbclid=1'))
    expect(trackerHeadline(many)).toBe('Tracked by A, B and 2 others · 1 tracked link')

    expect(trackerHeadline(newReport())).toBeNull()

    // The sender's own hidden pixel is not a second company when a known service is involved.
    const mixed = report()
    addPixel(mixed, 'https://stats.example/px.gif', { service: null, host: 'stats.example' })
    expect(trackerHeadline(mixed)).toBe('Tracked by Mailchimp · 3 tracked links')
  })

  it('lists the details', () => {
    expect(trackerDetails(report())).toEqual([
      'Tracking pixel removed · Mailchimp (a.list-manage.com)',
      '1 link cleaned · tracking parameters removed',
      '1 link unwrapped · opens the destination directly',
      '1 tracked link · goes through a.list-manage.com'
    ])
  })
})

describe('plain text', () => {
  const text = 'Read it: https://a.example/post?utm_source=x&id=3. Or https://a.us1.list-manage.com/track/click?u=1&id=2 now.'

  it('cleans links in place and keeps the rest', () => {
    expect(cleanedText(text)).toBe(
      'Read it: https://a.example/post?id=3. Or https://a.us1.list-manage.com/track/click?u=1&id=2 now.'
    )
  })

  it('reports what it found and describes each link', () => {
    const { parts, report } = shieldText(text)
    expect(report.links.map((l) => l.change)).toEqual(['stripped', 'marked'])
    const links = parts.filter((p) => 'href' in p)
    expect(links).toHaveLength(2)
    expect(links[1]).toMatchObject({ change: 'marked', via: 'a.us1.list-manage.com' })
  })
})
