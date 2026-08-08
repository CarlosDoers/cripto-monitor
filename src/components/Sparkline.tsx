/**
 * A 48-point price trace. Drawn at its real pixel size (not a scaled viewBox)
 * so the 2px stroke stays 2px and doesn't smear along one axis.
 *
 * It is decoration for the number beside it: the exact values live in the table
 * row and the tooltip, never in the sparkline alone.
 */
export function Sparkline({
  values,
  color,
  width = 84,
  height = 26,
}: {
  values: number[]
  color: string
  width?: number
  height?: number
}) {
  if (values.length < 2) return <div style={{ width, height }} />

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 2

  const points = values.map((value, i) => {
    const x = (i / (values.length - 1)) * (width - pad * 2) + pad
    const y = height - pad - ((value - min) / span) * (height - pad * 2)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const last = points.at(-1)!.split(',')

  return (
    <svg className="spark" width={width} height={height} aria-hidden="true">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  )
}
