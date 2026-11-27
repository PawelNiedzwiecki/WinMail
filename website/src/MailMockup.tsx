import { useEffect, useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform
} from 'motion/react'
import { Flag, Hourglass, Inbox, Search, Send, SquarePen, type LucideIcon } from 'lucide-react'
import { Mark } from './Mark'
import { siteEase } from './siteMotion'

interface Message {
  id: string
  from: string
  subject: string
  preview: string
  date: string
  meta: string
  /** Shown above the body, like the app's mailing-list banner. */
  banner?: string
  body: string[]
}

const ANNA: Message = {
  id: 'anna',
  from: 'Anna Kowalska',
  subject: 'Flat viewing on Saturday',
  preview: 'Are you still free at 11? The agent can meet us outside the station.',
  date: '09:41',
  meta: 'To: Pawel · 09:41',
  body: [
    'Hi Pawel,',
    'Are you still free at 11? The agent can meet us outside the station, and we would have about twenty minutes inside before the next couple arrives.',
    'Let me know and I will confirm.',
    'Anna'
  ]
}

// Arrives a moment after the window comes into view, as the 09:00 delivery would.
const BRIEF: Message = {
  id: 'brief',
  from: 'Morning brief',
  subject: '12 messages, 3 need you',
  preview: 'Two replies are waiting on you and one invoice is due on Friday.',
  date: '09:00',
  meta: 'WinMail · 09:00',
  body: [
    'Two replies are waiting on you and one invoice is due on Friday.',
    'Everything else can wait for the 13:00 delivery.'
  ]
}

const OTHERS: Message[] = [
  {
    id: 'ben',
    from: 'Ben Hughes',
    subject: 'Build 214 is ready',
    preview: 'Release notes are attached. Nothing blocking from my side.',
    date: 'Yesterday',
    meta: 'To: Pawel · Yesterday',
    body: ['Hi Pawel,', 'Build 214 is ready. Release notes are attached. Nothing blocking from my side.', 'Ben']
  },
  {
    id: 'digest',
    from: 'Monthly Digest',
    subject: 'Tracked by Mailchimp · 3 tracked links',
    preview: 'Opened 0 of 48.',
    date: 'Mon',
    meta: 'To: Pawel · Mon',
    banner: 'Tracked by Mailchimp · 3 tracked links',
    body: [
      'You have opened 0 of the last 48 issues.',
      'The Unsubscribe audit ranks lists like this one, so you can leave several at once.'
    ]
  }
]

interface Mailbox {
  icon: LucideIcon
  label: string
  count?: number
  nudge?: boolean
}

export function MailMockup() {
  const stage = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(stage, { once: true, amount: 0.35 })

  // Tilted back like a laptop lid while it rises into view, flat once its top reaches the upper quarter.
  const { scrollYProgress } = useScroll({ target: stage, offset: ['start end', 'start 0.25'] })
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 })
  const rotateX = useTransform(progress, [0, 1], [16, 0])
  const scale = useTransform(progress, [0, 1], [0.92, 1])

  const [arrived, setArrived] = useState(false)
  const [selected, setSelected] = useState(ANNA.id)
  const [unread, setUnread] = useState<Set<string>>(() => new Set([ANNA.id]))

  useEffect(() => {
    if (!inView) return
    const t = setTimeout(
      () => {
        setArrived(true)
        setUnread((u) => new Set(u).add(BRIEF.id))
      },
      reduce ? 0 : 1800
    )
    return () => clearTimeout(t)
  }, [inView, reduce])

  const messages = arrived ? [ANNA, BRIEF, ...OTHERS] : [ANNA, ...OTHERS]
  const open = messages.find((m) => m.id === selected) ?? ANNA

  const select = (id: string) => {
    setSelected(id)
    // Opening a message reads it, after a beat, as Mail does.
    setTimeout(() => setUnread((u) => (u.has(id) ? new Set([...u].filter((x) => x !== id)) : u)), 600)
  }

  const favourites: Mailbox[] = [
    { icon: Inbox, label: 'All Inboxes', count: arrived ? 12 : 11 },
    { icon: Flag, label: 'Flagged', count: 2 },
    { icon: Hourglass, label: 'Waiting for', count: 3, nudge: true },
    { icon: Send, label: 'Sent' }
  ]

  return (
    <div className="mockup">
      <div className="mockup-scroll" ref={stage}>
        <motion.div
          className="mk-window"
          style={reduce ? undefined : { rotateX, scale, transformOrigin: '50% 0%' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.45, ease: siteEase }}
        >
          <aside className="mk-sidebar" aria-label="Mailboxes">
            <div className="mk-brand">
              <Mark size={20} />
              <span>WinMail</span>
            </div>
            <div className="mk-boxes">
              <div className="mk-section">Favourites</div>
              {favourites.map((b, i) => (
                <SidebarItem key={b.label} box={b} selected={i === 0} />
              ))}
              <div className="mk-section">Work</div>
              <SidebarItem box={{ icon: Inbox, label: 'Inbox', count: 7 }} />
              <div className="mk-section">Personal</div>
              <SidebarItem box={{ icon: Inbox, label: 'Inbox', count: 5 }} />
            </div>
          </aside>

          <div className="mk-list">
            <div className="mk-toolbar">
              <div className="mk-search">
                <Search size={13} aria-hidden />
                <span className="mk-search-text">Search</span>
                <span className="mk-kbd">Ctrl F</span>
              </div>
            </div>
            <ul className="mk-rows">
              {messages.map((m) => (
                <Row
                  key={m.id}
                  message={m}
                  selected={m.id === selected}
                  unread={unread.has(m.id)}
                  arriving={m.id === BRIEF.id && !reduce}
                  onSelect={() => select(m.id)}
                />
              ))}
            </ul>
          </div>

          <div className="mk-reader">
            <div className="mk-toolbar mk-toolbar-end">
              <span className="mk-compose">
                <SquarePen size={14} aria-hidden />
                Compose
              </span>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.article
                key={open.id}
                className="mk-message"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: siteEase } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                aria-live="polite"
              >
                <div className="mk-msg-from">{open.from}</div>
                <div className="mk-msg-subject">{open.subject}</div>
                <div className="mk-msg-meta">{open.meta}</div>
                {open.banner && <div className="mk-banner">{open.banner}</div>}
                {open.body.map((p, i) => (
                  <motion.p
                    key={i}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.05 + i * 0.05, ease: siteEase }}
                  >
                    {p}
                  </motion.p>
                ))}
              </motion.article>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function SidebarItem({ box, selected = false }: { box: Mailbox; selected?: boolean }) {
  const Icon = box.icon
  return (
    <div className={`mk-item${selected ? ' is-selected' : ''}`}>
      <Icon size={15} strokeWidth={2} className="mk-item-icon" aria-hidden />
      <span className="mk-item-label">{box.label}</span>
      {box.count !== undefined && (
        <span className={`mk-count${box.nudge ? ' is-nudge' : ''}`}>
          {/* Ticks when the number changes, like the app's sidebar counts. */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={box.count}
              initial={{ y: -8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
              transition={{ duration: 0.22, ease: siteEase }}
            >
              {box.count}
            </motion.span>
          </AnimatePresence>
        </span>
      )}
    </div>
  )
}

function Row(p: { message: Message; selected: boolean; unread: boolean; arriving: boolean; onSelect: () => void }) {
  const m = p.message
  return (
    <motion.li
      className="mk-row-wrap"
      initial={p.arriving ? { height: 0, opacity: 0 } : false}
      animate={{ height: 'auto', opacity: 1 }}
      transition={{ duration: 0.45, ease: siteEase }}
    >
      <button
        type="button"
        className={`mk-row${p.selected ? ' is-selected' : ''}`}
        aria-pressed={p.selected}
        onClick={p.onSelect}
      >
        <AnimatePresence initial={false}>
          {p.unread && (
            <motion.span
              className="mk-dot"
              initial={{ scale: 0 }}
              animate={{ scale: 1, transition: { type: 'spring', stiffness: 520, damping: 18, delay: 0.25 } }}
              exit={{ scale: 0, transition: { duration: 0.16 } }}
              aria-label="Unread"
            />
          )}
        </AnimatePresence>
        <span className="mk-row-top">
          <span className="mk-row-from">{m.from}</span>
          <span className="mk-row-date">{m.date}</span>
        </span>
        <span className="mk-row-subject">{m.subject}</span>
        <span className="mk-row-preview">{m.preview}</span>
      </button>
    </motion.li>
  )
}
