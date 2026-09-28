# Histórico de versões — OPS 360° IA (Aurora)

## 3.0.0 — 2026-09-28

Versão que resolve as pendências listadas no LEIA-ME do kit anterior. Entregue como
um único arquivo (`dist/ops360-ia.js`) que substitui automaticamente o painel antigo
da IA. Detalhes de uso em [`LEIA-ME.md`](LEIA-ME.md).

### Novo
- **Janela maior e ajustável:** altura padrão de 82% da tela (mín. 620 px), alça de
  redimensionar, modos Expandir e Tela cheia, tamanho salvo, lista de conversas
  recolhível e tamanho de letra ajustável.
- **Anexar e escrever antes de enviar:** bandeja de anexos (📎, arrastar e soltar,
  colar imagem), leitura em segundo plano, envio só com a instrução; arquivos ficam no
  contexto da conversa.
- **Leitura de documentos:** PDF (leitor nativo com fontes compactadas, fluxos de
  objetos e mapas ToUnicode; pdf.js/OCR opcionais quando online), Word, Excel, PowerPoint,
  OpenDocument, CSV, HTML, JSON, RTF e fotos (EXIF). Análise automática: tipo do
  documento, NRs e CAs citados, datas e **vencimentos**, riscos, EPIs, responsável e
  alertas de conformidade (PPRA citado, NR revogada, falta de campo de assinatura).
- **Geração de documentos por tipo de pedido (16 tipos):** APR, PT/PET, DDS, checklist,
  OS (NR-01), ficha de EPI, relatório de inspeção/não conformidade (com fotos),
  investigação de acidente, plano de ação 5W2H, POP, lista de presença, comunicado/alerta,
  plano de treinamento, inventário de riscos (base do PGR), plano de emergência e
  relatório de análise de documento — em **PDF, Word e Excel**. Pedidos de continuação
  ("agora em Word", "e para andaime?", "mude o local para…") reaproveitam o último
  documento.
- **Estúdio de Abas:** a IA cria abas e sub-abas **dentro do OPS 360°** (KPIs,
  gráficos, tabelas com controle de validade, formulários, checklists, calculadoras,
  contador de dias, metas, links, linha do tempo, leitor de site), a partir de um
  pedido, de campos informados, de uma planilha ou de um **site lido em segundo plano**.
  Edição por conversa ou no modo Editar, com desfazer. Cada aba segue o padrão
  [`ops360.tab/1`](docs/PADRAO-ABAS.md), guarda o histórico de construção (replayável)
  e exporta um pacote de implementação.
- **Vários chats com memória:** conversas separadas (fixar, renomear, buscar,
  exportar), título automático, lembrança do que foi falado em outras conversas e
  **memória adaptativa** (perfil, fatos, termos aprendidos, preferências de formato,
  avaliações 👍/👎) — tudo salvo localmente, com tela para ver, exportar ou apagar.
- **Dock inteligente do Slack:** o botão flutuante vira uma aba magnética de 46 px na
  borda, que desvia dos controles da IA, recolhe enquanto você digita, mostra o
  contador de notificações e abre com Alt+Shift+S. O botão original continua sendo o
  que é acionado.
- **API pública** `window.OPS360IA` (abrir, perguntar, gerar documentos, ler arquivos
  e sites, instalar/renderizar/exportar abas, memória, dock).

### Qualidade
- 55 testes unitários (Node) e 56 verificações ponta a ponta no Chromium
  (`npm test`). Arquivos gerados validados com leitores independentes de PDF, DOCX e
  XLSX.
- O build falha se dois módulos definirem o mesmo nome de função/constante (evita
  que uma função sobrescreva outra no arquivo final).

### Limitações conhecidas
Veja a seção "Limitações conhecidas e pendências para a v3.1" do
[`LEIA-ME.md`](LEIA-ME.md).
