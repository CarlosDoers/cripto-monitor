import { useState, type FormEvent } from 'react'
import { setToken } from '../lib/api'
import { IconLock } from './icons'

/**
 * Shown when the deployment sets APP_ACCESS_TOKEN. The token is only ever
 * compared server-side; this screen just stores it for the `x-app-token` header.
 */
export function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!value.trim()) return

    setChecking(true)
    setError('')
    setToken(value.trim())

    try {
      const response = await fetch('/api/okx?probe=1', {
        headers: { 'x-app-token': value.trim() },
      })
      if (response.status === 401) {
        setToken('')
        setError('Token incorrecto.')
        return
      }
      onUnlock()
    } catch {
      setToken('')
      setError('No se pudo contactar con el servidor.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="gate-head">
          <IconLock />
          <h1>Cripto Monitor</h1>
          <p>Introduce el token de acceso para ver tu cuenta.</p>
        </div>

        <div className="field">
          <label htmlFor="token">Token de acceso</label>
          <input
            id="token"
            type="password"
            value={value}
            autoComplete="current-password"
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
          {error && <p className="gate-error">{error}</p>}
        </div>

        <button type="submit" className="btn btn--primary" disabled={checking}>
          {checking ? 'Comprobando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
