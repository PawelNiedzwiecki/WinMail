import type { Mailbox, Message } from './types'

export const mailboxes: Mailbox[] = [
  { id: 'inbox', name: 'Inbox', icon: 'inbox' },
  { id: 'vip', name: 'VIP', icon: 'star' },
  { id: 'flagged', name: 'Flagged', icon: 'flag' },
  { id: 'drafts', name: 'Drafts', icon: 'file' },
  { id: 'sent', name: 'Sent', icon: 'send' },
  { id: 'junk', name: 'Junk', icon: 'junk' },
  { id: 'trash', name: 'Bin', icon: 'trash' },
  { id: 'archive', name: 'Archive', icon: 'archive' }
]

const now = new Date()
const ago = (mins: number) => new Date(now.getTime() - mins * 60_000).toISOString()

export const messages: Message[] = [
  {
    id: '1',
    mailbox: 'inbox',
    from: { name: 'Monzo', email: 'help@monzo.com' },
    to: 'me',
    subject: 'Your October statement is ready',
    preview: 'Hi Pawel, your statement for October is now available in the app.',
    body: 'Hi Pawel,\n\nYour statement for October is now available in the app. You can download it as a PDF or CSV from the Account tab.\n\nThanks,\nMonzo',
    date: ago(12),
    read: false,
    flagged: false
  },
  {
    id: '2',
    mailbox: 'inbox',
    from: { name: 'Adam Baumgartner', email: 'adam@example.com' },
    to: 'me',
    subject: 'Flat keys and move-in day',
    preview: 'Agent says keys are ready from Friday. Can you do 10:00 at Old Station House?',
    body: 'Hey,\n\nAgent says keys are ready from Friday. Can you do 10:00 at Old Station House? I can bring the van.\n\nAlso, do we still need to sort broadband?\n\nAdam',
    date: ago(95),
    read: false,
    flagged: true
  },
  {
    id: '3',
    mailbox: 'inbox',
    from: { name: 'GitHub', email: 'noreply@github.com' },
    to: 'me',
    subject: '[bumbag] PR #42: Offline map caching',
    preview: 'Review requested. 14 files changed, 612 additions, 88 deletions.',
    body: 'Review requested on PR #42 "Offline map caching".\n\n14 files changed, 612 additions, 88 deletions.\n\nView it on GitHub.',
    date: ago(60 * 5),
    read: true,
    flagged: false,
    attachments: [{ name: 'diff-summary.txt', size: '4 KB' }]
  },
  {
    id: '4',
    mailbox: 'inbox',
    from: { name: 'Transport for London', email: 'contactless@tfl.gov.uk' },
    to: 'me',
    subject: 'Your weekly journey summary',
    preview: 'You travelled 9 times this week. Total charged: £27.40.',
    body: 'You travelled 9 times this week.\n\nTotal charged: £27.40\nWeekly cap reached: No\n\nView full history in your TfL account.',
    date: ago(60 * 26),
    read: true,
    flagged: false
  },
  {
    id: '5',
    mailbox: 'inbox',
    from: { name: 'Recruiter, Acme', email: 'talent@acme.example' },
    to: 'me',
    subject: 'Senior React Native Engineer role',
    preview: 'Hi Pawel, I came across your profile and think you could be a great fit.',
    body: 'Hi Pawel,\n\nI came across your profile and think you could be a great fit for our Senior React Native Engineer role. Hybrid, London Bridge.\n\nWould you be open to a quick call this week?\n\nBest,\nSam',
    date: ago(60 * 50),
    read: true,
    flagged: true
  },
  {
    id: '6',
    mailbox: 'sent',
    from: { name: 'Me', email: 'me@example.com' },
    to: 'Hyperoptic Support',
    subject: 'Re: Account closure fee',
    preview: 'Hi, I am disputing the early termination fee because the service is not available at my new address.',
    body: 'Hi,\n\nI am disputing the early termination fee because the service is not available at my new address.\n\nRegards,\nPawel',
    date: ago(60 * 72),
    read: true,
    flagged: false
  }
]
