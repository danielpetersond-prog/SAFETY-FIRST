// ---------------------------------------------------------------------------
// 23 · Interface do chat: painel maior e redimensionável, modos expandido e
//      tela cheia, várias conversas, anexos com instrução, cartões e modais.
// ---------------------------------------------------------------------------
const ui = {
  host: null, root: null, panel: null, ovHost: null, ov: null, layer: null,
  chat: null, staged: [], busy: false, size: 'normal', sideOpen: true, fsWrap: null,
  els: {},
};

// ---- ícones SVG -------------------------------------------------------------------------------
function logoSVG(cls = 'o3-logo') {
  const s = svgEl('svg', { viewBox: '0 0 56 56', class: cls, 'aria-hidden': 'true' });
  s.innerHTML = '<defs><linearGradient id="o3g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#99f6e4"/><stop offset="1" stop-color="#14b8a6"/></linearGradient></defs><circle cx="28" cy="28" r="23" fill="#0b1a24" stroke="rgba(45,212,191,.28)" stroke-width="4"/><path d="M28 5 A23 23 0 1 1 7.2 38" fill="none" stroke="url(#o3g)" stroke-width="4.5" stroke-linecap="round"/><circle cx="7.4" cy="17.5" r="4" fill="#5eead4"/><circle cx="28" cy="28" r="4.6" fill="#ccfbf1"/>';
  return s;
}
function faceSVG() {
  const s = svgEl('svg', { viewBox: '0 0 32 32', class: 'o3-face', 'aria-hidden': 'true' });
  s.innerHTML = '<circle cx="11" cy="13" r="2.4" fill="#0f3b38"/><circle cx="21" cy="13" r="2.4" fill="#0f3b38"/><path d="M9.5 19c3.6 4.2 9.4 4.2 13 0" fill="none" stroke="#0f3b38" stroke-width="2.4" stroke-linecap="round"/>';
  return s;
}
const ICON = {
  send: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clip: '<svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><path d="M8.5 12.5l6.6-6.6a3.2 3.2 0 014.5 4.5l-8.3 8.3a5 5 0 01-7.1-7.1l7.7-7.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
const iconEl = (k) => {
  const d = document.createElement('span');
  d.style.display = 'inline-grid';
  d.innerHTML = ICON[k];
  return d;
};

// ---- markdown seguro -----------------------------------------------------------------------------
function mdInlineSafe(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}
function mdToHtml(src) {
  const lines = esc(src).split('\n');
  let out = '', list = null, quote = [];
  const flushList = () => {
    if (list) out += `</${list}>`;
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out += `<blockquote>${quote.map(mdInlineSafe).join('<br>')}</blockquote>`;
    quote = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flushList();
      flushQuote();
      let code = '';
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code += lines[i++] + '\n';
      out += `<pre>${code}</pre>`;
      continue;
    }
    let m;
    if ((m = /^&gt;\s?(.*)$/.exec(l))) {
      flushList();
      quote.push(m[1]);
      continue;
    }
    flushQuote();
    if ((m = /^\s*(?:[•\-*]|◦)\s+(.*)$/.exec(l))) {
      if (list !== 'ul') {
        flushList();
        out += '<ul>';
        list = 'ul';
      }
      out += `<li>${mdInlineSafe(m[1])}</li>`;
    } else if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(l))) {
      if (list !== 'ol') {
        flushList();
        out += `<ol start="${m[1]}">`;
        list = 'ol';
      }
      out += `<li>${mdInlineSafe(m[2])}</li>`;
    } else if (!l.trim()) {
      flushList();
    } else {
      flushList();
      out += `<p>${mdInlineSafe(l)}</p>`;
    }
  }
  flushList();
  flushQuote();
  return out;
}

// ---- utilidades de interface -----------------------------------------------------------------------
function toast(text, { action, onAction, ms = 3800 } = {}) {
  if (!ui.layer) return;
  let box = ui.layer.querySelector('.o3-toasts');
  if (!box) ui.layer.appendChild((box = h('div', { class: 'o3-toasts', 'aria-live': 'polite' })));
  const t = h('div', { class: 'o3-toast' }, h('span', { text }), action ? h('button', { onclick: () => (onAction && onAction(), t.remove()), text: action }) : null);
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function openMenu(x, y, items) {
  closeMenu();
  const m = h('div', { class: 'o3-menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') m.appendChild(h('hr'));
    else m.appendChild(h('button', { role: 'menuitem', onclick: () => (closeMenu(), it.run()) }, it.icon ? h('span', { text: it.icon }) : null, h('span', { text: it.label })));
  }
  ui.layer.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = clamp(x, 6, innerWidth - r.width - 6) + 'px';
  m.style.top = clamp(y, 6, innerHeight - r.height - 6) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', ui._menuAway = (e) => { if (!e.composedPath().includes(m)) closeMenu(); }, true), 0);
  m.querySelector('button') && m.querySelector('button').focus();
}
function closeMenu() {
  ui.layer && ui.layer.querySelectorAll('.o3-menu').forEach((m) => m.remove());
  if (ui._menuAway) document.removeEventListener('pointerdown', ui._menuAway, true);
}
function openModal({ title, body, footer = [], size = '', onClose }) {
  const bg = h('div', { class: 'o3-modal-bg', onclick: (e) => e.target === bg && close() });
  const md = h('div', { class: 'o3-modal ' + (size === 'sm' ? 'o3-sm' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => {
    bg.remove();
    document.removeEventListener('keydown', esc1, true);
    onClose && onClose();
  };
  const esc1 = (e) => e.key === 'Escape' && (e.stopPropagation(), close());
  md.appendChild(h('div', { class: 'o3-mh' }, h('h2', { text: title }), h('button', { class: 'o3-ib', 'aria-label': 'Fechar', onclick: close, text: '✕' })));
  md.appendChild(h('div', { class: 'o3-mb' }, body));
  if (footer.length) md.appendChild(h('div', { class: 'o3-mf' }, footer));
  bg.appendChild(md);
  ui.layer.appendChild(bg);
  document.addEventListener('keydown', esc1, true);
  setTimeout(() => {
    const f = md.querySelector('input,textarea,select,button.o3-primary');
    f && f.focus();
  }, 30);
  return { close, el: md };
}
function confirmBox(text, okLabel = 'Confirmar') {
  return new Promise((res) => {
    const m = openModal({ title: 'Confirmar', size: 'sm', body: h('p', { text }), footer: [h('button', { class: 'o3-btn', onclick: () => (m.close(), res(false)), text: 'Cancelar' }), h('button', { class: 'o3-btn o3-primary', onclick: () => (m.close(), res(true)), text: okLabel })], onClose: () => res(false) });
  });
}

// ---- montagem ------------------------------------------------------------------------------------------
function mountOverlay() {
  ui.ovHost = h('div', { id: 'ops360-ia-v3-overlay', 'data-o3': 'overlay' });
  document.body.appendChild(ui.ovHost);
  ui.ov = ui.ovHost.attachShadow({ mode: 'open' });
  adoptStyles(ui.ov);
  ui.layer = h('div', { class: 'o3-ov o3-root' });
  ui.layer.style.setProperty('--o3-z', CFG.zIndex);
  ui.ov.appendChild(ui.layer);
}
function buildPanel() {
  const E = ui.els;
  E.status = h('span', { class: 'o3-pill', title: 'Tudo roda no seu navegador. Recursos de internet (sites, OCR) só são usados quando você pede.' }, h('i'), h('span', { text: '100% local · offline' }));
  E.btnSide = h('button', { class: 'o3-ib', title: 'Mostrar/ocultar conversas', 'aria-label': 'Conversas', onclick: () => setSide(!ui.sideOpen), text: '☰' });
  E.btnTabs = h('button', { class: 'o3-btn', title: 'Abas criadas pela IA', onclick: openTabsManager }, '🗂️', h('span', { text: 'Abas' }));
  E.btnNew = h('button', { class: 'o3-btn', onclick: () => newChat(), text: 'Nova conversa' });
  E.btnExp = h('button', { class: 'o3-ib', title: 'Expandir janela (maior)', 'aria-label': 'Expandir', onclick: () => setSize(ui.size === 'expanded' ? 'normal' : 'expanded'), text: '⤢' });
  E.btnFs = h('button', { class: 'o3-ib', title: 'Tela cheia (Esc para sair)', 'aria-label': 'Tela cheia', onclick: () => setSize(ui.size === 'fullscreen' ? 'normal' : 'fullscreen'), text: '⛶' });
  E.btnSet = h('button', { class: 'o3-ib', title: 'Configurações', 'aria-label': 'Configurações', onclick: openSettings, text: '⚙' });
  const head = h('div', { class: 'o3-head' }, E.btnSide, logoSVG(), h('div', { class: 'o3-brand' }, h('div', {}, h('h1', {}, 'OPS', h('span', { text: '360°' }))), h('span', { class: 'o3-badge', text: 'IA' })), h('div', { class: 'o3-head-r' }, E.status, E.btnTabs, E.btnNew, E.btnExp, E.btnFs, E.btnSet));
  // lateral
  E.search = h('input', { class: 'o3-search', type: 'search', placeholder: '🔎 Buscar conversas…', oninput: () => renderChatList() });
  E.chats = h('div', { class: 'o3-chats', role: 'list' });
  E.side = h(
    'aside',
    { class: 'o3-side', 'aria-label': 'Conversas' },
    h('div', { class: 'o3-side-top' }, h('button', { class: 'o3-btn o3-primary', style: { justifyContent: 'center' }, onclick: () => newChat() }, '＋', h('span', { text: 'Nova conversa' })), E.search),
    E.chats,
    h('div', { class: 'o3-side-foot' }, h('button', { class: 'o3-btn', onclick: openMemory, title: 'O que a Aurora aprendeu' }, '🧠', h('span', { text: 'Memória' })), h('button', { class: 'o3-btn', onclick: openTabsManager }, '🗂️', h('span', { text: 'Abas' })))
  );
  // principal
  E.title = h('input', { class: 'o3-ctitle', 'aria-label': 'Título da conversa', onchange: () => renameChat(ui.chat, E.title.value), onkeydown: (e) => e.key === 'Enter' && E.title.blur() });
  E.chatMenu = h('button', { class: 'o3-ib', title: 'Opções da conversa', 'aria-label': 'Opções da conversa', text: '⋯', onclick: (e) => chatMenu(ui.chat, e) });
  E.ctx = h('div', { class: 'o3-ctx', 'aria-label': 'Documentos em contexto' });
  E.msgs = h('div', { class: 'o3-msgs', role: 'log', 'aria-live': 'polite' });
  E.statusLine = h('div', { class: 'o3-status' });
  E.tray = h('div', { class: 'o3-tray' });
  E.ta = h('textarea', { class: 'o3-ta', rows: 1, placeholder: 'Pergunte ou peça — ex.: "APR de trabalho em altura em PDF", "o que diz a NR-12?"', 'aria-label': 'Mensagem para a Aurora' });
  E.file = h('input', { type: 'file', multiple: true, hidden: true, accept: '.pdf,.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.odt,.ods,.odp,.csv,.tsv,.txt,.md,.json,.html,.htm,.xml,.rtf,image/*' });
  E.attach = h('button', { class: 'o3-attach', title: 'Anexar arquivos ou fotos (você escreve a instrução antes de enviar)', 'aria-label': 'Anexar', onclick: () => E.file.click() }, iconEl('clip'));
  E.send = h('button', { class: 'o3-send', title: 'Enviar (Enter)', 'aria-label': 'Enviar', onclick: () => send() }, iconEl('send'));
  E.slash = h('div', { class: 'o3-slash', hidden: true, role: 'listbox' });
  E.comp = h('div', { class: 'o3-comp' }, E.ta, E.attach, E.send);
  const hint = h('div', { class: 'o3-hint' }, h('span', { text: 'Enter envia · Shift+Enter quebra linha' }), h('span', { text: '📎 anexe e escreva o que quer antes de enviar' }), h('span', { text: '/ atalhos' }));
  E.drop = h('div', { class: 'o3-drop' }, h('div', {}, h('div', { style: { fontSize: '34px' }, text: '📎' }), h('b', { text: 'Solte os arquivos aqui' }), h('div', { style: { fontSize: '13px', opacity: 0.8 }, text: 'Eles ficam anexados — escreva sua instrução e envie quando quiser.' })));
  E.main = h('section', { class: 'o3-main' }, h('div', { class: 'o3-chatbar' }, E.title, E.chatMenu), E.ctx, E.msgs, E.statusLine, h('div', { class: 'o3-comp-wrap', style: { position: 'relative' } }, E.slash, E.tray, E.comp, hint), E.file, E.drop);
  E.resize = h('div', { class: 'o3-resize', title: 'Arraste para redimensionar · duplo clique para restaurar', role: 'separator', 'aria-orientation': 'horizontal' });
  ui.panel = h('div', { class: 'o3-panel o3-root', 'data-o3-protect': 'panel' }, head, h('div', { class: 'o3-body' }, E.side, E.main), E.resize);
  wireComposer();
  wireResize();
  return ui.panel;
}

function wireComposer() {
  const E = ui.els;
  const autosize = () => {
    E.ta.style.height = 'auto';
    E.ta.style.height = Math.min(210, E.ta.scrollHeight) + 'px';
  };
  E.ta.addEventListener('input', () => {
    ui.lastKey = Date.now();
    autosize();
    updateSlash();
    updateSendState();
  });
  E.ta.addEventListener('keydown', (e) => {
    if (!E.slash.hidden && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return slashKey(e);
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  E.ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.files : [])];
    if (files.length) {
      e.preventDefault();
      stageFiles(files);
    }
  });
  E.file.addEventListener('change', () => {
    stageFiles([...E.file.files]);
    E.file.value = '';
  });
  let depth = 0;
  const panel = ui.panel;
  panel.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer ? e.dataTransfer.types : [])].includes('Files')) return;
    e.preventDefault();
    depth++;
    E.drop.classList.add('o3-show');
  });
  panel.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer ? e.dataTransfer.types : [])].includes('Files')) e.preventDefault();
  });
  panel.addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      E.drop.classList.remove('o3-show');
    }
  });
  panel.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    depth = 0;
    E.drop.classList.remove('o3-show');
    if (files.length) {
      e.preventDefault();
      stageFiles(files);
    }
  });
  updateSendState();
}
function updateSendState() {
  const E = ui.els;
  E.send.disabled = ui.busy || (!E.ta.value.trim() && !ui.staged.length);
}
function wireResize() {
  const r = ui.els.resize;
  let y0 = 0, h0 = 0;
  r.addEventListener('pointerdown', (e) => {
    y0 = e.clientY;
    h0 = ui.panel.getBoundingClientRect().height;
    r.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const nh = clamp(h0 + ev.clientY - y0, 460, innerHeight * 0.97);
      ui.panel.style.setProperty('--o3-h', nh + 'px');
    };
    const up = () => {
      r.removeEventListener('pointermove', move);
      r.removeEventListener('pointerup', up);
      kv.set('ui.height', Math.round(ui.panel.getBoundingClientRect().height));
    };
    r.addEventListener('pointermove', move);
    r.addEventListener('pointerup', up);
  });
  r.addEventListener('dblclick', () => {
    ui.panel.style.removeProperty('--o3-h');
    kv.set('ui.height', null);
  });
}
function setSide(open) {
  ui.sideOpen = open;
  ui.els.side.classList.toggle('o3-hidden', !open);
  ui.els.btnSide.classList.toggle('o3-on', open);
  kv.set('ui.side', open);
}
function setSize(mode) {
  const p = ui.panel;
  if (ui.size === 'fullscreen' && mode !== 'fullscreen') {
    p.classList.remove('o3-fullscreen');
    ui.home.appendChild(p);
    ui.fsWrap && ui.fsWrap.remove();
    ui.fsWrap = null;
    document.removeEventListener('keydown', ui._fsEsc, true);
    document.documentElement.style.overflow = ui._oldOverflow || '';
  }
  p.classList.toggle('o3-expanded', mode === 'expanded');
  if (mode === 'fullscreen' && ui.size !== 'fullscreen') {
    ui.fsWrap = h('div', { class: 'o3-fs' });
    ui.layer.appendChild(ui.fsWrap);
    ui.fsWrap.appendChild(p);
    p.classList.add('o3-fullscreen');
    ui._oldOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    ui._fsEsc = (e) => {
      if (e.key === 'Escape' && !ui.layer.querySelector('.o3-modal-bg')) setSize('normal');
    };
    document.addEventListener('keydown', ui._fsEsc, true);
  }
  ui.size = mode;
  ui.els.btnExp.classList.toggle('o3-on', mode === 'expanded');
  ui.els.btnFs.classList.toggle('o3-on', mode === 'fullscreen');
  if (mode !== 'fullscreen') kv.set('ui.size', mode);
  bus.emit('ui:size', mode);
  scrollBottom();
  setTimeout(() => ui.els.ta.focus(), 50);
}
function setStatus(text) {
  ui.els.statusLine.textContent = text || '';
}

// ---- conversas -----------------------------------------------------------------------------------------
function groupOf(c) {
  if (c.pinned) return 'Fixadas';
  const d = daysBetween(new Date(c.updatedAt), new Date());
  return d <= 0 ? 'Hoje' : d === 1 ? 'Ontem' : d <= 7 ? 'Últimos 7 dias' : 'Mais antigas';
}
function renderChatList() {
  const E = ui.els;
  const q = norm(E.search.value);
  E.chats.textContent = '';
  const list = chatStore.list.filter((c) => !q || norm(c.title).includes(q) || c.messages.some((m) => norm(messageText(m)).includes(q)));
  const order = ['Fixadas', 'Hoje', 'Ontem', 'Últimos 7 dias', 'Mais antigas'];
  for (const g of order) {
    const items = list.filter((c) => groupOf(c) === g);
    if (!items.length) continue;
    E.chats.appendChild(h('div', { class: 'o3-grp', text: g }));
    for (const c of items) {
      const b = h(
        'div',
        { class: 'o3-chat' + (ui.chat && c.id === ui.chat.id ? ' o3-active' : ''), role: 'listitem', tabindex: 0, title: c.title, onclick: () => openChat(c.id), onkeydown: (e) => e.key === 'Enter' && openChat(c.id), oncontextmenu: (e) => (e.preventDefault(), chatMenu(c, e)) },
        c.pinned ? h('span', { class: 'o3-pin', text: '📌' }) : null,
        h('span', { class: 'o3-ct', text: c.title }),
        h('button', { class: 'o3-cm', 'aria-label': 'Opções', text: '⋯', onclick: (e) => (e.stopPropagation(), chatMenu(c, e)) })
      );
      E.chats.appendChild(b);
    }
  }
  if (!list.length) E.chats.appendChild(h('div', { class: 'o3-grp', text: q ? 'Nada encontrado' : 'Nenhuma conversa' }));
}
function chatMenu(c, e) {
  if (!c) return;
  const r = e.currentTarget ? e.currentTarget.getBoundingClientRect() : { left: e.clientX, bottom: e.clientY };
  openMenu(r.left, r.bottom + 4, [
    { icon: '✏️', label: 'Renomear', run: () => {
      const inp = h('input', { value: c.title });
      const m = openModal({ title: 'Renomear conversa', size: 'sm', body: h('div', { class: 'o3-field' }, h('span', { text: 'Título' }), inp), footer: [h('button', { class: 'o3-btn o3-primary', onclick: () => (renameChat(c, inp.value), m.close()), text: 'Salvar' })] });
      inp.addEventListener('keydown', (ev) => ev.key === 'Enter' && (renameChat(c, inp.value), m.close()));
    } },
    { icon: c.pinned ? '📍' : '📌', label: c.pinned ? 'Desafixar' : 'Fixar no topo', run: async () => {
      c.pinned = !c.pinned;
      await chatStore.save(c);
      renderChatList();
    } },
    { icon: '📝', label: 'Exportar conversa (Markdown)', run: () => exportChat(c, 'md') },
    { icon: '📄', label: 'Exportar conversa (PDF)', run: () => exportChat(c, 'pdf') },
    '-',
    { icon: '🗑️', label: 'Excluir conversa', run: () => deleteChat(c) },
  ]);
}
async function renameChat(c, title) {
  if (!c || !title.trim()) return;
  c.title = truncate(title.trim(), 80);
  c.autoTitle = false;
  await chatStore.save(c);
  if (ui.chat && ui.chat.id === c.id) ui.els.title.value = c.title;
  renderChatList();
}
async function deleteChat(c) {
  const snapshot = deepClone(c);
  await chatStore.remove(c.id);
  if (ui.chat && ui.chat.id === c.id) {
    if (chatStore.list.length) openChat(chatStore.list[0].id);
    else newChat();
  }
  renderChatList();
  toast('Conversa excluída.', {
    action: 'Desfazer',
    onAction: async () => {
      chatStore.list.unshift(snapshot);
      await chatStore.save(snapshot);
      openChat(snapshot.id);
    },
    ms: 6500,
  });
}
async function exportChat(c, fmt) {
  if (fmt === 'md') {
    const md = [`# ${c.title}`, `_Exportado do OPS 360° IA em ${fmtDateTime(new Date())}_`, ''];
    for (const m of c.messages) md.push(`**${m.role === 'user' ? memory.profile.name || 'Você' : CFG.assistantName}** · ${fmtDateTime(m.at)}`, '', messageText(m) || '(anexo/documento)', '');
    downloadBlob(new Blob([md.join('\n')], { type: 'text/markdown' }), `conversa-${slug(c.title)}.md`);
    return;
  }
  const doc = newDoc('chat', 'Conversa — ' + c.title, { subtitle: `${c.messages.length} mensagens`, company: memory.profile.company || '' });
  for (const m of c.messages) {
    doc.blocks.push({ t: 'h', level: 2, text: `${m.role === 'user' ? memory.profile.name || 'Você' : CFG.assistantName} · ${fmtDateTime(m.at)}` });
    const txt = messageText(m) || '(anexo/documento)';
    doc.blocks.push({ t: 'p', text: txt.replace(/^[•\-]\s/gm, '• ') });
  }
  downloadBlob(await docToPDF(doc), `conversa-${slug(c.title)}.pdf`);
}
async function newChat(opts = {}) {
  const c = chatStore.create();
  await chatStore.save(c);
  await openChat(c.id, { greet: opts.greet !== false });
  ui.els.ta.focus();
  return c;
}
async function openChat(id, { greet = false } = {}) {
  const c = chatStore.get(id);
  if (!c) return;
  ui.chat = c;
  kv.set('ui.chat', id);
  ui.els.title.value = c.title;
  renderMessages();
  renderContext();
  renderChatList();
  if (innerWidth < 900) setSide(false);
}
function uiState() {
  return { currentTabId: ws.tabId, currentSubId: ws.subId, workspaceOpen: !!ws.el };
}

// ---- contexto de documentos -------------------------------------------------------------------------
async function renderContext() {
  const E = ui.els;
  E.ctx.textContent = '';
  const ids = (ui.chat && ui.chat.state.activeFiles) || [];
  for (const id of ids) {
    const f = await fileStore.get(id);
    if (!f) continue;
    E.ctx.appendChild(h('span', { class: 'o3-ctxc', title: 'Documento em contexto: a Aurora usa este arquivo para responder' }, h('span', { text: (KIND_ICON[f.kind] || '📎') + ' ' + f.name }), h('button', { 'aria-label': 'Remover do contexto', text: '✕', onclick: () => removeFromContext(id) })));
  }
}
async function removeFromContext(id) {
  ui.chat.state.activeFiles = ui.chat.state.activeFiles.filter((x) => x !== id);
  await chatStore.save(ui.chat);
  renderContext();
}

// ---- anexos (ficam na bandeja até o envio) ------------------------------------------------------
function stageFiles(files) {
  for (const f of files.slice(0, 12)) {
    const st = { id: uid('st'), file: f, rec: null, status: 'reading', note: 'lendo…' };
    ui.staged.push(st);
    st.promise = readFileRecord(f, (msg) => {
      st.note = msg;
      renderTray();
    })
      .then(async (rec) => {
        st.rec = rec;
        st.status = rec.warnings.length && !rec.text && rec.kind !== 'image' ? 'warn' : 'ready';
        const a = rec.analysis || {};
        st.note = rec.kind === 'image' ? `${rec.image ? rec.image.width + '×' + rec.image.height : ''}` : [a.typeLabel && a.typeLabel !== 'Documento geral' ? a.typeLabel.split(' (')[0] : KIND_LABEL[rec.kind], rec.meta.pageCount ? rec.meta.pageCount + ' pág.' : rec.meta.sheetCount ? rec.meta.sheetCount + ' aba(s)' : ''].filter(Boolean).join(' · ');
        await fileStore.put(rec);
        renderTray();
      })
      .catch((e) => {
        st.status = 'error';
        st.note = 'não foi possível ler';
        renderTray();
      });
  }
  renderTray();
  updateSendState();
  ui.els.ta.focus();
  if (files.length) setStatus('Arquivo anexado — escreva o que você quer que eu faça e envie.');
}
function renderTray() {
  const E = ui.els;
  E.tray.textContent = '';
  for (const st of ui.staged) {
    const isImg = /^image\//.test(st.file.type);
    const thumb = st.rec && st.rec.image ? h('img', { src: st.rec.image.thumb, alt: '' }) : document.createTextNode(isImg ? '🖼️' : KIND_ICON[fileKind(st.file.name, st.file.type)] || '📎');
    E.tray.appendChild(
      h('div', { class: 'o3-att' + (st.status === 'reading' ? ' o3-busy' : ''), title: st.file.name }, h('span', { class: 'o3-ati' }, thumb), h('span', { class: 'o3-atn' }, h('b', { text: st.file.name }), h('span', { text: st.status === 'error' ? '⚠️ ' + st.note : `${humanSize(st.file.size)}${st.note ? ' · ' + st.note : ''}` })), h('button', { class: 'o3-atx', 'aria-label': 'Remover anexo', text: '✕', onclick: () => ((ui.staged = ui.staged.filter((x) => x !== st)), renderTray(), updateSendState()) }))
    );
  }
}

// ---- envio --------------------------------------------------------------------------------------------------
async function send(textArg, meta = {}) {
  const E = ui.els;
  if (ui.busy) return;
  const text = textArg != null ? String(textArg) : E.ta.value.trim();
  const staged = textArg != null ? [] : ui.staged.slice();
  if (!text && !staged.length) return;
  if (!ui.chat) await newChat({ greet: false });
  ui.busy = true;
  updateSendState();
  if (textArg == null) {
    E.ta.value = '';
    E.ta.style.height = 'auto';
    ui.staged = [];
    renderTray();
  }
  hideSlash();
  const chat = ui.chat;
  const userMsg = { id: uid('m'), role: 'user', at: Date.now(), text, fileIds: [], fileNames: staged.map((s) => s.file.name) };
  const welcome = E.msgs.querySelector('.o3-welcome');
  if (welcome && memory.profile.name) welcome.remove();
  chat.messages.push(userMsg);
  appendMessage(userMsg, staged);
  const typing = appendTyping();
  if (staged.some((s) => s.status === 'reading')) setStatus('Terminando de ler os anexos…');
  const recs = [];
  for (const s of staged) {
    try {
      await s.promise;
    } catch (e) {}
    if (s.rec) recs.push(s.rec);
  }
  userMsg.fileIds = recs.map((r) => r.id);
  for (const r of recs) if (r.kind !== 'heic') chat.state.activeFiles = uniq([...(chat.state.activeFiles || []), r.id]).slice(-6);
  renderContext();
  setStatus('');
  const t0 = Date.now();
  let r;
  try {
    r = await aiRespond(chat, { text, files: recs, meta }, uiState());
  } catch (e) {
    r = { parts: [P.md('Ops, algo deu errado 😕 ' + e.message)], intent: 'error', effects: {} };
  }
  await sleep(Math.max(0, 260 - (Date.now() - t0)));
  typing.remove();
  const aiMsg = { id: uid('m'), role: 'assistant', at: Date.now(), parts: r.parts, intent: r.intent };
  chat.messages.push(aiMsg);
  await chatStore.save(chat);
  appendMessage(aiMsg, null, true);
  ui.els.title.value = chat.title;
  renderChatList();
  ui.busy = false;
  updateSendState();
  setStatus('');
  handleEffects(r.effects || {});
  if (textArg == null) E.ta.focus();
  return aiMsg;
}
function handleEffects(fx) {
  if (fx.openTab && fx.openTab.tabId) openWorkspace(fx.openTab.tabId, fx.openTab.subId);
  if (fx.exportTab) exportTabNow(fx.exportTab);
}

// ---- mensagens ----------------------------------------------------------------------------------------------
function renderMessages() {
  const E = ui.els;
  E.msgs.textContent = '';
  if (!ui.chat.messages.length) renderWelcome();
  for (const m of ui.chat.messages) appendMessage(m);
  scrollBottom(true);
}
// Tela de boas-vindas das conversas vazias (não é salva como mensagem)
function renderWelcome() {
  const E = ui.els;
  const n = memory.profile.name;
  if (!n) ui.chat.state.pending = { kind: 'ask_name' };
  const tiles = [
    ['📄', 'Documentos sob medida', 'APR, PT, DDS, checklist, OS, ficha de EPI, inspeção com fotos, 5W2H…', 'Faz uma APR de trabalho em altura'],
    ['📎', 'Leia meus arquivos', 'Anexe PDF, Word, Excel ou fotos, escreva o que quer e envie.', null],
    ['🗂️', 'Crie abas no OPS 360°', 'Indicadores, controles, gráficos e formulários — até a partir de sites.', 'Crie uma aba de indicadores de segurança'],
    ['🧠', 'Eu aprendo com você', 'Lembro suas preferências, anotações e conversas anteriores.', 'O que você sabe sobre mim?'],
  ];
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: '10px', marginTop: '14px' } });
  for (const [ic, t1, t2, sendTxt] of tiles)
    grid.appendChild(h('button', { class: 'o3-card', style: { textAlign: 'left', cursor: 'pointer' }, onclick: () => (sendTxt ? send(sendTxt) : ui.els.file.click()) }, h('div', { class: 'o3-ci', text: ic }), h('div', { class: 'o3-cb' }, h('div', { class: 'o3-ct1', text: t1 }), h('div', { class: 'o3-ct2', text: t2 }))));
  const chips = h('div', { class: 'o3-chips', style: { marginTop: '12px' } });
  for (const c of greetingChips()) chips.appendChild(h('button', { class: 'o3-chip', onclick: () => chipClick(c), text: c.label }));
  const bub = h('div', { class: 'o3-bub o3-md' });
  bub.insertAdjacentHTML('beforeend', mdToHtml(n ? `${greetingByHour()}, ${n}! Em que posso ajudar na segurança hoje?` : `${greetingByHour()}! 👋 Eu sou a **${CFG.assistantName}**, a IA de segurança do OPS 360°. Funciono 100% no seu navegador e aprendo com as nossas conversas.\nComo posso te chamar?`));
  if (n) bub.appendChild(chips);
  const col = h('div', { class: 'o3-ai-col', style: { maxWidth: '100%' } }, bub, n ? grid : null);
  E.msgs.appendChild(h('div', { class: 'o3-msg o3-ai o3-welcome' }, h('div', { class: 'o3-av' }, faceSVG()), col));
}
function scrollBottom(instant) {
  const el = ui.els.msgs;
  if (!el) return;
  if (instant) el.style.scrollBehavior = 'auto';
  el.scrollTop = el.scrollHeight;
  if (instant) el.style.scrollBehavior = '';
}
function appendTyping() {
  const el = h('div', { class: 'o3-msg o3-ai' }, h('div', { class: 'o3-av' }, faceSVG()), h('div', { class: 'o3-bub', 'aria-label': 'Aurora está digitando' }, h('span', { class: 'o3-typing' }, h('i'), h('i'), h('i'))));
  ui.els.msgs.appendChild(el);
  scrollBottom();
  return el;
}
function appendMessage(m, staged, live = false) {
  const E = ui.els;
  if (m.role === 'user') {
    const bub = h('div', { class: 'o3-bub' });
    if (m.text) bub.appendChild(document.createTextNode(m.text));
    const names = m.fileNames || [];
    if (names.length) {
      const row = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: m.text ? '8px' : 0 } });
      names.forEach((n, i) => {
        const st = staged && staged[i];
        const img = st && st.rec && st.rec.image ? h('img', { src: st.rec.image.thumb, alt: n, style: { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', border: '1px solid rgba(255,255,255,.2)' } }) : null;
        row.appendChild(img || h('span', { class: 'o3-ctxc', text: '📎 ' + n }));
      });
      bub.appendChild(row);
    }
    E.msgs.appendChild(h('div', { class: 'o3-msg o3-user' }, h('div', {}, bub, h('div', { class: 'o3-meta', text: fmtDateTime(m.at).slice(-5) }))));
    scrollBottom();
    return;
  }
  const col = h('div', { class: 'o3-ai-col' });
  let bub = null;
  const ensureBub = () => bub || col.appendChild((bub = h('div', { class: 'o3-bub o3-md' })));
  for (const p of m.parts || []) {
    if (p.type === 'md') {
      ensureBub().insertAdjacentHTML('beforeend', mdToHtml(p.text));
    } else if (p.type === 'chips') {
      if (!p.items.length) continue;
      const row = h('div', { class: 'o3-chips', style: { marginTop: bub ? '12px' : '2px' } });
      for (const c of p.items) row.appendChild(h('button', { class: 'o3-chip', onclick: () => chipClick(c), text: c.label }));
      // depois de um cartão, as sugestões ficam soltas (sem balão)
      (bub || col).appendChild(row);
    } else {
      bub = null;
      const card = renderPartCard(p, m, live);
      if (card) col.appendChild(card);
    }
  }
  const acts = h('div', { class: 'o3-acts' });
  if (!m.auto) {
    acts.appendChild(h('button', { title: 'Copiar resposta', 'aria-label': 'Copiar', text: '📋', onclick: async () => (await copyText(messageText(m)), toast('Copiado!')) }));
    const up = h('button', { title: 'Resposta útil', 'aria-label': 'Gostei', text: '👍', class: m.feedback === 1 ? 'o3-on' : '', onclick: () => feedback(m, 1, up, down) });
    const down = h('button', { title: 'Não ajudou', 'aria-label': 'Não gostei', text: '👎', class: m.feedback === -1 ? 'o3-on' : '', onclick: () => feedback(m, -1, up, down) });
    acts.append(up, down);
    if (dock.available()) acts.appendChild(h('button', { title: 'Copiar e abrir o Slack', 'aria-label': 'Enviar ao Slack', text: '💬 Slack', onclick: async () => (await copyText(messageText(m)), dock.openSlack(), toast('Texto copiado — cole no Slack.')) }));
  }
  col.appendChild(acts);
  E.msgs.appendChild(h('div', { class: 'o3-msg o3-ai' }, h('div', { class: 'o3-av' }, faceSVG()), col));
  scrollBottom();
}
async function feedback(m, v, up, down) {
  m.feedback = m.feedback === v ? 0 : v;
  up.classList.toggle('o3-on', m.feedback === 1);
  down.classList.toggle('o3-on', m.feedback === -1);
  const idx = ui.chat.messages.indexOf(m);
  const prevUser = ui.chat.messages.slice(0, idx).reverse().find((x) => x.role === 'user');
  if (m.feedback) memory.feedback(v, m.intent, prevUser ? prevUser.text : '');
  await chatStore.save(ui.chat);
  if (m.feedback === -1) toast('Obrigada pelo retorno! Me diga o que esperava que eu melhoro. 🙏');
  else if (m.feedback === 1) toast('Que bom que ajudou! 💚');
}
function chipClick(c) {
  if (c.action) return runAction(c.action);
  if (c.send != null) {
    if (/\s$/.test(c.send) || /(de|para|sobre|item|risco)$/i.test(c.send.trim()) && c.send.length < 40) {
      ui.els.ta.value = c.send;
      ui.els.ta.focus();
      ui.els.ta.setSelectionRange(c.send.length, c.send.length);
      updateSendState();
      return;
    }
    send(c.send, { learnFrom: c.learnFrom || null });
  }
}
async function runAction(a) {
  if (a.kind === 'open_chat') return openChat(a.chatId);
  if (a.kind === 'open_memory') return openMemory();
  if (a.kind === 'memory_clear') {
    memory.clear();
    toast('Memória apagada.');
    return;
  }
  if (a.kind === 'tab_delete') {
    const tb = tabs.get(a.tabId);
    if (!tb) return;
    const snap = deepClone(tb);
    await tabs.remove(a.tabId);
    if (ws.tabId === a.tabId) closeWorkspace();
    toast(`Aba “${snap.name}” excluída.`, { action: 'Desfazer', onAction: () => tabs.install(snap, { overwrite: true }), ms: 7000 });
    return;
  }
  if (a.kind === 'tab_export') return exportTabNow(a.tabId);
  if (a.kind === 'site_pdf') {
    try {
      const rep = await readSite(a.url);
      const pseudo = { id: uid('site'), name: rep.title || rep.host, kind: 'html', size: rep.text.length, text: rep.text, meta: {}, tables: rep.tables.map((t) => ({ name: t.caption, rows: [t.head || [], ...t.rows] })) };
      pseudo.analysis = analyzeDoc(pseudo);
      const { doc } = GENERATORS.resumo_doc({ fromFile: pseudo, params: {}, profile: memory.profile });
      doc.subtitle = rep.url;
      await docStore.put(doc);
      downloadDoc(doc, 'pdf');
    } catch (e) {
      toast('Não consegui gerar o PDF do site: ' + e.message);
    }
  }
}

// ---- cartões ---------------------------------------------------------------------------------------------
function renderPartCard(p, m, live) {
  if (p.type === 'doc') {
    const card = h('div', { class: 'o3-card' }, h('div', { class: 'o3-ci', text: '📄' }), h('div', { class: 'o3-cb' }, h('div', { class: 'o3-ct1', text: 'Carregando documento…' })));
    docStore.get(p.docId).then((doc) => {
      if (!doc) {
        card.querySelector('.o3-ct1').textContent = 'Documento não encontrado';
        return;
      }
      const meta = DOC_TYPES_GEN[doc.type] || { icon: '📄' };
      card.textContent = '';
      card.append(
        h('div', { class: 'o3-ci', text: meta.icon }),
        h(
          'div',
          { class: 'o3-cb' },
          h('div', { class: 'o3-ct1', text: doc.title }),
          h('div', { class: 'o3-ct2', text: [doc.subtitle, doc.code, doc.date].filter(Boolean).join(' · ') }),
          h(
            'div',
            { class: 'o3-cbtns' },
            h('button', { class: 'o3-btn o3-sm', onclick: () => previewDoc(doc), text: '👁 Visualizar' }),
            h('button', { class: 'o3-btn o3-sm o3-primary', onclick: () => downloadDoc(doc, 'pdf'), text: '⬇ PDF' }),
            h('button', { class: 'o3-btn o3-sm', onclick: () => downloadDoc(doc, 'docx'), text: '⬇ Word' }),
            h('button', { class: 'o3-btn o3-sm', onclick: () => downloadDoc(doc, 'xlsx'), text: '⬇ Excel' }),
            h('button', { class: 'o3-btn o3-sm', onclick: () => downloadDoc(doc, 'print'), text: '🖨 Imprimir' }),
            h('button', { class: 'o3-btn o3-sm', onclick: async () => (await copyText(docToText(doc)), toast('Texto do documento copiado.')), text: '📋 Copiar' })
          )
        )
      );
      if (live && p.autoFormat && !p._done) {
        p._done = true;
        downloadDoc(doc, p.autoFormat);
        chatStore.save(ui.chat);
      }
    });
    return card;
  }
  if (p.type === 'file') {
    const card = h('div', { class: 'o3-card' }, h('div', { class: 'o3-ci', text: '📎' }), h('div', { class: 'o3-cb' }, h('div', { class: 'o3-ct1', text: 'Arquivo' })));
    fileStore.get(p.fileId).then((f) => {
      if (!f) return;
      const a = f.analysis || {};
      card.textContent = '';
      const ic = h('div', { class: 'o3-ci' });
      if (f.image && f.image.thumb) ic.appendChild(h('img', { src: f.image.thumb, alt: '' }));
      else ic.textContent = KIND_ICON[f.kind] || '📎';
      const body = h('div', { class: 'o3-cb o3-md' });
      body.insertAdjacentHTML('beforeend', mdToHtml(fileSummaryMD(f)));
      card.append(ic, body);
    });
    return card;
  }
  if (p.type === 'tab') {
    const tb = tabs.get(p.tabId);
    if (!tb) return h('div', { class: 'o3-card' }, h('div', { class: 'o3-ci', text: '🗂️' }), h('div', { class: 'o3-cb' }, h('div', { class: 'o3-ct1', text: 'Aba removida' })));
    return h(
      'div',
      { class: 'o3-card' },
      h('div', { class: 'o3-ci', text: tb.icon, style: { background: tb.color + '26', borderColor: tb.color + '55' } }),
      h('div', { class: 'o3-cb' }, h('div', { class: 'o3-ct1', text: tb.name }), h('div', { class: 'o3-ct2', text: describeTab(tb) }), h('div', { class: 'o3-cbtns' }, h('button', { class: 'o3-btn o3-sm o3-primary', onclick: () => openWorkspace(tb.id), text: '↗ Abrir aba' }), h('button', { class: 'o3-btn o3-sm', onclick: () => exportTabNow(tb.id), text: '📦 Exportar padrão' })))
    );
  }
  if (p.type === 'kpis') {
    const g = h('div', { class: 'o3-kpis' });
    for (const k of p.items) g.appendChild(h('div', { class: 'o3-kpi', title: k.hint || '' }, h('b', { text: (k.unit === 'R$' ? 'R$ ' : '') + fmtCompact(k.value) + (k.unit && k.unit !== 'R$' ? k.unit : '') }), h('span', { text: truncate(k.label, 60) })));
    return g;
  }
  if (p.type === 'sources') {
    const box = h('div', { class: 'o3-srcs' });
    for (const s of p.items) box.appendChild(h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: '🔗 ' + (s.title || s.url) }));
    return box;
  }
  return null;
}

// ---- documentos: pré-visualização e downloads ------------------------------------------------------
async function downloadDoc(doc, fmt) {
  const base = `${slug(doc.title)}-${doc.code}`.toLowerCase();
  try {
    if (fmt === 'print') return printHTML(renderDocHTML(doc, { forPrint: true }));
    if (fmt === 'html') return downloadBlob(new Blob([renderDocHTML(doc)], { type: 'text/html' }), base + '.html');
    setStatus(`Gerando ${fmt.toUpperCase()}…`);
    const blob = fmt === 'docx' ? await docToDOCX(doc) : fmt === 'xlsx' ? await docToXLSX(doc) : await docToPDF(doc);
    downloadBlob(blob, `${base}.${fmt === 'docx' ? 'docx' : fmt === 'xlsx' ? 'xlsx' : 'pdf'}`);
    toast(`${fmt === 'docx' ? 'Word' : fmt === 'xlsx' ? 'Excel' : 'PDF'} pronto: ${doc.title}`);
    memory.data.prefs.format[fmt] = (memory.data.prefs.format[fmt] || 0) + 0.5;
    memory.save();
  } catch (e) {
    console.error(e);
    toast('Não consegui gerar o arquivo: ' + e.message);
  } finally {
    setStatus('');
  }
}
function previewDoc(doc) {
  const frame = h('iframe', { class: 'o3-frame', title: 'Pré-visualização do documento', sandbox: 'allow-same-origin allow-modals' });
  frame.srcdoc = renderDocHTML(doc);
  openModal({
    title: `${doc.title}${doc.subtitle ? ' — ' + doc.subtitle : ''}`,
    body: frame,
    footer: [h('button', { class: 'o3-btn', onclick: () => downloadDoc(doc, 'print'), text: '🖨 Imprimir' }), h('button', { class: 'o3-btn', onclick: () => downloadDoc(doc, 'xlsx'), text: '⬇ Excel' }), h('button', { class: 'o3-btn', onclick: () => downloadDoc(doc, 'docx'), text: '⬇ Word' }), h('button', { class: 'o3-btn o3-primary', onclick: () => downloadDoc(doc, 'pdf'), text: '⬇ PDF' })],
  });
}

// ---- atalhos "/" ---------------------------------------------------------------------------------------------
const SLASH = [
  ['/apr', 'APR — análise preliminar de risco', 'Faz uma APR de '], ['/pt', 'Permissão de trabalho / PET', 'Gera uma permissão de trabalho de '], ['/dds', 'DDS — diálogo diário de segurança', 'Faz um DDS sobre '],
  ['/checklist', 'Checklist de inspeção', 'Faz um checklist de '], ['/os', 'Ordem de serviço (NR-01)', 'Faz uma ordem de serviço para '], ['/epi', 'Ficha de entrega de EPI', 'Faz uma ficha de EPI para '],
  ['/inspecao', 'Relatório de inspeção com fotos', 'Faça um relatório de inspeção: '], ['/investigacao', 'Investigação de acidente', 'Gera um relatório de investigação de acidente: '], ['/5w2h', 'Plano de ação 5W2H', 'Monta um plano de ação 5W2H para '],
  ['/pop', 'Procedimento operacional padrão', 'Faz um POP de '], ['/presenca', 'Lista de presença', 'Faz uma lista de presença para o treinamento de '], ['/comunicado', 'Comunicado / alerta', 'Faz um alerta de segurança sobre '],
  ['/treinamento', 'Plano de treinamento', 'Plano de treinamento NR-'], ['/inventario', 'Inventário de riscos (PGR)', 'Gera um inventário de riscos para '], ['/pae', 'Plano de emergência', 'Monte um plano de emergência para '],
  ['/aba', 'Criar uma aba no OPS 360°', 'Crie uma aba de '], ['/abas', 'Minhas abas', 'Quais abas eu tenho?'], ['/site', 'Ler um site', 'Leia o site '], ['/memoria', 'O que a Aurora sabe', 'O que você sabe sobre mim?'], ['/ajuda', 'O que a Aurora faz', 'O que você sabe fazer?'],
];
let slashSel = 0;
function updateSlash() {
  const v = ui.els.ta.value;
  if (!/^\/\S*$/.test(v)) return hideSlash();
  const q = v.slice(1).toLowerCase();
  const list = SLASH.filter((s) => s[0].slice(1).startsWith(q) || norm(s[1]).includes(q));
  if (!list.length) return hideSlash();
  slashSel = clamp(slashSel, 0, list.length - 1);
  const E = ui.els;
  E.slash.textContent = '';
  list.forEach((s, i) => E.slash.appendChild(h('button', { class: i === slashSel ? 'o3-sel' : '', role: 'option', onclick: () => applySlash(s) }, h('b', { text: s[0] }), h('span', { text: s[1] }))));
  E.slash.hidden = false;
  E.slash._list = list;
}
function hideSlash() {
  ui.els.slash.hidden = true;
  slashSel = 0;
}
function slashKey(e) {
  const list = ui.els.slash._list || [];
  if (e.key === 'Escape') return hideSlash();
  e.preventDefault();
  if (e.key === 'ArrowDown') slashSel = (slashSel + 1) % list.length;
  else if (e.key === 'ArrowUp') slashSel = (slashSel - 1 + list.length) % list.length;
  else return applySlash(list[slashSel]);
  updateSlash();
}
function applySlash(s) {
  const E = ui.els;
  E.ta.value = s[2];
  hideSlash();
  E.ta.focus();
  E.ta.setSelectionRange(s[2].length, s[2].length);
  updateSendState();
  if (!/\s$|NR-$/.test(s[2])) send();
}

// ---- modais: memória, configurações, abas -----------------------------------------------------------
function openMemory() {
  const d = memory.data;
  const body = h('div');
  const name = h('input', { value: d.profile.name || '', placeholder: 'Seu nome' });
  const company = h('input', { value: d.profile.company || '', placeholder: 'Empresa padrão nos documentos' });
  const role = h('input', { value: d.profile.role || '', placeholder: 'Ex.: Técnico de Segurança' });
  body.append(h('div', { class: 'o3-row' }, h('label', { class: 'o3-field' }, h('span', { text: 'Nome' }), name), h('label', { class: 'o3-field' }, h('span', { text: 'Empresa' }), company), h('label', { class: 'o3-field' }, h('span', { text: 'Função' }), role)));
  const learnT = h('input', { type: 'checkbox', checked: memory.enabled });
  body.append(h('label', { class: 'o3-sw-t' }, learnT, h('span', { text: 'Aprender com as minhas conversas (preferências, termos e frases)' })));
  const factsList = h('div', { class: 'o3-list' });
  const renderFacts = () => {
    factsList.textContent = '';
    if (!d.facts.length) factsList.appendChild(h('div', { class: 'o3-mut', text: 'Nenhuma anotação. Diga "lembre que…" no chat.' }));
    d.facts.forEach((f) => factsList.appendChild(h('div', { class: 'o3-li' }, h('span', { text: '📌 ' + f.text }), h('span', { class: 'o3-mut', style: { flex: 'none' }, text: fmtDate(f.at) }), h('button', { class: 'o3-ib', 'aria-label': 'Apagar', text: '🗑', onclick: () => (memory.removeFact(f.id), renderFacts()) }))));
  };
  renderFacts();
  const newFact = h('input', { placeholder: 'Adicionar anotação (ex.: nosso SESMT fica no prédio B)' });
  body.append(h('div', { class: 'o3-h3', text: 'Anotações' }), factsList, h('div', { class: 'o3-row', style: { marginTop: '8px' } }, newFact, h('button', { class: 'o3-btn', style: { flex: 'none' }, onclick: () => (newFact.value.trim() && memory.addFact(newFact.value), (newFact.value = ''), renderFacts()), text: 'Adicionar' })));
  const learnedList = h('div', { class: 'o3-list' });
  const renderLearned = () => {
    learnedList.textContent = '';
    const syn = Object.entries(d.synonyms);
    if (!d.learned.length && !syn.length) learnedList.appendChild(h('div', { class: 'o3-mut', text: 'Ainda nada. Quando eu não entender e você escolher uma sugestão, eu aprendo.' }));
    syn.forEach(([w, id]) => learnedList.appendChild(h('div', { class: 'o3-li' }, h('span', { text: `🔤 “${w}” → ${ACT_BY_ID[id] ? ACT_BY_ID[id].nome : id}` }), h('button', { class: 'o3-ib', 'aria-label': 'Apagar', text: '🗑', onclick: () => (delete d.synonyms[w], memory.save(), renderLearned()) }))));
    d.learned.slice(-30).reverse().forEach((l) => learnedList.appendChild(h('div', { class: 'o3-li' }, h('span', { text: `💬 “${truncate(l.phrase, 70)}” → ${l.intent}` }), h('span', { class: 'o3-mut', style: { flex: 'none' }, text: `${l.hits}×` }), h('button', { class: 'o3-ib', 'aria-label': 'Apagar', text: '🗑', onclick: () => ((d.learned = d.learned.filter((x) => x !== l)), memory.save(), renderLearned()) }))));
  };
  renderLearned();
  body.append(h('div', { class: 'o3-h3', text: 'O que aprendi a entender' }), learnedList);
  const top = (b) => memory.top(b, 5).map((x) => `${b === 'activities' ? (ACT_BY_ID[x.key] || {}).nome || x.key : b === 'docTypes' ? shortDoc(x.key) : x.key} (${x.count})`).join(', ') || '—';
  body.append(h('div', { class: 'o3-h3', text: 'Estatísticas' }), h('div', { class: 'o3-mut', html: `Mensagens: <b>${d.stats.messages}</b> · Conversas: <b>${chatStore.list.length}</b> · 👍 ${d.feedback.up} · 👎 ${d.feedback.down}<br>Documentos: ${esc(top('docTypes'))}<br>Atividades: ${esc(top('activities'))}<br>Assuntos: ${esc(top('topics'))}<br>Aprendendo desde ${fmtDate(d.stats.firstSeen)}` }));
  const imp = h('input', { type: 'file', accept: '.json', hidden: true, onchange: async () => {
    try {
      memory.import(await imp.files[0].text());
      toast('Memória importada.');
      m.close();
    } catch (e) {
      toast('Arquivo inválido: ' + e.message);
    }
  } });
  body.appendChild(imp);
  const m = openModal({
    title: '🧠 Memória da Aurora',
    body,
    footer: [
      h('button', { class: 'o3-btn o3-danger', onclick: async () => (await confirmBox('Apagar tudo o que a Aurora aprendeu? (seu nome é mantido)', 'Apagar')) && (memory.clear(), m.close(), toast('Memória apagada.')), text: '🧹 Apagar memória' }),
      h('button', { class: 'o3-btn', onclick: () => imp.click(), text: '⬆ Importar' }),
      h('button', { class: 'o3-btn', onclick: () => downloadBlob(new Blob([memory.export()], { type: 'application/json' }), 'ops360-memoria.json'), text: '⬇ Exportar' }),
      h('button', { class: 'o3-btn o3-primary', onclick: () => {
        memory.setProfile('name', name.value.trim() || null);
        memory.setProfile('company', company.value.trim() || null);
        memory.setProfile('role', role.value.trim() || null);
        d.enabled = learnT.checked;
        memory.save();
        m.close();
        toast('Memória atualizada.');
      }, text: 'Salvar' }),
    ],
  });
}
function openSettings() {
  const dockT = h('input', { type: 'checkbox', checked: kv.get('dock.enabled', CFG.slackDock) !== false });
  const offT = h('input', { type: 'checkbox', checked: !!CFG.strictOffline });
  const fsz = h('select', {}, ...[['14', 'Pequena'], ['15.5', 'Média (padrão)'], ['17', 'Grande'], ['18.5', 'Muito grande']].map(([v, l]) => h('option', { value: v, selected: String(kv.get('ui.font', '15.5')) === v, text: l })));
  const prox = h('textarea', {}, (kv.get('cfg.proxies') || CFG.proxies).join('\n'));
  const body = h(
    'div',
    {},
    h('label', { class: 'o3-sw-t' }, dockT, h('span', { text: 'Dock inteligente do Slack (botão compacto na lateral que desvia da IA)' })),
    h('label', { class: 'o3-sw-t' }, offT, h('span', { text: 'Modo estritamente offline (desativa leitura de sites, OCR e leitor avançado de PDF)' })),
    h('label', { class: 'o3-field' }, h('span', { text: 'Tamanho do texto no chat' }), fsz),
    h('label', { class: 'o3-field' }, h('span', { text: 'Leitores públicos para sites que bloqueiam acesso direto ({url} = endereço codificado, {rawurl} = endereço puro). Um por linha.' }), prox),
    h('div', { class: 'o3-mut', html: `OPS 360° IA v${VERSION} · armazenamento: <b>${db._mode === 'idb' ? 'IndexedDB (navegador)' : db._mode === 'ls' ? 'localStorage' : 'memória temporária'}</b> · nada é enviado para servidores.` })
  );
  const m = openModal({
    title: '⚙ Configurações',
    size: 'sm',
    body,
    footer: [
      h('button', { class: 'o3-btn o3-danger', onclick: async () => {
        if (!(await confirmBox('Apagar TODAS as conversas, documentos, arquivos e abas deste navegador?', 'Apagar tudo'))) return;
        for (const s of ['chats', 'files', 'docs', 'tabs']) await db.clear(s);
        location.reload();
      }, text: 'Apagar dados locais' }),
      h('button', { class: 'o3-btn o3-primary', onclick: () => {
        kv.set('dock.enabled', dockT.checked);
        dockT.checked ? dock.init(true) : dock.destroy();
        CFG.strictOffline = offT.checked;
        kv.set('cfg.offline', offT.checked);
        kv.set('ui.font', fsz.value);
        applyFont();
        const list = prox.value.split('\n').map((s) => s.trim()).filter(Boolean);
        kv.set('cfg.proxies', list);
        CFG.proxies = list;
        updateOnlinePill();
        m.close();
        toast('Configurações salvas.');
      }, text: 'Salvar' }),
    ],
  });
}
function applyFont() {
  const px = parseFloat(kv.get('ui.font', '15.5')) || 15.5;
  ui.panel.style.setProperty('font-size', px - 1 + 'px');
  ui.panel.querySelectorAll('.o3-msgs').forEach((el) => el.style.setProperty('font-size', px + 'px'));
  ui.panel.style.setProperty('--o3-fs', px + 'px');
  if (ui.els.ta) ui.els.ta.style.fontSize = px + 'px';
  ui.panel.querySelectorAll('.o3-bub').forEach((b) => (b.style.fontSize = px + 'px'));
}
function updateOnlinePill() {
  const pill = ui.els.status;
  pill.classList.toggle('o3-online', false);
  pill.lastChild.textContent = CFG.strictOffline ? '100% local · modo offline estrito' : '100% local · offline';
}
function openTabsManager() {
  const body = h('div');
  const list = h('div', { class: 'o3-list' });
  const render = () => {
    list.textContent = '';
    if (!tabs.list.length) list.appendChild(h('div', { class: 'o3-mut', text: 'Nenhuma aba ainda. Peça à Aurora: "crie uma aba de indicadores", "crie uma aba a partir do site…" ou "crie uma aba com os dados desta planilha".' }));
    for (const tb of tabs.list) {
      list.appendChild(
        h(
          'div',
          { class: 'o3-li' },
          h('span', { style: { fontSize: '20px', flex: 'none' }, text: tb.icon }),
          h('span', {}, h('b', { text: tb.name }), h('div', { class: 'o3-mut', text: describeTab(tb) + ' · alterada ' + fmtDateTime(tb.updatedAt) })),
          h('button', { class: 'o3-btn o3-sm o3-primary', onclick: () => (m.close(), openWorkspace(tb.id)), text: 'Abrir' }),
          h('button', { class: 'o3-btn o3-sm', onclick: () => exportTabNow(tb.id), text: '📦' , title: 'Exportar pacote padronizado' }),
          h('button', { class: 'o3-btn o3-sm', title: 'Duplicar', onclick: async () => {
            const cp = deepClone(tb);
            cp.id = uid('tab');
            cp.name = tb.name + ' (cópia)';
            cp.createdAt = Date.now();
            await tabs.install(cp);
            render();
          }, text: '⧉' }),
          h('button', { class: 'o3-btn o3-sm o3-danger', title: 'Excluir', onclick: async () => {
            if (await confirmBox(`Excluir a aba “${tb.name}”?`, 'Excluir')) {
              await tabs.remove(tb.id);
              if (ws.tabId === tb.id) closeWorkspace();
              render();
            }
          }, text: '🗑' })
        )
      );
    }
  };
  render();
  const newIn = h('input', { placeholder: 'Descreva a aba (ex.: controle de inspeções de andaimes com campos: data, local, inspetor, resultado)' });
  const imp = h('input', { type: 'file', accept: '.json,.zip', hidden: true, onchange: async () => {
    try {
      const f = imp.files[0];
      let bp;
      if (/\.zip$/i.test(f.name)) {
        const z = await zipRead(new Uint8Array(await f.arrayBuffer()));
        const n = z.names().find((x) => /blueprint\.json$/.test(x));
        bp = JSON.parse(await z.text(n));
      } else bp = JSON.parse(await f.text());
      const t = await tabs.install(bp);
      toast(`Aba “${t.name}” importada.`);
      render();
    } catch (e) {
      toast('Não consegui importar: ' + e.message);
    }
  } });
  body.append(list, h('div', { class: 'o3-h3', text: 'Criar com a Aurora' }), h('div', { class: 'o3-row' }, newIn, h('button', { class: 'o3-btn o3-primary', style: { flex: 'none' }, onclick: () => {
    const v = newIn.value.trim();
    if (!v) return;
    m.close();
    send(/\baba\b/i.test(v) ? v : 'Crie uma aba ' + (/^(de|para|com)\b/i.test(v) ? '' : 'de ') + v);
  }, text: '✨ Criar' })), imp);
  const m = openModal({
    title: '🗂️ Abas criadas pela IA',
    body,
    footer: [
      h('button', { class: 'o3-btn', onclick: () => imp.click(), text: '⬆ Importar aba (.json/.zip)' }),
      h('button', { class: 'o3-btn', onclick: async () => {
        for (const tb of tabs.list) await exportTabNow(tb.id);
      }, text: '📦 Exportar todas' }),
    ],
  });
}
