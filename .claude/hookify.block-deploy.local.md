---
name: block-deploy
enabled: true
event: bash
action: block
pattern: vercel\s+(deploy|--prod|-p\b)|vercel\s+.*--prod
---

🛑 **El despliegue es manual y lo hace el usuario.**

En este proyecto `git push` publica el código y `vercel --prod` despliega, y ambos los lanza el usuario. No ejecutes un despliegue por tu cuenta. Si el usuario te lo ha pedido expresamente en este mensaje, desactiva esta regla (`enabled: false` en `.claude/hookify.block-deploy.local.md`), despliega y vuelve a activarla.
