import { Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type InviteAnswer, type MessageDetail, type MessageSummary, type Settings } from '@shared/types'
import { api } from '../api'
import { setComposeEnv } from '../compose/actions'
import type { PopoutMessage } from '../compose/popout'
import type { ReplyMode } from '../compose/sessions'
import { applyReduceMotion } from '../motion'
import { printDocument } from '../print'
import { toast } from '../toasts'
import type { MenuItem } from './ContextMenu'
import { MessageView } from './MessageView'
import { ToastStack } from './ToastStack'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * A message in a window of its own, opened by double-clicking it in the list. Replies go back to
 * the main window, which opens them in compose windows of their own.
 */
export default function MessageWindowApp() {
  const [summary, setSummary] = useState<MessageSummary | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [remoteAllowed, setRemoteAllowed] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [payload, accounts, saved] = await Promise.all([
        api.messageWindowPayload(),
        api.listAccounts(),
        api.getSettings()
      ])
      if (!alive) return
      if (!payload) return void window.close()
      // Reply All needs to know which addresses are yours.
      setComposeEnv({
        accounts: accounts.filter((a) => a.enabled),
        settings: saved,
        defaultAccountId: () => payload.accountId,
        refreshIfShowing: () => {},
        selectMailbox: () => {},
        setSettings: () => {},
        focusList: () => {},
        selectedKey: () => null
      })
      applyReduceMotion(saved.reduceMotion)
      setSettings(saved)
      setSummary(payload)
      api.getMessage(payload.accountId, payload.mailbox, payload.uid, payload.uidValidity).then(
        (d) => alive && setDetail(d),
        (e) => alive && setError(errText(e))
      )
    })()
    return () => {
      alive = false
    }
  }, [])

  // Nothing to save here: the window may close as soon as it is asked.
  useEffect(() => api.onCloseRequested(() => api.closeReady()), [])

  useEffect(() => {
    document.title = summary?.subject || 'Message'
  }, [summary])

  if (!summary) return null
  const allowRemote = settings.loadRemoteContent || remoteAllowed

  const reply = (mode: ReplyMode) => {
    const m: PopoutMessage = { type: 'reply', mode, summary, detail, allowRemote }
    api.popoutSend(m)
  }

  const saveAttachment = async (index: number) => {
    try {
      const path = await api.saveAttachment(summary.accountId, summary.mailbox, summary.uid, index, summary.uidValidity)
      if (path) toast(`Saved to ${path}`)
    } catch (e) {
      toast({ text: errText(e), tone: 'error' })
    }
  }

  const answerInvite = async (answer: InviteAnswer) => {
    try {
      const invite = await api.answerInvite(summary.accountId, summary.mailbox, summary.uid, answer, summary.uidValidity)
      setDetail((d) => (d ? { ...d, invite } : d))
      toast(`Answer sent to ${invite.organizer?.name || invite.organizer?.email || 'the organiser'}`)
    } catch (e) {
      toast({ text: errText(e), tone: 'error' })
      throw e
    }
  }

  const openInvite = () => {
    api
      .openInvite(summary.accountId, summary.mailbox, summary.uid, summary.uidValidity)
      .catch((e) => toast({ text: errText(e), tone: 'error' }))
  }

  const moreItems = (): MenuItem[] => [
    {
      label: 'Print…',
      icon: <Printer size={14} />,
      disabled: !detail,
      onSelect: () => {
        if (detail) api.print(printDocument(detail, allowRemote)).catch((e) => toast({ text: errText(e), tone: 'error' }))
      }
    }
  ]

  return (
    <div className="message-window">
      <header className="message-window-head">
        <span className="message-window-title">{summary.subject || '(No Subject)'}</span>
      </header>
      <MessageView
        summary={summary}
        detail={detail}
        error={error}
        allowRemote={allowRemote}
        onAllowRemote={() => setRemoteAllowed(true)}
        messageAppearance={settings.messageAppearance}
        onSaveAttachment={(i) => void saveAttachment(i)}
        inlineReplyId={null}
        isDraft={false}
        onReply={reply}
        onEditDraft={() => {}}
        moreItems={moreItems}
        onAnswerInvite={answerInvite}
        onOpenInvite={openInvite}
      />
      <ToastStack />
    </div>
  )
}
