import type { ReactNode } from 'react'
import { IconAlert, IconDown, IconInbox, IconSearch, IconUp } from './icons'
import { pct } from '../lib/format'

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

export function Stat({
  label,
  value,
  hero,
  foot,
  loading,
  glow,
  badge,
}: {
  label: string
  value: ReactNode
  hero?: boolean
  foot?: ReactNode
  loading?: boolean
  glow?: boolean
  badge?: ReactNode
}) {
  return (
    <article className={`stat${hero ? ' stat--hero' : ''}${glow ? ' stat--glow' : ''}`}>
      <div className="stat-header">
        <p className="stat-label">{label}</p>
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

