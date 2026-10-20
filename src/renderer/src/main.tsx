import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { useReduceMotion } from './motion'
import '@fontsource-variable/inter'
import './styles.css'
import './compose/compose.css'
import './skeleton.css'
import './settings.css'
import App from './App'
import PopoutApp from './components/compose/PopoutApp'

// A compose card in a window of its own loads the same page with #popout.
const Page = location.hash === '#popout' ? PopoutApp : App

// Motion components follow the in-app "Reduce animations" setting and the system's.
function Root() {
  const reduce = useReduceMotion()
  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'never'}>
      <Page />
    </MotionConfig>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
