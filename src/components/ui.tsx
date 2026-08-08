import type { ReactNode } from 'react'
import { IconAlert, IconDown, IconInbox, IconUp } from './icons'
import { pct } from '../lib/format'

export function Card({
  title,
  subtitle,
  action,
  flush,
  dimmed,
  children,
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  flush?: boolean
  dimmed?: boolean
  children: ReactNode
}) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {action}
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
}: {
  label: string
  value: ReactNode
  hero?: boolean
  foot?: ReactNode
  loading?: boolean
}) {
  return (
    <article className="stat">
      <p className="stat-label">{label}</p>
      {loading ? (
        <div className="skeleton" style={{ height: hero ? 40 : 29, width: '70%' }} />
      ) : (
        <p className={`stat-value${hero ? ' stat-value--hero' : ''}`}>{value}</p>
      )}
      {foot && <div className="stat-foot">{foot}</div>}
    </article>
  )
}

/**
 * A signed change. The arrow is a second channel so the meaning never rests on
 * colour alone.
 */
export function Delta({ ratio, children }: { ratio: number; children?: ReactNode }) {
  const dir = ratio > 0 ? 'up' : ratio < 0 ? 'down' : 'flat'
  const Icon = dir === 'up' ? IconUp : IconDown
  return (
    <span className={`delta delta--${dir}`}>
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
}: {
  children: ReactNode
  variant?: 'buy' | 'sell' | 'live' | 'warn'
}) {
  return <span className={`badge${variant ? ` badge--${variant}` : ''}`}>{children}</span>
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} />
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ padding: '4px 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="row" style={{ gap: 18 }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} height={14} width={c === 0 ? 90 : `${100 / cols}%`} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state">
      <IconInbox />
      <p className="state-title">{title}</p>
      {hint && <p>{hint}</p>}
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
