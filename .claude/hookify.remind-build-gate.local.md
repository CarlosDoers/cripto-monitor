---
name: remind-build-gate
enabled: true
event: stop
pattern: .*
---

**Antes de dar el trabajo por terminado** (si has tocado código en `src/`, `api/` o `scripts/`):

- [ ] `npm run build` pasa (tipos, tests, bundle y bundles del servidor): es la puerta de este proyecto.
- [ ] `npm run lint` sale limpio.
- [ ] Un fallo corregido tiene su test.
- [ ] Si cambió una cifra medida o un hallazgo: CLAUDE.md y `FINDINGS` en la Guía dicen lo mismo.
- [ ] Si tocaste una vista: la has mirado en pantalla, en móvil y en tema claro.

Si no has tocado código, ignora este recordatorio.
