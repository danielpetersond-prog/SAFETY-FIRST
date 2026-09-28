# OPS 360° IA (Aurora) — v3

Assistente de SST do OPS 360°, 100% local no navegador: janela de conversa maior e
ajustável, vários chats com memória, anexos com instrução antes do envio, leitura e
geração de documentos (PDF, Word, Excel), abas e sub-abas criadas pela IA dentro do app
e dock inteligente do Slack.

- **Arquivo para instalar:** [`dist/ops360-ia.js`](dist/ops360-ia.js) (um único arquivo, sem dependências)
- **Guia completo (instalação, uso, configurações, API):** [`LEIA-ME.md`](LEIA-ME.md)
- **Padrão das abas criadas pela IA (`ops360.tab/1`):** [`docs/PADRAO-ABAS.md`](docs/PADRAO-ABAS.md)
- **Histórico de versões:** [`CHANGELOG.md`](CHANGELOG.md)
- **Demonstração local:** `npm run demo` e abra `http://127.0.0.1:8080/demo/`

```html
<!-- no index.html do OPS 360°, antes de </body> -->
<script src="ops360-ia.js"></script>
```

Desenvolvimento: `npm run build` gera o `dist/` a partir de `src/`; `npm test` roda os
testes unitários (Node) e ponta a ponta (Chromium).
