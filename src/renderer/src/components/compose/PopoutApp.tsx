import { AppWindow } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type Account, type Settings } from '@shared/types'
import { api } from '../../api'
import { flushAll, returnToMain, saveTemplatesFromPopout, setComposeEnv, startPopout, stash } from '../../compose/actions'
import { ComposeContext } from '../../compose/ComposeContext'
import type { PopoutPayload } from '../../compose/popout'
import { useSession, useSessionList } from '../../compose/sessions'
import { applyReduceMotion } from '../../motion'
import { toast } from '../../toasts'
import { ToastStack } from '../ToastStack'
import { ComposeForm } from './ComposeForm'

interface Boot {
  id: string
  accounts: Account[]
  settings: Settings
  aiAvailable: boolean
}

/** A compose card in a window of its own: the same form, under a title bar instead of in the dock. */
export default function PopoutApp() {
  const [boot, setBoot] = useState<Boot | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [payload, accounts, saved, aiAvailable] = await Promise.all([
        api.popoutPayload() as Promise<PopoutPayload | null>,
        api.listAccounts(),
        api.getSettings(),
        api.aiAvailable().catch(() => false)
      ])
      if (!alive) return
      if (!payload) return void window.close()
      const enabled = accounts.filter((a) => a.enabled)
      const id = payload.session.id
      setComposeEnv({
        accounts: enabled,
        settings: saved,
        defaultAccountId: () => payload.session.accountId,
        refreshIfShowing: () => {},
        selectMailbox: () => {},
        setSettings: (next) => {
          setSettings(next)
          void saveTemplatesFromPopout(next.templates).then(setSettings, (e) =>
            toast({ text: e instanceof Error ? e.message : String(e), tone: 'error' })
          )
        },
        focusList: () => {},
        selectedKey: () => null
      })
      setSettings(saved)
      applyReduceMotion(saved.reduceMotion)
      startPopout(payload)
      setBoot({ id, accounts: enabled, settings: saved, aiAvailable })
    })()
    return () => {
      alive = false
    }
  }, [])

  // The window asks before closing so the draft can be saved first.
  useEffect(
    () =>
      api.onCloseRequested(async () => {
        await flushAll().catch(console.error)
        api.closeReady()
      }),
    []
  )
  useEffect(() => {
    window.addEventListener('beforeunload', stash)
    return () => window.removeEventListener('beforeunload', stash)
  }, [])
  // A drop outside the card must not navigate the window to the file.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (!(e.target as HTMLElement).closest?.('input, textarea, [contenteditable], [data-compose]')) e.preventDefault()
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => {
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
    }
  }, [])

  // The window lives as long as its card: sent, scheduled, discarded, saved and closed, or handed back.
  const entries = useSessionList()
  useEffect(() => {
    if (boot && !entries.length) window.close()
  }, [boot, entries.length])

  if (!boot) return null
  return (
    <ComposeContext.Provider value={{ accounts: boot.accounts, settings, aiAvailable: boot.aiAvailable }}>
      <Card id={boot.id} />
      <ToastStack />
    </ComposeContext.Provider>
  )
}

function Card({ id }: { id: string }) {
  const s = useSession(id)
  const title = s?.subject.trim() || 'New Message'
  useEffect(() => {
    document.title = title
  }, [title])
  if (!s) return null
  return (
    <section className="compose popout" aria-label={title} data-compose={id}>
      <header className="compose-head popout-head">
        <span className="compose-title">{title}</span>
        <button
          className="head-btn"
          title="Move to main window"
          aria-label="Move to main window"
          onClick={() => void returnToMain(id)}
        >
          <AppWindow size={16} />
        </button>
      </header>
      <ComposeForm id={id} showSubject />
    </section>
  )
}
