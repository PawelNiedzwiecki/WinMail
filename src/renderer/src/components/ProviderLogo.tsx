import type { ProviderId } from '@shared/types'

const envelope = (
  <path
    d="M5 7.5h14v9H5z M5 8l7 5 7-5"
    fill="none"
    stroke="#fff"
    strokeWidth="1.6"
    strokeLinejoin="round"
  />
)

export function ProviderLogo({ id }: { id: ProviderId }) {
  switch (id) {
    case 'icloud':
      return (
        <svg className="provider-logo provider-bg-icloud" viewBox="0 0 24 24" aria-hidden>
          <path d="M17 10.5h-.9A5.5 5.5 0 1 0 9.5 17.5H17a3.5 3.5 0 0 0 0-7z" fill="#fff" />
        </svg>
      )
    case 'gmail':
      return (
        <svg className="provider-logo provider-logo-google" viewBox="-10 -10 68 68" aria-hidden>
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
      )
    case 'yahoo':
      return (
        <svg className="provider-logo provider-bg-yahoo" viewBox="0 0 24 24" aria-hidden>
          <text x="12" y="16.5" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="800" fontFamily="system-ui, sans-serif">
            Y!
          </text>
        </svg>
      )
    case 'fastmail':
      return (
        <svg className="provider-logo provider-bg-fastmail" viewBox="0 0 24 24" aria-hidden>
          {envelope}
        </svg>
      )
    case 'outlook':
      return (
        <svg className="provider-logo provider-bg-outlook" viewBox="0 0 24 24" aria-hidden>
          <ellipse cx="12" cy="12" rx="4.6" ry="5.4" fill="none" stroke="#fff" strokeWidth="2.4" />
        </svg>
      )
    default:
      return (
        <svg className="provider-logo provider-bg-other" viewBox="0 0 24 24" aria-hidden>
          {envelope}
        </svg>
      )
  }
}
