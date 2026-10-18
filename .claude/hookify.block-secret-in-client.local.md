---
name: block-secret-in-client
enabled: true
event: file
action: block
conditions:
  - field: new_text
    operator: regex_match
    pattern: VITE_[A-Z0-9_]*(SECRET|KEY|TOKEN|PASSPHRASE|PASSWORD)
---

🛑 **Un `VITE_` con un secreto acaba dentro del código que descarga el navegador.**

Vite incrusta todo lo que empieza por `VITE_` en el bundle del cliente. La clave de OKX, `APP_ACCESS_TOKEN`, `MCP_TOKEN`, `CRON_SECRET` y los tokens de ntfy/Telegram solo pueden vivir en el servidor (`api/`, variables de Vercel y `.env.local`), sin prefijo `VITE_`.
