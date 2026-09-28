// ---------------------------------------------------------------------------
// 24 · Interface do Estúdio de Abas: visualização, edição visual, barra de
//      abas do app, pedidos à IA dentro da aba, exportação e modo embutido.
// ---------------------------------------------------------------------------
const ws = { el: null, tabId: null, subId: null, editing: false, nav: null, observers: [] };
const WIDGET_DESC = {
  kpi: 'Número em destaque (fixo ou calculado dos dados)', chart: 'Barras, linha, área, rosca ou empilhado', table: 'Tabela com busca, ordenação e validade', form: 'Formulário que grava registros e alimenta os gráficos',
  note: 'Texto livre com **negrito** e listas', checklist: 'Lista de verificação com marcação', links: 'Lista de links úteis', counter: 'Dias desde uma data (ex.: sem acidentes)', progress: 'Meta com barra de progresso',
  calc: 'Calculadora com fórmula própria', site: 'Resumo de um site, com atualização', timeline: 'Eventos em ordem cronológica', image: 'Imagem ou logotipo', embed: 'Página externa incorporada',
};

function openWorkspace(tabId, subId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  if (ws.tabId !== tabId) ws.editing = false;
  ws.tabId = tabId;
  ws.subId = subId && tab.subtabs.some((s) => s.id === subId) ? subId : ws.subId && tab.subtabs.some((s) => s.id === ws.subId) ? ws.subId : tab.subtabs[0].id;
  if (!ws.el) {
    ws.el = h('div', { class: 'o3-ws', role: 'region', 'aria-label': 'Aba personalizada do OPS 360°' });
    ui.layer.appendChild(ws.el);
    ws._pos = throttle(positionWorkspace, 80);
    addEventListener('resize', ws._pos);
    addEventListener('scroll', ws._pos, true);
    ws._esc = (e) => e.key === 'Escape' && !ui.layer.querySelector('.o3-modal-bg,.o3-menu') && closeWorkspace();
    document.addEventListener('keydown', ws._esc);
  }
  positionWorkspace();
  renderWorkspace();
  markNav();
  ui.layer.classList.add('o3-ws-open');
  bus.emit('ws:open', { tabId });
}
function closeWorkspace() {
  if (!ws.el) return;
  ws.el.remove();
  ws.el = null;
  ws.tabId = null;
  ws.editing = false;
  ui.layer.classList.remove('o3-ws-open');
  removeEventListener('resize', ws._pos);
  removeEventListener('scroll', ws._pos, true);
  document.removeEventListener('keydown', ws._esc);
  markNav();
  bus.emit('ws:close');
}
function positionWorkspace() {
  if (!ws.el) return;
  let top = 0;
  const nav = ws.nav && ws.nav.container;
  if (nav && nav.isConnected) {
    const r = nav.getBoundingClientRect();
    if (r.bottom > 0 && r.bottom < innerHeight * 0.4) top = Math.round(r.bottom);
  }
  ws.el.style.setProperty('--o3-ws-top', top + 'px');
}

function renderWorkspace() {
  if (!ws.el) return;
  const tab = tabs.get(ws.tabId);
  if (!tab) return closeWorkspace();
  renderTabView(ws.el, tab, ws, false);
}
// Renderiza uma aba num container (sobreposição ou embutida no app)
function renderTabView(el, tab, state, embed) {
  const keepScroll = el.querySelector('.o3-ws-body') ? el.querySelector('.o3-ws-body').scrollTop : 0;
  el.textContent = '';
  el.className = 'o3-ws' + (tab.theme === 'dark' ? ' o3-dark' : '') + (state.editing ? ' o3-editing' : '') + (embed ? ' o3-embed' : '');
  el.style.setProperty('--w-p', tab.color);
  const sub = tab.subtabs.find((s) => s.id === state.subId) || tab.subtabs[0];
  state.subId = sub.id;
  const rerender = () => renderTabView(el, tabs.get(tab.id) || tab, state, embed);
  const hasSrc = Object.keys(tab.sources || {}).length > 0;
  const acts = h(
    'div',
    { class: 'o3-ws-acts' },
    h('button', { class: 'o3-wb' + (state.editing ? ' o3-on' : ''), onclick: () => ((state.editing = !state.editing), rerender()), title: 'Editar blocos e sub-abas' }, state.editing ? '✓ Concluir edição' : '✏️ Editar'),
    h('button', { class: 'o3-wb', title: 'Desfazer a última alteração', onclick: async () => ((await tabs.undo(tab)) ? rerender() : toast('Nada para desfazer.')) }, '↶'),
    hasSrc ? h('button', { class: 'o3-wb', title: 'Buscar os dados do site novamente', onclick: async (e) => {
      e.currentTarget.textContent = '⟳ Atualizando…';
      const r = await refreshTabSources(tabs.get(tab.id));
      toast(r.every((x) => x.ok) ? 'Dados atualizados ✓' : 'Algumas fontes falharam: ' + r.filter((x) => !x.ok).map((x) => x.error).join('; '));
      rerender();
    } }, '⟳ Atualizar') : null,
    h('button', { class: 'o3-wb', title: 'Nome, ícone, cor, tema', onclick: () => tabSettings(tab, rerender) }, '⚙'),
    h('button', { class: 'o3-wb', title: 'Exportar o pacote padronizado (blueprint + script + documentação)', onclick: () => exportTabNow(tab.id) }, '📦 Exportar'),
    embed ? null : h('button', { class: 'o3-wb o3-pri', title: 'Fechar e voltar ao OPS 360° (Esc)', onclick: closeWorkspace }, '✕ Fechar')
  );
  el.appendChild(
    h('div', { class: 'o3-ws-head' }, h('div', { class: 'o3-ws-ic', text: tab.icon }), h('div', { class: 'o3-ws-title' }, h('h2', {}, tab.name, h('span', { style: { fontSize: '11px', fontWeight: 700, color: 'var(--w-mut)', border: '1px solid var(--w-line)', borderRadius: '6px', padding: '1px 6px' }, text: 'criada com IA' })), tab.description ? h('p', { text: tab.description, title: tab.description }) : null), acts)
  );
  if (!embed && !(ws.nav && ws.nav.container && ws.nav.container.isConnected) && tabs.list.length > 1) {
    const strip = h('div', { class: 'o3-ws-tabs', role: 'tablist' });
    for (const t of tabs.list) strip.appendChild(h('button', { class: 'o3-wt' + (t.id === tab.id ? ' o3-active' : ''), role: 'tab', 'aria-selected': t.id === tab.id ? 'true' : 'false', onclick: () => openWorkspace(t.id), text: `${t.icon} ${t.name}` }));
    el.appendChild(strip);
  }
  const subs = h('div', { class: 'o3-subs', role: 'tablist' });
  for (const s of tab.subtabs) {
    subs.appendChild(
      h('button', {
        class: 'o3-st' + (s.id === sub.id ? ' o3-active' : ''), role: 'tab', 'aria-selected': s.id === sub.id ? 'true' : 'false', text: s.name,
        onclick: () => ((state.subId = s.id), rerender()),
        ondblclick: () => state.editing && renameSub(tab, s, rerender),
        oncontextmenu: (e) => (e.preventDefault(), subMenu(tab, s, e, rerender)),
      })
    );
  }
  if (state.editing) subs.appendChild(h('button', { class: 'o3-st o3-add', onclick: () => addSub(tab, rerender), text: '＋ Sub-aba' }));
  el.appendChild(subs);
  const body = h('div', { class: 'o3-ws-body' });
  const grid = h('div', { class: 'o3-grid', style: { '--cols': sub.columns || 3 } });
  grid.style.setProperty('--cols', sub.columns || 3);
  for (const w of sub.widgets) grid.appendChild(renderWidget(tab, sub, w, { editing: state.editing, rerender }));
  if (state.editing || !sub.widgets.length) grid.appendChild(h('button', { class: 'o3-add-tile', style: { gridColumn: `span ${Math.min(sub.columns || 3, 1)}` }, onclick: () => addWidgetGallery(tab, sub, rerender) }, '＋ Adicionar bloco'));
  body.appendChild(grid);
  el.appendChild(body);
  requestAnimationFrame(() => (body.scrollTop = keepScroll));
  // pedir à IA dentro da aba
  if (!ui.panel) return;
  const reply = h('div', { class: 'o3-ws-reply o3-md', role: 'status' });
  const inp = h('input', { placeholder: `Peça uma alteração nesta aba — ex.: "adicione um gráfico de linha por mês", "crie uma sub-aba Metas"`, 'aria-label': 'Pedido para a Aurora sobre esta aba' });
  const go = async () => {
    const v = inp.value.trim();
    if (!v) return;
    inp.value = '';
    reply.innerHTML = '<span class="o3-typing"><i></i><i></i><i></i></span>';
    reply.classList.add('o3-show');
    const msg = await send(/\baba\b/i.test(v) ? v : `${v} na aba ${tab.name}`);
    const txt = msg ? messageText(msg) : '';
    reply.innerHTML = mdToHtml(txt || 'Feito.');
    clearTimeout(reply._t);
    reply._t = setTimeout(() => reply.classList.remove('o3-show'), 9000);
  };
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  el.appendChild(reply);
  el.appendChild(h('div', { class: 'o3-ws-ask' }, h('span', { class: 'o3-aurora', text: 'AURORA' }), inp, h('button', { 'aria-label': 'Enviar pedido', onclick: go }, iconEl('send'))));
}

// ---- widgets -------------------------------------------------------------------------------------------------
function renderWidget(tab, sub, w, { editing, rerender, static: isStatic } = {}) {
  const cols = sub.columns || 3;
  const card = h('div', { class: 'o3-wg', 'data-w': w.id, style: { gridColumn: `span ${Math.min(w.span || 1, cols)}` } });
  const tb = h('div', { class: 'o3-wg-tb' });
  const head = h('div', { class: 'o3-wg-h' }, h('h3', { text: w.title || WIDGET_LABEL[w.type], title: w.title }), tb);
  card.appendChild(head);
  const body = h('div', { class: 'o3-wg-b' });
  card.appendChild(body);
  const theme = tab.theme === 'dark' ? 'dark' : 'light';
  const save = async (log = false, prompt = '') => {
    if (log) await applyTabOps(tab, [], { prompt, by: 'usuario' });
    else await tabs.save(tab, { silent: true });
  };
  try {
    WIDGET_RENDER[w.type](tab, w, body, { theme, tb, save, rerender, isStatic, card });
  } catch (e) {
    body.appendChild(h('div', { class: 'o3-empty', text: 'Não foi possível exibir este bloco: ' + e.message }));
  }
  if (editing && !isStatic) {
    const idx = sub.widgets.indexOf(w);
    tb.append(
      h('button', { title: 'Editar', onclick: () => editWidget(tab, w, rerender), text: '✎' }),
      h('button', { title: 'Mover para trás', onclick: async () => (await applyTabOps(tab, [{ op: 'move_widget', widgetId: w.id, subId: sub.id, index: Math.max(0, idx - 1) }], { prompt: '(edição visual) mover bloco', by: 'usuario' }), rerender()), text: '←' }),
      h('button', { title: 'Mover para frente', onclick: async () => (await applyTabOps(tab, [{ op: 'move_widget', widgetId: w.id, subId: sub.id, index: idx + 1 }], { prompt: '(edição visual) mover bloco', by: 'usuario' }), rerender()), text: '→' }),
      h('button', { title: 'Largura', onclick: async () => (await applyTabOps(tab, [{ op: 'update_widget', widgetId: w.id, patch: { span: ((w.span || 1) % cols) + 1 } }], { prompt: '(edição visual) largura', by: 'usuario' }), rerender()), text: '⤢' }),
      h('button', { title: 'Remover', onclick: async () => {
        await applyTabOps(tab, [{ op: 'remove_widget', widgetId: w.id }], { prompt: `(edição visual) remover “${w.title}”`, by: 'usuario' });
        rerender();
        toast('Bloco removido.', { action: 'Desfazer', onAction: async () => (await tabs.undo(tab), rerender()) });
      }, text: '🗑' })
    );
  }
  return card;
}
function toneBadge(tone, label) {
  const icon = { critical: '⛔', warning: '⏳', good: '✅' }[tone] || '';
  return h('span', { class: 'o3-tone o3-tone-' + tone }, icon, label);
}
const WIDGET_RENDER = {
  kpi(tab, w, body, o) {
    const r = resolveKpi(tab, w);
    const p = w.props || {};
    const val = r.value == null || isNaN(r.value) ? '—' : (r.unit === 'R$' ? 'R$ ' : '') + (Math.abs(r.value) >= 10000 ? fmtCompact(r.value) : fmtNum(r.value, Number.isInteger(r.value) ? 0 : 1));
    body.appendChild(h('div', { class: 'o3-kv' }, val, r.unit && r.unit !== 'R$' ? h('small', { text: r.unit }) : null));
    const d = h('div', { class: 'o3-kd' });
    if (r.delta != null && !isNaN(r.delta)) {
      const upGood = p.good !== 'down';
      const good = r.delta === 0 ? null : r.delta > 0 === upGood;
      d.classList.add(good ? 'o3-up' : 'o3-down');
      d.appendChild(h('b', { text: `${r.delta > 0 ? '▲ +' : r.delta < 0 ? '▼ ' : ''}${fmtNum(r.delta)}` }));
      d.appendChild(h('span', { text: 'vs. anterior' }));
    }
    if (p.tone && r.value > 0) d.appendChild(toneBadge(p.tone, p.tone === 'critical' ? 'Atenção' : p.tone === 'warning' ? 'Acompanhar' : 'Ok'));
    if (r.spark && r.spark.length > 2) d.appendChild(sparkline(r.spark, o.theme));
    if (p.context) body.title = p.context;
    if (d.childNodes.length) body.appendChild(d);
  },
  chart(tab, w, body, o) {
    const box = h('div');
    body.appendChild(box);
    const data = resolveChart(tab, w);
    if (w.props.placeholder) data.placeholder = true;
    const draw = () => renderChart(box, data, { kind: w.props.kind, theme: o.theme, unit: w.props.unit || '', title: w.title, height: 210 });
    let tableOn = false;
    const tblBtn = h('button', { title: 'Ver os dados em tabela', text: '▦ Tabela', onclick: () => {
      tableOn = !tableOn;
      tblBtn.textContent = tableOn ? '📊 Gráfico' : '▦ Tabela';
      box.textContent = '';
      if (tableOn) box.appendChild(dataTable([w.props.x || 'Categoria', ...data.series.map((s) => s.name)], data.labels.map((l, i) => [l, ...data.series.map((s) => fmtNum(s.values[i]))])));
      else draw();
    } });
    o.tb.appendChild(tblBtn);
    if (o.isStatic) {
      box.style.width = '100%';
      draw();
      return;
    }
    requestAnimationFrame(draw);
    if (typeof ResizeObserver !== 'undefined') {
      let lastW = 0;
      const ro = new ResizeObserver(debounce(() => {
        const cw = box.clientWidth;
        if (Math.abs(cw - lastW) > 8 && !tableOn) {
          lastW = cw;
          draw();
        }
      }, 120));
      ro.observe(box);
    }
  },
  table(tab, w, body, o) {
    const p = w.props || {};
    const ds = tab.datasets[p.dataset];
    if (!ds) {
      body.appendChild(h('div', { class: 'o3-empty', text: 'Tabela sem base de dados.' }));
      return;
    }
    if (ds.sample && ds.rows.length && !o.isStatic) {
      body.appendChild(h('div', { class: 'o3-sample' }, '🧪 Estes são dados de exemplo.', h('button', { onclick: async () => {
        ds.rows = [];
        ds.sample = false;
        await o.save();
        o.rerender();
        toast('Exemplos apagados — registre os dados reais pelo formulário.');
      }, text: 'Apagar exemplos' })));
    }
    const vi = p.validity ? dsColIndex(ds, p.validity) : -1;
    const head = ds.columns.map((c) => c.name).concat(vi >= 0 ? ['Situação'] : []);
    let q = '', sortI = -1, asc = true, limit = 100;
    const tools = h('div', { class: 'o3-tbl-tools' });
    const search = h('input', { type: 'search', placeholder: 'Buscar…', oninput: () => ((q = norm(search.value)), draw()) });
    if (p.search !== false && !o.isStatic) tools.appendChild(search);
    if (!o.isStatic) {
      tools.appendChild(h('button', { class: 'o3-wb', title: 'Baixar CSV', onclick: () => downloadBlob(new Blob([datasetCSV(ds)], { type: 'text/csv' }), slug(ds.name) + '.csv'), text: '⬇ CSV' }));
      tools.appendChild(h('button', { class: 'o3-wb', title: 'Baixar Excel', onclick: async () => downloadBlob(await sheetsToXLSX([{ name: ds.name, rows: [ds.columns.map((c) => c.name), ...ds.rows] }], ds.name), slug(ds.name) + '.xlsx'), text: '⬇ Excel' }));
      body.appendChild(tools);
    }
    const wrap = h('div', { class: 'o3-tbl-wrap' });
    body.appendChild(wrap);
    const fmtCell = (c, v) => (c && c.type === 'date' && v ? fmtDate(parseDateBR(v)) || v : v);
    const draw = () => {
      let rows = ds.rows.map((r, i) => ({ r, i })).filter(({ r }) => !q || r.some((c) => norm(c).includes(q)));
      if (sortI >= 0) {
        rows.sort((a, b) => {
          const A = a.r[sortI], B = b.r[sortI];
          const col = ds.columns[sortI];
          const na = col && col.type === 'date' ? +parseDateBR(A) || 0 : parseNumBR(A), nb = col && col.type === 'date' ? +parseDateBR(B) || 0 : parseNumBR(B);
          const cmp = !isNaN(na) && !isNaN(nb) ? na - nb : String(A).localeCompare(String(B), 'pt-BR');
          return asc ? cmp : -cmp;
        });
      }
      const tbl = h('table', { class: 'o3-tbl' });
      const trh = h('tr');
      head.forEach((hd, i) => trh.appendChild(h('th', { text: hd + (sortI === i ? (asc ? ' ▲' : ' ▼') : ''), onclick: () => (i < ds.columns.length ? ((asc = sortI === i ? !asc : true), (sortI = i), draw()) : null) })));
      if (!o.isStatic) trh.appendChild(h('th', { text: '' }));
      tbl.appendChild(h('thead', {}, trh));
      const tbody = h('tbody');
      for (const { r, i } of rows.slice(0, limit)) {
        const tr = h('tr');
        ds.columns.forEach((c, k) => tr.appendChild(h('td', { class: c.type === 'number' ? 'o3-num' : '', text: fmtCell(c, r[k] == null ? '' : String(r[k])) })));
        if (vi >= 0) {
          const v = validityOf(r[vi]);
          tr.appendChild(h('td', {}, v.status === 'sem_data' ? '—' : toneBadge(v.status === 'vencido' ? 'critical' : v.status === 'a_vencer' ? 'warning' : 'good', v.label)));
        }
        if (!o.isStatic)
          tr.appendChild(h('td', {}, h('button', { class: 'o3-rowx', title: 'Excluir registro', text: '✕', onclick: async () => {
            const removed = ds.rows.splice(i, 1)[0];
            await o.save();
            o.rerender();
            toast('Registro excluído.', { action: 'Desfazer', onAction: async () => (ds.rows.splice(i, 0, removed), await o.save(), o.rerender()) });
          } })));
        tbody.appendChild(tr);
      }
      if (!rows.length) tbody.appendChild(h('tr', {}, h('td', { colspan: head.length + 1, class: 'o3-empty', text: ds.rows.length ? 'Nada encontrado.' : 'Nenhum registro ainda.' })));
      tbl.appendChild(tbody);
      wrap.textContent = '';
      wrap.appendChild(tbl);
      if (rows.length > limit) wrap.appendChild(h('button', { class: 'o3-wb', style: { margin: '8px' }, onclick: () => ((limit += 200), draw()), text: `Mostrar mais (${rows.length - limit})` }));
    };
    draw();
    o.tb.appendChild(h('span', { class: 'o3-tone', style: { color: 'var(--w-mut)' }, text: `${ds.rows.length} registro(s)` }));
  },
  form(tab, w, body, o) {
    const ds = tab.datasets[(w.props || {}).dataset];
    if (!ds) {
      body.appendChild(h('div', { class: 'o3-empty', text: 'Formulário sem base de dados.' }));
      return;
    }
    const form = h('form', { class: 'o3-form', onsubmit: (e) => e.preventDefault() });
    const inputs = ds.columns.map((c) => {
      let inp;
      if (c.type === 'select' && c.options && c.options.length) inp = h('select', {}, h('option', { value: '', text: '—' }), ...c.options.map((op) => h('option', { value: op, text: op })));
      else inp = h('input', { type: c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text', step: c.type === 'number' ? 'any' : null, placeholder: c.type === 'text' ? c.name : '' });
      form.appendChild(h('label', {}, c.name, inp));
      return inp;
    });
    body.appendChild(form);
    const btn = h('button', { class: 'o3-wb o3-pri', style: { marginTop: '10px' }, text: '＋ Salvar registro', onclick: async () => {
      const row = inputs.map((i) => i.value.trim());
      if (!row.some(Boolean)) return toast('Preencha pelo menos um campo.');
      const hadSample = ds.sample;
      ds.rows.push(row);
      await o.save();
      o.rerender();
      toast('Registro salvo ✓' + (hadSample ? ' — quer apagar os dados de exemplo?' : ''), hadSample ? { action: 'Apagar exemplos', onAction: async () => {
        ds.rows = ds.rows.filter((r) => r === row);
        ds.sample = false;
        await o.save();
        o.rerender();
      }, ms: 8000 } : {});
    } });
    if (!o.isStatic) body.appendChild(btn);
  },
  note(tab, w, body) {
    const d = h('div', { class: 'o3-note o3-md' });
    d.innerHTML = mdToHtml((w.props || {}).text || '');
    body.appendChild(d);
  },
  checklist(tab, w, body, o) {
    const items = (w.props.items = w.props.items || []);
    const box = h('div', { class: 'o3-cl' });
    items.forEach((it) => {
      const cb = h('input', { type: 'checkbox', checked: !!it.done, disabled: o.isStatic, onchange: async () => {
        it.done = cb.checked;
        span.classList.toggle('o3-done', it.done);
        await o.save();
        cnt.textContent = `${items.filter((x) => x.done).length}/${items.length}`;
      } });
      const span = h('span', { class: it.done ? 'o3-done' : '', text: it.text });
      box.appendChild(h('label', {}, cb, span));
    });
    if (!items.length) box.appendChild(h('div', { class: 'o3-empty', text: 'Sem itens — edite o bloco para adicionar.' }));
    body.appendChild(box);
    const cnt = h('span', { class: 'o3-tone', style: { color: 'var(--w-mut)' }, text: `${items.filter((x) => x.done).length}/${items.length}` });
    o.tb.appendChild(cnt);
    if (!o.isStatic) {
      const add = h('input', { placeholder: '＋ Novo item (Enter)', style: { width: '100%', marginTop: '8px', padding: '7px 10px', borderRadius: '9px', border: '1px solid var(--w-line)', background: 'var(--w-bg)', color: 'var(--w-text)' }, onkeydown: async (e) => {
        if (e.key !== 'Enter' || !add.value.trim()) return;
        items.push({ text: add.value.trim(), done: false });
        await o.save();
        o.rerender();
      } });
      body.appendChild(add);
    }
  },
  links(tab, w, body) {
    const box = h('div', { class: 'o3-links' });
    for (const it of (w.props || {}).items || []) {
      const u = normalizeUrl(it.url);
      if (u) box.appendChild(h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, '🔗', h('span', { text: it.text || u })));
    }
    if (!box.childNodes.length) box.appendChild(h('div', { class: 'o3-empty', text: 'Nenhum link ainda.' }));
    body.appendChild(box);
  },
  counter(tab, w, body) {
    const r = resolveCounter(tab, w);
    body.appendChild(h('div', { class: 'o3-counter' }, h('b', { text: r.days == null ? '—' : fmtNum(r.days) }), h('span', { text: r.days === 1 ? 'dia' : 'dias' })));
    body.appendChild(h('div', { class: 'o3-kd', text: r.since ? `desde ${fmtDate(r.since)}` : 'Defina a data inicial (modo Editar).' }));
  },
  progress(tab, w, body) {
    const p = w.props || {};
    const pct = p.max ? clamp((p.value / p.max) * 100, 0, 100) : 0;
    body.appendChild(h('div', { class: 'o3-kv' }, fmtNum(pct, 0), h('small', { text: '%' })));
    body.appendChild(h('div', { class: 'o3-bar', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: pct + '%' } })));
    body.appendChild(h('div', { class: 'o3-kd', text: `${fmtNum(p.value || 0)} de ${fmtNum(p.max || 0)}${p.unit ? ' ' + p.unit : ''}` }));
  },
  calc(tab, w, body, o) {
    const p = w.props || {};
    const fields = p.fields || [];
    const res = h('div', { class: 'o3-res' });
    const calc = () => {
      const vars = {};
      fields.forEach((f) => (vars[f.name] = f.value));
      const v = evalFormula(p.formula, vars);
      res.textContent = isNaN(v) ? '—' : fmtNum(v, p.decimals != null ? p.decimals : 2) + (p.unit ? '' : '');
      res.title = p.unit || '';
    };
    const box = h('div', { class: 'o3-calc' });
    const form = h('div', { class: 'o3-form' });
    fields.forEach((f) => {
      const inp = h('input', { type: 'number', step: 'any', value: f.value != null ? f.value : '', disabled: o.isStatic, oninput: debounce(async () => {
        f.value = inp.value;
        calc();
        await o.save();
      }, 250) });
      form.appendChild(h('label', {}, f.label || f.name, inp));
    });
    box.appendChild(form);
    box.appendChild(h('div', {}, res, p.unit ? h('div', { class: 'o3-kd', text: p.unit }) : null));
    box.appendChild(h('div', { class: 'o3-kd', text: 'Fórmula: ' + p.formula }));
    body.appendChild(box);
    calc();
  },
  site(tab, w, body, o) {
    const src = (tab.sources || {})[(w.props || {}).source];
    if (!src) {
      body.appendChild(h('div', { class: 'o3-empty', text: 'Fonte não configurada.' }));
      return;
    }
    const box = h('div', { class: 'o3-site o3-md' });
    const sum = (src.summary || []).slice(0, 5);
    box.innerHTML = sum.length ? '<ul>' + sum.map((s) => `<li>${esc(truncate(s, 260))}</li>`).join('') + '</ul>' : '<p class="o3-empty">Ainda não li este site — clique em Atualizar.</p>';
    body.appendChild(box);
    body.appendChild(h('div', { class: 'o3-src' }, '🌐 ', h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer', text: truncate(src.url, 70) }), ` · ${src.lastFetched ? 'atualizado ' + fmtDateTime(src.lastFetched) : 'nunca lido'}${src.via ? ' · via ' + src.via : ''}${src.status === 'erro' ? ' · ⚠️ ' + src.error : ''}`));
    if (!o.isStatic)
      o.tb.appendChild(h('button', { title: 'Atualizar agora', text: '⟳', onclick: async () => {
        const r = await refreshTabSources(tab);
        toast(r.every((x) => x.ok) ? 'Atualizado ✓' : 'Falha: ' + r.map((x) => x.error).filter(Boolean).join('; '));
        o.rerender();
      } }));
  },
  timeline(tab, w, body) {
    const items = [...((w.props || {}).items || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const box = h('div', { class: 'o3-tl' });
    for (const it of items.slice(0, 40)) {
      const d = parseDateBR(it.date);
      box.appendChild(h('div', {}, h('small', { text: d ? fmtDate(d) : it.date || '' }), it.url ? h('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer', text: it.text }) : h('span', { text: it.text })));
    }
    if (!items.length) box.appendChild(h('div', { class: 'o3-empty', text: 'Sem eventos.' }));
    body.appendChild(box);
  },
  image(tab, w, body) {
    const p = w.props || {};
    if (p.src && /^data:image\/|^https?:/.test(p.src)) body.appendChild(h('img', { src: p.src, alt: p.caption || w.title, style: { maxWidth: '100%', borderRadius: '10px', display: 'block', margin: '0 auto' } }));
    if (p.caption) body.appendChild(h('div', { class: 'o3-kd', text: p.caption }));
  },
  embed(tab, w, body) {
    const u = normalizeUrl((w.props || {}).url);
    if (!u) return body.appendChild(h('div', { class: 'o3-empty', text: 'Informe um endereço.' }));
    body.appendChild(h('iframe', { src: u, sandbox: 'allow-scripts allow-same-origin allow-popups', style: { width: '100%', height: ((w.props || {}).height || 360) + 'px', border: '1px solid var(--w-line)', borderRadius: '10px' }, loading: 'lazy', title: w.title }));
  },
};
function dataTable(head, rows) {
  const t = h('table', { class: 'o3-tbl' });
  t.appendChild(h('thead', {}, h('tr', {}, ...head.map((x) => h('th', { text: x })))));
  t.appendChild(h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c, i) => h('td', { class: i ? 'o3-num' : '', text: c }))))));
  return h('div', { class: 'o3-tbl-wrap' }, t);
}

// ---- edição visual -------------------------------------------------------------------------------------------
function addWidgetGallery(tab, sub, rerender) {
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '10px' } });
  const m = openModal({ title: '＋ Adicionar bloco', body: grid });
  for (const type of Object.keys(WIDGET_LABEL)) {
    grid.appendChild(
      h('button', { class: 'o3-li', style: { flexDirection: 'column', alignItems: 'flex-start', gap: '4px', textAlign: 'left' }, onclick: async () => {
        m.close();
        const ds0 = Object.values(tab.datasets)[0];
        const defaults = {
          kpi: ds0 ? { from: { dataset: ds0.id, agg: 'count' } } : { value: 0 },
          chart: ds0 ? { kind: 'bar', dataset: ds0.id, x: (ds0.columns.find((c) => c.type === 'select') || ds0.columns[0]).name, agg: 'count' } : { kind: 'bar', labels: ['A', 'B', 'C'], series: [{ name: 'Valor', values: [3, 5, 2] }] },
          table: null, form: null, note: { text: 'Escreva aqui.' }, checklist: { items: [] }, links: { items: [] }, counter: { since: isoDate(new Date()) }, progress: { value: 0, max: 100 },
          calc: { fields: [{ name: 'A', label: 'Valor A', value: 0 }, { name: 'B', label: 'Valor B', value: 0 }], formula: 'A + B', decimals: 2 }, site: null, timeline: { items: [] }, image: { src: '' }, embed: { url: '' },
        };
        const ops = [];
        let props = defaults[type];
        if (type === 'table' || type === 'form') {
          let ds = ds0;
          if (!ds) {
            ds = DS('Registros', [{ name: 'Data', type: 'date' }, { name: 'Descrição', type: 'text' }, { name: 'Responsável', type: 'text' }], []);
            ops.push({ op: 'add_dataset', dataset: ds });
          }
          props = { dataset: ds.id, search: true };
        }
        if (type === 'site') {
          const src = { id: uid('src'), type: 'url', url: '', mode: 'auto', refreshMinutes: 0 };
          ops.push({ op: 'add_source', source: src });
          props = { source: src.id };
        }
        const w = W(type, WIDGET_LABEL[type], props, type === 'table' || type === 'note' ? 2 : 1);
        ops.push({ op: 'add_widget', subId: sub.id, widget: w });
        await applyTabOps(tab, ops, { prompt: `(edição visual) adicionar ${WIDGET_LABEL[type]}`, by: 'usuario' });
        rerender();
        editWidget(tab, findWidget(tab, w.id), rerender);
      } }, h('b', { text: `${WIDGET_ICON[type]} ${WIDGET_LABEL[type]}` }), h('span', { class: 'o3-mut', text: WIDGET_DESC[type] }))
    );
  }
}
function editWidget(tab, w, rerender) {
  if (!w) return;
  const p = deepClone(w.props || {});
  const body = h('div');
  const title = h('input', { value: w.title });
  const span = h('select', {}, ...[1, 2, 3, 4].map((n) => h('option', { value: n, selected: (w.span || 1) === n, text: `${n} coluna(s)` })));
  body.append(h('div', { class: 'o3-row' }, h('label', { class: 'o3-field' }, h('span', { text: 'Título' }), title), h('label', { class: 'o3-field' }, h('span', { text: 'Largura' }), span)));
  const getters = [];
  const field = (label, el) => (body.appendChild(h('label', { class: 'o3-field' }, h('span', { text: label }), el)), el);
  const dsSel = () => h('select', {}, ...Object.values(tab.datasets).map((d) => h('option', { value: d.id, selected: p.dataset === d.id || (p.from && p.from.dataset === d.id), text: d.name })));
  if (w.type === 'chart') {
    const kind = field('Tipo de gráfico', h('select', {}, ...[['bar', 'Barras (colunas)'], ['hbar', 'Barras horizontais'], ['line', 'Linha'], ['area', 'Área'], ['donut', 'Rosca (participação)'], ['stacked', 'Barras empilhadas']].map(([v, l]) => h('option', { value: v, selected: p.kind === v, text: l }))));
    getters.push(() => (p.kind = kind.value));
    if (p.dataset) {
      const ds = tab.datasets[p.dataset];
      const xs = field('Categoria / eixo', h('select', {}, ...ds.columns.map((c) => h('option', { value: c.name, selected: p.x === c.name, text: c.name }))));
      const agg = field('Cálculo', h('select', {}, h('option', { value: 'count', selected: p.agg === 'count', text: 'Contar registros' }), h('option', { value: 'sum', selected: p.agg === 'sum', text: 'Somar valores' })));
      const ys = field('Valores a somar (colunas numéricas, separadas por vírgula)', h('input', { value: (p.y || []).join(', ') }));
      getters.push(() => {
        p.x = xs.value;
        p.agg = agg.value;
        p.y = ys.value.split(',').map((s) => s.trim()).filter(Boolean);
        const col = ds.columns.find((c) => c.name === p.x);
        p.groupDate = col && col.type === 'date' ? 'month' : undefined;
        delete p.validity;
      });
    } else {
      const lines = [['Rótulo', ...(p.series || []).map((s) => s.name)].join(';'), ...(p.labels || []).map((l, i) => [l, ...(p.series || []).map((s) => s.values[i])].join(';'))].join('\n');
      const data = field('Dados (primeira linha = cabeçalho; uma linha por categoria; separe com ;)', h('textarea', {}, lines));
      getters.push(() => {
        const rows = data.value.split('\n').map((l) => l.split(/[;\t]/).map((c) => c.trim())).filter((r) => r.some(Boolean));
        if (rows.length >= 2) {
          p.labels = rows.slice(1).map((r) => r[0]);
          p.series = rows[0].slice(1).map((name, k) => ({ name: name || 'Valor', values: rows.slice(1).map((r) => parseNumBR(r[k + 1]) || 0) }));
          p.placeholder = false;
        }
      });
    }
  } else if (w.type === 'kpi' && !p.from) {
    const v = field('Valor', h('input', { type: 'number', step: 'any', value: p.value != null ? p.value : '' }));
    const u = field('Unidade (opcional)', h('input', { value: p.unit || '' }));
    const d = field('Variação vs. anterior (opcional)', h('input', { type: 'number', step: 'any', value: p.delta != null ? p.delta : '' }));
    getters.push(() => {
      p.value = parseNumBR(v.value);
      p.unit = u.value;
      p.delta = d.value === '' ? null : parseNumBR(d.value);
    });
  } else if (w.type === 'note') {
    const t = field('Texto (use **negrito** e linhas começando com • para listas)', h('textarea', { style: { fontFamily: 'inherit', fontSize: '14px' } }, p.text || ''));
    getters.push(() => (p.text = t.value));
  } else if (w.type === 'checklist') {
    const t = field('Itens (um por linha; comece com [x] para marcar)', h('textarea', {}, (p.items || []).map((i) => (i.done ? '[x] ' : '') + i.text).join('\n')));
    getters.push(() => (p.items = t.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ text: l.replace(/^\[x\]\s*/i, ''), done: /^\[x\]/i.test(l) }))));
  } else if (w.type === 'links') {
    const t = field('Links (um por linha: Texto | https://endereço)', h('textarea', {}, (p.items || []).map((i) => `${i.text} | ${i.url}`).join('\n')));
    getters.push(() => (p.items = t.value.split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((x) => x[0]).map(([a, b]) => ({ text: b ? a : a, url: b || a }))));
  } else if (w.type === 'counter') {
    const d = field('Desde (data)', h('input', { type: 'date', value: p.since || '' }));
    getters.push(() => {
      p.since = d.value;
      if (d.value) delete p.from;
    });
    if (p.from) body.appendChild(h('div', { class: 'o3-mut', text: 'Hoje o contador é calculado automaticamente pelos registros. Preencher uma data fixa desliga o cálculo automático.' }));
  } else if (w.type === 'progress') {
    const v = field('Realizado', h('input', { type: 'number', step: 'any', value: p.value || 0 }));
    const mx = field('Meta', h('input', { type: 'number', step: 'any', value: p.max || 100 }));
    const u = field('Unidade', h('input', { value: p.unit || '' }));
    getters.push(() => Object.assign(p, { value: parseNumBR(v.value) || 0, max: parseNumBR(mx.value) || 0, unit: u.value }));
  } else if (w.type === 'calc') {
    const f = field('Campos (um por linha: LETRA | rótulo)', h('textarea', {}, (p.fields || []).map((x) => `${x.name} | ${x.label}`).join('\n')));
    const fo = field('Fórmula (use as letras; + − × ÷ ^ e min, max, round, sqrt)', h('input', { value: p.formula || '' }));
    const u = field('Unidade do resultado', h('input', { value: p.unit || '' }));
    const dcm = field('Casas decimais', h('input', { type: 'number', min: 0, max: 6, value: p.decimals != null ? p.decimals : 2 }));
    getters.push(() => {
      const old = Object.fromEntries((p.fields || []).map((x) => [x.name, x.value]));
      p.fields = f.value.split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((x) => x[0]).map(([n, l]) => ({ name: n.toUpperCase().replace(/[^A-Z0-9_]/g, '') || 'A', label: l || n, value: old[n] || 0 }));
      p.formula = fo.value;
      p.unit = u.value;
      p.decimals = +dcm.value;
    });
  } else if (w.type === 'site') {
    const src = (tab.sources || {})[p.source] || {};
    const u = field('Endereço do site', h('input', { value: src.url || '', placeholder: 'https://…' }));
    getters.push(() => {
      if (tab.sources[p.source]) tab.sources[p.source].url = normalizeUrl(u.value) || '';
    });
  } else if (w.type === 'image') {
    const inp = h('input', { type: 'file', accept: 'image/*' });
    field('Imagem', inp);
    getters.push(async () => {
      if (inp.files[0]) {
        const img = await readImage(inp.files[0], new Uint8Array(await inp.files[0].arrayBuffer()));
        p.src = img.dataUrl;
      }
    });
  } else if (w.type === 'embed') {
    const u = field('Endereço (alguns sites bloqueiam incorporação)', h('input', { value: p.url || '' }));
    getters.push(() => (p.url = u.value));
  } else if (w.type === 'table' || w.type === 'form' || (w.type === 'kpi' && p.from)) {
    const ds = tab.datasets[p.dataset || (p.from && p.from.dataset)];
    if (ds) {
      const cols = field('Colunas da base (uma por linha: nome | tipo [texto, número, data, lista] | opções separadas por /)', h('textarea', {}, ds.columns.map((c) => `${c.name} | ${{ text: 'texto', number: 'número', date: 'data', select: 'lista' }[c.type] || 'texto'}${c.options ? ' | ' + c.options.join('/') : ''}`).join('\n')));
      getters.push(() => {
        const next = cols.value.split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((x) => x[0]).map(([n, t, o]) => ({ name: n, type: /num/.test(norm(t || '')) ? 'number' : /data/.test(norm(t || '')) ? 'date' : /lista|select/.test(norm(t || '')) ? 'select' : 'text', options: o ? o.split('/').map((s) => s.trim()).filter(Boolean) : undefined }));
        const oldNames = ds.columns.map((c) => c.name);
        ds.rows = ds.rows.map((r) => next.map((c) => (oldNames.indexOf(c.name) >= 0 ? r[oldNames.indexOf(c.name)] : '')));
        ds.columns = next;
      });
    }
  }
  const adv = h('textarea', {}, JSON.stringify(p, null, 2));
  const advBox = h('details', {}, h('summary', { class: 'o3-mut', style: { cursor: 'pointer', margin: '8px 0' }, text: 'Avançado: propriedades em JSON' }), adv);
  body.appendChild(advBox);
  const m = openModal({
    title: `✎ ${WIDGET_LABEL[w.type]}`,
    body,
    footer: [
      h('button', { class: 'o3-btn', onclick: () => m.close(), text: 'Cancelar' }),
      h('button', { class: 'o3-btn o3-primary', onclick: async () => {
        let props = p;
        if (advBox.open) {
          try {
            props = JSON.parse(adv.value);
          } catch (e) {
            return toast('JSON inválido: ' + e.message);
          }
        } else for (const g of getters) await g();
        await applyTabOps(tab, [{ op: 'update_widget', widgetId: w.id, patch: { title: title.value.trim() || w.title, span: +span.value, props } }], { prompt: `(edição visual) editar “${w.title}”`, by: 'usuario' });
        m.close();
        rerender();
        if (w.type === 'site') refreshTabSources(tab).then(rerender);
      }, text: 'Salvar' }),
    ],
  });
}
async function renameSub(tab, s, rerender) {
  const inp = h('input', { value: s.name });
  const m = openModal({ title: 'Renomear sub-aba', size: 'sm', body: h('label', { class: 'o3-field' }, h('span', { text: 'Nome' }), inp), footer: [h('button', { class: 'o3-btn o3-primary', onclick: async () => (await applyTabOps(tab, [{ op: 'rename_subtab', subId: s.id, name: inp.value.trim() || s.name }], { prompt: '(edição visual) renomear sub-aba', by: 'usuario' }), m.close(), rerender()), text: 'Salvar' })] });
}
function subMenu(tab, s, e, rerender) {
  const i = tab.subtabs.indexOf(s);
  openMenu(e.clientX, e.clientY, [
    { icon: '✏️', label: 'Renomear', run: () => renameSub(tab, s, rerender) },
    { icon: '▦', label: 'Colunas: 1 · 2 · 3 · 4', run: async () => (await applyTabOps(tab, [{ op: 'set_columns', subId: s.id, columns: ((s.columns || 3) % 4) + 1 }], { prompt: '(edição visual) colunas', by: 'usuario' }), rerender()) },
    { icon: '←', label: 'Mover para a esquerda', run: async () => (await applyTabOps(tab, [{ op: 'move_subtab', subId: s.id, index: Math.max(0, i - 1) }], { prompt: '(edição visual) mover sub-aba', by: 'usuario' }), rerender()) },
    { icon: '→', label: 'Mover para a direita', run: async () => (await applyTabOps(tab, [{ op: 'move_subtab', subId: s.id, index: i + 1 }], { prompt: '(edição visual) mover sub-aba', by: 'usuario' }), rerender()) },
    '-',
    { icon: '🗑️', label: 'Excluir sub-aba', run: async () => {
      if (tab.subtabs.length < 2) return toast('A aba precisa de pelo menos uma sub-aba.');
      await applyTabOps(tab, [{ op: 'remove_subtab', subId: s.id }], { prompt: '(edição visual) excluir sub-aba', by: 'usuario' });
      rerender();
      toast('Sub-aba excluída.', { action: 'Desfazer', onAction: async () => (await tabs.undo(tab), rerender()) });
    } },
  ]);
}
async function addSub(tab, rerender) {
  const inp = h('input', { placeholder: 'Ex.: Metas, Treinamentos, Extintores, Links…' });
  const m = openModal({ title: '＋ Nova sub-aba', size: 'sm', body: h('div', {}, h('label', { class: 'o3-field' }, h('span', { text: 'Nome (se for um assunto conhecido, eu já monto o conteúdo)' }), inp)), footer: [h('button', { class: 'o3-btn o3-primary', onclick: async () => {
    const name = inp.value.trim();
    if (!name) return;
    const r = subFromTemplate(tab, name);
    const widgets = r.sub.widgets;
    r.sub.widgets = [];
    const ops = [...r.ops, ...widgets.map((w) => ({ op: 'add_widget', subId: r.sub.id, widget: w }))];
    await applyTabOps(tab, ops, { prompt: `(edição visual) nova sub-aba ${name}`, by: 'usuario' });
    m.close();
    ws.subId = r.sub.id;
    rerender();
  }, text: 'Criar' })] });
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && m.el.querySelector('.o3-primary').click());
}
function tabSettings(tab, rerender) {
  const name = h('input', { value: tab.name });
  const icon = h('input', { value: tab.icon, maxlength: 4, style: { width: '80px' } });
  const color = h('input', { type: 'color', value: tab.color });
  const theme = h('select', {}, h('option', { value: 'light', selected: tab.theme !== 'dark', text: 'Claro (padrão do OPS 360°)' }), h('option', { value: 'dark', selected: tab.theme === 'dark', text: 'Escuro' }));
  const desc = h('textarea', { style: { fontFamily: 'inherit', fontSize: '14px', minHeight: '60px' } }, tab.description || '');
  const pinned = h('input', { type: 'checkbox', checked: tab.pinned !== false });
  const swatches = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' } }, ...Object.values(TAB_COLORS).slice(0, 12).map((c) => h('button', { style: { width: '26px', height: '26px', borderRadius: '8px', background: c, border: '2px solid rgba(255,255,255,.2)' }, 'aria-label': c, onclick: () => (color.value = c) })));
  const icons = h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '12px' } }, ...['📊', '📈', '🦺', '🧯', '🎓', '🔎', '🩺', '👥', '🔗', '🧮', '📌', '🌐', '🗂️', '⚠️', '🏗️', '⚡', '🚜', '🧪', '🛠️', '✅'].map((e) => h('button', { style: { fontSize: '19px', padding: '3px 5px', borderRadius: '8px' }, onclick: () => (icon.value = e), text: e })));
  const json = h('textarea', { style: { minHeight: '160px' } }, tabBlueprintJSON(tab));
  const body = h('div', {}, h('div', { class: 'o3-row' }, h('label', { class: 'o3-field' }, h('span', { text: 'Nome' }), name), h('label', { class: 'o3-field', style: { flex: 'none', minWidth: 0 } }, h('span', { text: 'Ícone' }), icon)), icons, h('div', { class: 'o3-row' }, h('label', { class: 'o3-field' }, h('span', { text: 'Cor' }), color), h('label', { class: 'o3-field' }, h('span', { text: 'Tema' }), theme)), swatches, h('label', { class: 'o3-field' }, h('span', { text: 'Descrição' }), desc), h('label', { class: 'o3-sw-t' }, pinned, h('span', { text: 'Mostrar na barra de abas do OPS 360°' })), h('details', {}, h('summary', { class: 'o3-mut', style: { cursor: 'pointer', margin: '8px 0' }, text: 'Avançado: editar o blueprint (JSON) completo' }), json));
  const m = openModal({
    title: '⚙ Configurar aba',
    body,
    footer: [
      h('button', { class: 'o3-btn o3-danger', onclick: async () => {
        if (!(await confirmBox(`Excluir a aba “${tab.name}”?`, 'Excluir'))) return;
        m.close();
        runAction({ kind: 'tab_delete', tabId: tab.id });
      }, text: '🗑 Excluir aba' }),
      h('button', { class: 'o3-btn o3-primary', onclick: async () => {
        if (body.querySelector('details:last-of-type').open) {
          try {
            const bp = JSON.parse(json.value);
            bp.id = tab.id;
            tabs.snapshot(tab);
            await tabs.install(bp, { overwrite: true });
          } catch (e) {
            return toast('Blueprint inválido: ' + e.message);
          }
        } else {
          const ops = [];
          if (name.value.trim() && name.value.trim() !== tab.name) ops.push({ op: 'rename_tab', name: name.value.trim() });
          ops.push({ op: 'set_style', icon: icon.value.trim() || tab.icon, color: color.value, theme: theme.value, description: desc.value.trim() });
          await applyTabOps(tab, ops, { prompt: '(edição visual) configurações da aba', by: 'usuario' });
          tab.pinned = pinned.checked;
          await tabs.save(tab);
        }
        m.close();
        rerender();
      }, text: 'Salvar' }),
    ],
  });
}

// ---- exportação e renderização estática -----------------------------------------------------------------
function renderTabStatic(tab) {
  const wrap = h('div', { style: { position: 'fixed', left: '-20000px', top: '0', width: '1200px' } });
  ui.layer.appendChild(wrap);
  const view = h('div', { class: 'o3-ws o3-embed' + (tab.theme === 'dark' ? ' o3-dark' : '') });
  view.style.setProperty('--w-p', tab.color);
  wrap.appendChild(view);
  view.appendChild(h('div', { class: 'o3-ws-head' }, h('div', { class: 'o3-ws-ic', text: tab.icon }), h('div', { class: 'o3-ws-title' }, h('h2', { text: tab.name }), h('p', { text: tab.description || '' }))));
  for (const s of tab.subtabs) {
    view.appendChild(h('div', { class: 'o3-subs' }, h('span', { class: 'o3-st o3-active', text: s.name })));
    const body = h('div', { class: 'o3-ws-body', style: { overflow: 'visible', paddingBottom: '24px' } });
    const grid = h('div', { class: 'o3-grid' });
    grid.style.setProperty('--cols', s.columns || 3);
    body.appendChild(grid);
    view.appendChild(body);
    for (const w of s.widgets) grid.appendChild(renderWidget(tab, s, w, { static: true, rerender: () => {} }));
  }
  view.querySelectorAll('.o3-wg-tb button').forEach((b) => b.remove());
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tab.name)} — OPS 360°</title><style>${CSS}\nbody{margin:0;background:#eef2f7}.o3-ws.o3-embed{min-height:100vh;border-radius:0}</style></head><body>${view.outerHTML}<p style="font:12px Segoe UI,Arial;color:#8a97a6;text-align:center;padding:12px">Pré-visualização estática gerada pelo OPS 360° IA v${VERSION} em ${fmtDateTime(new Date())} — padrão ${TAB_SCHEMA}</p></body></html>`;
  wrap.remove();
  return html;
}
async function exportTabNow(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  try {
    const names = await exportTabPackage(tab, renderTabStatic(tab));
    toast(`Pacote da aba “${tab.name}” exportado (${names.length} arquivos).`);
  } catch (e) {
    console.error(e);
    toast('Falha ao exportar: ' + e.message);
  }
}

// ---- integração com a barra de abas do OPS 360° --------------------------------------------------------------
const ACTIVE_CLS = /(^|[-_\s])(active|selected|current|ativo|ativa|atual|is-active|on)([-_\s]|$)/i;
function visibleEl(el) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
}
function findHostNav() {
  if (CFG.navSelector) {
    const c = document.querySelector(CFG.navSelector);
    if (!c) return null;
    const items = [...c.querySelectorAll('a,button,[role=tab]')].filter((x) => !x.hasAttribute('data-o3-tab'));
    return items.length ? { container: items[0].parentElement, sample: items.find((x) => !ACTIVE_CLS.test(x.className)) || items[0], items } : { container: c, sample: null, items: [] };
  }
  const cands = [...document.querySelectorAll('[role=tablist],nav,header,[class*="tab"],[class*="nav"],[class*="menu"],[class*="aba"]')].filter((el) => !el.closest('#ops360-ia-v3,#ops360-ia-v3-overlay') && visibleEl(el));
  let best = null, bestScore = 0;
  for (const el of cands) {
    const r = el.getBoundingClientRect();
    if (r.top + scrollY > 420 || r.width < 260) continue;
    const items = [...el.querySelectorAll('a,button,[role=tab]')].filter((x) => visibleEl(x) && !x.hasAttribute('data-o3-tab') && x.textContent.trim().length > 1 && x.textContent.trim().length <= 28 && !x.closest('#ops360-ia-v3'));
    if (items.length < 3) continue;
    const byParent = new Map();
    for (const it of items) byParent.set(it.parentElement, (byParent.get(it.parentElement) || []).concat(it));
    const [parent, group] = [...byParent.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (group.length < 3) continue;
    const tops = group.map((x) => Math.round(x.getBoundingClientRect().top));
    const horizontal = Math.max(...tops) - Math.min(...tops) < 30;
    const sc = group.length * (horizontal ? 2 : 1) + (el.getAttribute('role') === 'tablist' ? 4 : 0) + (/tab|aba/i.test(el.className) ? 2 : 0);
    if (sc > bestScore) {
      bestScore = sc;
      best = { container: parent, sample: group.find((x) => !ACTIVE_CLS.test(x.className) && x.getAttribute('aria-selected') !== 'true') || group[0], items: group };
    }
  }
  return best;
}
function injectNav() {
  if (CFG.injectNav === false) return;
  const nav = ws.nav && ws.nav.container && ws.nav.container.isConnected ? ws.nav : findHostNav();
  if (!nav || !nav.sample) {
    ws.nav = null;
    return;
  }
  ws.nav = nav;
  nav.container.querySelectorAll('[data-o3-tab]').forEach((n) => n.remove());
  const make = (label, id, onClick, title) => {
    const el = nav.sample.cloneNode(false);
    el.removeAttribute('id');
    el.className = String(nav.sample.className || '').split(/\s+/).filter((c) => !ACTIVE_CLS.test(c)).join(' ');
    el.removeAttribute('aria-selected');
    el.removeAttribute('aria-current');
    el.setAttribute('data-o3-tab', id);
    el.setAttribute('role', 'tab');
    if (title) el.title = title;
    if (el.tagName === 'A') el.setAttribute('href', '#');
    el.textContent = label;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return el;
  };
  const frag = document.createDocumentFragment();
  for (const t of tabs.list.filter((x) => x.pinned !== false)) frag.appendChild(make(`${t.icon} ${truncate(t.name, 26)}`, t.id, () => openWorkspace(t.id), `${t.name} — aba criada com a IA do OPS 360°`));
  frag.appendChild(make('＋', 'new', () => {
    if (ws.el) closeWorkspace();
    openTabsManager();
  }, 'Criar uma nova aba com a IA'));
  nav.container.appendChild(frag);
  if (!nav._wired) {
    nav._wired = true;
    nav.container.addEventListener('click', (e) => {
      const it = e.target.closest('a,button,[role=tab]');
      if (it && !it.hasAttribute('data-o3-tab') && ws.el) closeWorkspace();
    }, true);
    const mo = new MutationObserver(debounce(() => {
      if (!nav.container.querySelector('[data-o3-tab]')) injectNav();
    }, 300));
    mo.observe(nav.container, { childList: true });
    ws.observers.push(mo);
  }
  markNav();
}
function markNav() {
  if (!ws.nav || !ws.nav.container) return;
  ws.nav.container.querySelectorAll('[data-o3-tab]').forEach((el) => {
    const on = el.getAttribute('data-o3-tab') === ws.tabId;
    el.setAttribute('aria-selected', on ? 'true' : 'false');
    const t = tabs.get(el.getAttribute('data-o3-tab'));
    el.style.boxShadow = on ? `inset 0 -3px 0 ${t ? t.color : '#0d9488'}` : '';
    el.style.fontWeight = on ? '700' : '';
  });
}

// ---- modo embutido (API) --------------------------------------------------------------------------------------
async function renderTabInto(target, tabOrBlueprint, opts = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) throw new Error('Container não encontrado');
  let tab = typeof tabOrBlueprint === 'string' ? tabs.get(tabOrBlueprint) || tabs.find(tabOrBlueprint) : tabs.get(tabOrBlueprint && tabOrBlueprint.id);
  if (!tab && tabOrBlueprint && typeof tabOrBlueprint === 'object') tab = await tabs.install(tabOrBlueprint, { overwrite: true });
  if (!tab) throw new Error('Aba não encontrada');
  const root = el.shadowRoot || el.attachShadow({ mode: 'open' });
  if (!el._o3) {
    adoptStyles(root);
    el._o3 = { view: h('div'), state: { subId: opts.subId || null, editing: false } };
    root.appendChild(el._o3.view);
    bus.on('tabs:changed', (d) => d && d.id === tab.id && renderTabView(el._o3.view, tabs.get(tab.id) || tab, el._o3.state, true));
  }
  renderTabView(el._o3.view, tab, el._o3.state, true);
  return tab;
}
