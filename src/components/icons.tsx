/** Inline stroke icons — no icon dependency for a set this small. */

type Props = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const IconOverview = (p: Props) => (
  <svg {...base} className={p.className}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
)

export const IconWallet = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" />
    <rect x="3" y="8" width="18" height="12" rx="2" />
    <path d="M16 13h2" />
  </svg>
)

export const IconPositions = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M3 17l5-5 4 3 8-8" />
    <path d="M15 7h5v5" />
  </svg>
)

export const IconOrders = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="1" />
    <circle cx="4" cy="12" r="1" />
    <circle cx="4" cy="18" r="1" />
  </svg>
)

export const IconHistory = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v4h4" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const IconUp = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M12 19V5" />
    <path d="M6 11l6-6 6 6" />
  </svg>
)

export const IconDown = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M12 5v14" />
    <path d="M6 13l6 6 6-6" />
  </svg>
)

export const IconRefresh = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v5h-5" />
  </svg>
)

export const IconSun = (p: Props) => (
  <svg {...base} className={p.className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const IconMoon = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

export const IconAlert = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </svg>
)

export const IconInbox = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M3 12h5l2 3h4l2-3h5" />
    <path d="M5.5 5h13l2.5 7v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7z" />
  </svg>
)

export const IconMarkets = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20V7" />
  </svg>
)

export const IconSignal = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M3 12h3l3-7 4 14 3-7h5" />
  </svg>
)

export const IconPerformance = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M3 3v18h18" />
    <path d="M7 15l3.5-4 3 2.5L20 7" />
  </svg>
)

export const IconMore = (p: Props) => (
  <svg {...base} className={p.className}>
    <circle cx="5" cy="12" r="1.25" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.25" fill="currentColor" stroke="none" />
  </svg>
)

export const IconLock = (p: Props) => (
  <svg {...base} className={p.className}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 1 1 8 0v3" />
  </svg>
)

export const IconSearch = (p: Props) => (
  <svg {...base} className={p.className}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
)

export const IconFilter = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </svg>
)

export const IconShield = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)

export const IconActivity = (p: Props) => (
  <svg {...base} className={p.className}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)

export const IconCheck = (p: Props) => (
  <svg {...base} className={p.className}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export const IconCross = (p: Props) => (
  <svg {...base} className={p.className}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

export const IconTarget = (p: Props) => (
  <svg {...base} className={p.className}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
)

export const IconChevronDown = (p: Props) => (
  <svg {...base} className={p.className}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

export const IconSparkles = (p: Props) => (
  <svg {...base} className={p.className}>
    <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6l2.1-2.1" />
  </svg>
)

