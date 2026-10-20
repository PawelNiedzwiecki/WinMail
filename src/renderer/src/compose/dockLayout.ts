/** Docked cards: sizes and placement along the bottom edge, first opened at the far right. */
export const CARD_W = 520
export const BAR_W = 260
export const GAP = 12
export const EDGE = 16
export const MORE_W = 56

export interface DockItem {
  id: string
  minimized: boolean
  openedAt: number
  activeAt: number
}

export interface DockLayout {
  /** `right` offset in px for each visible card. */
  right: Record<string, number>
  /** Cards that don't fit, listed in the "+N" menu, most recent first. */
  hidden: string[]
  /** `right` offset of the "+N" tab, when there is one. */
  moreRight: number | null
  cardWidth: number
}

export const cardWidth = (windowWidth: number) => Math.min(CARD_W, windowWidth - 2 * EDGE)

/** How many full cards fit side by side: 1 at 900 px, 2 at 1280, 3 at 1920. */
export const maxOpen = (windowWidth: number) =>
  Math.max(1, Math.floor((windowWidth - 2 * EDGE + GAP) / (cardWidth(windowWidth) + GAP)))

export function layoutDock(items: DockItem[], windowWidth: number): DockLayout {
  const cw = cardWidth(windowWidth)
  const avail = windowWidth - 2 * EDGE
  const width = (i: DockItem) => (i.minimized ? BAR_W : cw)

  // The most recently used cards stay visible; the rest go to the "+N" menu.
  const byRecent = [...items].sort((a, b) => b.activeAt - a.activeAt)
  const shown: DockItem[] = []
  let used = 0
  for (const [n, item] of byRecent.entries()) {
    const next = used + (shown.length ? GAP : 0) + width(item)
    const more = n < byRecent.length - 1 ? GAP + MORE_W : 0
    if (shown.length && next + more > avail) break
    shown.push(item)
    used = next
  }
  const hidden = byRecent.slice(shown.length).map((i) => i.id)

  const right: Record<string, number> = {}
  let x = EDGE
  for (const item of [...shown].sort((a, b) => a.openedAt - b.openedAt)) {
    right[item.id] = x
    x += width(item) + GAP
  }
  return { right, hidden, moreRight: hidden.length ? x : null, cardWidth: cw }
}
