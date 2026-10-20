export type MailboxId = 'inbox' | 'vip' | 'flagged' | 'drafts' | 'sent' | 'junk' | 'trash' | 'archive'

export interface Mailbox {
  id: MailboxId
  name: string
  icon: string
}

export interface Message {
  id: string
  mailbox: MailboxId
  from: { name: string; email: string }
  to: string
  subject: string
  preview: string
  body: string
  date: string // ISO
  read: boolean
  flagged: boolean
  attachments?: { name: string; size: string }[]
}
