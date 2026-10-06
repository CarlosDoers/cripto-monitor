import { useRef, useState } from 'react'
import { okx } from '../lib/api'
import { PROJECT_INSTRUCTIONS } from '../lib/claudePrompt'
import { qty } from '../lib/format'
import { fullSnapshot } from '../lib/snapshot'
import { IconChat, IconCross } from './icons'

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'copied'; message: string }
  | { kind: 'manual'; text: string }
  | { kind: 'error'; message: string }

/**
 * Writes text that is still being produced. Safari only lets a page write to
 * the clipboard inside the click that asked for it, and reading the account
 * takes longer than that; a ClipboardItem built from a promise keeps the
 * permission while the text arrives. Where that is missing, `writeText` once
 * the text is ready; if that is refused too, the caller shows it to copy by
 * hand. Never rejects.
 */
async function writeClipboard(text: Promise<string>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) }),
      ])
      return true
    }
  } catch {
    // Fall through to writeText.
  }
  try {
    await navigator.clipboard.writeText(await text)
    return true
  } catch {
    return false
  }
}

/**
 * "Copiar para Claude": the account, and optionally the live signals and the
 * funding carry, as Markdown for a claude.ai chat or Project. The text is
 * rendered by `snapshot.ts` — the same code the claude.ai connector answers
 * with — from a fresh read through the read-only proxy, so it holds what the
 * views show and nothing the model would have to work out.
 *
 * Nothing is fetched until the button is pressed.
 */
export function ClaudeExport() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [signals, setSignals] = useState(false)
  const [funding, setFunding] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [last, setLast] = useState('')

  async function copySnapshot() {
    setStatus({ kind: 'busy' })
    const job = fullSnapshot(okx, { signals, funding })
    const copied = writeClipboard(job)
    let text: string
    try {
      text = await job
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      return
    }
    setLast(text)
    setStatus((await copied) ? { kind: 'copied', message: `La cuenta ya está en el portapapeles (${qty(text.length)} caracteres). Pégala en un chat de claude.ai.` } : { kind: 'manual', text })
  }

  async function copyInstructions() {
    const ok = await writeClipboard(Promise.resolve(PROJECT_INSTRUCTIONS))
    setStatus(
      ok
        ? { kind: 'copied', message: 'Las instrucciones ya están en el portapapeles. Pégalas en las del proyecto.' }
        : { kind: 'manual', text: PROJECT_INSTRUCTIONS },
    )
  }

  const busy = status.kind === 'busy'
  // No key in it: claude.ai discovers the OAuth server from this address and
  // asks for the app's password on connecting.
  const connectorUrl = `${window.location.origin}/api/mcp`

  return (
    <>
      <button
        type="button"
        className="btn btn--outline claude-button"
        onClick={() => dialog.current?.showModal()}
        title="Copiar la cuenta para analizarla con Claude"
      >
        <IconChat />
        <span className="claude-button-label">Claude</span>
      </button>

      {/* A click on the backdrop lands on the <dialog> itself; the body wraps
          everything else, so only the backdrop closes it. */}
      <dialog
        ref={dialog}
        className="claude-dialog"
        aria-labelledby="claude-dialog-title"
        onClick={(e) => e.target === dialog.current && dialog.current.close()}
      >
        <div className="claude-dialog-body">
          <div className="claude-dialog-head">
            <h2 id="claude-dialog-title">Analizar con Claude</h2>
            <button type="button" className="btn btn--icon" onClick={() => dialog.current?.close()} aria-label="Cerrar">
              <IconCross />
            </button>
          </div>

          <p className="claude-lead">
            Copia la cuenta como texto y pégala en un chat de claude.ai. Lleva las cifras de esta app y las reglas de
            las estrategias medidas, para que Claude las explique sin inventar señales.
          </p>

          <fieldset className="claude-options">
            <legend>Qué incluir</legend>
            <label>
              <input type="checkbox" checked disabled />
              <span>
                Cuenta
                <span className="sub">avisos, posiciones, bots, rendimiento de 30 días, cartera y estrategias medidas</span>
              </span>
            </label>
            <label>
              <input type="checkbox" checked={signals} onChange={(e) => setSignals(e.target.checked)} />
              <span>
                Señales en vivo
                <span className="sub">reversión diaria en los 40 X-Perp más negociados, y ruptura + EMA 200 y cruce de la EMA 200 en 4 h · unos 5 s</span>
              </span>
            </label>
            <label>
              <input type="checkbox" checked={funding} onChange={(e) => setFunding(e.target.checked)} />
              <span>
                Financiación
                <span className="sub">qué paga hoy cubrir con un corto las monedas que tienes</span>
              </span>
            </label>
          </fieldset>

          <div className="claude-actions">
            <button type="button" className="btn btn--primary" onClick={copySnapshot} disabled={busy}>
              {busy ? 'Leyendo la cuenta…' : 'Copiar para Claude'}
            </button>
            <p className={`claude-status${status.kind === 'error' ? ' claude-status--error' : ''}`} role="status">
              {status.kind === 'copied' && status.message}
              {status.kind === 'manual' && 'El navegador no deja copiar solo: selecciona el texto de abajo y cópialo a mano.'}
              {status.kind === 'error' && `No se pudo leer la cuenta: ${status.message}`}
            </p>
          </div>

          {status.kind === 'manual' ? (
            <textarea className="claude-text" readOnly value={status.text} onFocus={(e) => e.currentTarget.select()} />
          ) : (
            last && (
              <details className="claude-details">
                <summary>Ver lo que se ha copiado</summary>
                <textarea className="claude-text" readOnly value={last} />
              </details>
            )
          )}

          <details className="claude-details">
            <summary>Primera vez: un proyecto en claude.ai</summary>
            <ol>
              <li>En claude.ai, abre Proyectos y crea uno (por ejemplo, «Cripto Monitor»).</li>
              <li>
                Pega esto en sus instrucciones:{' '}
                <button type="button" className="btn btn--outline" onClick={copyInstructions}>
                  Copiar instrucciones
                </button>
              </li>
              <li>Para analizar, abre un chat en ese proyecto y pega la cuenta. Cada copia es una foto del momento.</li>
            </ol>
          </details>

          <details className="claude-details">
            <summary>Sin copiar nada: el conector</summary>
            <p>
              Con el conector, Claude lee la cuenta solo cuando se lo pides en cualquier chat. Es de solo lectura y
              usa la misma lista cerrada de consultas que esta app.
            </p>
            <ol>
              <li>
                En la app publicada en Vercel, define <code>MCP_TOKEN</code> (64 caracteres al azar) y despliega.
              </li>
              <li>
                En claude.ai: Ajustes → Conectores → Añadir conector personalizado, con la dirección{' '}
                <code className="claude-url">{connectorUrl}</code>
              </li>
              <li>
                Pulsa Conectar: se abre una página de esta app que pide su contraseña (la misma con la que entras
                aquí). Claude queda autorizado y renueva el acceso solo.
              </li>
              <li>En un chat, actívalo y pide, por ejemplo, «revisa mi cuenta».</li>
            </ol>
            <p className="sub">
              Para retirar el acceso a todos los clientes a la vez, cambia <code>MCP_TOKEN</code> y vuelve a
              desplegar. La dirección antigua con <code>?token=</code> sigue funcionando, pero lleva la clave dentro:
              mejor pasarse a esta.
            </p>
          </details>
        </div>
      </dialog>
    </>
  )
}
