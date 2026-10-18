---
name: warn-push-env
enabled: true
event: bash
action: block
pattern: push-env\.sh|vercel\s+env\s+(add|rm|pull)
---

🛑 **Esto cambia las variables de entorno de producción (o reescribe `.env.local`).**

`push-env.sh` publica credenciales en Vercel y `vercel env pull` reescribe `.env.local` entre comillas. Solo debe hacerse si el usuario lo ha pedido expresamente; después hay que comprobar producción con una petición real.
