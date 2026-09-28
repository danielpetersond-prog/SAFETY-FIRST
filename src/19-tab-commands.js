// ---------------------------------------------------------------------------
// 19 · Comandos de abas em linguagem natural + criação a partir de sites e
//      planilhas + exportação do pacote padronizado (blueprint, script, docs)
// ---------------------------------------------------------------------------
const TAB_TEMPLATE_META = {
  ocorrencias: { name: 'Indicadores de SST', icon: '📊', color: '#2a78d6', subs: ['Visão geral', 'Calculadoras'] },
  treinamentos: { name: 'Treinamentos', icon: '🎓', color: '#6d5bd0', subs: ['Controle'] },
  epi: { name: 'Controle de EPI', icon: '🦺', color: '#eb6834', subs: ['Entregas'] },
  extintores: { name: 'Extintores', icon: '🧯', color: '#d03b3b', subs: ['Controle'] },
  inspecoes: { name: 'Inspeções', icon: '🔎', color: '#0d9488', subs: ['Inspeções'] },
  asos: { name: 'ASOs', icon: '🩺', color: '#0891b2', subs: ['Controle'] },
  cipa: { name: 'CIPA', icon: '👥', color: '#0f9d58', subs: ['Reuniões', 'Mural'] },
  links: { name: 'Links úteis', icon: '🔗', color: '#64748b', subs: ['Links'] },
  calculadoras: { name: 'Calculadoras de SST', icon: '🧮', color: '#b8860b', subs: ['Calculadoras'] },
  mural: { name: 'Mural de segurança', icon: '📌', color: '#eda100', subs: ['Mural'] },
};
const cleanName = (s) => String(s || '').replace(/^[\s"“'«]+|[\s"”'».,;:!?]+$/g, '').replace(/\s+/g, ' ').trim();
function quoted(raw) {
  const m = /["“'«]([^"”'»]{2,60})["”'»]/.exec(raw);
  return m ? m[1].trim() : null;
}
function splitList(s) {
  return String(s || '')
    .split(/\s*(?:,|;|\s+e\s+|\n)\s*/)
    .map(cleanName)
    .filter((x) => x && x.length < 50);
}
function parseSubNames(raw) {
  const nk = normKeep(raw);
  const m = /sub[\s-]?abas?\s*(?:chamadas?|com os nomes|com nomes|nomeadas|de|como|:)?\s*(.+)$/.exec(nk);
  if (!m) return [];
  let seg = raw.slice(m.index + m[0].length - m[1].length);
  seg = seg.split(/\s+(?:com (?:os )?campos|e (?:um|uma) |com (?:um|uma) |usando|a partir)/i)[0];
  return splitList(seg).slice(0, 10);
}
function parseFields(raw) {
  const nk = normKeep(raw);
  const m = /\b(?:campos?|colunas?)\s*(?:de|como|:|-)?\s*(.+)$/.exec(nk);
  if (!m) return [];
  return splitList(raw.slice(m.index + m[0].length - m[1].length)).slice(0, 15);
}
function parseTabName(raw) {
  const q = quoted(raw);
  if (q) return q;
  const nk = normKeep(raw);
  let m = /\b(?:chamad[ao]|com (?:o )?nome(?: de)?|nomead[ao]|intitulad[ao]|com titulo)\s+(.+?)(?=\s+(?:com|para|e|usando|a partir)\b|[,.;!?]|$)/.exec(nk);
  if (m) return cleanName(raw.slice(m.index + m[0].length - m[1].length, m.index + m[0].length));
  m = /\b(?:aba|guia|dashboard|painel)\s+(?:de|do|da|dos|das|para|pra|sobre)\s+(?:controle de |controlar |registrar |acompanhar |gestao de |gerenciar )?(.+?)(?=\s+(?:com|usando|a partir|que|onde)\b|[,.;!?]|$)/.exec(nk);
  if (m) return cleanName(raw.slice(m.index + m[0].length - m[1].length, m.index + m[0].length));
  return null;
}
function tabTemplateFor(text) {
  const n = norm(text);
  const t = SUB_TEMPLATES.find((x) => x.match.test(n));
  return t ? t.key : null;
}
function colorFrom(t) {
  const hex = /#([0-9a-f]{6})\b/i.exec(t);
  if (hex) return '#' + hex[1].toLowerCase();
  const n = norm(t);
  for (const [k, v] of Object.entries(TAB_COLORS)) if (new RegExp('\\b' + k).test(n)) return v;
  return null;
}
const emojiOf = (s) => (String(s).match(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u) || [])[0] || null;

function describeTab(tab) {
  const nW = tab.subtabs.reduce((a, s) => a + s.widgets.length, 0);
  return `${tab.subtabs.length} sub-aba(s) — ${tab.subtabs.map((s) => s.name).join(', ')} — e ${nW} bloco(s)`;
}
function currentTargetTab(env, raw) {
  const nk = normKeep(raw);
  const m = /\b(?:na|da|a|pela|para a)\s+aba\s+["“]?([^"”,.;]+?)["”]?(?=\s+(?:com|para|e|um|uma)\b|[,.;!?]|$)/.exec(nk);
  if (m) {
    const t = tabs.find(cleanName(raw.slice(m.index + m[0].length - m[1].length, m.index + m[0].length)));
    if (t) return t;
  }
  for (const t of tabs.list) if (norm(raw).includes(norm(t.name)) && t.name.length > 3) return t;
  return tabs.get(env.currentTabId) || tabs.get(env.chat && env.chat.state.lastTab) || tabs.list[tabs.list.length - 1] || null;
}
function targetSub(tab, raw, env) {
  const nk = normKeep(raw);
  const m = /sub[\s-]?aba\s+["“]?([^"”,.;]+?)["”]?(?=\s+(?:com|para|e|um|uma)\b|[,.;!?]|$)/.exec(nk);
  if (m) {
    const name = cleanName(raw.slice(m.index + m[0].length - m[1].length, m.index + m[0].length));
    let best = null, bs = 0;
    for (const s of tab.subtabs) {
      const sc = dice(s.name, name);
      if (sc > bs) {
        best = s;
        bs = sc;
      }
    }
    if (best && bs >= 0.5) return best;
  }
  return tab.subtabs.find((s) => s.id === env.currentSubId) || tab.subtabs[0];
}
function findWidgetByText(tab, typeWord, title) {
  const typeMap = { grafico: 'chart', kpi: 'kpi', indicador: 'kpi', card: 'kpi', tabela: 'table', nota: 'note', anotacao: 'note', checklist: 'checklist', contador: 'counter', formulario: 'form', calculadora: 'calc', link: 'links', links: 'links', meta: 'progress', progresso: 'progress' };
  const type = typeMap[norm(typeWord || '')];
  let best = null, bs = 0;
  for (const s of tab.subtabs)
    for (const w of s.widgets) {
      if (type && w.type !== type) continue;
      const sc = title ? dice(w.title, title) + (norm(w.title).includes(norm(title)) ? 0.4 : 0) : 0.5;
      if (sc > bs) {
        best = w;
        bs = sc;
      }
    }
  return bs >= 0.35 ? best : null;
}
function findDatasetCol(tab, word) {
  let best = null, bs = 0;
  for (const ds of Object.values(tab.datasets))
    for (const c of ds.columns) {
      const sc = dice(c.name, word) + (norm(c.name).startsWith(norm(word).slice(0, 4)) ? 0.25 : 0);
      if (sc > bs) {
        best = { ds, col: c };
        bs = sc;
      }
    }
  return bs >= 0.5 ? best : null;
}
function chartKindFrom(t) {
  if (/(pizza|rosca|donut|torta)/.test(t)) return 'donut';
  if (/horizonta/.test(t)) return 'hbar';
  if (/empilhad/.test(t)) return 'stacked';
  if (/\barea\b/.test(t)) return 'area';
  if (/(linha|evolucao|tendencia|temporal)/.test(t)) return 'line';
  return 'bar';
}
function parsePairs(raw) {
  const pairs = [];
  const re = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9/ .-]{0,24}?)\s*(?:[:=]|\s)\s*(-?\d+(?:[.,]\d+)?)(?=\s*(?:,|;|e\b|$))/g;
  const seg = (/[:]\s*(.+)$/.exec(raw) || [])[1] || raw;
  let m;
  while ((m = re.exec(seg))) {
    const label = cleanName(m[1]).replace(/^(os dados|dados|valores|com)\s+/i, '');
    if (label && !/^(grafico|com|de|dados)$/i.test(label)) pairs.push([label, parseNumBR(m[2])]);
  }
  return pairs.length >= 2 ? pairs : [];
}
function widgetTitle(raw, fallback) {
  const q = quoted(raw);
  if (q) return q;
  const nk = normKeep(raw);
  const m = /\b(?:chamad[oa]|com (?:o )?titulo|intitulad[oa])\s+(.+?)(?=\s+(?:com|na|no|para|e)\b|[,.;!?]|$)/.exec(nk);
  if (m) return cleanName(raw.slice(m.index + m[0].length - m[1].length, m.index + m[0].length));
  return fallback;
}

// Cria um widget a partir do pedido em linguagem natural
function widgetFromText(raw, tab, env) {
  const t = norm(raw);
  const ops = [];
  const url = (RE_URL.exec(raw) || [])[1];
  if (/(contador|dias sem)/.test(t)) {
    const d = (/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/.exec(raw) || [])[1];
    const occ = Object.values(tab.datasets).find((ds) => ds.columns.some((c) => /tipo/i.test(c.name)) && ds.columns.some((c) => c.type === 'date'));
    const props = d ? { since: isoDate(parseDateBR(d)) } : occ ? { from: { dataset: occ.id, dateCol: occ.columns.find((c) => c.type === 'date').name, filter: { col: 'Tipo', op: 'contains', value: 'acidente' } } } : { since: isoDate(new Date()) };
    return { widget: W('counter', widgetTitle(raw, 'Dias sem acidentes'), props), ops };
  }
  if (/calculadora/.test(t)) {
    if (/frequencia/.test(t)) return { widget: calcWidget('tf'), ops };
    if (/gravidade/.test(t)) return { widget: calcWidget('tg'), ops };
    if (/(ruido|exposicao|decibe)/.test(t)) return { widget: calcWidget('ruido'), ops };
    const fields = parseFields(raw.replace(/f[oó]rmula.*$/i, '')).slice(0, 6);
    const formula = (/f[oó]rmula\s*[:=]?\s*(.+)$/i.exec(raw) || [])[1] || fields.map((_, i) => String.fromCharCode(65 + i)).join(' + ');
    const letters = fields.map((f, i) => ({ name: /^[A-Za-z]$/.test(f) ? f.toUpperCase() : String.fromCharCode(65 + i), label: f, value: 0 }));
    return { widget: W('calc', widgetTitle(raw, 'Calculadora'), { fields: letters.length ? letters : [{ name: 'A', label: 'Valor A', value: 0 }, { name: 'B', label: 'Valor B', value: 0 }], formula: formula.trim(), decimals: 2 }), ops };
  }
  if (/(meta|progresso)/.test(t)) {
    const nums = (raw.match(/\d+(?:[.,]\d+)?/g) || []).map(parseNumBR);
    const max = nums.length ? Math.max(...nums) : 100;
    const value = nums.length > 1 ? Math.min(...nums) : 0;
    return { widget: W('progress', widgetTitle(raw, 'Meta'), { value, max, unit: '' }), ops };
  }
  if (/(checklist|lista de verificacao|lista de tarefas|tarefas|pendencias)/.test(t)) {
    const items = splitList((/(?:itens|tarefas|com)\s*:?\s*(.+)$/i.exec(raw) || [])[1] || '').slice(0, 30);
    return { widget: W('checklist', widgetTitle(raw, 'Checklist'), { items: items.map((x) => ({ text: capFirst(x), done: false })) }), ops };
  }
  if (/\blinks?\b/.test(t) && !/grafico/.test(t)) {
    const urls = raw.match(new RegExp(RE_URL.source, 'gi')) || [];
    const items = urls.map((u) => {
      const nu = normalizeUrl(u);
      return nu ? { text: new URL(nu).hostname.replace(/^www\./, ''), url: nu } : null;
    }).filter(Boolean);
    return { widget: W('links', widgetTitle(raw, 'Links'), { items }), ops };
  }
  if (/(leitor|site|pagina externa)/.test(t) && url) {
    const nu = normalizeUrl(url);
    const src = { id: uid('src'), type: 'url', url: nu, mode: 'auto', refreshMinutes: 0, lastFetched: null };
    ops.push({ op: 'add_source', source: src });
    return { widget: W('site', widgetTitle(raw, new URL(nu).hostname.replace(/^www\./, '')), { source: src.id }, 2), ops, fetchSource: src.id };
  }
  if (/(nota|anotacao|texto|aviso|recado|observacao)/.test(t) && !/grafico|tabela/.test(t)) {
    const txt = (/(?:dizendo|com o texto|escrito|texto|:)\s*["“]?(.+?)["”]?$/i.exec(raw) || [])[1] || 'Escreva aqui.';
    return { widget: W('note', widgetTitle(raw, 'Nota'), { text: txt }, 2), ops };
  }
  if (/(linha do tempo|timeline|cronograma)/.test(t)) {
    const items = [...raw.matchAll(/(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\s*[-–:]\s*([^,;\n]+)/g)].map((m) => ({ date: isoDate(parseDateBR(m[1]) || new Date()), text: m[2].trim() }));
    return { widget: W('timeline', widgetTitle(raw, 'Linha do tempo'), { items }, 2), ops };
  }
  if (/(tabela|formulario|cadastro|registro de)/.test(t) && !/grafico/.test(t)) {
    const fields = parseFields(raw);
    let ds = null;
    if (fields.length) {
      ds = DS(widgetTitle(raw, 'Registros'), fields.map((f) => ({ name: capFirst(f), type: /(data|validade|venc)/.test(norm(f)) ? 'date' : /(quantidade|qtd|valor|numero|total|dias|horas)/.test(norm(f)) ? 'number' : 'text' })), []);
      ops.push({ op: 'add_dataset', dataset: ds });
    } else ds = Object.values(tab.datasets)[0] || null;
    if (!ds) {
      ds = DS('Registros', [{ name: 'Data', type: 'date' }, { name: 'Descrição', type: 'text' }, { name: 'Responsável', type: 'text' }], []);
      ops.push({ op: 'add_dataset', dataset: ds });
    }
    if (/(formulario|cadastro)/.test(t)) return { widget: W('form', widgetTitle(raw, 'Novo registro'), { dataset: ds.id }), ops, extra: [W('table', ds.name, { dataset: ds.id, search: true }, 3)] };
    return { widget: W('table', widgetTitle(raw, ds.name), { dataset: ds.id, search: true }, 3), ops };
  }
  if (/(kpi|indicador|card|numero em destaque)/.test(t) && !/grafico/.test(t)) {
    const val = (/(?:valor|=|:|com)\s*(-?\d+(?:[.,]\d+)?)/.exec(raw) || [])[1];
    const lbl = widgetTitle(raw, cleanName((/(?:kpi|indicador|card)\s+(?:de|do|da|com)?\s*([^=:,.;]+?)(?:\s+(?:com|=|valor)|[,.;]|$)/i.exec(raw) || [])[1] || 'Indicador'));
    if (val != null) return { widget: W('kpi', capFirst(lbl), { value: parseNumBR(val), unit: /%/.test(raw) ? '%' : '' }), ops };
    const ds = Object.values(tab.datasets)[0];
    if (ds) return { widget: W('kpi', capFirst(lbl), { from: { dataset: ds.id, agg: 'count' } }), ops };
    return { widget: W('kpi', capFirst(lbl), { value: 0 }), ops };
  }
  if (/(image|imagem|foto|logo)/.test(t) && env.files && env.files.some((f) => f.kind === 'image')) {
    const img = env.files.find((f) => f.kind === 'image');
    return { widget: W('image', widgetTitle(raw, img.name), { src: img.image.dataUrl, caption: '' }, 2), ops };
  }
  // gráfico (padrão)
  const kind = chartKindFrom(t);
  const pairs = parsePairs(raw);
  if (pairs.length) return { widget: W('chart', widgetTitle(raw, 'Gráfico'), { kind, labels: pairs.map((p) => p[0]), series: [{ name: 'Valor', values: pairs.map((p) => p[1]) }] }, kind === 'donut' ? 1 : 2), ops };
  const por = /\bpor\s+([a-zà-ú ]{3,25}?)(?=\s+(?:na|no|da|do|com|em)\b|[,.;!?]|$)/i.exec(raw);
  if (por) {
    const hit = findDatasetCol(tab, por[1]);
    if (hit) {
      const isDate = hit.col.type === 'date' || /mes|mês|data|periodo/.test(norm(por[1]));
      let subject = (/(?:grafico|gráfico)(?:\s+de\s+(?:barras|pizza|linha|rosca|area|área|colunas)(?:\s+horizontais)?)?\s+(?:de|dos|das|com)\s+([a-zà-ú ]+?)\s+por\b/i.exec(raw) || [])[1];
      if (subject && /^(pizza|barras?|linhas?|rosca|donut|area|área|colunas?|torta)(\s+horizontais)?$/i.test(subject.trim())) subject = null;
      const numCol = subject ? hit.ds.columns.find((c) => c.type === 'number' && dice(c.name, subject) > 0.45) : null;
      return {
        widget: W('chart', widgetTitle(raw, subject ? `${capFirst(subject)} por ${por[1].trim()}` : kind === 'donut' ? `Distribuição por ${por[1].trim()}` : `Registros por ${por[1].trim()}`), { kind: isDate && kind === 'bar' ? 'line' : kind, dataset: hit.ds.id, x: hit.col.name, agg: numCol ? 'sum' : 'count', y: numCol ? [numCol.name] : undefined, groupDate: hit.col.type === 'date' ? 'month' : undefined, top: 12 }, kind === 'donut' ? 1 : 2),
        ops,
      };
    }
  }
  const ds = Object.values(tab.datasets)[0];
  if (ds) {
    const cat = ds.columns.find((c) => c.type === 'select') || ds.columns.find((c) => c.type === 'text');
    if (cat) return { widget: W('chart', widgetTitle(raw, `Registros por ${cat.name.toLowerCase()}`), { kind, dataset: ds.id, x: cat.name, agg: 'count', top: 12 }, kind === 'donut' ? 1 : 2), ops };
  }
  return { widget: W('chart', widgetTitle(raw, 'Novo gráfico'), { kind, labels: ['Jan', 'Fev', 'Mar', 'Abr'], series: [{ name: 'Valor', values: [0, 0, 0, 0] }], placeholder: true }, 2), ops, note: 'Criei com dados de exemplo — edite os dados no modo Editar ou me diga: "adicione os dados: jan 3, fev 5, mar 2".' };
}

async function createTabFromRequest(raw, env) {
  const t = norm(raw);
  const fields = /\bcampos?\b|\bcolunas?\b/.test(t) ? parseFields(raw) : [];
  let subNames = parseSubNames(raw);
  let name = parseTabName(raw) || (subNames.length ? 'Nova aba' : null);
  const tplKey = tabTemplateFor(name || raw);
  const meta = tplKey ? TAB_TEMPLATE_META[tplKey] : null;
  if (!name) name = meta ? meta.name : 'Nova aba';
  name = capFirst(name.replace(/^(controle de|controlar|registrar|acompanhar|gestao de|gerenciar)\s+/i, (m) => (fields.length ? m : '')));
  const tab = newTab({ name: fields.length && !/^controle/i.test(name) ? 'Controle de ' + name.toLowerCase() : name, icon: emojiOf(raw) || (meta ? meta.icon : fields.length ? '🗂️' : '📁'), color: colorFrom(raw) || (meta ? meta.color : '#0d9488'), description: capFirst(truncate(raw, 200)) });
  const ops = [{ op: 'set_style', color: tab.color, icon: tab.icon, description: tab.description }];
  if (fields.length) {
    const { ds, widgets } = trackerFromFields(name, fields);
    const sub = { id: uid('sub'), name: 'Controle', columns: 3, widgets: [] };
    ops.push({ op: 'add_dataset', dataset: ds }, { op: 'add_subtab', sub });
    widgets.forEach((w) => ops.push({ op: 'add_widget', subId: sub.id, widget: w }));
  } else {
    if (!subNames.length) subNames = meta ? meta.subs : ['Geral'];
    for (const sn of subNames) {
      const r = subFromTemplate(tab, sn === 'Visão geral' && tplKey ? tplKey + ' visão geral' : sn === 'Controle' && tplKey ? tplKey : sn === 'Entregas' && tplKey ? 'epi' : sn);
      r.sub.name = titleCase(sn);
      const widgets = r.sub.widgets;
      r.sub.widgets = [];
      ops.push(...r.ops);
      widgets.forEach((w) => ops.push({ op: 'add_widget', subId: r.sub.id, widget: w }));
    }
  }
  await applyTabOps(tab, ops, { prompt: raw });
  return tab;
}

async function tabFromSite(url, raw) {
  const rep = await readSite(url);
  const name = truncate(rep.title || rep.host, 40);
  const tab = newTab({ name, icon: '🌐', color: colorFrom(raw) || '#2a78d6', description: `Criada a partir de ${rep.url}` });
  const src = { id: uid('src'), type: 'url', url: rep.url, mode: 'auto', refreshMinutes: 0, lastFetched: rep.fetchedAt, via: rep.via, title: rep.title, summary: rep.summary, numbers: rep.numbers, links: rep.links.slice(0, 20), tablesCount: rep.tables.length };
  const ops = [{ op: 'set_style', icon: '🌐', color: tab.color, description: tab.description }, { op: 'add_source', source: src }];
  const s1 = { id: uid('sub'), name: 'Resumo', columns: 3, widgets: [] };
  ops.push({ op: 'add_subtab', sub: s1 });
  ops.push({ op: 'add_widget', subId: s1.id, widget: W('site', rep.title || rep.host, { source: src.id }, 2) });
  rep.numbers.slice(0, 4).forEach((n) => ops.push({ op: 'add_widget', subId: s1.id, widget: W('kpi', truncate(n.label, 40), { value: n.value, unit: n.pct ? '%' : n.money ? 'R$' : '', source: src.id, context: truncate(n.context, 160) }) }));
  if (rep.headings.length > 2) ops.push({ op: 'add_widget', subId: s1.id, widget: W('note', 'Tópicos da página', { text: rep.headings.slice(0, 14).map((h) => (h.level > 2 ? '   ◦ ' : '• ') + h.text).join('\n') }) });
  if (rep.links.length) ops.push({ op: 'add_widget', subId: s1.id, widget: W('links', 'Links principais', { items: rep.links.slice(0, 12) }, rep.headings.length > 2 ? 2 : 3) });
  const good = rep.tables.filter((tb) => tb.profile && tb.profile.rows >= 2).slice(0, 4);
  good.forEach((tb, k) => {
    const rows = [tb.head || tb.rows[0].map((_, i) => `Coluna ${i + 1}`), ...tb.rows];
    const { ds, widgets } = autoWidgetsForTable(tab, rows, tb.caption);
    if (!ds) return;
    ds.source = src.id;
    ds.tableIndex = rep.tables.indexOf(tb);
    const sub = { id: uid('sub'), name: truncate(tb.caption || `Dados ${k + 1}`, 28), columns: 3, widgets: [] };
    ops.push({ op: 'add_dataset', dataset: ds }, { op: 'add_subtab', sub });
    widgets.forEach((w) => ops.push({ op: 'add_widget', subId: sub.id, widget: w }));
  });
  if (rep.kind === 'rss' && rep.feed) {
    const sub = { id: uid('sub'), name: 'Notícias', columns: 3, widgets: [] };
    ops.push({ op: 'add_subtab', sub }, { op: 'add_widget', subId: sub.id, widget: W('timeline', 'Últimas publicações', { items: rep.feed.slice(0, 20).map((i) => ({ date: i.date && !isNaN(i.date) ? isoDate(i.date) : '', text: i.title, url: i.url })) }, 3) });
  }
  await applyTabOps(tab, ops, { prompt: raw });
  return { tab, rep };
}

async function tabFromFile(file, raw) {
  const tab = newTab({ name: truncate(file.name.replace(/\.[^.]+$/, ''), 40), icon: '📈', color: colorFrom(raw) || '#0d9488', description: `Criada a partir do arquivo ${file.name}` });
  const ops = [{ op: 'set_style', icon: '📈', color: tab.color, description: tab.description }];
  const a = file.analysis;
  const s0 = { id: uid('sub'), name: 'Resumo', columns: 3, widgets: [] };
  ops.push({ op: 'add_subtab', sub: s0 });
  ops.push({ op: 'add_widget', subId: s0.id, widget: W('note', `Sobre “${file.name}”`, { text: [`**Tipo:** ${a.typeLabel}`, ...(a.summary || []).slice(0, 4).map((x) => '• ' + x), ...(a.alerts || []).slice(0, 4)].join('\n') }, 3) });
  const tbls = (file.sheets || file.tables || []).filter((x) => x.rows && x.rows.length >= 2).slice(0, 6);
  for (const tb of tbls) {
    const { ds, widgets } = autoWidgetsForTable(tab, tb.rows, tb.name);
    if (!ds) continue;
    ds.origin = file.name;
    const sub = { id: uid('sub'), name: truncate(tb.name || 'Dados', 28), columns: 3, widgets: [] };
    ops.push({ op: 'add_dataset', dataset: ds }, { op: 'add_subtab', sub });
    widgets.forEach((w) => ops.push({ op: 'add_widget', subId: sub.id, widget: w }));
  }
  await applyTabOps(tab, ops, { prompt: raw });
  return tab;
}

async function refreshTabSources(tab) {
  const results = [];
  for (const src of Object.values(tab.sources || {})) {
    if (src.type !== 'url') continue;
    try {
      const rep = await readSite(src.url, { fresh: true });
      const ops = [{ op: 'update_source', srcId: src.id, patch: { lastFetched: rep.fetchedAt, via: rep.via, title: rep.title, summary: rep.summary, numbers: rep.numbers, links: rep.links.slice(0, 20), status: 'ok', error: null } }];
      for (const ds of Object.values(tab.datasets)) {
        if (ds.source !== src.id || ds.tableIndex == null) continue;
        const tb = rep.tables[ds.tableIndex];
        if (tb) ops.push({ op: 'set_rows', dsId: ds.id, rows: tb.rows.slice(0, 2000).map((r) => ds.columns.map((_, i) => r[i] == null ? '' : String(r[i]))) });
      }
      await applyTabOps(tab, ops, { prompt: 'Atualização da fonte ' + src.url, by: 'sistema', log: false });
      results.push({ url: src.url, ok: true });
    } catch (e) {
      await applyTabOps(tab, [{ op: 'update_source', srcId: src.id, patch: { status: 'erro', error: e.message } }], { log: false });
      results.push({ url: src.url, ok: false, error: e.message });
    }
  }
  return results;
}

// Interpreta um pedido de edição e devolve operações
function editOpsFromText(raw, tab, env) {
  const t = norm(raw);
  const nk = normKeep(raw);
  const ops = [];
  const notes = [];
  let m;
  const sub = targetSub(tab, raw, env);
  // sub-abas
  if ((m = /(?:adicion|cri|inclu|coloc|faz|fac)\w*\s+(?:uma\s+|mais\s+uma\s+)?(?:nova\s+)?sub[\s-]?abas?\s*(?:chamadas?|de|com (?:o )?nome|para|:)?\s*(.+)$/.exec(nk))) {
    const names = splitList(raw.slice(m.index + m[0].length - m[1].length)).map((n) => n.replace(/\s+na aba.*$/i, '')).filter(Boolean).slice(0, 8);
    for (const n of names.length ? names : ['Nova sub-aba']) {
      const r = subFromTemplate(tab, n);
      const widgets = r.sub.widgets;
      r.sub.widgets = [];
      ops.push(...r.ops);
      widgets.forEach((w) => ops.push({ op: 'add_widget', subId: r.sub.id, widget: w }));
    }
    return { ops, notes, focusSub: ops.find((o) => o.op === 'add_subtab').sub.id };
  }
  if ((m = /renome\w*\s+(?:a\s+)?sub[\s-]?aba\s+["“]?(.+?)["”]?\s+para\s+["“]?(.+?)["”]?$/.exec(nk))) {
    const s = targetSub(tab, 'sub-aba ' + m[1], env);
    const at = nk.lastIndexOf(m[2]);
    if (s) ops.push({ op: 'rename_subtab', subId: s.id, name: capFirst(cleanName(at >= 0 ? raw.slice(at, at + m[2].length) : m[2])) });
    return { ops, notes };
  }
  if ((m = /(?:remov|exclu|apag|delet|tir)\w*\s+(?:a\s+)?sub[\s-]?aba\s+["“]?(.+?)["”]?$/.exec(nk))) {
    const s = targetSub(tab, 'sub-aba ' + m[1], env);
    if (s && tab.subtabs.length > 1) ops.push({ op: 'remove_subtab', subId: s.id });
    else notes.push('A aba precisa ter pelo menos uma sub-aba.');
    return { ops, notes };
  }
  // aba: nome, cor, ícone, tema, descrição, colunas
  if ((m = /(?:renome\w*|mud\w* o nome|troc\w* o nome|alter\w* o nome)(?:\s+d?a\s+aba)?(?:\s+["“]?.+?["”]?)?\s+para\s+["“]?(.+?)["”]?$/.exec(nk))) {
    const newName = cleanName(raw.slice(nk.lastIndexOf(m[1])));
    ops.push({ op: 'rename_tab', name: capFirst(newName || m[1]) });
  }
  const color = /\b(cor|colori|pint|tonalidade)\w*/.test(t) ? colorFrom(raw) : null;
  if (color) ops.push({ op: 'set_style', color });
  const emo = /(icone|emoji|simbolo)/.test(t) ? emojiOf(raw) : null;
  if (emo) ops.push({ op: 'set_style', icon: emo });
  if ((m = /(?:tema|modo|fundo)\s+(escuro|claro|dark|light)/.exec(t))) ops.push({ op: 'set_style', theme: /escuro|dark/.test(m[1]) ? 'dark' : 'light' });
  if ((m = /(?:descricao|objetivo)\s*[:\-]\s*(.+)$/.exec(nk))) ops.push({ op: 'set_style', description: raw.slice(m.index + m[0].length - m[1].length) });
  if ((m = /\b([1-4])\s*colunas?\b/.exec(t)) && /(layout|colunas|organiz|grade|deix)/.test(t)) ops.push({ op: 'set_columns', subId: sub.id, columns: +m[1] });
  if (ops.length) return { ops, notes };
  // widgets: remover
  if ((m = /(?:remov|exclu|apag|delet|tir)\w*\s+(?:o|a|os|as|esse|essa)?\s*(grafico|kpi|indicador|card|tabela|nota|anotacao|checklist|contador|widget|formulario|calculadora|links?|bloco|meta|progresso)s?\s*(?:de|do|da|dos|das|chamad[oa]|sobre)?\s*["“]?(.*?)["”]?$/.exec(t))) {
    const w = findWidgetByText(tab, m[1], cleanName(m[2]).replace(/\s*na aba.*$/, ''));
    if (w) ops.push({ op: 'remove_widget', widgetId: w.id });
    else notes.push('Não encontrei esse bloco — diga o título exato ou use o modo Editar.');
    return { ops, notes };
  }
  // widgets: trocar tipo de gráfico
  if ((m = /(?:mud|troc|transform|alter|convert)\w*\s+(?:o\s+)?grafico\s*(.*?)\s+(?:para|em)\s+(?:um\s+)?(?:grafico\s+de\s+)?(pizza|rosca|donut|barras?(?: horizontais)?|colunas|linha|area|empilhad\w*)/.exec(t))) {
    const w = findWidgetByText(tab, 'grafico', cleanName(m[1]));
    if (w) ops.push({ op: 'update_widget', widgetId: w.id, patch: { props: { kind: chartKindFrom(m[2]) } } });
    return { ops, notes };
  }
  // widgets: tamanho
  if ((m = /(?:deix|aument|diminu|coloc|mud)\w*\s+(?:o|a)\s+(grafico|tabela|nota|kpi|indicador|checklist|contador|formulario|calculadora|bloco)\s*(.*?)\s+(maior|largura total|inteir[oa]|full|menor|pequen[oa]|metade)/.exec(t))) {
    const w = findWidgetByText(tab, m[1], cleanName(m[2]));
    const span = /(maior|largura total|inteir|full)/.test(m[3]) ? (/(largura total|inteir|full)/.test(m[3]) ? 4 : Math.min(4, (w ? w.span : 1) + 1)) : /metade/.test(m[3]) ? 2 : 1;
    if (w) ops.push({ op: 'update_widget', widgetId: w.id, patch: { span } });
    return { ops, notes };
  }
  // widgets: mover
  if ((m = /(?:mov|pass|lev|coloc)\w*\s+(?:o|a)\s+(grafico|tabela|nota|kpi|indicador|checklist|contador|formulario|calculadora|bloco)\s*(.*?)\s+para\s+(?:o\s+|a\s+)?(topo|inicio|comeco|fim|final|primeiro|ultimo|sub[\s-]?aba\s+.+)/.exec(t))) {
    const w = findWidgetByText(tab, m[1], cleanName(m[2]));
    if (w) {
      const dest = /sub[\s-]?aba/.test(m[3]) ? targetSub(tab, m[3], env) : widgetSub(tab, w.id);
      ops.push({ op: 'move_widget', widgetId: w.id, subId: dest.id, index: /(topo|inicio|comeco|primeiro)/.test(m[3]) ? 0 : null });
    }
    return { ops, notes };
  }
  // widgets: renomear
  if ((m = /renome\w*\s+(?:o|a)\s+(grafico|tabela|nota|kpi|indicador|checklist|contador|formulario|calculadora|bloco)\s*(.*?)\s+para\s+["“]?(.+?)["”]?$/.exec(nk))) {
    const w = findWidgetByText(tab, m[1], cleanName(m[2]));
    const at = nk.lastIndexOf(m[3]);
    if (w) ops.push({ op: 'update_widget', widgetId: w.id, patch: { title: capFirst(cleanName(at >= 0 ? raw.slice(at, at + m[3].length) : m[3])) } });
    return { ops, notes };
  }
  // dados em gráfico existente
  if (/(adicion|inclu|coloc|atualiz)\w*\s+(?:os\s+)?(dados|valores)/.test(t)) {
    const pairs = parsePairs(raw);
    const w = findWidgetByText(tab, 'grafico', (/(?:grafico|gráfico)\s+["“]?([^"”:,]+)/i.exec(raw) || [])[1] || '') || [...tab.subtabs.flatMap((s) => s.widgets)].reverse().find((x) => x.type === 'chart' && !x.props.dataset);
    if (w && pairs.length && !w.props.dataset) ops.push({ op: 'update_widget', widgetId: w.id, patch: { props: { labels: pairs.map((p) => p[0]), series: [{ name: (w.props.series && w.props.series[0] && w.props.series[0].name) || 'Valor', values: pairs.map((p) => p[1]) }], placeholder: false } } });
    else notes.push('Para adicionar dados, diga por exemplo: "adicione os dados: jan 3, fev 5, mar 2 ao gráfico X". Gráficos ligados a tabelas se atualizam pelo formulário de registro.');
    return { ops, notes };
  }
  // widgets: adicionar
  if (/(adicion|inclu|coloc|cri|bot|ponh|poe|faz|fac|mont|quero|insir)\w*/.test(t) && WIDGET_WORD.test(t)) {
    const r = widgetFromText(raw, tab, env);
    ops.push(...r.ops, { op: 'add_widget', subId: sub.id, widget: r.widget });
    if (r.extra) r.extra.forEach((w) => ops.push({ op: 'add_widget', subId: sub.id, widget: w }));
    if (r.note) notes.push(r.note);
    return { ops, notes, fetchSource: r.fetchSource };
  }
  return { ops, notes };
}

async function tabCommand(intent, res, env) {
  const raw = res.raw;
  const parts = [];
  const md = (text) => parts.push({ type: 'md', text });
  const chips = (items) => parts.push({ type: 'chips', items });
  if (intent === 'tab_list') {
    if (!tabs.list.length) {
      md('Você ainda não tem abas personalizadas. Que tal criar uma? Eu monto a estrutura, os gráficos e os formulários — e você ajusta como quiser. ✨');
      chips([{ label: '📊 Aba de indicadores de SST', send: 'Crie uma aba de indicadores de segurança' }, { label: '🎓 Controle de treinamentos', send: 'Crie uma aba de treinamentos' }, { label: '🧯 Controle de extintores', send: 'Crie uma aba de extintores' }, { label: '🗂️ Aba com meus campos', send: 'Crie uma aba para controlar inspeções de empilhadeira com campos: data, equipamento, operador, resultado, observação' }]);
      return { parts };
    }
    md(`Você tem **${tabs.list.length}** aba(s) personalizada(s):\n` + tabs.list.map((tb) => `• ${tb.icon} **${tb.name}** — ${describeTab(tb)}`).join('\n'));
    tabs.list.slice(0, 6).forEach((tb) => parts.push({ type: 'tab', tabId: tb.id }));
    return { parts };
  }
  if (intent === 'tab_create') {
    const tab = await createTabFromRequest(raw, env);
    md(`${pick(['Pronto!', 'Aba criada! ✨', 'Feito!'])} Criei a aba **${tab.icon} ${tab.name}** com ${describeTab(tab)}.${Object.values(tab.datasets).some((d) => d.sample) ? '\nColoquei alguns **dados de exemplo** para você ver os gráficos funcionando — dá para apagá-los com um clique.' : ''}\nEla já aparece na barra de abas do OPS 360°. Me peça ajustes quando quiser (ex.: *"adicione um gráfico de pizza por setor"*, *"mude a cor para azul"*, *"crie uma sub-aba Metas"*).`);
    parts.push({ type: 'tab', tabId: tab.id });
    chips([{ label: '➕ Adicionar gráfico', send: `Adicione um gráfico de barras por setor na aba ${tab.name}` }, { label: '🎨 Mudar cor', send: `Mude a cor da aba ${tab.name} para azul` }, { label: '📦 Exportar padrão', send: `Exporte o pacote da aba ${tab.name}` }]);
    return { parts, tabId: tab.id, open: true };
  }
  if (intent === 'tab_from_site') {
    const url = res.slots.url;
    try {
      const { tab, rep } = await tabFromSite(url, raw);
      md(`Li **${rep.title || rep.host}** (${rep.host}, via ${rep.via}) e montei a aba **${tab.icon} ${tab.name}**: ${describeTab(tab)}.${rep.tables.length ? ` Transformei ${Math.min(4, rep.tables.length)} tabela(s) em gráficos inteligentes.` : ' A página não tinha tabelas de dados, então destaquei resumo, números e links.'}\nUse **Atualizar** na aba para buscar os dados novamente — a receita da leitura fica salva no padrão da aba.`);
      parts.push({ type: 'tab', tabId: tab.id });
      return { parts, tabId: tab.id, open: true };
    } catch (e) {
      md(`Não consegui ler esse site agora 😕\n${e.message}\n\nDicas: confira o endereço; alguns sites bloqueiam leitura automática. Se o OPS 360° já tem um leitor próprio, ele pode ser conectado com \`OPS360IA_CONFIG.fetcher\`.`);
      return { parts };
    }
  }
  if (intent === 'tab_from_file') {
    const file = (env.files || []).find((f) => (f.sheets || f.tables || []).length) || (env.files || [])[0];
    if (!file) {
      md('Anexe uma planilha (Excel/CSV) ou documento com tabelas e me diga "crie uma aba com esses dados".');
      return { parts };
    }
    const tab = await tabFromFile(file, raw);
    md(`Criei a aba **${tab.icon} ${tab.name}** a partir de **${file.name}**: ${describeTab(tab)}. Os gráficos foram escolhidos automaticamente pelo tipo de cada coluna (datas → evolução, categorias → comparação, participação → rosca).`);
    parts.push({ type: 'tab', tabId: tab.id });
    return { parts, tabId: tab.id, open: true };
  }
  const tab = currentTargetTab(env, raw);
  if (!tab) {
    md('Ainda não há abas criadas. Quer que eu crie uma? Diga, por exemplo: **"crie uma aba de indicadores"**.');
    chips([{ label: '📊 Criar aba de indicadores', send: 'Crie uma aba de indicadores de segurança' }]);
    return { parts };
  }
  if (intent === 'tab_open') {
    md(`Abrindo **${tab.icon} ${tab.name}**…`);
    return { parts, tabId: tab.id, open: true };
  }
  if (intent === 'tab_delete') {
    md(`Tem certeza que deseja excluir a aba **${tab.icon} ${tab.name}**? Você pode exportar o pacote antes.`);
    chips([{ label: '🗑️ Sim, excluir', action: { kind: 'tab_delete', tabId: tab.id } }, { label: '📦 Exportar antes', action: { kind: 'tab_export', tabId: tab.id } }, { label: 'Cancelar', send: 'Cancelar' }]);
    return { parts };
  }
  if (intent === 'tab_export') {
    md(`Gerei o **pacote de implementação** da aba **${tab.icon} ${tab.name}** — é o padrão para levar essa usabilidade para dentro do app:\n• \`blueprint.json\` — definição completa (padrão ops360.tab/1)\n• \`historico-ops.json\` — o script de construção (cada pedido → operações, replayável)\n• \`aba-${slug(tab.name)}.js\` — instalador (1 linha no index.html)\n• \`COMO-FOI-FEITO.md\` — documentação, fontes de dados e passo a passo de implementação\n• \`preview.html\` — visualização estática\n• \`dados/*.csv\` — dados atuais`);
    parts.push({ type: 'tab', tabId: tab.id, exportNow: true });
    return { parts, tabId: tab.id, exportTab: tab.id };
  }
  if (intent === 'tab_undo') {
    const r = await tabs.undo(tab);
    md(r ? `Desfeito ✅ — a aba **${r.name}** voltou ao estado anterior.` : 'Não há alterações para desfazer nesta sessão.');
    return { parts, tabId: tab.id, open: !!r };
  }
  // tab_edit
  if (/\b(atualiz|recarreg|sincroniz)\w*/.test(res.t) && Object.keys(tab.sources || {}).length && !WIDGET_WORD.test(res.t)) {
    const r = await refreshTabSources(tab);
    md(r.map((x) => (x.ok ? `✅ ${x.url} atualizado` : `⚠️ ${x.url}: ${x.error}`)).join('\n') || 'Nada para atualizar.');
    return { parts, tabId: tab.id, open: true };
  }
  const { ops, notes, focusSub, fetchSource } = editOpsFromText(raw, tab, env);
  if (!ops.length) {
    md(`Não entendi qual alteração fazer na aba **${tab.name}** 🤔 ${notes[0] || ''}\nExemplos: *"adicione um gráfico de pizza por setor"*, *"crie uma sub-aba Metas"*, *"mude a cor para verde"*, *"layout em 2 colunas"*, *"remova o gráfico X"*, *"adicione um contador de dias sem acidentes desde 01/08/2026"*.`);
    return { parts, tabId: tab.id };
  }
  await applyTabOps(tab, ops, { prompt: raw });
  if (fetchSource) await refreshTabSources(tab).catch(() => {});
  const desc = ops.map((o) => TAB_OP_LABEL[o.op] ? TAB_OP_LABEL[o.op](o, tab) : null).filter(Boolean);
  md(`Feito na aba **${tab.icon} ${tab.name}** ✅\n${uniq(desc).map((d) => '• ' + d).join('\n')}${notes.length ? '\n\n' + notes.join('\n') : ''}`);
  return { parts, tabId: tab.id, open: true, subId: focusSub };
}
const TAB_OP_LABEL = {
  rename_tab: (o) => `Nome alterado para “${o.name}”`,
  set_style: (o) => [o.color && 'Cor atualizada', o.icon && `Ícone ${o.icon}`, o.theme && `Tema ${o.theme === 'dark' ? 'escuro' : 'claro'}`, o.description && 'Descrição atualizada'].filter(Boolean).join(' · ') || null,
  add_subtab: (o) => `Sub-aba “${o.sub.name}” criada`,
  rename_subtab: (o) => `Sub-aba renomeada para “${o.name}”`,
  remove_subtab: () => 'Sub-aba removida',
  set_columns: (o) => `Layout em ${o.columns} coluna(s)`,
  add_widget: (o) => `${WIDGET_ICON[o.widget.type]} ${WIDGET_LABEL[o.widget.type]} “${o.widget.title}” adicionado`,
  update_widget: (o) => `Bloco atualizado${o.patch.props && o.patch.props.kind ? ' (tipo de gráfico)' : o.patch.span ? ' (tamanho)' : o.patch.title ? ' (título)' : ''}`,
  remove_widget: () => 'Bloco removido',
  move_widget: () => 'Bloco movido',
  add_dataset: (o) => `Base de dados “${o.dataset.name}” criada`,
  add_source: (o) => `Fonte conectada: ${o.source.url}`,
};

// ---- Exportação padronizada ------------------------------------------------------------------
function tabBlueprintJSON(tab) {
  return JSON.stringify({ ...deepClone(tab), exportedAt: new Date().toISOString(), generator: 'OPS 360° IA v' + VERSION }, null, 2);
}
function tabInstallerJS(tab) {
  const bp = deepClone(tab);
  return `/*\n * Aba "${tab.name}" — gerada pelo OPS 360° IA (Aurora) v${VERSION} em ${fmtDateTime(new Date())}\n * Padrão: ${TAB_SCHEMA}. Requer ops360-ia.js v3+ carregado na página.\n * Uso: <script src="ops360-ia.js"></script> <script src="aba-${slug(tab.name)}.js"></script>\n */\n(function () {\n  var blueprint = ${JSON.stringify(bp, null, 2)};\n  function install() { window.OPS360IA.tabs.install(blueprint, { overwrite: true }); }\n  if (window.OPS360IA && window.OPS360IA.tabs) install();\n  else (window.OPS360IA_PENDING_TABS = window.OPS360IA_PENDING_TABS || []).push(blueprint);\n})();\n`;
}
function tabHowMD(tab) {
  const L = [];
  L.push(`# Aba “${tab.name}” — como foi feita`, '');
  L.push(`- **Padrão:** \`${TAB_SCHEMA}\` · **Gerador:** OPS 360° IA (Aurora) v${VERSION}`);
  L.push(`- **Criada em:** ${fmtDateTime(tab.createdAt)} · **Última alteração:** ${fmtDateTime(tab.updatedAt)}${tab.author ? ' · **Autor:** ' + tab.author : ''}`);
  L.push(`- **Ícone/cor:** ${tab.icon} \`${tab.color}\` · **Tema:** ${tab.theme === 'dark' ? 'escuro' : 'claro'}`);
  if (tab.description) L.push('', `> ${tab.description}`);
  L.push('', '## Estrutura', '', '| Sub-aba | Colunas | Blocos |', '|---|---|---|');
  for (const s of tab.subtabs) L.push(`| ${s.name} | ${s.columns} | ${s.widgets.map((w) => `${WIDGET_ICON[w.type]} ${w.title}`).join('<br>')} |`);
  L.push('', '## Blocos (widgets)', '');
  for (const s of tab.subtabs) {
    L.push(`### ${s.name}`);
    for (const w of s.widgets) {
      const p = w.props || {};
      const ds = p.dataset ? tab.datasets[p.dataset] : p.from ? tab.datasets[p.from.dataset] : null;
      L.push(`- **${w.title}** — \`${w.type}\` (${WIDGET_LABEL[w.type]}), largura ${w.span}/4${ds ? `, dados: “${ds.name}”` : ''}${p.kind ? `, gráfico: ${p.kind}` : ''}${p.x ? `, eixo/categoria: ${p.x}` : ''}${p.y ? `, valores: ${p.y.join(', ')}` : ''}${p.agg ? `, agregação: ${p.agg}` : ''}${p.formula ? `, fórmula: \`${p.formula}\`` : ''}${p.validity ? `, controle de validade: ${p.validity}` : ''}`);
    }
    L.push('');
  }
  const dsl = Object.values(tab.datasets);
  if (dsl.length) {
    L.push('## Dados', '');
    for (const d of dsl) L.push(`- **${d.name}** (\`${d.id}\`): ${d.rows.length} linha(s); colunas: ${d.columns.map((c) => `${c.name} (${c.type}${c.options ? ': ' + c.options.join('/') : ''})`).join(', ')}${d.sample ? ' — contém dados de exemplo' : ''}${d.origin ? ` — origem: ${d.origin}` : ''}`);
    L.push('');
  }
  const srcs = Object.values(tab.sources || {});
  if (srcs.length) {
    L.push('## Fontes externas (leitura de sites)', '');
    for (const s of srcs) L.push(`- ${s.url} — modo \`${s.mode}\`, último acesso: ${s.lastFetched ? fmtDateTime(s.lastFetched) : '—'} (via ${s.via || '—'}). Tabelas da página viram datasets (campo \`tableIndex\`), números viram KPIs e links viram lista.`);
    L.push('', '> Recomendação para produção: reimplemente a busca da URL no servidor do app (evita bloqueios de CORS) e mantenha as mesmas regras de extração.', '');
  }
  L.push('## Histórico de construção (pedidos → operações)', '');
  tab.history.forEach((h, i) => L.push(`${i + 1}. ${fmtDateTime(h.at)} · ${h.by === 'ia' ? 'IA' : h.by} · “${h.prompt || '(edição manual)'}” → ${h.ops.map((o) => o.op).join(', ')}`));
  L.push('', '## Como implementar no aplicativo (padronizado)', '');
  L.push('1. **Mais rápido:** mantenha `ops360-ia.js` carregado e inclua `aba-' + slug(tab.name) + '.js` depois dele. A aba aparece na barra de abas automaticamente.');
  L.push('2. **Dentro do roteador/tela do app:** `OPS360IA.tabs.renderInto(document.querySelector("#minha-area"), blueprint)` renderiza a aba em qualquer container.');
  L.push('3. **Reimplementação nativa:** cada bloco segue o contrato de `docs/PADRAO-ABAS.md` (tipo + props + dataset). Os dados estão em `dados/*.csv` e no `blueprint.json`.');
  L.push('4. **Reconstrução:** `OPS360IA.tabs.replay(blueprintBase, historico)` refaz a aba a partir do `historico-ops.json`.');
  return L.join('\n');
}
function datasetCSV(ds) {
  const q = (v) => {
    const s = String(v == null ? '' : v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [ds.columns.map((c) => q(c.name)).join(';'), ...ds.rows.map((r) => r.map(q).join(';'))].join('\r\n');
}
async function exportTabPackage(tab, previewHTML) {
  const base = `aba-${slug(tab.name)}`;
  const files = [
    { name: `${base}/blueprint.json`, data: tabBlueprintJSON(tab) },
    { name: `${base}/historico-ops.json`, data: JSON.stringify(tab.history, null, 2) },
    { name: `${base}/${base}.js`, data: tabInstallerJS(tab) },
    { name: `${base}/COMO-FOI-FEITO.md`, data: tabHowMD(tab) },
  ];
  if (previewHTML) files.push({ name: `${base}/preview.html`, data: previewHTML });
  for (const d of Object.values(tab.datasets)) files.push({ name: `${base}/dados/${slug(d.name)}.csv`, data: datasetCSV(d) });
  const zip = await zipWrite(files);
  downloadBlob(new Blob([zip], { type: 'application/zip' }), `ops360-${base}.zip`);
  return files.map((f) => f.name);
}
