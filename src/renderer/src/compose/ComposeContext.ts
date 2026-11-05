import { createContext, useContext } from 'react'
import type { Account, Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

/** What the compose UI reads from the rest of the app. */
export interface ComposeCtx {
  /** Enabled accounts. */
  accounts: Account[]
  settings: Settings
  /**
   * A Claude API key is saved, so replies show "Suggest a reply". The key alone sends nothing: whether it may send
   * the message is `settings.contentOptIns.reply` (ADR 0001).
   */
  aiAvailable: boolean
}

export const ComposeContext = createContext<ComposeCtx>({ accounts: [], settings: DEFAULT_SETTINGS, aiAvailable: false })

export const useComposeCtx = () => useContext(ComposeContext)
