import { useEffect, useState } from 'react'

const query = window.matchMedia('(prefers-color-scheme: dark)')

/** Whether the app is drawn dark; follows the Appearance setting, which main applies via nativeTheme. */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(query.matches)
  useEffect(() => {
    const onChange = () => setDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return dark
}
