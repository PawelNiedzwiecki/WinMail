import type { WinMailApi } from '@shared/types'
import { createMockApi } from './mockApi'

declare global {
  interface Window {
    winmail?: WinMailApi
  }
}

/** Real IPC bridge inside Electron; in-memory mock when opened in a plain browser. */
export const api: WinMailApi = window.winmail ?? createMockApi()
