// ---------------------------------------------------------------------------
// 99 · Inicialização: localiza onde montar (substitui o painel antigo da IA),
//      restaura preferências e conversas, integra abas e dock, expõe a API.
// ---------------------------------------------------------------------------
function findLegacyPanel() {
  if (CFG.legacySelector) return document.querySelector(CFG.legacySelector);
  const inputs = [...document.querySelectorAll('input[placeholder],textarea[placeholder]')].filter((i) => /pergunte ou pe[cç]a|o que diz a nr|apr de trabalho em altura/i.test(i.placeholder) && !i.closest('#ops360-ia-v3'));
  for (const inp of inputs) {
    let n = inp.parentElement;
    for (let k = 0; k < 12 && n && n !== document.body; k++, n = n.parentElement) {
      const t = n.textContent || '';
      if (/OPS\s?360/i.test(t) && /(nova conversa|100% local)/i.test(t)) return n;
    }
  }
  return document.querySelector('[data-ops360-ia],#ops360-ia-legacy') || null;
}
function looksLikeOps360() {
  return /OPS\s?360/i.test(document.title) || !!findLegacyPanel() || !!document.querySelector('#ops360-ia,[data-ops360]') || /OPS\s?360/i.test((document.body && document.body.innerText.slice(0, 5000)) || '');
}
function resolveMount() {
  if (CFG.mount) {
    const el = typeof CFG.mount === 'string' ? document.querySelector(CFG.mount) : CFG.mount;
    if (el) return { mode: 'inside', el };
  }
  const box = document.querySelector('#ops360-ia');
  if (box) return { mode: 'inside', el: box };
  const legacy = CFG.replaceLegacy !== false ? findLegacyPanel() : null;
  if (legacy) return { mode: 'replace', el: legacy };
  return null;
}
function placeHost(target) {
  if (target.mode === 'inside') {
    target.el.appendChild(ui.host);
  } else if (target.mode === 'replace') {
    ui.legacy = target.el;
    target.el.parentElement.insertBefore(ui.host, target.el);
    ui.legacyDisplay = target.el.style.display;
    target.el.style.setProperty('display', 'none', 'important');
    target.el.setAttribute('data-o3-replaced', VERSION);
  }
}
function mountLauncher() {
  // Sem painel antigo nem container: botão flutuante que abre a Aurora numa janela
  const pop = h('div', { style: { position: 'fixed', left: '16px', bottom: '16px', width: 'min(1040px, calc(100vw - 32px))', display: 'none', zIndex: 8 } });
  const btn = h('button', { class: 'o3-dock', style: { left: '16px', right: 'auto', top: 'auto', bottom: '16px', transform: 'none', borderRadius: '999px', background: 'linear-gradient(135deg,#0f766e,#0b1322)', padding: '0 16px 0 8px', height: '52px' }, 'aria-label': 'Abrir a Aurora (OPS 360° IA)' }, logoSVG('o3-face'), h('span', { class: 'o3-dl', text: CFG.assistantName }));
  btn.firstChild.style.width = btn.firstChild.style.height = '36px';
  btn.addEventListener('click', () => {
    const open = pop.style.display === 'none';
    pop.style.display = open ? 'block' : 'none';
    btn.style.display = open ? 'none' : '';
    if (open) setTimeout(() => ui.els.ta.focus(), 50);
  });
  ui.layer.append(pop, btn);
  ui.launcher = { pop, btn };
  return pop;
}

let _booted = false;
async function boot() {
  if (_booted) return;
  _booted = true;
  await db.open();
  await kv.load(['ui.height', 'ui.side', 'ui.size', 'ui.chat', 'ui.font', 'dock.enabled', 'dock.y', 'dock.side', 'cfg.offline', 'cfg.proxies']);
  if (kv.get('cfg.offline') != null) CFG.strictOffline = !!kv.get('cfg.offline');
  if (Array.isArray(kv.get('cfg.proxies'))) CFG.proxies = kv.get('cfg.proxies');
  await memory.load();
  await chatStore.load();
  await tabs.load();
  mountOverlay();
  // espera o app renderizar o painel antigo (SPAs), por até 6 s
  let target = resolveMount();
  for (let i = 0; !target && i < 20; i++) {
    await sleep(300);
    target = resolveMount();
  }
  if (!target && IS_USERSCRIPT && !CFG.force && !looksLikeOps360()) {
    ui.ovHost.remove();
    return;
  }
  ui.host = h('div', { id: 'ops360-ia-v3', 'data-o3-protect': 'panel' });
  ui.root = ui.host.attachShadow({ mode: 'open' });
  adoptStyles(ui.root);
  ui.home = ui.root;
  if (target) placeHost(target);
  else {
    const pop = mountLauncher();
    const shadowHost = h('div');
    pop.appendChild(shadowHost);
    ui.root = shadowHost.attachShadow({ mode: 'open' });
    adoptStyles(ui.root);
    ui.home = ui.root;
    ui.host = shadowHost;
  }
  ui.root.appendChild(buildPanel());
  if (!target) ui.panel.style.setProperty('--o3-h', 'min(86vh, 900px)');
  const hgt = kv.get('ui.height');
  if (hgt) ui.panel.style.setProperty('--o3-h', clamp(hgt, 460, innerHeight * 0.97) + 'px');
  setSide(kv.get('ui.side', innerWidth >= 900));
  if (kv.get('ui.size') === 'expanded') setSize('expanded');
  applyFont();
  updateOnlinePill();
  renderChatList();
  const last = chatStore.get(kv.get('ui.chat')) || chatStore.list[0];
  if (last) await openChat(last.id);
  else await newChat({ greet: false });
  // reage a mudanças
  bus.on('tabs:changed', debounce(() => {
    injectNav();
    if (ws.el) renderWorkspace();
  }, 60));
  bus.on('status', (s) => setStatus(s));
  addEventListener('online', updateOnlinePill);
  addEventListener('offline', updateOnlinePill);
  setTimeout(injectNav, 400);
  setTimeout(injectNav, 2500);
  dock.init();
  // se o app re-renderizar e remover o painel, recoloca no lugar
  new MutationObserver(throttle(() => {
    if (ui.size === 'fullscreen' || !target) return;
    if (!ui.host.isConnected) {
      const t2 = resolveMount();
      if (t2) placeHost(t2);
    }
  }, 700)).observe(document.body, { childList: true, subtree: true });
  bus.emit('ready');
  log('OPS 360° IA v' + VERSION + ' pronto (' + db._mode + ')');
}

// ---- API pública -------------------------------------------------------------------------------------------
const API = {
  version: VERSION,
  config: CFG,
  ready: new Promise((res) => bus.on('ready', () => res(API))),
  open() {
    if (ui.launcher && ui.launcher.pop.style.display === 'none') ui.launcher.btn.click();
    else if (ui.host) ui.host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    ui.els.ta && ui.els.ta.focus();
  },
  ask: (text) => send(String(text)),
  newChat: () => newChat(),
  setSize: (m) => setSize(m),
  tabs: {
    list: () => deepClone(tabs.list),
    get: (id) => deepClone(tabs.get(id)),
    open: (id, subId) => openWorkspace((tabs.get(id) || tabs.find(id) || {}).id, subId),
    close: () => closeWorkspace(),
    install: async (bp, o) => {
      const t = await tabs.install(bp, o);
      injectNav();
      return deepClone(t);
    },
    remove: (id) => tabs.remove(id),
    exportPackage: (id) => exportTabNow(id),
    renderInto: (el, tab, o) => renderTabInto(el, tab, o),
    replay: (base, history) => replayTabOps(base, history),
    blueprintSchema: TAB_SCHEMA,
  },
  memory: { get: () => deepClone(memory.data), export: () => memory.export(), import: (j) => memory.import(j), clear: () => memory.clear() },
  docs: {
    generate(type, { atividade, params = {}, texto = '' } = {}) {
      const acts = atividade ? findActivities(atividade) : [];
      const act = acts.length ? mergeActivities(acts) : genericActivity(atividade || '');
      return GENERATORS[type]({ text: texto || atividade || '', act, acts, actDetected: acts.length > 0, params, profile: memory.profile, photos: [] }).doc;
    },
    download: (doc, fmt = 'pdf') => downloadDoc(doc, fmt),
    toPDF: docToPDF, toDOCX: docToDOCX, toXLSX: docToXLSX, toHTML: renderDocHTML,
    types: () => Object.keys(DOC_TYPES_GEN),
  },
  read: (file) => readFileRecord(file),
  readSite: (url) => readSite(url),
  registerFetcher(fn) {
    CFG.fetcher = fn;
  },
  dock: { enable: () => (kv.set('dock.enabled', true), dock.init(true)), disable: () => (kv.set('dock.enabled', false), dock.destroy()), reset: () => (kv.set('dock.y', null), kv.set('dock.side', 'right'), dock.destroy(), dock.init(true)) },
  restoreLegacy() {
    if (ui.legacy) {
      ui.legacy.style.display = ui.legacyDisplay || '';
      ui.legacy.removeAttribute('data-o3-replaced');
    }
    ui.host && ui.host.remove();
    closeWorkspace();
    dock.destroy();
  },
  _internals: { classify, aiRespond, tabs, memory, chatStore, fileStore, docStore, readFileRecord, analyzeDoc, docToPDF, docToDOCX, docToXLSX, renderDocHTML, readSite, parseSiteDoc, findActivities, GENERATORS, ui, ws, dock, db, kv, evalFormula, resolveChart, resolveKpi, zipRead, zipWrite, pdfExtractNative, send, openWorkspace, closeWorkspace, exportTabPackage, renderTabStatic, injectNav },
};
PAGE.OPS360IA = API;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot().catch((e) => console.error('[OPS360IA] falha ao iniciar', e)));
else boot().catch((e) => console.error('[OPS360IA] falha ao iniciar', e));
