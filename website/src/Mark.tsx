import { useId } from 'react'

/** The app mark, as drawn in the sidebar (src/renderer/src/components/Sidebar.tsx). */
export function Mark({ size, label }: { size: number; label?: string }) {
  const id = useId()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#52B4FF" />
          <stop offset="1" stopColor="#0A5BD3" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="56" fill={`url(#${id})`} />
      <rect x="42" y="72" width="172" height="120" rx="16" fill="#fff" />
      <path
        d="M52 84l76 58 76-58"
        fill="none"
        stroke="#0A5BD3"
        strokeOpacity="0.6"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
