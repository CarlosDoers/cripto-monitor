---
name: warn-index-html-hash
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: (^|/)index\.html$
  - field: new_text
    operator: contains
    pattern: <script
---

⚠️ **Tocas un script de `index.html`.**

El CSP de producción (`vercel.json`) autoriza el script de tema inline por su **sha256**. Si cambias ese script, el hash de `vercel.json` debe cambiar también o producción lo bloquea sin avisar. `api/_headers.test.ts` falla hasta que coincidan: ejecuta `npm test`.
