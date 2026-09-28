# OPS 360° IA — Aurora v3.0.0

Assistente de Segurança e Saúde no Trabalho do OPS 360°, **100% local** (roda no navegador, sem servidor e sem enviar dados).
Arquivo único: **`dist/ops360-ia.js`** — é ele que você copia para o app.

---

## O que foi resolvido nesta versão

| # | Pendência | O que mudou |
|---|-----------|-------------|
| 1 | **Janela de conversa pequena** | Painel com altura padrão de 82% da tela (mín. 620 px, antes ~600 px fixos), **alça para redimensionar** (arraste a barrinha no rodapé; duplo clique restaura), botão **⤢ Expandir** (94% da tela) e **⛶ Tela cheia** (Esc para sair). O tamanho escolhido fica salvo. Lista de conversas recolhível (☰) para ganhar largura e tamanho de letra ajustável em ⚙. |
| 2 | **Anexo era enviado direto, sem deixar escrever o pedido** | O 📎 agora só **anexa**: o arquivo fica numa bandeja acima do campo (com leitura em segundo plano e opção de remover). Você escreve a instrução ("resuma", "transforme em checklist", "faça um relatório de não conformidade com esta foto"…) e envia tudo junto. Também dá para **arrastar e soltar** arquivos ou **colar** imagens (Ctrl+V). Arquivos enviados ficam **no contexto da conversa** para perguntas seguintes. |
| 3 | **Leitura de documentos e documentos sob medida** | Leitor nativo de **PDF** (inclusive fontes embutidas e PDFs do Word/Chrome), **Word, Excel (com datas), PowerPoint, OpenDocument, CSV, TXT, HTML, JSON, RTF e fotos (data/GPS do EXIF)**. A Aurora identifica o tipo do documento (APR, PT, ASO, PGR, FDS, certificado, procedimento…), resume, encontra **NRs, EPIs, CAs, riscos e validades vencidas**, alerta sobre PPRA (substituído pelo PGR), responde perguntas citando o trecho e a página, e **transforma** o documento em checklist, APR, plano 5W2H ou relatório de análise. **16 tipos de documento** gerados em **PDF, Word e Excel** direto no navegador: APR, PT/PET, DDS, checklist, OS (NR-01), ficha de EPI, relatório de inspeção/RNC **com fotos**, investigação de acidente, 5W2H, POP, lista de presença, comunicado/alerta, plano de treinamento, inventário de riscos (base PGR), plano de emergência e relatório de análise de documento. Pedidos de continuação funcionam: *"agora em Word"*, *"adicione o risco de ruído"*, *"e para andaime?"*, *"mude o local para Galpão 3"*. |
| 4 | **Botão do Slack atrapalhando a IA** | **Dock inteligente**: o botão grande vira uma **aba magnética de 46 px presa à borda** que desliza ao passar o mouse; pode ser **arrastada pela lateral** (ou trocada de lado); **desvia sozinha** do campo de digitação, dos botões da IA e de modais; **recolhe para uma faixa de 7 px enquanto você digita**, em tela cheia ou dentro de uma aba; **espelha o contador de notificações**; abre com **Alt+Shift+S**; botão direito tem "esconder por 1 hora" e "voltar ao botão original". O botão original continua no app (invisível) e é ele que é acionado — nada da integração muda. Cada resposta da IA ganhou "💬 Slack" (copia o texto e abre o Slack). |
| 5 | **A IA criar abas e sub-abas dentro do OPS 360°** | **Estúdio de Abas**: peça *"crie uma aba de indicadores de segurança com sub-abas Acidentes e Treinamentos"*, *"crie uma aba para controlar extintores com campos: local, tipo, validade, situação"*, *"crie uma aba a partir do site https://…"* ou *"crie uma aba com os dados desta planilha"*. A aba aparece **na barra de abas do próprio app**, com KPIs, gráficos (barras, linha, área, rosca, empilhado), tabelas com busca/ordenação e **controle de validade**, **formulários que gravam registros e atualizam os gráficos**, checklists, calculadoras (taxa de frequência/gravidade, ruído ou fórmula própria), contador de dias sem acidente, metas, links e leitor de site com **Atualizar**. Edite **por conversa** (*"adicione um gráfico de pizza por setor"*, *"mude a cor para azul"*, *"crie uma sub-aba Metas"*, *"layout em 2 colunas"*) ou no **modo Editar** (mover blocos ← →, mudar largura e colunas, editar blocos e dados, adicionar blocos pela galeria), com **Desfazer**. **Tudo é salvo como padrão**: cada aba é um *blueprint* (`ops360.tab/1`) com o **histórico de cada pedido → operações** (o "script" de como foi feita), e o botão **📦 Exportar** gera um pacote com `blueprint.json`, `historico-ops.json`, `aba-xxx.js` (instalador de 1 linha), `COMO-FOI-FEITO.md` (documentação + passo a passo para implementar no app), `preview.html` e `dados/*.csv`. Abas podem ser importadas por outros usuários. Especificação completa em [`docs/PADRAO-ABAS.md`](docs/PADRAO-ABAS.md). |
| 6 | **Um único chat** | **Vários chats** na lateral (Fixadas, Hoje, Ontem, 7 dias, Mais antigas), com busca no conteúdo, renomear, fixar, exportar (Markdown/PDF) e excluir com **Desfazer**. **Memória adaptativa**: a Aurora lembra seu nome e empresa, **anotações** (*"lembre que o extintor do galpão 2 vence em outubro"* — e avisa quando a data se aproxima), formatos e atividades preferidos (sugestões personalizadas), **aprende termos novos** (quando não reconhece uma atividade, pergunta uma vez e passa a entender), **aprende frases** quando você escolhe uma sugestão depois de um "não entendi", usa 👍/👎 e **busca nas conversas antigas** (*"o que conversamos sobre empilhadeira?"*). Tudo visível/editável em **🧠 Memória** (exportar, importar, apagar, desligar o aprendizado). |

---

## Instalação

> **Importante:** o repositório chegou vazio nesta sessão e o `.js` anterior não veio anexado. Por isso a v3 foi construída como um **módulo completo e independente** que **substitui automaticamente o painel antigo da IA** — você não precisa apagar nada do app. Se quiser um arquivo único fundido com o `.js` antigo, envie o arquivo anterior que eu faço a fusão.

### Opção A — no `index.html` do OPS 360° (recomendada)
1. Copie `dist/ops360-ia.js` para a pasta do app.
2. Antes de `</body>`, **depois** dos scripts do app:
   ```html
   <script src="ops360-ia.js"></script>
   ```
3. Recarregue. A nova Aurora aparece **no lugar do painel antigo** (ele fica oculto, não é removido). As abas criadas pela IA entram na barra de abas do app e o botão do Slack vira o dock.

### Opção B — Tampermonkey / Violentmonkey
Crie um novo script e cole o conteúdo de `ops360-ia.js` (o cabeçalho `==UserScript==` já está pronto). Ajuste `@match` para o endereço do seu OPS 360°. Nesse modo, a leitura de sites usa `GM_xmlhttpRequest` (sem bloqueio de CORS).

### Opção C — extensão/página interna
Inclua o arquivo como qualquer script. Em páginas de extensão com `host_permissions`, a leitura de sites funciona direto.

---

## Configuração (opcional)

Defina **antes** de carregar o script:

```html
<script>
  window.OPS360IA_CONFIG = {
    userName: 'Daniel',            // se o app já souber o nome do usuário
    company: 'Minha Empresa Ltda', // empresa padrão nos documentos
    // mount: '#area-da-ia',        // montar num container específico
    // navSelector: '.minhas-abas', // barra de abas do app (se a detecção automática falhar)
    // slackSelector: '#botaoSlack',// botão do Slack (se a detecção automática falhar)
    // fetcher: (url) => meuApp.lerSite(url), // usar o leitor de sites que o OPS 360° já tem
    // strictOffline: true,         // nunca usar internet (desliga sites, OCR e pdf.js)
  };
</script>
<script src="ops360-ia.js"></script>
```

| Opção | Padrão | Para que serve |
|---|---|---|
| `mount` | — | Seletor/elemento onde montar. Sem ele: `#ops360-ia`, depois o painel antigo; se nada existir, vira um botão flutuante "Aurora". |
| `replaceLegacy` | `true` | Esconde o painel antigo e monta no lugar dele. |
| `legacySelector` | — | Seletor exato do painel antigo, se preferir. |
| `assistantName` | `'Aurora'` | Nome da assistente. |
| `userName` / `company` | — | Pré-preenchem perfil e documentos. |
| `navSelector` | automático | Barra de abas onde as abas da IA são injetadas. `injectNav: false` desliga. |
| `slackSelector` / `slackDock` | automático / `true` | Botão do Slack e o dock. |
| `fetcher` | — | Função `(url) => Promise<string | {text, contentType}>` para ler sites (reaproveita o leitor do app). |
| `proxies` | leitores públicos | Leitores usados quando um site bloqueia acesso direto (editáveis em ⚙). |
| `strictOffline` | `false` | Bloqueia qualquer uso de internet. |
| `zIndex` | `2147483000` | Camada das janelas da IA. |

---

## Exemplos de uso

- **Documentos:** "APR de trabalho em altura em PDF" · "PT de trabalho a quente no galpão 3 para amanhã" · "DDS sobre saúde mental para 20 pessoas" · "checklist de extintores em Excel" · "OS para operador de empilhadeira" · "ficha de EPI para soldador" · "inventário de riscos para solda e pintura" · "plano de emergência para o galpão 1" · "plano de treinamento NR-35".
- **Com arquivos (📎 + instrução):** "resuma e diga as validades" · "quais normas são citadas?" · "o que diz sobre resgate?" · "transforme em checklist" · "crie um plano de ação 5W2H a partir deste relatório" · foto + "fiação exposta no painel do galpão 2, faça um relatório de não conformidade".
- **Conhecimento:** "o que diz a NR-12?" · "qual NR fala de espaço confinado?" · "o que é sinalização vertical?" · "meu time não usa protetor auricular, o que faço?" · "tivemos um acidente, o que fazer?" · "calcule a taxa de frequência com 3 acidentes e 450.000 HHT" · "quanto tempo posso ficar exposto a 95 dB por 3 horas?".
- **Abas:** "crie uma aba de treinamentos" · "crie uma aba a partir do site …" · "adicione um contador de dias sem acidentes desde 01/08/2026" · "exporte o pacote da aba Indicadores".
- **Memória:** "meu nome é Daniel" · "minha empresa é …" · "lembre que …" · "o que você sabe sobre mim?" · "o que conversamos sobre …?".
- **Atalhos:** digite `/` no campo (`/apr`, `/pt`, `/dds`, `/checklist`, `/aba`, `/memoria`…).

---

## Privacidade e dados

- Conversas, arquivos lidos, documentos, abas e memória ficam no **IndexedDB do navegador** (fallback: localStorage). Nada vai para servidores.
- Internet só é usada quando **você pede**: leitura de sites, OCR de imagens (Tesseract.js) e leitor avançado para PDFs protegidos/escaneados (pdf.js). O selo do painel informa; `strictOffline` desliga tudo isso.
- ⚙ Configurações → **Apagar dados locais** limpa tudo deste navegador.

---

## API JavaScript (`window.OPS360IA`)

```js
await OPS360IA.ready;                              // pronto
OPS360IA.ask('Faz uma APR de solda em PDF');       // envia uma mensagem
OPS360IA.setSize('fullscreen');                    // 'normal' | 'expanded' | 'fullscreen'
OPS360IA.tabs.list();                              // abas criadas
OPS360IA.tabs.open('Indicadores de SST');          // abre por id ou nome
OPS360IA.tabs.install(blueprint);                  // instala uma aba exportada
OPS360IA.tabs.renderInto('#minha-tela', blueprint);// renderiza a aba dentro de uma tela do app
OPS360IA.tabs.replay(base, historico);             // reconstrói a aba pelo script de operações
OPS360IA.docs.generate('apr', { atividade: 'empilhadeira' }); // modelo de documento
OPS360IA.docs.download(doc, 'pdf');                // 'pdf' | 'docx' | 'xlsx' | 'print' | 'html'
OPS360IA.read(file);                               // lê e analisa um File
OPS360IA.readSite('https://…');                    // lê um site
OPS360IA.registerFetcher(url => app.lerSite(url)); // conecta o leitor do app
OPS360IA.restoreLegacy();                          // volta ao painel antigo
```

---

## Desenvolvimento

```
src/             módulos (utilitários, armazenamento, ZIP, NLP, base de SST, leitores, PDF nativo,
                 análise, modelo de documento, PDF/Word/Excel, geradores, memória, NLU, sites,
                 abas, comandos de abas, cérebro, gráficos, estilos, chat, estúdio, dock, boot)
scripts/build.mjs   monta dist/ops360-ia.js (e falha se houver nomes duplicados entre módulos)
demo/index.html     página que simula o OPS 360° (barra de abas, painel antigo, botão do Slack)
tests/unit.mjs      55 testes sem navegador        →  node tests/unit.mjs
tests/e2e.mjs       56 verificações no Chromium     →  node tests/e2e.mjs
```

`npm run build` · `npm test` · `npm run demo` (abre em http://127.0.0.1:8080/demo/).

---

## Limitações conhecidas e pendências para a próxima versão (v3.1)

1. **Fusão com o `.js` anterior:** não recebi o arquivo antigo nem o LEIA-ME anterior nesta sessão. A v3 substitui o painel da IA sem mexer no resto; se houver respostas ou integrações específicas do código antigo que você quer manter, envie o arquivo para eu migrar.
2. **Inteligência local, não um modelo de linguagem:** a Aurora usa regras, base de conhecimento de SST e busca. Perguntas muito abertas podem cair no "não entendi" — ao escolher uma sugestão, ela aprende a frase.
3. **Fotos:** offline a IA não "enxerga" a imagem; usa **a sua descrição**, a data/GPS da foto e embute a imagem no relatório. OCR (ler texto da imagem) precisa de internet na primeira vez.
4. **PDFs escaneados ou com senha** precisam do leitor avançado/OCR (internet). Arquivos antigos `.doc/.xls/.ppt` têm leitura parcial — salve como `.docx/.xlsx/.pptx`.
5. **Sites que bloqueiam leitura automática:** conecte o leitor que o OPS 360° já possui (`fetcher`) ou use um endpoint no servidor.
6. **Conteúdo normativo:** os resumos de NRs são para orientação — confira sempre o texto vigente no site do MTE; documentos gerados devem ser revisados pelo responsável técnico.
7. **Próximas ideias:** abas compartilhadas entre usuários via servidor do app, sincronização de conversas entre dispositivos, ditado por voz, e modelos de documento com a identidade visual/logotipo da empresa.
