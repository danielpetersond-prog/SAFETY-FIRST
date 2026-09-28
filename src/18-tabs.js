// ---------------------------------------------------------------------------
// 18 · Estúdio de Abas — abas e sub-abas criadas pela IA dentro do OPS 360°
//      Cada aba é um "blueprint" JSON (padrão ops360.tab/1) + histórico de
//      operações (o "script" de como foi construída), exportável como pacote.
// ---------------------------------------------------------------------------
const TAB_SCHEMA = 'ops360.tab/1';
const TAB_COLORS = { azul: '#2a78d6', verde: '#0f9d58', vermelho: '#d03b3b', laranja: '#eb6834', roxo: '#6d5bd0', violeta: '#6d5bd0', amarelo: '#eda100', rosa: '#e87ba4', cinza: '#64748b', preto: '#1f2937', teal: '#0d9488', turquesa: '#0d9488', 'verde-agua': '#0d9488', ciano: '#0891b2', marrom: '#8b5a2b', dourado: '#b8860b' };
const WIDGET_LABEL = { kpi: 'Indicador (KPI)', chart: 'Gráfico', table: 'Tabela', note: 'Nota', checklist: 'Checklist', links: 'Links', counter: 'Contador de dias', progress: 'Meta / progresso', form: 'Formulário de registro', calc: 'Calculadora', site: 'Leitor de site', timeline: 'Linha do tempo', image: 'Imagem', embed: 'Página incorporada' };
const WIDGET_ICON = { kpi: '🔢', chart: '📊', table: '📋', note: '📝', checklist: '✅', links: '🔗', counter: '⏱️', progress: '🎯', form: '🧾', calc: '🧮', site: '🌐', timeline: '🗓️', image: '🖼️', embed: '🪟' };

const tabs = {
  list: [],
  undoStacks: new Map(),
  async load() {
    this.list = (await db.all('tabs')).filter((t) => t && t.schema === TAB_SCHEMA).sort((a, b) => (a.order || 0) - (b.order || 0));
    const pending = PAGE.OPS360IA_PENDING_TABS || [];
    for (const bp of pending) await this.install(bp, { overwrite: true, silent: true });
    PAGE.OPS360IA_PENDING_TABS = [];
  },
  get(id) {
    return this.list.find((t) => t.id === id) || null;
  },
  find(q) {
    if (!q) return null;
    const byId = this.get(q);
    if (byId) return byId;
    let best = null, bs = 0;
    for (const t of this.list) {
      const s = Math.max(dice(t.name, q), norm(t.name).includes(norm(q)) || norm(q).includes(norm(t.name)) ? 0.8 : 0);
      if (s > bs) {
        best = t;
        bs = s;
      }
    }
    return bs >= 0.55 ? best : null;
  },
  async save(tab, { silent = false } = {}) {
    tab.updatedAt = Date.now();
    const i = this.list.findIndex((t) => t.id === tab.id);
    if (i >= 0) this.list[i] = tab;
    else this.list.push(tab);
    await db.put('tabs', deepClone(tab));
    if (!silent) bus.emit('tabs:changed', { id: tab.id });
  },
  async remove(id) {
    this.list = this.list.filter((t) => t.id !== id);
    await db.del('tabs', id);
    bus.emit('tabs:changed', { id, removed: true });
  },
  snapshot(tab) {
    const st = this.undoStacks.get(tab.id) || [];
    st.push(JSON.stringify(tab));
    if (st.length > 40) st.shift();
    this.undoStacks.set(tab.id, st);
  },
  async undo(tab) {
    const st = this.undoStacks.get(tab.id) || [];
    const prev = st.pop();
    if (!prev) return null;
    const restored = JSON.parse(prev);
    await this.save(restored);
    return restored;
  },
  // Instala um blueprint recebido (pacote exportado, outro usuário, API)
  async install(bp, { overwrite = false, silent = false } = {}) {
    if (!bp || bp.schema !== TAB_SCHEMA || !Array.isArray(bp.subtabs)) throw new Error('Blueprint inválido (esperado schema ops360.tab/1).');
    const tab = sanitizeBlueprint(deepClone(bp));
    const ex = this.get(tab.id);
    if (ex && !overwrite) tab.id = uid('tab');
    tab.order = tab.order != null ? tab.order : this.list.length;
    await this.save(tab, { silent });
    return tab;
  },
};

function sanitizeBlueprint(bp) {
  bp.name = truncate(String(bp.name || 'Aba'), 60);
  bp.icon = String(bp.icon || '📁').slice(0, 4);
  bp.color = /^#[0-9a-f]{6}$/i.test(bp.color || '') ? bp.color : '#0d9488';
  bp.datasets = bp.datasets || {};
  bp.sources = bp.sources || {};
  bp.history = Array.isArray(bp.history) ? bp.history.slice(-500) : [];
  bp.subtabs = bp.subtabs.map((s) => ({ id: s.id || uid('sub'), name: truncate(String(s.name || 'Geral'), 40), columns: clamp(+s.columns || 3, 1, 4), widgets: (s.widgets || []).filter((w) => w && WIDGET_LABEL[w.type]).map((w) => ({ id: w.id || uid('w'), type: w.type, title: String(w.title || ''), span: clamp(+w.span || 1, 1, 4), props: w.props || {} })) }));
  if (!bp.subtabs.length) bp.subtabs.push({ id: uid('sub'), name: 'Geral', columns: 3, widgets: [] });
  return bp;
}

function newTab({ name, icon = '📁', color = '#0d9488', description = '' }) {
  return {
    schema: TAB_SCHEMA, id: uid('tab'), name: truncate(titleCase(name || 'Nova aba'), 60), icon, color, description, theme: 'light',
    order: tabs.list.length, pinned: true, createdAt: Date.now(), updatedAt: Date.now(), createdBy: 'OPS 360° IA (Aurora) v' + VERSION,
    author: memory.profile.name || '', subtabs: [], datasets: {}, sources: {}, history: [],
  };
}
const W = (type, title, props = {}, span = 1) => ({ id: uid('w'), type, title, span, props });
const DS = (name, columns, rows = [], extra = {}) => ({ id: uid('ds'), name, columns, rows, ...extra });

// ---- Operações (cada alteração vira uma operação registrada e replayável) ----------------
const TAB_OPS = {
  rename_tab: (tab, o) => (tab.name = truncate(o.name, 60)),
  set_style: (tab, o) => {
    if (o.color) tab.color = o.color;
    if (o.icon) tab.icon = o.icon;
    if (o.theme) tab.theme = o.theme;
    if (o.description != null) tab.description = o.description;
  },
  add_subtab: (tab, o) => tab.subtabs.push(o.sub),
  rename_subtab: (tab, o) => {
    const s = tab.subtabs.find((x) => x.id === o.subId);
    if (s) s.name = o.name;
  },
  remove_subtab: (tab, o) => (tab.subtabs = tab.subtabs.filter((x) => x.id !== o.subId)),
  move_subtab: (tab, o) => {
    const i = tab.subtabs.findIndex((x) => x.id === o.subId);
    if (i < 0) return;
    const [s] = tab.subtabs.splice(i, 1);
    tab.subtabs.splice(clamp(o.index, 0, tab.subtabs.length), 0, s);
  },
  set_columns: (tab, o) => {
    const s = tab.subtabs.find((x) => x.id === o.subId);
    if (s) s.columns = clamp(o.columns, 1, 4);
  },
  add_widget: (tab, o) => {
    const s = tab.subtabs.find((x) => x.id === o.subId) || tab.subtabs[0];
    if (o.index != null) s.widgets.splice(o.index, 0, o.widget);
    else s.widgets.push(o.widget);
  },
  update_widget: (tab, o) => {
    const w = findWidget(tab, o.widgetId);
    if (!w) return;
    if (o.patch.title != null) w.title = o.patch.title;
    if (o.patch.span != null) w.span = clamp(o.patch.span, 1, 4);
    if (o.patch.type) w.type = o.patch.type;
    if (o.patch.props) w.props = { ...w.props, ...o.patch.props };
  },
  remove_widget: (tab, o) => tab.subtabs.forEach((s) => (s.widgets = s.widgets.filter((w) => w.id !== o.widgetId))),
  move_widget: (tab, o) => {
    let w = null;
    tab.subtabs.forEach((s) => {
      const i = s.widgets.findIndex((x) => x.id === o.widgetId);
      if (i >= 0) w = s.widgets.splice(i, 1)[0];
    });
    if (!w) return;
    const dest = tab.subtabs.find((x) => x.id === o.subId) || tab.subtabs[0];
    dest.widgets.splice(clamp(o.index == null ? dest.widgets.length : o.index, 0, dest.widgets.length), 0, w);
  },
  add_dataset: (tab, o) => (tab.datasets[o.dataset.id] = o.dataset),
  set_rows: (tab, o) => {
    if (tab.datasets[o.dsId]) tab.datasets[o.dsId].rows = o.rows;
  },
  add_rows: (tab, o) => {
    const d = tab.datasets[o.dsId];
    if (d) d.rows.push(...o.rows);
  },
  add_source: (tab, o) => (tab.sources[o.source.id] = o.source),
  update_source: (tab, o) => {
    if (tab.sources[o.srcId]) Object.assign(tab.sources[o.srcId], o.patch);
  },
};
function findWidget(tab, id) {
  for (const s of tab.subtabs) for (const w of s.widgets) if (w.id === id) return w;
  return null;
}
function widgetSub(tab, id) {
  return tab.subtabs.find((s) => s.widgets.some((w) => w.id === id)) || null;
}
// Aplica operações, registra no histórico e salva (com desfazer)
async function applyTabOps(tab, ops, { prompt = '', by = 'ia', log = true } = {}) {
  tabs.snapshot(tab);
  for (const op of ops) {
    const fn = TAB_OPS[op.op];
    if (fn) fn(tab, op);
  }
  if (log) tab.history.push({ at: Date.now(), by, prompt: truncate(prompt, 400), ops: deepClone(ops) });
  await tabs.save(tab);
  return tab;
}
// Recria uma aba a partir do script de operações (replay)
function replayTabOps(base, history) {
  const tab = { ...deepClone(base), subtabs: [], datasets: {}, sources: {}, history: [] };
  for (const h of history) for (const op of h.ops) TAB_OPS[op.op] && TAB_OPS[op.op](tab, op);
  tab.history = deepClone(history);
  return tab;
}

// ---- Modelos de sub-abas (conteúdo inteligente por assunto) ---------------------------------
const now0 = () => new Date();
const isoMinus = (days) => isoDate(addDays(now0(), -days)); // dias atrás (negativo = no futuro)
const SUB_TEMPLATES = [
  {
    key: 'ocorrencias', match: /(acident|ocorrenc|incident|quase|indicador|visao geral|dashboard|resumo|kpi)/,
    build(tab, name) {
      const ds = DS('Ocorrências', [{ name: 'Data', type: 'date' }, { name: 'Tipo', type: 'select', options: ['Acidente com afastamento', 'Acidente sem afastamento', 'Quase acidente', 'Incidente com dano material', 'Primeiros socorros'] }, { name: 'Setor', type: 'text' }, { name: 'Descrição', type: 'text' }, { name: 'Dias perdidos', type: 'number' }], [
        [isoMinus(160), 'Quase acidente', 'Expedição', 'Empilhadeira quase atinge pedestre', '0'], [isoMinus(130), 'Acidente sem afastamento', 'Manutenção', 'Corte leve na mão', '0'], [isoMinus(95), 'Quase acidente', 'Produção', 'Queda de material da prateleira', '0'],
        [isoMinus(70), 'Acidente com afastamento', 'Expedição', 'Entorse ao descer da carroceria', '6'], [isoMinus(45), 'Quase acidente', 'Manutenção', 'Ferramenta caiu do andaime', '0'], [isoMinus(20), 'Primeiros socorros', 'Produção', 'Irritação ocular', '0'], [isoMinus(8), 'Quase acidente', 'Expedição', 'Pedestre fora da faixa', '0'],
      ], { sample: true });
      return {
        datasets: [ds],
        widgets: [
          W('counter', 'Dias sem acidente com afastamento', { from: { dataset: ds.id, dateCol: 'Data', filter: { col: 'Tipo', op: 'contains', value: 'com afastamento' } }, record: 0 }),
          W('kpi', 'Ocorrências registradas', { from: { dataset: ds.id, agg: 'count' }, unit: '' }),
          W('kpi', 'Quase acidentes', { from: { dataset: ds.id, agg: 'count', filter: { col: 'Tipo', op: 'contains', value: 'quase' } } }),
          W('chart', 'Ocorrências por mês', { kind: 'line', dataset: ds.id, x: 'Data', agg: 'count', groupDate: 'month' }, 2),
          W('chart', 'Ocorrências por tipo', { kind: 'donut', dataset: ds.id, x: 'Tipo', agg: 'count' }),
          W('chart', 'Ocorrências por setor', { kind: 'hbar', dataset: ds.id, x: 'Setor', agg: 'count' }, 2),
          W('form', 'Registrar ocorrência', { dataset: ds.id }),
          W('table', 'Registros', { dataset: ds.id, search: true }, 3),
        ],
      };
    },
  },
  {
    key: 'treinamentos', match: /(treinament|capacitac|curso|reciclag|certificad)/,
    build() {
      const ds = DS('Treinamentos', [{ name: 'Colaborador', type: 'text' }, { name: 'Treinamento', type: 'select', options: ['NR-05 CIPA', 'NR-06 EPI', 'NR-10', 'NR-11 Empilhadeira', 'NR-12', 'NR-20', 'NR-33', 'NR-35', 'Brigada', 'Primeiros socorros', 'Outro'] }, { name: 'Realização', type: 'date' }, { name: 'Validade', type: 'date' }, { name: 'Setor', type: 'text' }], [
        ['Ana Souza', 'NR-35', isoMinus(700), isoMinus(-30), 'Manutenção'], ['Carlos Lima', 'NR-35', isoMinus(300), isoMinus(-430), 'Manutenção'], ['Beatriz Rocha', 'NR-10', isoMinus(500), isoMinus(230), 'Elétrica'],
        ['Diego Alves', 'NR-11 Empilhadeira', isoMinus(380), isoMinus(15), 'Expedição'], ['Eva Martins', 'NR-33', isoMinus(400), isoMinus(35), 'Utilidades'], ['Fábio Nunes', 'Brigada', isoMinus(90), isoMinus(-275), 'Geral'],
      ], { sample: true });
      return {
        datasets: [ds],
        widgets: [
          W('kpi', 'Vencidos', { from: { dataset: ds.id, validity: 'Validade', status: 'vencido' }, good: 'down', tone: 'critical' }),
          W('kpi', 'Vencem em 30 dias', { from: { dataset: ds.id, validity: 'Validade', status: 'a_vencer' }, good: 'down', tone: 'warning' }),
          W('kpi', 'Em dia', { from: { dataset: ds.id, validity: 'Validade', status: 'em_dia' }, good: 'up', tone: 'good' }),
          W('chart', 'Situação dos treinamentos', { kind: 'donut', dataset: ds.id, validity: 'Validade' }),
          W('chart', 'Treinamentos por norma', { kind: 'bar', dataset: ds.id, x: 'Treinamento', agg: 'count' }, 2),
          W('form', 'Registrar treinamento', { dataset: ds.id }),
          W('table', 'Controle de treinamentos', { dataset: ds.id, search: true, validity: 'Validade' }, 3),
        ],
      };
    },
  },
  {
    key: 'epi', match: /\b(epis?|equipamentos? de protecao|entregas?)\b/,
    build() {
      const ds = DS('Entregas de EPI', [{ name: 'Data', type: 'date' }, { name: 'Colaborador', type: 'text' }, { name: 'EPI', type: 'select', options: ['Capacete', 'Óculos', 'Protetor auricular', 'Luvas', 'Botina', 'Respirador PFF2', 'Cinto paraquedista', 'Colete refletivo', 'Outro'] }, { name: 'CA', type: 'text' }, { name: 'Validade do CA', type: 'date' }, { name: 'Quantidade', type: 'number' }], [
        [isoMinus(40), 'Ana Souza', 'Luvas', '12345', isoMinus(-200), '2'], [isoMinus(33), 'Carlos Lima', 'Protetor auricular', '5745', isoMinus(-400), '10'], [isoMinus(20), 'Diego Alves', 'Botina', '40377', isoMinus(12), '1'], [isoMinus(5), 'Eva Martins', 'Respirador PFF2', '38503', isoMinus(-90), '5'],
      ], { sample: true });
      return {
        datasets: [ds],
        widgets: [
          W('kpi', 'Itens entregues', { from: { dataset: ds.id, agg: 'sum', col: 'Quantidade' } }),
          W('kpi', 'CAs vencidos', { from: { dataset: ds.id, validity: 'Validade do CA', status: 'vencido' }, good: 'down', tone: 'critical' }),
          W('chart', 'Entregas por EPI', { kind: 'hbar', dataset: ds.id, x: 'EPI', agg: 'sum', y: ['Quantidade'] }),
          W('form', 'Registrar entrega', { dataset: ds.id }),
          W('table', 'Entregas registradas', { dataset: ds.id, search: true, validity: 'Validade do CA' }, 3),
        ],
      };
    },
  },
  {
    key: 'extintores', match: /(extintor|incendio|hidrante)/,
    build() {
      const ds = DS('Extintores', [{ name: 'Local', type: 'text' }, { name: 'Tipo', type: 'select', options: ['Água (AP)', 'PQS BC', 'PQS ABC', 'CO₂', 'Espuma', 'Classe K'] }, { name: 'Capacidade', type: 'text' }, { name: 'Recarga (validade)', type: 'date' }, { name: 'Teste hidrostático', type: 'date' }, { name: 'Situação', type: 'select', options: ['OK', 'Obstruído', 'Sem sinalização', 'Despressurizado', 'Lacre violado'] }], [
        ['Portaria', 'PQS ABC', '6 kg', isoMinus(-120), isoMinus(-900), 'OK'], ['Galpão 1', 'CO₂', '6 kg', isoMinus(10), isoMinus(-600), 'OK'], ['Galpão 2', 'Água (AP)', '10 L', isoMinus(-20), isoMinus(-300), 'Obstruído'], ['Cozinha', 'Classe K', '6 L', isoMinus(-200), isoMinus(-1200), 'OK'],
      ], { sample: true });
      return {
        datasets: [ds],
        widgets: [
          W('kpi', 'Extintores', { from: { dataset: ds.id, agg: 'count' } }),
          W('kpi', 'Recarga vencida', { from: { dataset: ds.id, validity: 'Recarga (validade)', status: 'vencido' }, good: 'down', tone: 'critical' }),
          W('kpi', 'Com pendência', { from: { dataset: ds.id, agg: 'count', filter: { col: 'Situação', op: 'neq', value: 'OK' } }, good: 'down', tone: 'warning' }),
          W('chart', 'Extintores por tipo', { kind: 'donut', dataset: ds.id, x: 'Tipo', agg: 'count' }),
          W('chart', 'Situação da recarga', { kind: 'bar', dataset: ds.id, validity: 'Recarga (validade)' }, 2),
          W('form', 'Cadastrar extintor', { dataset: ds.id }),
          W('table', 'Controle de extintores', { dataset: ds.id, search: true, validity: 'Recarga (validade)' }, 3),
        ],
      };
    },
  },
  {
    key: 'inspecoes', match: /(inspec|auditori|5s|vistori)/,
    build() {
      const ds = DS('Inspeções', [{ name: 'Data', type: 'date' }, { name: 'Área', type: 'text' }, { name: 'Inspetor', type: 'text' }, { name: 'Itens conformes', type: 'number' }, { name: 'Não conformidades', type: 'number' }], [
        [isoMinus(80), 'Expedição', 'Daniel', '18', '4'], [isoMinus(60), 'Manutenção', 'Daniel', '15', '5'], [isoMinus(40), 'Produção', 'Ana', '20', '2'], [isoMinus(20), 'Expedição', 'Daniel', '21', '1'], [isoMinus(6), 'Manutenção', 'Ana', '19', '2'],
      ], { sample: true });
      return {
        datasets: [ds],
        widgets: [
          W('kpi', 'Inspeções realizadas', { from: { dataset: ds.id, agg: 'count' } }),
          W('kpi', 'Não conformidades', { from: { dataset: ds.id, agg: 'sum', col: 'Não conformidades' }, good: 'down' }),
          W('chart', 'Não conformidades por área', { kind: 'bar', dataset: ds.id, x: 'Área', agg: 'sum', y: ['Não conformidades'] }),
          W('chart', 'Evolução das não conformidades', { kind: 'line', dataset: ds.id, x: 'Data', agg: 'sum', y: ['Não conformidades'], groupDate: 'month' }, 2),
          W('form', 'Registrar inspeção', { dataset: ds.id }),
          W('table', 'Inspeções', { dataset: ds.id, search: true }, 3),
        ],
      };
    },
  },
  {
    key: 'asos', match: /\b(aso|asos|exames?|pcmso|medic)/,
    build() {
      const ds = DS('ASOs', [{ name: 'Colaborador', type: 'text' }, { name: 'Tipo', type: 'select', options: ['Admissional', 'Periódico', 'Retorno ao trabalho', 'Mudança de risco', 'Demissional'] }, { name: 'Data', type: 'date' }, { name: 'Vencimento', type: 'date' }, { name: 'Resultado', type: 'select', options: ['Apto', 'Inapto', 'Apto com restrição'] }], [
        ['Ana Souza', 'Periódico', isoMinus(300), isoMinus(-65), 'Apto'], ['Carlos Lima', 'Periódico', isoMinus(380), isoMinus(15), 'Apto'], ['Diego Alves', 'Admissional', isoMinus(30), isoMinus(-335), 'Apto'],
      ], { sample: true });
      return {
        datasets: [ds],
        widgets: [
          W('kpi', 'ASOs vencidos', { from: { dataset: ds.id, validity: 'Vencimento', status: 'vencido' }, good: 'down', tone: 'critical' }),
          W('kpi', 'Vencem em 30 dias', { from: { dataset: ds.id, validity: 'Vencimento', status: 'a_vencer' }, good: 'down', tone: 'warning' }),
          W('chart', 'ASOs por tipo', { kind: 'donut', dataset: ds.id, x: 'Tipo', agg: 'count' }),
          W('form', 'Registrar ASO', { dataset: ds.id }),
          W('table', 'Controle de ASOs', { dataset: ds.id, search: true, validity: 'Vencimento' }, 3),
        ],
      };
    },
  },
  {
    key: 'cipa', match: /\b(cipa|reuni|atas?)\b/,
    build() {
      const ds = DS('Reuniões da CIPA', [{ name: 'Data', type: 'date' }, { name: 'Tipo', type: 'select', options: ['Ordinária', 'Extraordinária'] }, { name: 'Pauta', type: 'text' }, { name: 'Presentes', type: 'number' }, { name: 'Ata assinada', type: 'select', options: ['Sim', 'Não'] }], [], {});
      return {
        datasets: [ds],
        widgets: [
          W('kpi', 'Reuniões realizadas', { from: { dataset: ds.id, agg: 'count' } }),
          W('checklist', 'Plano de trabalho da CIPA', { items: ['Calendário anual de reuniões aprovado', 'Treinamento dos membros concluído', 'Participação na identificação de riscos do PGR', 'Inspeções periódicas nas áreas', 'Organização da SIPAT', 'Ações de prevenção ao assédio'].map((t) => ({ text: t, done: false })) }, 2),
          W('form', 'Registrar reunião', { dataset: ds.id }),
          W('table', 'Reuniões', { dataset: ds.id, search: true }, 3),
        ],
      };
    },
  },
  {
    key: 'links', match: /(links?|documentos?|referencias|normas|legislac)/,
    build() {
      return {
        datasets: [],
        widgets: [
          W('links', 'Links úteis de SST', { items: [{ text: 'Normas Regulamentadoras vigentes (MTE)', url: NR_SOURCE }, { text: 'Consulta de CA de EPI (CAEPI)', url: 'https://caepi.mte.gov.br/internet/ConsultaCAInternet.aspx' }, { text: 'eSocial — Documentação técnica', url: 'https://www.gov.br/esocial/pt-br' }, { text: 'Fundacentro', url: 'https://www.gov.br/fundacentro/pt-br' }] }, 2),
          W('note', 'Como usar', { text: 'Peça à Aurora: **"adicione o link https://... nesta aba"** ou edite este bloco no modo **Editar**.' }),
        ],
      };
    },
  },
  {
    key: 'calculadoras', match: /(calcul|taxa|formula)/,
    build() {
      return { datasets: [], widgets: [calcWidget('tf'), calcWidget('tg'), calcWidget('ruido')] };
    },
  },
  {
    key: 'mural', match: /(mural|comunicad|avisos?|notas?|recados?)/,
    build() {
      return { datasets: [], widgets: [W('note', 'Mural de segurança', { text: '**Bem-vindo!** Use este espaço para comunicados, alertas e lições aprendidas.' }, 2), W('checklist', 'Pendências da semana', { items: [] })] };
    },
  },
];
function calcWidget(kind) {
  if (kind === 'tf') return W('calc', 'Taxa de frequência (NBR 14280)', { fields: [{ name: 'A', label: 'Nº de acidentes', value: 0 }, { name: 'H', label: 'Horas-homem trabalhadas (HHT)', value: 0 }], formula: 'A * 1000000 / H', unit: 'acidentes por milhão de HHT', decimals: 2 });
  if (kind === 'tg') return W('calc', 'Taxa de gravidade (NBR 14280)', { fields: [{ name: 'D', label: 'Dias perdidos + debitados', value: 0 }, { name: 'H', label: 'Horas-homem trabalhadas (HHT)', value: 0 }], formula: 'D * 1000000 / H', unit: 'dias por milhão de HHT', decimals: 0 });
  return W('calc', 'Tempo máximo de exposição ao ruído (NR-15)', { fields: [{ name: 'L', label: 'Nível de ruído em dB(A)', value: 85 }], formula: '480 / 2 ^ ((L - 85) / 5)', unit: 'minutos por dia', decimals: 0 });
}
function subFromTemplate(tab, name) {
  const n = norm(name);
  const tpl = SUB_TEMPLATES.find((t) => t.match.test(n));
  const sub = { id: uid('sub'), name: titleCase(name), columns: 3, widgets: [] };
  const ops = [];
  if (tpl) {
    const b = tpl.build(tab, name);
    for (const d of b.datasets) ops.push({ op: 'add_dataset', dataset: d });
    sub.widgets = b.widgets;
  } else {
    sub.widgets = [W('note', `Sub-aba ${titleCase(name)}`, { text: `Espaço pronto para **${name}**. Peça à Aurora, por exemplo: "adicione um gráfico de barras…", "adicione uma tabela com colunas…", "crie um formulário para registrar…".` }, 3)];
  }
  ops.unshift({ op: 'add_subtab', sub });
  return { sub, ops, template: tpl ? tpl.key : null };
}

// Aba de controle personalizada a partir de campos ("com campos: local, tipo, validade")
function trackerFromFields(name, fields) {
  const cols = fields.map((f) => {
    const n = norm(f);
    const type = /(data|validade|vencimento|venc\b|prazo|realiza|entrega|recarga|inspecao|revisao)/.test(n) ? 'date' : /(quantidade|qtd|valor|numero|nº|total|horas|dias|nota|pontos|custo|idade)/.test(n) ? 'number' : /(status|situacao|tipo|categoria|setor|area|prioridade|resultado|classe|turno)/.test(n) ? 'select' : 'text';
    const options = type === 'select' ? (/(status|situacao)/.test(n) ? ['Aberto', 'Em andamento', 'Concluído'] : /prioridade/.test(n) ? ['Baixa', 'Média', 'Alta', 'Crítica'] : /resultado/.test(n) ? ['Conforme', 'Não conforme'] : []) : undefined;
    return { name: capFirst(f.trim()), type: type === 'select' && !options.length ? 'text' : type, options: options && options.length ? options : undefined };
  });
  const ds = DS(titleCase(name), cols, []);
  const widgets = [W('kpi', 'Registros', { from: { dataset: ds.id, agg: 'count' } })];
  const vcol = cols.find((c) => c.type === 'date' && /(valid|venc|prazo|recarga|revisao)/.test(norm(c.name)));
  if (vcol) {
    widgets.push(W('kpi', 'Vencidos', { from: { dataset: ds.id, validity: vcol.name, status: 'vencido' }, good: 'down', tone: 'critical' }));
    widgets.push(W('kpi', 'Vencem em 30 dias', { from: { dataset: ds.id, validity: vcol.name, status: 'a_vencer' }, good: 'down', tone: 'warning' }));
  }
  const cat = cols.filter((c) => c.type === 'select' || /(setor|area|tipo|local|categoria)/.test(norm(c.name))).slice(0, 2);
  cat.forEach((c, i) => widgets.push(W('chart', `Registros por ${c.name.toLowerCase()}`, { kind: i === 0 ? 'donut' : 'bar', dataset: ds.id, x: c.name, agg: 'count' }, i === 0 ? 1 : 2)));
  const dcol = cols.find((c) => c.type === 'date' && c !== vcol);
  if (dcol) widgets.push(W('chart', `Registros por mês`, { kind: 'line', dataset: ds.id, x: dcol.name, agg: 'count', groupDate: 'month' }, 2));
  if (vcol) widgets.push(W('chart', 'Situação dos vencimentos', { kind: 'donut', dataset: ds.id, validity: vcol.name }));
  widgets.push(W('form', 'Novo registro', { dataset: ds.id }));
  widgets.push(W('table', 'Registros', { dataset: ds.id, search: true, validity: vcol ? vcol.name : undefined }, 3));
  return { ds, widgets };
}

// Gráficos e indicadores automáticos a partir de uma tabela (sites, planilhas)
function autoWidgetsForTable(tab, rows, name) {
  const prof = profileTable(rows);
  if (!prof || !prof.body.length) return { ds: null, widgets: [] };
  const cols = prof.cols.map((c) => ({ name: c.name, type: c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text' }));
  const ds = DS(truncate(name || 'Dados', 40), cols, prof.body.slice(0, 2000));
  const widgets = [];
  const num = prof.cols.filter((c) => c.type === 'number' && !/^(id|codigo|cod|n|no|numero|ano)$/i.test(norm(c.name))).slice(0, 3);
  const label = prof.cols.find((c) => c.type === 'period' || c.type === 'date') || prof.cols.find((c) => c.type === 'category') || prof.cols.find((c) => c.type === 'text');
  const timeLike = label && (label.type === 'period' || label.type === 'date');
  for (const c of num.slice(0, 3)) {
    const downGood = /(acident|incident|ocorr|falh|nao conform|vencid|afast|perdid|lesao|lesoes|multa|custo|desvio|obito|morte)/.test(norm(c.name)) && !/quase/.test(norm(c.name));
    widgets.push(W('kpi', timeLike ? `${c.name} (último)` : `${c.name} (total)`, { from: { dataset: ds.id, agg: timeLike ? 'last' : 'sum', col: c.name, deltaPrev: timeLike }, pct: !!c.pct, good: downGood ? 'down' : 'up' }));
  }
  const vcol = prof.cols.find((c) => c.validity);
  if (vcol) {
    widgets.push(W('kpi', 'Vencidos', { from: { dataset: ds.id, validity: vcol.name, status: 'vencido' }, good: 'down', tone: 'critical' }));
    widgets.push(W('chart', `Situação — ${vcol.name}`, { kind: 'donut', dataset: ds.id, validity: vcol.name }));
  }
  if (label && num.length) {
    if (timeLike) widgets.push(W('chart', `${num.map((c) => c.name).join(', ')} ao longo do tempo`, { kind: num.length === 1 ? 'area' : 'line', dataset: ds.id, x: label.name, y: num.map((c) => c.name), agg: label.type === 'date' ? 'sum' : 'none', groupDate: label.type === 'date' ? 'month' : undefined }, 3));
    else {
      const many = prof.body.length > 8 || prof.body.some((r) => String(r[label.index]).length > 14);
      const share = num.length === 1 && prof.body.length <= 6 && num[0].sum > 0;
      widgets.push(W('chart', `${num[0].name} por ${label.name.toLowerCase()}`, { kind: share ? 'donut' : many ? 'hbar' : 'bar', dataset: ds.id, x: label.name, y: [num[0].name], agg: 'sum', top: 12 }, share ? 1 : 2));
      if (num.length > 1) widgets.push(W('chart', `${num.slice(0, 3).map((c) => c.name).join(' × ')}`, { kind: 'bar', dataset: ds.id, x: label.name, y: num.slice(0, 3).map((c) => c.name), agg: 'sum', top: 10 }, 3));
    }
  } else {
    const cat = prof.cols.filter((c) => c.type === 'category').slice(0, 2);
    cat.forEach((c) => widgets.push(W('chart', `Registros por ${c.name.toLowerCase()}`, { kind: c.unique <= 6 ? 'donut' : 'bar', dataset: ds.id, x: c.name, agg: 'count' }, c.unique <= 6 ? 1 : 2)));
  }
  widgets.push(W('table', name || 'Dados', { dataset: ds.id, search: true, validity: vcol ? vcol.name : undefined }, 3));
  return { ds, widgets, profile: prof };
}

// ---- Resolução de dados dos widgets ---------------------------------------------------------
function dsColIndex(ds, name) {
  if (!ds) return -1;
  let i = ds.columns.findIndex((c) => c.name === name);
  if (i < 0) i = ds.columns.findIndex((c) => norm(c.name) === norm(name || ''));
  return i;
}
function rowMatches(ds, row, f) {
  if (!f) return true;
  const i = dsColIndex(ds, f.col);
  if (i < 0) return true;
  const v = norm(row[i]), val = norm(f.value);
  if (f.op === 'contains') return v.includes(val);
  if (f.op === 'neq') return v !== val;
  if (f.op === 'eq') return v === val;
  const n = parseNumBR(row[i]);
  if (f.op === 'gt') return n > parseNumBR(f.value);
  if (f.op === 'lt') return n < parseNumBR(f.value);
  return true;
}
function validityOf(value, ref = new Date()) {
  const d = parseDateBR(value);
  if (!d) return { status: 'sem_data', label: 'Sem data', days: null };
  const days = daysBetween(ref, d);
  if (days < 0) return { status: 'vencido', label: `Vencido há ${-days} d`, days };
  if (days <= 30) return { status: 'a_vencer', label: `Vence em ${days} d`, days };
  return { status: 'em_dia', label: 'Em dia', days };
}
const VALIDITY_LABEL = { vencido: 'Vencido', a_vencer: 'Vence em 30 dias', em_dia: 'Em dia', sem_data: 'Sem data' };
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const monthLabel = (k) => {
  const [y, m] = k.split('-');
  return `${MESES_ABR[+m - 1]}/${y.slice(2)}`;
};
function resolveChart(tab, w) {
  const p = w.props || {};
  if (!p.dataset) return { labels: p.labels || [], series: p.series || [], unit: p.unit || '' };
  const ds = tab.datasets[p.dataset];
  if (!ds) return { labels: [], series: [] };
  const rows = ds.rows.filter((r) => rowMatches(ds, r, p.filter));
  if (p.validity) {
    const vi = dsColIndex(ds, p.validity);
    const counts = { vencido: 0, a_vencer: 0, em_dia: 0 };
    rows.forEach((r) => {
      const s = validityOf(r[vi]).status;
      if (counts[s] != null) counts[s]++;
    });
    return { labels: Object.keys(counts).map((k) => VALIDITY_LABEL[k]), series: [{ name: 'Registros', values: Object.values(counts) }], status: ['critical', 'warning', 'good'] };
  }
  const xi = dsColIndex(ds, p.x);
  const ys = (p.y || []).map((y) => ({ name: y, i: dsColIndex(ds, y) })).filter((y) => y.i >= 0);
  if (xi < 0) return { labels: [], series: [] };
  if (p.agg === 'none') {
    const labels = rows.map((r) => r[xi]).slice(0, 80);
    return { labels, series: ys.map((y) => ({ name: y.name, values: rows.slice(0, 80).map((r) => parseNumBR(r[y.i]) || 0) })) };
  }
  const groups = new Map();
  for (const r of rows) {
    let key = String(r[xi] || '').trim() || '(vazio)';
    if (p.groupDate === 'month') {
      const d = parseDateBR(r[xi]);
      if (!d) continue;
      key = monthKey(d);
    }
    if (!groups.has(key)) groups.set(key, ys.length ? ys.map(() => 0) : [0]);
    const g = groups.get(key);
    if (ys.length && p.agg !== 'count') ys.forEach((y, k) => (g[k] += parseNumBR(r[y.i]) || 0));
    else g[0] += 1;
  }
  let entries = [...groups.entries()];
  if (p.groupDate === 'month') {
    entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    // preenche meses sem registro
    if (entries.length > 1) {
      const filled = [];
      let [y, m] = entries[0][0].split('-').map(Number);
      const last = entries[entries.length - 1][0];
      const map = new Map(entries);
      for (let k = 0; k < 60; k++) {
        const key = `${y}-${pad2(m)}`;
        filled.push([key, map.get(key) || (ys.length ? ys.map(() => 0) : [0])]);
        if (key === last) break;
        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }
      entries = filled;
    }
    return { labels: entries.map((e) => monthLabel(e[0])), series: (ys.length && p.agg !== 'count' ? ys : [{ name: 'Registros' }]).map((y, k) => ({ name: y.name, values: entries.map((e) => e[1][k]) })) };
  }
  if (!/line|area/.test(p.kind)) entries.sort((a, b) => b[1][0] - a[1][0]);
  if (p.top && entries.length > p.top) {
    const rest = entries.slice(p.top - 1);
    entries = entries.slice(0, p.top - 1);
    entries.push(['Outros', rest.reduce((acc, e) => acc.map((v, k) => v + e[1][k]), rest[0][1].map(() => 0))]);
  }
  return { labels: entries.map((e) => e[0]), series: (ys.length && p.agg !== 'count' ? ys : [{ name: 'Registros' }]).map((y, k) => ({ name: y.name, values: entries.map((e) => e[1][k]) })) };
}
function resolveKpi(tab, w) {
  const p = w.props || {};
  const f = p.from;
  if (!f) return { value: p.value, unit: p.unit, delta: p.delta };
  const ds = tab.datasets[f.dataset];
  if (!ds) return { value: null };
  const rows = ds.rows.filter((r) => rowMatches(ds, r, f.filter));
  if (f.validity) {
    const vi = dsColIndex(ds, f.validity);
    return { value: rows.filter((r) => validityOf(r[vi]).status === f.status).length, unit: '' };
  }
  if (f.agg === 'count') return { value: rows.length, unit: p.unit || '' };
  const ci = dsColIndex(ds, f.col);
  const vals = rows.map((r) => parseNumBR(r[ci])).filter((n) => !isNaN(n));
  if (!vals.length) return { value: null };
  if (f.agg === 'last') {
    const last = vals[vals.length - 1], prev = vals[vals.length - 2];
    return { value: last, unit: p.pct ? '%' : p.unit || '', delta: f.deltaPrev && prev != null ? last - prev : null, spark: vals.slice(-12) };
  }
  if (f.agg === 'avg') return { value: vals.reduce((a, b) => a + b, 0) / vals.length, unit: p.unit || '' };
  if (f.agg === 'max') return { value: Math.max(...vals), unit: p.unit || '' };
  if (f.agg === 'min') return { value: Math.min(...vals), unit: p.unit || '' };
  return { value: vals.reduce((a, b) => a + b, 0), unit: p.pct ? '%' : p.unit || '' };
}
function resolveCounter(tab, w) {
  const p = w.props || {};
  let since = p.since ? parseDateBR(p.since) : null;
  if (p.from) {
    const ds = tab.datasets[p.from.dataset];
    if (ds) {
      const di = dsColIndex(ds, p.from.dateCol);
      const dates = ds.rows.filter((r) => rowMatches(ds, r, p.from.filter)).map((r) => parseDateBR(r[di])).filter(Boolean).sort((a, b) => b - a);
      if (dates.length) since = dates[0];
    }
  }
  if (!since) return { days: null, since: null };
  return { days: Math.max(0, daysBetween(since, new Date())), since };
}
// Avaliador seguro de fórmulas (sem eval): + - * / ^ ( ) variáveis e funções
function evalFormula(expr, vars) {
  const toks = String(expr).match(/\d+(?:[.,]\d+)?|[A-Za-z_][A-Za-z0-9_]*|\*\*|[-+*/^(),%]/g) || [];
  let i = 0;
  const FN = { min: Math.min, max: Math.max, round: Math.round, abs: Math.abs, sqrt: Math.sqrt, log: Math.log10, ln: Math.log, pow: Math.pow, ceil: Math.ceil, floor: Math.floor };
  const peek = () => toks[i];
  const next = () => toks[i++];
  const primary = () => {
    const t = next();
    if (t === '(') {
      const v = expr1();
      next();
      return v;
    }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (/^\d/.test(t)) return parseFloat(t.replace(',', '.'));
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(' && FN[t.toLowerCase()]) {
        next();
        const args = [];
        while (peek() !== ')' && i < toks.length) {
          args.push(expr1());
          if (peek() === ',') next();
        }
        next();
        return FN[t.toLowerCase()](...args);
      }
      const v = vars[t] != null ? vars[t] : vars[t.toUpperCase()] != null ? vars[t.toUpperCase()] : NaN;
      return parseNumBR(v);
    }
    return NaN;
  };
  const power = () => {
    let b = primary();
    while (peek() === '^' || peek() === '**') {
      next();
      b = Math.pow(b, power());
    }
    return b;
  };
  const term = () => {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next();
      const r = power();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const expr1 = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = expr1();
    return isFinite(v) ? v : NaN;
  } catch (e) {
    return NaN;
  }
}
