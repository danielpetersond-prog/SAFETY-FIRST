# Padrão de abas do OPS 360° — `ops360.tab/1`

Este documento é o **contrato** das abas e sub-abas que o OPS 360° IA (Aurora) cria
dentro do aplicativo. Ele existe para que qualquer aba criada por um usuário possa
ser **levada para dentro do app de forma padronizada**: instalada como está,
renderizada em qualquer tela ou reimplementada de forma nativa, bloco por bloco.

Tudo o que a IA faz numa aba fica salvo em dois lugares:

1. **Blueprint** — o estado atual da aba (JSON, padrão `ops360.tab/1`).
2. **Histórico de operações** — o "script" de construção: cada pedido do usuário
   vira uma lista de operações que, reaplicadas na ordem, recriam a aba (replay).

O botão **Exportar** de cada aba (ou o pedido "exporte a aba X") gera o pacote de
implementação descrito na seção 9.

---

## 1. Visão geral

```
Aba (blueprint)
├── identidade: id, nome, ícone, cor, tema, descrição, autor, datas
├── subtabs[]            ← sub-abas, cada uma com um grid de 1–4 colunas
│   └── widgets[]        ← blocos: KPI, gráfico, tabela, formulário, nota…
├── datasets{}           ← bases de dados da aba (colunas tipadas + linhas)
├── sources{}            ← fontes externas (sites lidos pela IA)
└── history[]            ← pedidos → operações (replayável)
```

Regras gerais:

- Tudo é **JSON puro** (sem funções, sem HTML executável). O blueprint pode ser
  salvo em banco, versionado em Git ou trafegado por API sem risco.
- Os **widgets não guardam dados calculados**: guardam a *regra* (dataset + coluna +
  agregação). O valor é recalculado na renderização, então formulários e
  atualizações de sites refletem automaticamente em KPIs e gráficos.
- IDs são strings com prefixo (`tab_…`, `sub_…`, `w_…`, `ds_…`, `src_…`) e só
  precisam ser únicos dentro da aba.

## 2. Blueprint (raiz)

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `schema` | `"ops360.tab/1"` | sim | Versão do padrão. Blueprints com outro valor são recusados. |
| `id` | string | sim | Identificador da aba (`tab_…`). |
| `name` | string (≤ 60) | sim | Nome exibido na barra de abas. |
| `icon` | string (emoji, ≤ 4) | não | Padrão `📁`. |
| `color` | `#rrggbb` | não | Cor de destaque da aba. Padrão `#0d9488`. |
| `theme` | `"light"` \| `"dark"` | não | Tema da área de trabalho. Padrão `light` (visual do OPS 360°). |
| `description` | string | não | Subtítulo da aba. |
| `order` | número | não | Posição na barra de abas. |
| `pinned` | boolean | não | `false` oculta a aba da barra do app (continua na lista da IA). |
| `createdAt`, `updatedAt` | número (epoch ms) | não | Datas de criação/alteração. |
| `createdBy` | string | não | Gerador (ex.: `OPS 360° IA (Aurora) v3.0.0`). |
| `author` | string | não | Nome do usuário que pediu a aba (memória da IA). |
| `subtabs` | `Subtab[]` | sim | Ao menos uma; se vier vazio, é criada a sub-aba "Geral". |
| `datasets` | `{ [id]: Dataset }` | não | Bases de dados. |
| `sources` | `{ [id]: Source }` | não | Fontes externas. |
| `history` | `HistoryEntry[]` | não | Script de construção (mantidas as últimas 500 entradas). |
| `exportedAt`, `generator` | string | não | Só aparecem no `blueprint.json` exportado. |

## 3. Sub-abas

```json
{ "id": "sub_ab12", "name": "Acidentes", "columns": 3, "widgets": [ … ] }
```

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string | Identificador. |
| `name` | string (≤ 40) | Nome da sub-aba. |
| `columns` | 1–4 | Colunas do grid (padrão 3). Em telas estreitas o grid vira 1 coluna. |
| `widgets` | `Widget[]` | Blocos na ordem de exibição (esquerda → direita, cima → baixo). |

## 4. Widgets (blocos)

Campos comuns a todos os blocos:

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string | Identificador (`w_…`). |
| `type` | string | Um dos 14 tipos abaixo. Tipos desconhecidos são descartados na instalação. |
| `title` | string | Título do cartão. |
| `span` | 1–4 | Quantas colunas do grid o bloco ocupa (limitado a `columns`). |
| `props` | objeto | Configuração específica do tipo. |

### 4.1 Tipos e `props`

| `type` | Nome | `props` |
|---|---|---|
| `kpi` | Indicador | **Calculado:** `from: { dataset, agg, col?, filter?, validity?, status?, deltaPrev? }`. **Fixo:** `value`, `unit?`, `delta?`. Opcionais: `unit`, `pct` (exibe %), `good: "up"\|"down"` (sentido bom da variação), `tone: "good"\|"warning"\|"critical"` (selo de status quando valor > 0), `context` (texto de apoio no tooltip), `source` (fonte de origem). |
| `chart` | Gráfico | **Com dados da aba:** `kind`, `dataset`, `x` (coluna de categoria/data), `y?: string[]` (colunas numéricas), `agg: "count"\|"sum"\|"none"`, `groupDate?: "month"`, `filter?`, `top?` (agrupa o excedente em "Outros"), `validity?` (gráfico de situação por vencimento), `unit?`. **Valores fixos:** `kind`, `labels: string[]`, `series: [{ name, values: number[] }]`. |
| `table` | Tabela | `dataset`, `search?` (padrão `true`), `validity?` (acrescenta a coluna "Situação"). Ordenação por clique, exclusão de linha com desfazer, exportação CSV/Excel. |
| `form` | Formulário de registro | `dataset`. Os campos são gerados a partir das colunas do dataset (`text`, `number`, `date`, `select`). Cada envio adiciona uma linha ao dataset. |
| `note` | Nota | `text` (Markdown simples: `**negrito**`, listas com `•`/`-`, links). |
| `checklist` | Checklist | `items: [{ text, done }]`. |
| `links` | Links | `items: [{ text, url }]` (só `http(s)`, abertos em nova guia com `noopener`). |
| `counter` | Contador de dias | `since` (data ISO) **ou** `from: { dataset, dateCol, filter? }` — conta os dias desde a data mais recente que atende ao filtro (ex.: último acidente com afastamento). `record?`. |
| `progress` | Meta / progresso | `value`, `max`, `unit?`. |
| `calc` | Calculadora | `fields: [{ name, label, value }]`, `formula` (ex.: `A * 1000000 / H`), `unit?`, `decimals?`. Fórmulas são avaliadas por um interpretador seguro (sem `eval`): `+ - * / % ^ ( )` e `min max round abs sqrt log ln pow ceil floor`. |
| `site` | Leitor de site | `source` (id de uma `Source`). Mostra o resumo lido, data da última leitura e botão de atualizar. |
| `timeline` | Linha do tempo | `items: [{ date, text, url? }]` (ordenados do mais recente para o mais antigo). |
| `image` | Imagem | `src` (`data:image/…` ou `https://…`), `caption?`. |
| `embed` | Página incorporada | `url`, `height?` (px, padrão 360). Roda em `iframe` com `sandbox`; alguns sites bloqueiam incorporação. |

### 4.2 Tipos de gráfico (`kind`)

| `kind` | Uso recomendado |
|---|---|
| `bar` | Comparar categorias (até ~8 rótulos curtos). Com rótulos longos vira `hbar` automaticamente. |
| `hbar` | Rankings e categorias com nomes longos. |
| `line` | Evolução no tempo (uma ou mais séries). |
| `area` | Evolução de uma única série. |
| `donut` | Participação (≤ 6 fatias). `pie` é aceito e desenhado como `donut`. |
| `stacked` | Composição por categoria (barras empilhadas). |

Todos os gráficos têm tooltip ao passar o mouse, legenda quando há 2+ séries,
botão **▦ Tabela** (visão acessível dos dados) e tema claro/escuro.

### 4.3 Filtros, agregações e vencimentos

- **`filter`**: `{ col, op, value }` com `op` = `contains` \| `eq` \| `neq` \| `gt` \| `lt`.
  Comparações de texto ignoram maiúsculas e acentos.
- **`agg`** (KPI): `count` \| `sum` \| `avg` \| `max` \| `min` \| `last`
  (`last` + `deltaPrev: true` mostra a variação em relação ao valor anterior e um
  mini-gráfico das últimas 12 leituras).
- **`agg`** (gráfico): `count` (conta linhas por categoria), `sum` (soma as colunas
  `y`), `none` (usa as linhas como estão, até 80 pontos).
- **`groupDate: "month"`**: agrupa a coluna `x` (data) por mês e preenche meses sem
  registro com zero.
- **`validity`**: nome de uma coluna de data de vencimento. Status calculados na data
  de hoje: `vencido` (antes de hoje), `a_vencer` (até 30 dias), `em_dia`, `sem_data`.
  Em KPIs, use `from: { dataset, validity, status }`.

## 5. Datasets (bases de dados)

```json
{
  "id": "ds_x1",
  "name": "Extintores",
  "columns": [
    { "name": "Local", "type": "text" },
    { "name": "Tipo", "type": "select", "options": ["PQS ABC", "CO₂", "Água (AP)"] },
    { "name": "Recarga (validade)", "type": "date" },
    { "name": "Capacidade (kg)", "type": "number" }
  ],
  "rows": [["Portaria", "PQS ABC", "2027-01-26", "6"]],
  "sample": false
}
```

| Campo | Descrição |
|---|---|
| `columns[].type` | `text` \| `number` \| `date` \| `select` (com `options`). |
| `rows` | Matriz de strings, na ordem das colunas. Datas em ISO (`AAAA-MM-DD`); datas `DD/MM/AAAA` também são entendidas. Números aceitam formato brasileiro (`1.234,56`). |
| `sample` | `true` quando a IA preencheu dados de exemplo. A tabela mostra o aviso e o botão **Apagar exemplos**. |
| `source`, `tableIndex` | Dataset alimentado por um site: id da `Source` e índice da tabela na página. É reescrito a cada atualização da fonte. |
| `origin` | Texto livre sobre a origem (ex.: nome da planilha importada). |

## 6. Fontes externas (`sources`)

Criadas quando o usuário pede "crie uma aba a partir do site …" ou "adicione um
leitor do site …". A leitura acontece **sem abrir a guia do navegador**: a página é
baixada em segundo plano, interpretada e transformada em resumo, números, links e
tabelas.

| Campo | Descrição |
|---|---|
| `id`, `type: "url"`, `url` | Identificação da fonte. |
| `mode` | `auto` (padrão). |
| `refreshMinutes` | 0 = atualiza sob demanda (botão ⟳ ou pedido à IA). |
| `lastFetched`, `via`, `status`, `error` | Controle da última leitura (`via` = caminho usado: função do app, fetch direto ou leitor público). |
| `title`, `summary[]`, `numbers[]`, `links[]`, `tablesCount` | Conteúdo extraído na última leitura. |

Na criação a partir de um site, a IA gera: sub-aba **Resumo** (bloco `site`, até 4
KPIs com os números mais relevantes da página, tópicos e links), uma sub-aba por
tabela relevante (dataset + KPIs + gráfico escolhido pelo perfil dos dados + tabela)
e, para feeds RSS/Atom, uma sub-aba **Notícias** com linha do tempo.

> **Produção:** para evitar bloqueios de CORS, registre a busca de URLs do próprio
> servidor do app com `OPS360IA.registerFetcher(async (url) => ({ html, contentType }))`
> (também pode devolver só a string com o HTML) ou exponha `window.OPS360.lerSite(url)`.
> As regras de extração continuam as mesmas.

## 7. Histórico de operações (o "script")

Cada pedido do usuário (ou edição manual) gera uma entrada:

```json
{ "at": 1790000000000, "by": "ia", "prompt": "adicione um gráfico de pizza por setor", "ops": [ { "op": "add_widget", "subId": "sub_1", "widget": { … } } ] }
```

`by` = `ia` (pedido em linguagem natural) ou `usuario` (edição visual).
Atualizações automáticas de fontes não entram no histórico.

| `op` | Campos | Efeito |
|---|---|---|
| `rename_tab` | `name` | Renomeia a aba. |
| `set_style` | `color?`, `icon?`, `theme?`, `description?` | Aparência da aba. |
| `add_subtab` | `sub` (Subtab completa) | Cria sub-aba. |
| `rename_subtab` | `subId`, `name` | Renomeia sub-aba. |
| `remove_subtab` | `subId` | Remove sub-aba. |
| `move_subtab` | `subId`, `index` | Reordena sub-abas. |
| `set_columns` | `subId`, `columns` | Colunas do grid (1–4). |
| `add_widget` | `subId`, `widget`, `index?` | Adiciona bloco. |
| `update_widget` | `widgetId`, `patch: { title?, span?, type?, props? }` | Altera bloco (`props` é mesclado). |
| `remove_widget` | `widgetId` | Remove bloco. |
| `move_widget` | `widgetId`, `subId`, `index?` | Move bloco (inclusive entre sub-abas). |
| `add_dataset` | `dataset` | Cria base de dados. |
| `set_rows` | `dsId`, `rows` | Substitui as linhas. |
| `add_rows` | `dsId`, `rows` | Acrescenta linhas. |
| `add_source` | `source` | Conecta fonte externa. |
| `update_source` | `srcId`, `patch` | Atualiza dados da fonte. |

**Replay:** partindo da identidade da aba (nome, ícone, cor…) com `subtabs`,
`datasets` e `sources` vazios, aplicar todas as operações na ordem reproduz a aba.
É o que `OPS360IA.tabs.replay(base, historico)` faz.

## 8. Layout padrão (visual do OPS 360°)

- Grid de `columns` colunas (padrão 3), cartões com cantos arredondados, título à
  esquerda e ações do bloco à direita; em telas estreitas tudo empilha em 1 coluna.
- Cor da aba (`color`) só na identidade (ícone, barra de abas, destaques) — **nunca**
  como cor de série de gráfico.
- Paleta categórica fixa dos gráficos (validada para daltonismo), sempre na mesma
  ordem, nunca reciclada:
  - claro: `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #4a3aa7 #e34948`
  - escuro: `#3987e5 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 #e66767`
- Cores de status reservadas (sempre com rótulo/ícone, nunca só cor):
  bom `#0ca30c` · atenção `#fab219` · sério `#ec835a` · crítico `#d03b3b`.
- Um único eixo Y por gráfico; medidas de escalas diferentes vão em gráficos
  separados. Contagens usam marcas de eixo inteiras.

## 9. Pacote de implementação (exportação)

`ops360-aba-<nome>.zip`:

| Arquivo | Conteúdo |
|---|---|
| `blueprint.json` | A aba completa (seção 2) + `exportedAt` e `generator`. |
| `historico-ops.json` | O script de construção (seção 7). |
| `aba-<nome>.js` | Instalador de 1 linha: incluir **depois** do `ops360-ia.js`. Funciona mesmo se carregado antes (fica em `window.OPS360IA_PENDING_TABS` até o módulo iniciar). |
| `COMO-FOI-FEITO.md` | Documentação legível: estrutura, cada bloco e sua regra de dados, datasets, fontes, histórico de pedidos e passo a passo de implementação. |
| `preview.html` | Visualização estática da aba (abre em qualquer navegador). |
| `dados/*.csv` | Dados atuais de cada dataset (separador `;`, UTF-8 com BOM — abre direto no Excel). |

## 10. API JavaScript

Disponível em `window.OPS360IA` depois que o módulo inicia (`await OPS360IA.ready`).

```js
OPS360IA.tabs.list()                         // cópia de todas as abas
OPS360IA.tabs.get(id)                        // uma aba
OPS360IA.tabs.open(idOuNome, subId?)         // abre a área de trabalho da aba
OPS360IA.tabs.close()
await OPS360IA.tabs.install(blueprint, { overwrite: true })  // instala/atualiza
await OPS360IA.tabs.remove(id)
await OPS360IA.tabs.exportPackage(id)        // baixa o .zip da seção 9
await OPS360IA.tabs.renderInto('#minha-area', blueprintOuId) // renderiza em qualquer container
OPS360IA.tabs.replay(base, historico)        // reconstrói a partir do script
OPS360IA.tabs.blueprintSchema                // "ops360.tab/1"
```

`renderInto` usa Shadow DOM (o CSS do app não interfere e vice-versa) e se
atualiza sozinho quando a aba muda.

## 11. Três formas de levar uma aba para o app

1. **Instalar como está** — manter o `ops360-ia.js` carregado e incluir o
   `aba-<nome>.js` do pacote. A aba aparece na barra de abas do OPS 360°.
2. **Renderizar numa tela do app** — no roteador do app, chamar
   `OPS360IA.tabs.renderInto(container, blueprint)`.
3. **Reimplementar de forma nativa** — ler o `blueprint.json` e, para cada widget,
   implementar o componente equivalente seguindo as seções 4 e 5 (o `props` diz
   exatamente de onde vêm os dados e como agregá-los). Os dados iniciais estão em
   `dados/*.csv`.

## 12. Exemplo mínimo

```json
{
  "schema": "ops360.tab/1",
  "id": "tab_extintores",
  "name": "Extintores",
  "icon": "🧯",
  "color": "#d03b3b",
  "subtabs": [
    {
      "id": "sub_controle",
      "name": "Controle",
      "columns": 3,
      "widgets": [
        { "id": "w_total", "type": "kpi", "title": "Extintores", "span": 1, "props": { "from": { "dataset": "ds_ext", "agg": "count" } } },
        { "id": "w_venc", "type": "kpi", "title": "Recarga vencida", "span": 1, "props": { "from": { "dataset": "ds_ext", "validity": "Recarga", "status": "vencido" }, "good": "down", "tone": "critical" } },
        { "id": "w_tipo", "type": "chart", "title": "Por tipo", "span": 1, "props": { "kind": "donut", "dataset": "ds_ext", "x": "Tipo", "agg": "count" } },
        { "id": "w_form", "type": "form", "title": "Cadastrar extintor", "span": 1, "props": { "dataset": "ds_ext" } },
        { "id": "w_tab", "type": "table", "title": "Extintores", "span": 3, "props": { "dataset": "ds_ext", "validity": "Recarga" } }
      ]
    }
  ],
  "datasets": {
    "ds_ext": {
      "id": "ds_ext",
      "name": "Extintores",
      "columns": [
        { "name": "Local", "type": "text" },
        { "name": "Tipo", "type": "select", "options": ["PQS ABC", "CO₂", "Água (AP)"] },
        { "name": "Recarga", "type": "date" }
      ],
      "rows": [["Portaria", "PQS ABC", "2027-03-10"], ["Galpão 1", "CO₂", "2026-09-01"]]
    }
  },
  "sources": {},
  "history": []
}
```

## 13. Evolução do padrão

- Campos novos devem ser **opcionais** e ignoráveis por versões anteriores
  (compatível com `ops360.tab/1`).
- Mudanças que quebrem a leitura de blueprints existentes exigem `ops360.tab/2` e
  uma função de migração `1 → 2` no instalador.
- Tipos de widget novos entram na tabela 4.1 com `props` documentado antes de
  serem gerados pela IA.
