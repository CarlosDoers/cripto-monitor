---
name: warn-tofixed
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: src/.*\.tsx$
  - field: new_text
    operator: regex_match
    pattern: \.toFixed\(
---

⚠️ **`toFixed()` en un componente.**

Imprime el separador decimal con punto, mal en es-ES. Usa los formateadores de `src/lib/format.ts`: `usd`, `compactUsd`, `price`, `quote`, `pct`, `share`, `ratio`, `qty`…
