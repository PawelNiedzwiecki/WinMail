import { useRef, useState, type ReactNode } from 'react'
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { Bell, Clock, Inbox, Keyboard, Sparkle, Tag, type LucideIcon } from 'lucide-react'
import { Mark } from './Mark'
import { MailMockup } from './MailMockup'
import { onScroll, rise, slideIn, stagger } from './siteMotion'

const DOWNLOAD_URL = 'https://github.com/PawelNiedzwiecki/WinMail/releases/latest'

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <MailMockup />
        <Features />
        <Local />
        <Cta />
      </main>
      <footer className="footer wrap">
        <span>WinMail · 2026</span>
        <span>Not affiliated with Apple or Microsoft.</span>
      </footer>
    </>
  )
}

/** Sticks to the top; frosts over the page once it scrolls, like a macOS toolbar. */
function Nav() {
  const { scrollY } = useScroll()
  const [scrolled, setScrolled] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 8))

  return (
    <header className={`nav${scrolled ? ' is-scrolled' : ''}`}>
      <div className="nav-inner wrap">
        <a href="#top" className="nav-brand" aria-label="WinMail, back to top">
          <Mark size={28} />
          <span>WinMail</span>
        </a>
        <nav className="nav-links" aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#local">Privacy</a>
          <a href="#download" className="btn btn-primary btn-small">
            Download
          </a>
        </nav>
      </div>
    </header>
  )
}

function Hero() {
  const ref = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  // Drifts up and dims a little as the app window scrolls over it.
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [0, -60])
  const opacity = useTransform(scrollYProgress, [0, 0.9], [1, 0.35])

  return (
    <motion.section id="top" ref={ref} className="hero wrap" style={reduce ? undefined : { y, opacity }}>
      <motion.div variants={stagger(0.09, 0.05)} initial="hidden" animate="shown">
        <motion.p className="eyebrow" variants={rise}>
          Email for Windows
        </motion.p>
        <h1 className="hero-title">
          <motion.span variants={rise}>Mail that looks like a Mac.</motion.span>{' '}
          <motion.span variants={rise}>Runs on your PC.</motion.span>
        </h1>
        <motion.p className="hero-lede" variants={rise}>
          WinMail brings the three-pane layout of Apple Mail to Windows, with all your accounts in one window. Anything
          sent to Claude is labelled as such.
        </motion.p>
        <motion.div id="download" className="actions" variants={rise}>
          <a href={DOWNLOAD_URL} className="btn btn-primary">
            Download for Windows
          </a>
          <span className="actions-note">Windows 10 and 11</span>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}

interface Feature {
  icon: LucideIcon
  title: string
  text: string
  /** Waiting for draws in the nudge colour, as it does in the app. */
  nudge?: boolean
}

const FEATURES: Feature[] = [
  {
    icon: Inbox,
    title: 'Every account, one window',
    text: 'Work, personal and any other account sit side by side, each with its own inbox. Read them together in All Inboxes.'
  },
  {
    icon: Clock,
    title: 'Delivered when you choose',
    text: 'Turn on batching and new mail arrives at 09:00, 13:00 and 17:00, or up to six times you choose. The first delivery of the day comes with a Morning brief. Need something now? Deliver Now.'
  },
  {
    icon: Bell,
    title: 'See what is still waiting',
    text: 'Waiting for tracks messages you sent that nobody has answered. After 3 days by default, they come back as a nudge.',
    nudge: true
  },
  {
    icon: Sparkle,
    title: 'Claude, if you want it',
    text: 'Add your own API key to summarise a message, suggest a reply or search in plain language. Each feature has its own switch, off until you turn it on.'
  },
  {
    icon: Tag,
    title: 'Labels and tracking, in plain view',
    text: 'Nine label colours that read the same in light and dark. Newsletters show who tracks them and how many links.'
  },
  {
    icon: Keyboard,
    title: 'Fast from the keyboard',
    text: 'Ctrl shortcuts, and j and k to move through the list. Selection is instant, with no animation to wait for.'
  }
]

function Features() {
  return (
    <section id="features" className="band">
      <div className="wrap">
        <SectionHead
          title="Quiet by design. Built for triage."
          text="Neutral surfaces and one accent. Colour appears only where it means something: a flag, an unanswered message, a label."
        />
        <motion.ul className="cards" variants={stagger(0.08)} {...onScroll}>
          {FEATURES.map((f) => (
            <motion.li key={f.title} className="card-slot" variants={rise}>
              <div className="card">
                <f.icon size={28} strokeWidth={2} className={`card-icon${f.nudge ? ' is-nudge' : ''}`} aria-hidden />
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  )
}

function Local() {
  return (
    <section id="local" className="local wrap">
      <motion.div className="local-text" variants={rise} {...onScroll}>
        <h2>Local by default. Anything sent to Claude is labelled.</h2>
        <p className="section-lede">WinMail states what leaves your PC wherever it matters, in the interface itself.</p>
      </motion.div>
      <motion.div className="control-card" variants={rise} {...onScroll}>
        <div className="control-title">What you control</div>
        <motion.ul variants={stagger(0.12, 0.25)} {...onScroll}>
          {[
            'Your own Claude API key',
            'A switch for each feature, off until you turn it on',
            'Every result marked Sent to Claude'
          ].map((t) => (
            <motion.li key={t} variants={slideIn}>
              {t}
            </motion.li>
          ))}
        </motion.ul>
      </motion.div>
    </section>
  )
}

function Cta() {
  return (
    <section className="band cta">
      <motion.div variants={stagger(0.1)} {...onScroll}>
        <motion.h2 variants={rise}>Get the Apple Mail look on Windows.</motion.h2>
        <motion.div className="actions" variants={rise}>
          <a href={DOWNLOAD_URL} className="btn btn-primary">
            Download for Windows
          </a>
        </motion.div>
      </motion.div>
    </section>
  )
}

function SectionHead({ title, text }: { title: string; text: ReactNode }) {
  return (
    <motion.div className="section-head" variants={stagger(0.08)} {...onScroll}>
      <motion.h2 variants={rise}>{title}</motion.h2>
      <motion.p className="section-lede" variants={rise}>
        {text}
      </motion.p>
    </motion.div>
  )
}
