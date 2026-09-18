import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconAlert, IconDown, IconInbox, IconSearch, IconUp } from './icons'
import { pct } from '../lib/format'

/**
 * Wraps a data table so it can restyle itself as a list of cards on a phone.
 *
 * A nine-column table on a 390 px screen hides ~650 px of itself behind a
 * horizontal scroll, and the hidden part is where the numbers live. The card
 * layout needs every cell to carry its column name; rather than repeat the
 * headers as `data-label` attributes on sixty `<td>`s — silently wrong the
 * moment a column is inserted — this copies them off the `<thead>` after each
 * render, so a label can never disagree with the column it came from.
 */
export function TableWrap({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  // No dependency array: the rows change whenever the data does.
  useEffect(() => {
    const table = ref.current?.querySelector('table')
    if (!table) return
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '')
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td')
      // A single spanning cell is an empty state, not a record.
      if (cells.length < 2) continue
      cells.forEach((cell, i) => {
        if (headers[i]) cell.setAttribute('data-label', headers[i])
      })
    }
  })

  return (
    <div ref={ref} className={`table-wrap ${className}`.trim()}>
      {children}
    </div>
  )
}

export function Card({
  title,
  subtitle,
  action,
  flush,
  dimmed,
  glow,
  className = '',
  children,
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  flush?: boolean
  dimmed?: boolean
  glow?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`card${glow ? ' card--glow' : ''} ${className}`}>
      {(title || action) && (
        <header className="card-head">
          <div className="card-head-info">
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {action && <div className="card-head-action">{action}</div>}
        </header>
      )}
      <div
        className={`card-body${flush ? ' card-body--flush' : ''}${dimmed ? ' is-refetching' : ''}`}
      >
        {children}
      </div>
    </section>
  )
}

/**
 * A "?" beside a figure that explains what it means.
 *
 * The explanation is portalled to `<body>` and positioned against the viewport,
 * because the places that need one — table headers, KPI strips — sit inside
 * cards and scroll containers that clip anything absolutely positioned.
 *
 * Hover opens it for a mouse, keyboard focus for a keyboard, and a tap pins it
 * open on a phone, where there is no hover at all. The glyph is drawn by CSS,
 * not text, so a `<th>` holding one still gives `TableWrap` a clean label.
 */
export function Help({ children, label }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const id = useId()
  const shown = open || pinned

  const close = () => {
    setOpen(false)
    setPinned(false)
  }

  // Measure after render so the tip's own height decides whether it fits below.
  useLayoutEffect(() => {
    if (!shown || !button.current || !tip.current) return
    const anchor = button.current.getBoundingClientRect()
    const box = tip.current.getBoundingClientRect()
    const gutter = 8
    const below = anchor.bottom + 6
    const top =
      below + box.height > window.innerHeight - gutter ? anchor.top - 6 - box.height : below
    const centred = anchor.left + anchor.width / 2 - box.width / 2
    const left = Math.min(Math.max(centred, gutter), window.innerWidth - box.width - gutter)
    setPos({ top: Math.max(gutter, top), left })
  }, [shown])

  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: PointerEvent) => {
      if (!button.current?.contains(e.target as Node)) close()
    }
    // A fixed tip would drift away from its anchor on scroll; closing is simpler.
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [shown])

  useEffect(() => {
    if (!shown) setPos(null)
  }, [shown])

  return (
    <>
      <button
        ref={button}
        type="button"
        className="help"
        aria-label={label ? `Qué significa: ${label}` : 'Qué significa'}
        aria-expanded={shown}
        aria-describedby={shown ? id : undefined}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
        onFocus={(e) => e.currentTarget.matches(':focus-visible') && setOpen(true)}
        onBlur={close}
        onClick={(e) => {
          // Inside a clickable row or header, the tap is for the help only.
          e.stopPropagation()
          setPinned((p) => !p)
        }}
      />
      {shown &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className="help-tip"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}

export function Stat({
  label,
  value,
  hero,
  foot,
  loading,
  glow,
  badge,
  help,
}: {
  label: string
  value: ReactNode
  hero?: boolean
  foot?: ReactNode
  loading?: boolean
  glow?: boolean
  badge?: ReactNode
  /** What the figure means, behind a "?" beside the label. */
  help?: ReactNode
}) {
  return (
    <article className={`stat${hero ? ' stat--hero' : ''}${glow ? ' stat--glow' : ''}`}>
      <div className="stat-header">
        <p className="stat-label">
          {label}
          {help && <Help label={label}>{help}</Help>}
        </p>
        {badge}
      </div>
      {loading ? (
        <div className="skeleton" style={{ height: hero ? 38 : 28, width: '75%', borderRadius: 8 }} />
      ) : (
        <div className={`stat-value${hero ? ' stat-value--hero' : ''}`}>{value}</div>
      )}
      {foot && <div className="stat-foot">{foot}</div>}
    </article>
  )
}

/**
 * A signed change. The arrow is a second channel so the meaning never rests on
 * colour alone.
 */
export function Delta({
  ratio,
  pill,
  children,
}: {
  ratio: number
  pill?: boolean
  children?: ReactNode
}) {
  const dir = ratio > 0 ? 'up' : ratio < 0 ? 'down' : 'flat'
  const Icon = dir === 'up' ? IconUp : IconDown
  return (
    <span className={`delta delta--${dir}${pill ? ' delta--pill' : ''}`}>
      {dir !== 'flat' && <Icon />}
      {children ?? pct(ratio)}
    </span>
  )
}

/** A signed amount that carries its own sign glyph rather than only a colour. */
export function DeltaValue({ value, children }: { value: number; children: ReactNode }) {
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  return <span className={`delta delta--${dir}`}>{children}</span>
}

export function Badge({
  children,
  variant,
  pulse,
}: {
  children: ReactNode
  variant?: 'buy' | 'sell' | 'live' | 'warn' | 'neutral' | 'accent' | 'purple'
  pulse?: boolean
}) {
  return (
    <span className={`badge${variant ? ` badge--${variant}` : ''}`}>
      {pulse && <span className="badge-pulse" />}
      {children}
    </span>
  )
}

export function Skeleton({
  height = 16,
  width = '100%',
  radius,
}: {
  height?: number
  width?: number | string
  radius?: number
}) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} />
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ padding: '8px 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="row" style={{ gap: 16 }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} height={16} width={c === 0 ? 110 : `${100 / cols}%`} radius={6} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="state">
      <div className="state-icon-wrap">{icon ?? <IconInbox />}</div>
      <p className="state-title">{title}</p>
      {hint && <p className="state-hint">{hint}</p>}
    </div>
  )
}

export function ErrorNotice({ title, message }: { title: string; message: string }) {
  return (
    <div className="notice notice--error">
      <IconAlert />
      <div className="notice-body">
        <p className="notice-title">{title}</p>
        <p className="notice-text">{message}</p>
      </div>
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar...',
  className = '',
}: {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={`search-box ${className}`}>
      <IconSearch />
      <input
        type="text"
        className="search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
        >
          ×
        </button>
      )}
    </div>
  )
}

export function ProgressBar({
  value,
  max = 100,
  variant = 'accent',
  showLabel = false,
  label,
}: {
  value: number
  max?: number
  variant?: 'accent' | 'good' | 'warning' | 'critical'
  showLabel?: boolean
  label?: string
}) {
  const clamped = Math.min(Math.max((value / max) * 100, 0), 100)
  return (
    <div className="progress-bar-wrap">
      {(showLabel || label) && (
        <div className="progress-bar-head">
          <span>{label}</span>
          <span>{Math.round(clamped)}%</span>
        </div>
      )}
      <div className="progress-track">
        <div
          className={`progress-fill progress-fill--${variant}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}

