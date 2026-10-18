---
name: warn-posside
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: src/.*\.tsx?$
  - field: new_text
    operator: regex_match
    pattern: posSide\s*[!=]==?\s*['"](long|short|net)['"]
---

⚠️ **No compares `posSide` directamente.**

Esta cuenta es de un solo sentido (`net_mode`): OKX informa `net` en todas las posiciones y la dirección está en el **signo de `pos`**. Compararlo etiquetó un short como "Largo" e invirtió el signo de la financiación. Usa `isShort()` de `src/lib/guards.ts`.
