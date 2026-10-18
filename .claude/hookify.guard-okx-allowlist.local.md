---
name: guard-okx-allowlist
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: api/_okx\.ts$
  - field: new_text
    operator: regex_match
    pattern: /api/v5/
---

⚠️ **Estás tocando la lista permitida de OKX (`ALLOWED_PATHS`).**

Es un control de seguridad, no una comodidad: una URL de despliegue es pública y esta lista es lo que impide que algo distinto de leer llegue a OKX.

- Solo GET y solo endpoints de **lectura** que la app realmente llama.
- Un endpoint nuevo necesita su hook en `src/lib/queries.ts` y, si procede, un test en `api/*.test.ts`.
- No añadas nada "por si acaso", ni para una comprobación puntual (para eso, un script temporal fuera del repo).
