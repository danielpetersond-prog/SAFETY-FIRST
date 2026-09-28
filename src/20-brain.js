// ---------------------------------------------------------------------------
// 20 · Cérebro da Aurora — orquestra entendimento, conhecimento, documentos,
//      arquivos, sites, abas e memória. Cada resposta é uma lista de "partes"
//      (texto, chips, cartão de documento, arquivo, aba, KPIs, fontes).
// ---------------------------------------------------------------------------
const chatStore = {
  list: [],
  async load() {
    this.list = (await db.all('chats')).filter((c) => c && c.id).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  get(id) {
    return this.list.find((c) => c.id === id) || null;
  },
  create() {
    const c = { id: uid('chat'), title: 'Nova conversa', autoTitle: true, createdAt: Date.now(), updatedAt: Date.now(), pinned: false, messages: [], state: { activeFiles: [] } };
    this.list.unshift(c);
    return c;
  },
  _saveQ: new Map(),
  async save(chat) {
    chat.updatedAt = Date.now();
    await db.put('chats', deepClone(chat));
    bus.emit('chats:changed', { id: chat.id });
  },
  async remove(id) {
    this.list = this.list.filter((c) => c.id !== id);
    await db.del('chats', id);
    bus.emit('chats:changed', { id, removed: true });
  },
};
const fileStore = {
  cache: new Map(),
  async put(rec) {
    this.cache.set(rec.id, rec);
    await db.put('files', { ...rec });
  },
  async get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const r = await db.get('files', id);
    if (r) this.cache.set(id, r);
    return r || null;
  },
  async many(ids) {
    const out = [];
    for (const id of ids || []) {
      const r = await this.get(id);
      if (r) out.push(r);
    }
    return out;
  },
};
const docStore = {
  cache: new Map(),
  async put(doc) {
    this.cache.set(doc.id, doc);
    await db.put('docs', deepClone(doc));
  },
  async get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const d = await db.get('docs', id);
    if (d) this.cache.set(id, d);
    return d || null;
  },
};

const P = {
  md: (text) => ({ type: 'md', text }),
  chips: (items) => ({ type: 'chips', items: items.filter(Boolean) }),
  doc: (doc, autoFormat) => ({ type: 'doc', docId: doc.id, autoFormat: autoFormat || null }),
  file: (f) => ({ type: 'file', fileId: f.id }),
  tab: (id) => ({ type: 'tab', tabId: id }),
  kpis: (items) => ({ type: 'kpis', items }),
  sources: (items) => ({ type: 'sources', items }),
};
const nameOf = () => memory.profile.name;
const hi = (s) => (nameOf() ? s.replace('{nome}', nameOf()) : s.replace(/,? \{nome\}/, ''));
const shortDoc = (t) => ({ apr: 'APR', pt: 'PT', dds: 'DDS', checklist: 'Checklist', os: 'OS', ficha_epi: 'Ficha de EPI', inspecao: 'Relatório de inspeção', investigacao: 'Investigação', plano_acao: 'Plano 5W2H', pop: 'POP', lista_presenca: 'Lista de presença', comunicado: 'Comunicado', treinamento: 'Plano de treinamento', inventario: 'Inventário de riscos', pae: 'PAE', resumo_doc: 'Relatório de análise' })[t] || 'Documento';
const artigo = (t) => (['apr', 'pt', 'os', 'ficha_epi', 'investigacao', 'lista_presenca'].includes(t) ? 'uma' : 'um');

function greetingChips() {
  const out = [];
  const td = memory.top('docTypes', 2), ta = memory.top('activities', 2);
  if (td[0] && ta[0] && DOC_TYPES_GEN[td[0].key] && ACT_BY_ID[ta[0].key]) out.push({ label: `${DOC_TYPES_GEN[td[0].key].icon} ${shortDoc(td[0].key)} de ${ACT_BY_ID[ta[0].key].nome.toLowerCase()}`, send: `Faz ${artigo(td[0].key)} ${shortDoc(td[0].key)} de ${ACT_BY_ID[ta[0].key].nome.toLowerCase()}` });
  if (tabs.list.length) out.push({ label: `${tabs.list[tabs.list.length - 1].icon} Abrir ${tabs.list[tabs.list.length - 1].name}`, send: `Abra a aba ${tabs.list[tabs.list.length - 1].name}` });
  out.push({ label: 'O que é sinalização vertical?', send: 'O que é sinalização vertical?' });
  out.push({ label: 'Faz uma APR de empilhadeira', send: 'Faz uma APR de empilhadeira' });
  out.push({ label: 'Meu time não usa protetor auricular, o que faço?', send: 'Meu time não usa protetor auricular, o que faço?' });
  if (!tabs.list.length) out.push({ label: '✨ Criar uma aba de indicadores', send: 'Crie uma aba de indicadores de segurança' });
  return uniq(out.map((o) => JSON.stringify(o))).map((s) => JSON.parse(s)).slice(0, 4);
}
function reminders() {
  const out = [];
  for (const f of memory.data.facts) {
    const d = extractDates(f.text)[0];
    let date = d ? d.date : null;
    if (!date) {
      const mm = /(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/.exec(norm(f.text));
      if (mm) {
        const idx = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'].indexOf(mm[1]);
        const nowD = new Date();
        date = new Date(nowD.getFullYear() + (idx < nowD.getMonth() ? 1 : 0), idx, 1);
      }
    }
    if (date) {
      const days = daysBetween(new Date(), date);
      if (days >= -3 && days <= 45) out.push(`📌 Lembrete: ${f.text}${days >= 0 ? ` (em ${days} dia${days === 1 ? '' : 's'})` : ''}`);
    }
  }
  return out.slice(0, 3);
}
function messageText(m) {
  if (m.role === 'user') return m.text || '';
  return (m.parts || []).filter((p) => p.type === 'md').map((p) => p.text).join('\n');
}
function searchChats(query, k = 6) {
  const ix = new BM25();
  for (const c of chatStore.list) for (const m of c.messages) {
    const txt = messageText(m);
    if (txt && txt.length > 3) ix.add(c.id + '|' + m.id, txt, { chatId: c.id, msgId: m.id, role: m.role, at: m.at, title: c.title });
  }
  return ix.search(query, k);
}
function autoTitle(text, res) {
  if (res.docType && DOC_TYPES_GEN[res.docType]) return `${shortDoc(res.docType)}${res.activities && res.activities[0] ? ' — ' + ACT_BY_ID[res.activities[0]].nome : ''}`;
  if (res.intent === 'nr_info') return `NR-${String(res.slots.nr).padStart(2, '0')} — ${(NRS[res.slots.nr] || {}).titulo || ''}`.slice(0, 60);
  if (/^tab_/.test(res.intent)) return 'Abas — ' + truncate(text, 40);
  if (res.intent === 'site_read') return 'Leitura de site';
  if (res.intent === 'recall_chats') return 'Busca nas conversas';
  if (res.intent === 'recall_profile' || res.intent === 'remember' || res.intent === 'forget') return 'Memória da Aurora';
  if (res.intent === 'calc') return 'Cálculo de SST';
  if (/^(doc_|file_only|photo_report|image_ocr)/.test(res.intent)) return 'Análise de arquivo';
  if (res.intent === 'advice' && res.slots.advice) return res.slots.advice.titulo;
  if (res.intent === 'define' && res.slots.glossary) return 'O que é ' + res.slots.glossary.termo;
  const kw = keywords(text, 3);
  return kw.length ? capFirst(kw.join(', ')) : truncate(text, 40);
}

// ---- Respostas por intenção -------------------------------------------------------------------
const H = {};
H.greet = (ctx) => {
  const n = nameOf();
  if (!n) {
    ctx.chat.state.pending = { kind: 'ask_name' };
    return [P.md(`${greetingByHour()}! 👋 Eu sou a **${CFG.assistantName}**, a IA de segurança do OPS 360°. Funciono 100% no seu navegador e aprendo com as nossas conversas.\nComo posso te chamar?`)];
  }
  const rem = reminders();
  return [P.md(`${pick(['Oi', 'Olá', greetingByHour()])}, ${n}! Em que posso ajudar na segurança hoje?${rem.length ? '\n\n' + rem.join('\n') : ''}`), P.chips(greetingChips())];
};
H.howareyou = () => [P.md(pick(SMALLTALK.como_esta))];
H.user_state = (ctx) => [P.md(/(mal|pessimo|triste|cansad|estressad|exaust|sobrecarregad|ansios|mais ou menos)/.test(ctx.res.t) ? pick(SMALLTALK.mal) : pick(SMALLTALK.bem))];
H.thanks = () => [P.md(pick(SMALLTALK.obrigado))];
H.bye = () => [P.md(pick(SMALLTALK.tchau))];
H.compliment = () => [P.md(pick(SMALLTALK.elogio))];
H.empty = () => [P.md('Pode mandar sua pergunta ou pedido — e, se quiser, anexe um arquivo ou foto pelo 📎. 🙂')];
H.new_chat = () => [P.md('Use o botão **Nova conversa** para começar do zero — suas conversas anteriores ficam salvas na lateral.')];
H.help = () => [
  P.md(
    `Eu sou a **${CFG.assistantName}**, sua assistente de SST no OPS 360° (100% local). Posso:\n` +
      '• **Gerar documentos** sob medida: APR, PT/PET, DDS, checklist, ordem de serviço (NR-01), ficha de EPI, relatório de inspeção com fotos, investigação de acidente, plano 5W2H, POP, lista de presença, comunicado, plano de treinamento, inventário de riscos e plano de emergência — em **PDF, Word ou Excel**.\n' +
      '• **Ler seus arquivos** (PDF, Word, Excel, PowerPoint, CSV, fotos): anexe pelo 📎, escreva o que quer e envie — eu resumo, encontro validades, EPIs, NRs e riscos, respondo perguntas e transformo em checklist/APR/plano de ação.\n' +
      '• **Explicar NRs e termos**, orientar em situações do dia a dia e fazer cálculos (taxa de frequência/gravidade, exposição a ruído).\n' +
      '• **Criar abas e sub-abas** dentro do OPS 360° com gráficos, indicadores, formulários e calculadoras — inclusive **a partir de sites ou planilhas** — e exportar o padrão para implementação.\n' +
      '• **Lembrar** do que você me ensina e das nossas conversas (várias conversas na lateral).\n\nDica: digite **/** para ver atalhos (/apr, /dds, /pt, /checklist, /aba…).'
  ),
  P.chips([{ label: 'Faz uma APR de trabalho em altura', send: 'Faz uma APR de trabalho em altura' }, { label: 'Crie uma aba de treinamentos', send: 'Crie uma aba de treinamentos' }, { label: 'O que diz a NR-12?', send: 'O que diz a NR-12?' }, { label: 'O que você sabe sobre mim?', send: 'O que você sabe sobre mim?' }]),
];
H.set_name = (ctx) => {
  memory.setProfile('name', ctx.res.slots.name);
  return [P.md(`Prazer, ${ctx.res.slots.name}! 😊 Vou lembrar disso. Em que posso ajudar na segurança hoje?`), P.chips(greetingChips())];
};
H.set_company = (ctx) => {
  memory.setProfile('company', ctx.res.slots.company);
  return [P.md(`Anotado! Vou usar **${ctx.res.slots.company}** como empresa padrão nos documentos. 🏢`)];
};
H.remember = (ctx) => {
  const f = memory.addFact(ctx.res.slots.fact);
  if (!f) return [P.md('Isso eu já tinha anotado 😉')];
  const hasDate = extractDates(f.text).length || /(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/.test(norm(f.text));
  return [P.md(`Anotado! 📌 Vou lembrar que **${f.text}**.${hasDate ? ' Quando a data estiver próxima, eu te aviso ao cumprimentar.' : ''}`)];
};
H.forget = (ctx) => {
  const what = ctx.res.slots.what || '';
  if (/^(tudo|todo|toda|minha memoria|tudo o que voce sabe)/.test(norm(what))) {
    return [P.md('Quer mesmo apagar **tudo** o que aprendi (preferências, fatos, frases aprendidas)? Seu nome será mantido.'), P.chips([{ label: '🧹 Sim, apagar a memória', action: { kind: 'memory_clear' } }, { label: 'Cancelar', send: 'Cancelar' }])];
  }
  const n = memory.forgetMatching(what);
  return [P.md(n ? `Pronto, esqueci ${n} anotação(ões) sobre isso. 🧽` : 'Não encontrei nada parecido na minha memória. Abra **🧠 Memória** para ver tudo o que guardei.')];
};
H.recall_profile = () => {
  const d = memory.data;
  const lines = [];
  lines.push(`**Perfil:** ${d.profile.name || 'nome não informado'}${d.profile.company ? ' · ' + d.profile.company : ''}`);
  const ta = memory.top('activities', 3).map((x) => ACT_BY_ID[x.key] && ACT_BY_ID[x.key].nome).filter(Boolean);
  const td = memory.top('docTypes', 3).map((x) => shortDoc(x.key));
  if (td.length) lines.push(`**Documentos que você mais pede:** ${td.join(', ')}`);
  if (ta.length) lines.push(`**Atividades mais frequentes:** ${ta.join(', ')}`);
  const pf = memory.preferredFormat();
  if (pf) lines.push(`**Formato preferido:** ${pf.toUpperCase()}`);
  if (d.facts.length) lines.push(`**Anotações (${d.facts.length}):**\n` + d.facts.slice(-8).map((f) => '• ' + f.text).join('\n'));
  if (d.learned.length) lines.push(`**Frases que aprendi a entender:** ${d.learned.length}`);
  const syn = Object.keys(d.synonyms);
  if (syn.length) lines.push(`**Termos que aprendi:** ${syn.slice(0, 8).join(', ')}`);
  lines.push(`**Conversas salvas:** ${chatStore.list.length} · **Mensagens:** ${d.stats.messages}`);
  return [P.md('Aqui está o que eu sei e aprendi com você 🧠\n' + lines.join('\n') + '\n\nVocê pode ver, apagar ou exportar tudo em **🧠 Memória**.'), P.chips([{ label: '🧠 Abrir memória', action: { kind: 'open_memory' } }])];
};
H.recall_chats = (ctx) => {
  const q = ctx.res.slots.params.tema || ctx.res.raw.replace(/.*?\b(sobre|de|do|da|a respeito de)\b/i, '');
  const hits = searchChats(q, 8).filter((h) => h.meta.chatId !== ctx.chat.id || h.meta.role === 'user');
  if (!hits.length) return [P.md(`Não encontrei nada sobre “${truncate(q, 60)}” nas nossas conversas salvas.`)];
  const seen = new Set();
  const items = hits.filter((h) => !seen.has(h.meta.chatId) && seen.add(h.meta.chatId)).slice(0, 5);
  return [
    P.md(`Encontrei isto nas nossas conversas sobre **${truncate(q, 50)}**:\n` + items.map((h) => `• **${h.meta.title}** (${fmtDate(h.meta.at)}): “${truncate(bestSnippet(h.text, q, 160).replace(/\n/g, ' '), 160)}”`).join('\n')),
    P.chips(items.map((h) => ({ label: `💬 Abrir “${truncate(h.meta.title, 28)}”`, action: { kind: 'open_chat', chatId: h.meta.chatId } }))),
  ];
};
H.nr_info = (ctx) => {
  const n = ctx.res.slots.nr;
  const nr = NRS[n];
  if (!nr) return [P.md(`Não existe NR-${n} vigente. As Normas Regulamentadoras vão da NR-01 à NR-38.`)];
  const rel = ACTIVITIES.filter((a) => a.nrs[0] === n).slice(0, 2);
  const parts = [P.md(`**NR-${String(n).padStart(2, '0')} — ${nr.titulo}**\n${nr.resumo}${nr.pontos && nr.pontos.length ? '\n\n**Pontos-chave:**\n' + nr.pontos.map((p) => '• ' + p).join('\n') : ''}${nr.documentos ? '\n\n**Documentos típicos:** ' + nr.documentos.join('; ') + '.' : ''}\n\n_Resumo para orientação — confira sempre o texto vigente no site do MTE._`), P.sources([{ title: 'Normas Regulamentadoras vigentes — gov.br/MTE', url: NR_SOURCE }])];
  const chips = rel.map((a) => ({ label: `APR de ${a.nome.toLowerCase()}`, send: `Faz uma APR de ${a.nome.toLowerCase()}` }));
  if (TRAINING_CONTENT[n]) chips.push({ label: `Plano de treinamento NR-${n}`, send: `Plano de treinamento NR-${n}` });
  chips.push({ label: 'Quais NRs se aplicam a…', send: 'Qual NR fala de ' });
  parts.push(P.chips(chips.slice(0, 4)));
  return parts;
};
H.nr_search = (ctx) => {
  const topic = ctx.res.raw.replace(/.*\b(?:fala|falam|trata|tratam|regulamenta|aborda|cobre|aplica|sobre|de|para)\b\s*(?:de|do|da|sobre)?\s*/i, '') || ctx.res.raw;
  const acts = ctx.res.slots.acts;
  let ids = acts.length ? uniq(acts.flatMap((a) => a.nrs)).slice(0, 4) : nrSearch(topic, 3);
  if (!ids.length) return [P.md('Não identifiquei a norma. Pode me dar mais detalhes da atividade?')];
  return [P.md(`Para **${truncate(topic.replace(/\?$/, ''), 60)}**, as normas mais relacionadas são:\n` + ids.map((n) => `• **NR-${String(n).padStart(2, '0')}** — ${NRS[n].titulo}: ${NRS[n].resumo}`).join('\n')), P.chips(ids.slice(0, 3).map((n) => ({ label: `Detalhar NR-${n}`, send: `O que diz a NR-${n}?` })))];
};
H.define = (ctx) => {
  const g = ctx.res.slots.glossary;
  const parts = [P.md(`**${capFirst(g.termo)}** — ${g.definicao}${g.nrs && g.nrs.length ? `\n\n**Base:** ${g.nrs.map((n) => 'NR-' + String(n).padStart(2, '0')).join(', ')}` : ''}${g.dica ? `\n\n💡 **Dica:** ${g.dica}` : ''}`)];
  const chips = [];
  if (/sinaliza/.test(norm(g.termo))) chips.push({ label: 'Checklist de sinalização', send: 'Faz um checklist de sinalização de segurança' }, { label: 'DDS sobre sinalização', send: 'Faz um DDS sobre sinalização de segurança' });
  if (g.nrs && g.nrs[0]) chips.push({ label: `O que diz a NR-${g.nrs[0]}?`, send: `O que diz a NR-${g.nrs[0]}?` });
  if (chips.length) parts.push(P.chips(chips.slice(0, 3)));
  return parts;
};
H.advice = (ctx) => {
  const a = ctx.res.slots.advice;
  return [P.md(`**${a.titulo}** — o que eu recomendo:\n` + a.passos.map((p, i) => `${i + 1}. ${p}`).join('\n') + `\n\n**Base:** ${a.nrs.map((n) => 'NR-' + String(n).padStart(2, '0')).join(', ')}. Quer que eu prepare algum material?`), P.chips(a.ofertas.map(([label, send]) => ({ label, send })))];
};
H.activity_info = (ctx) => {
  const acts = ctx.res.slots.acts.length ? ctx.res.slots.acts : [];
  if (!acts.length) return H.kb_search(ctx);
  const a = mergeActivities(acts);
  const top = [...a.perigos].sort((x, y) => y[3] * y[4] - x[3] * x[4]).slice(0, 5);
  const t = ctx.res.t;
  let body;
  if (/\bepis?\b/.test(t)) body = `**EPIs para ${a.nome.toLowerCase()}:**\n` + a.epis.map((e) => '• ' + e).join('\n');
  else if (/(treinamento|capacitacao|requisito|precisa ter|exig)/.test(t)) body = `**Requisitos para ${a.nome.toLowerCase()}:**\n` + a.requisitos.map((e) => '• ' + e).join('\n');
  else body = `**Principais riscos em ${a.nome.toLowerCase()}:**\n` + top.map((p) => `• **${p[1]}** → ${p[2].toLowerCase()} (${riskLevel(p[3], p[4]).nivel}). _Controle:_ ${p[5][0].toLowerCase()}.`).join('\n') + `\n\n**EPIs:** ${a.epis.slice(0, 5).join(', ')}.`;
  body += `\n**Normas:** ${a.nrs.map((n) => 'NR-' + String(n).padStart(2, '0')).join(', ')}.`;
  const nm = a.nome.toLowerCase();
  return [P.md(body), P.chips([{ label: `APR de ${nm}`, send: `Faz uma APR de ${nm}` }, a.pt ? { label: `PT de ${nm}`, send: `Gera uma PT de ${nm}` } : { label: `Checklist de ${nm}`, send: `Faz um checklist de ${nm}` }, { label: `DDS de ${nm}`, send: `Faz um DDS sobre ${nm}` }, { label: `OS para ${nm}`, send: `Faz uma OS para ${nm}` }])];
};
H.ask_doctype = (ctx) => {
  const a = mergeActivities(ctx.res.slots.acts);
  const nm = a.nome.toLowerCase();
  return [P.md(`Que documento você quer para **${nm}**?`), P.chips([{ label: '⚠️ APR', send: `Faz uma APR de ${nm}` }, a.pt ? { label: '🪪 Permissão de trabalho', send: `Gera uma PT de ${nm}` } : null, { label: '✅ Checklist', send: `Faz um checklist de ${nm}` }, { label: '🗣️ DDS', send: `Faz um DDS sobre ${nm}` }, { label: '📋 Ordem de serviço', send: `Faz uma OS para ${nm}` }, { label: '📘 POP', send: `Faz um POP de ${nm}` }, { label: '🦺 Ficha de EPI', send: `Faz uma ficha de EPI para ${nm}` }])];
};
H.calc = (ctx) => {
  const t = ctx.res.t;
  const nums = (s, re) => {
    const m = re.exec(s);
    return m ? parseNumBR(m[1]) : NaN;
  };
  if (/(frequencia|\btf\b)/.test(t)) {
    const A = nums(t, /(\d+)\s*acidentes?/);
    const Hh = nums(t, /(\d[\d.,]*)\s*(?:de\s+)?(?:hht|horas?[- ]homem|horas trabalhadas|horas)/) || Math.max(...(t.match(/\d[\d.]*/g) || ['0']).map(parseNumBR));
    if (isNaN(A) || !Hh) return [P.md('Para a **taxa de frequência** preciso do nº de acidentes e das horas-homem trabalhadas (HHT). Ex.: *"taxa de frequência com 3 acidentes e 450.000 HHT"*.')];
    const tf = (A * 1e6) / Hh;
    return [P.md(`**Taxa de frequência (NBR 14280)** = acidentes × 1.000.000 ÷ HHT\n= ${fmtNum(A)} × 1.000.000 ÷ ${fmtNum(Hh)} = **${fmtNum(tf, 2)}**\n\nOu seja, cerca de ${fmtNum(tf, 1)} acidentes a cada milhão de horas trabalhadas. Compare mês a mês e com o histórico da empresa/setor.`), P.chips([{ label: '📊 Aba de indicadores', send: 'Crie uma aba de indicadores de segurança' }])];
  }
  if (/(gravidade|\btg\b)/.test(t)) {
    const D = nums(t, /(\d+)\s*dias/);
    const Hh = nums(t, /(\d[\d.,]*)\s*(?:de\s+)?(?:hht|horas?[- ]homem|horas trabalhadas|horas)/);
    if (isNaN(D) || !Hh) return [P.md('Para a **taxa de gravidade** preciso dos dias perdidos (+ debitados) e das HHT. Ex.: *"taxa de gravidade com 45 dias perdidos e 450.000 HHT"*.')];
    return [P.md(`**Taxa de gravidade (NBR 14280)** = (dias perdidos + debitados) × 1.000.000 ÷ HHT\n= ${fmtNum(D)} × 1.000.000 ÷ ${fmtNum(Hh)} = **${fmtNum((D * 1e6) / Hh, 0)}**`)];
  }
  if (/(db|decibe|ruido)/.test(t)) {
    const L = nums(t, /(\d{2,3}(?:[.,]\d)?)\s*(?:db|decibe)/);
    if (isNaN(L)) return [P.md('Me diga o nível de ruído em dB(A). Ex.: *"quanto tempo posso ficar exposto a 95 dB?"*')];
    const Tm = ruidoTempo(L);
    const ex = /(\d+(?:[.,]\d+)?)\s*(h|horas|min|minutos)\b/.exec(t);
    let extra = '';
    if (ex) {
      const minutes = parseNumBR(ex[1]) * (/^h/.test(ex[2]) ? 60 : 1);
      const dose = (minutes / Tm) * 100;
      extra = `\nCom exposição de ${ex[1]} ${ex[2]}, a **dose é ${fmtNum(dose, 0)}%** ${dose > 100 ? '— ⚠️ acima do limite de tolerância' : dose >= 50 ? '— acima do nível de ação (50%): exige medidas preventivas (PCA)' : '— abaixo do nível de ação'}.`;
    }
    return [P.md(L < 85 ? `Em ${fmtNum(L)} dB(A) não há limite diário pela NR-15 (o limite de 8h é para 85 dB(A)), mas acima de 80 dB(A) já se recomenda atenção (nível de ação da NR-09).${extra}` : `Pela **NR-15 (Anexo 1)**, a exposição máxima diária a **${fmtNum(L)} dB(A)** é de **${Tm >= 60 ? fmtNum(Tm / 60, Tm % 60 ? 1 : 0).replace(',0', '') + ' h' : Tm + ' min'}**, sem proteção.${extra}\n\nLembre: a cada +5 dB o tempo permitido cai pela metade. Priorize controles na fonte e use protetor auricular com atenuação adequada.`)];
  }
  if (/dias sem acidente/.test(t)) {
    const d = parseDateBR((/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/.exec(t) || [])[1]);
    if (!d) return [P.md('Me diga a data do último acidente. Ex.: *"dias sem acidente desde 10/08/2026"*.')];
    return [P.md(`São **${daysBetween(d, new Date())} dias** sem acidentes desde ${fmtDate(d)}. 👏 Quer um contador automático numa aba?`), P.chips([{ label: '⏱️ Criar contador', send: `Crie uma aba de indicadores com um contador de dias sem acidentes desde ${fmtDate(d)}` }])];
  }
  return H.kb_search(ctx);
};

async function ctxFiles(ctx) {
  if (ctx.files && ctx.files.length) return ctx.files;
  return fileStore.many(ctx.chat.state.activeFiles || []);
}
function fileSummaryMD(f) {
  const a = f.analysis || {};
  const meta = [KIND_LABEL[f.kind] || f.kind, humanSize(f.size), f.meta.pageCount ? `${f.meta.pageCount} pág.` : f.meta.sheetCount ? `${f.meta.sheetCount} aba(s)` : f.meta.slideCount ? `${f.meta.slideCount} slides` : null].filter(Boolean).join(' · ');
  if (f.kind === 'image') {
    const im = f.image || {};
    return `🖼️ **${f.name}** (${meta}${im.width ? ` · ${im.width}×${im.height}px` : ''})${a.photoDate ? `\nFoto tirada em ${fmtDateTime(a.photoDate)}${a.camera ? ' · ' + a.camera : ''}` : ''}${a.gps ? `\nLocalização (GPS): ${a.gps.lat}, ${a.gps.lon}` : ''}${a.alerts && a.alerts.length ? '\n' + a.alerts.join('\n') : ''}`;
  }
  const lines = [`${KIND_ICON[f.kind] || '📄'} **${f.name}** — ${a.typeLabel || 'Documento'} (${meta})`];
  if (f.warnings && f.warnings.length) lines.push(...f.warnings.map((w) => '⚠️ ' + w));
  if (a.summary && a.summary.length) lines.push('**Resumo:**\n' + a.summary.slice(0, 5).map((s) => '• ' + truncate(s, 260)).join('\n'));
  const found = [];
  if (a.nrs && a.nrs.length) found.push('**Normas:** ' + a.nrs.map((n) => 'NR-' + String(n).padStart(2, '0')).join(', '));
  if (a.epis && a.epis.length) found.push('**EPIs:** ' + a.epis.join(', '));
  if (a.hazards && a.hazards.length) found.push('**Riscos citados:** ' + a.hazards.slice(0, 8).join(', '));
  if (a.cas && a.cas.length) found.push('**CAs:** ' + a.cas.slice(0, 6).join(', '));
  if (found.length) lines.push(found.join('\n'));
  if (a.tables && a.tables.length) lines.push('**Tabelas:** ' + a.tables.map((t) => `${t.name} (${t.rows} linhas; ${t.cols.slice(0, 6).map((c) => c.name).join(', ')})`).join(' · '));
  if (a.alerts && a.alerts.length) lines.push('**Pontos de atenção:**\n' + a.alerts.slice(0, 6).join('\n'));
  return lines.join('\n');
}
function fileChips(files) {
  const f = files.find((x) => x.kind !== 'image') || files[0];
  if (!f) return [];
  if (f.kind === 'image') return [{ label: '🔎 Relatório de não conformidade', send: 'Faça um relatório de não conformidade com esta foto' }, { label: '📋 Relatório de inspeção', send: 'Gere um relatório de inspeção com as fotos' }, { label: '🔤 Ler texto da imagem (OCR)', send: 'Leia o texto da imagem' }];
  const hasTables = (f.sheets || f.tables || []).length > 0;
  const out = [{ label: '🧾 Relatório de análise (PDF)', send: 'Gere um relatório de análise deste documento em PDF' }];
  if (hasTables) out.push({ label: '📈 Criar aba com gráficos', send: 'Crie uma aba com os dados desta planilha' });
  out.push({ label: '✅ Transformar em checklist', send: 'Transforme este documento em checklist' });
  if (f.analysis && f.analysis.alerts && f.analysis.alerts.length) out.push({ label: '🎯 Plano de ação (5W2H)', send: 'Crie um plano de ação 5W2H a partir deste documento' });
  else out.push({ label: '⚠️ APR com base nele', send: 'Crie uma APR com base neste documento' });
  return out.slice(0, 4);
}
H.file_only = async (ctx) => {
  const files = ctx.files;
  const parts = [P.md(files.length > 1 ? `Recebi **${files.length} arquivos**. Veja o que encontrei:` : 'Recebi o arquivo. Veja o que encontrei:')];
  files.forEach((f) => parts.push(P.file(f)));
  parts.push(P.md(files.some((f) => f.kind === 'image') && files.every((f) => f.kind === 'image') ? 'O que você quer que eu faça com a(s) foto(s)? Descreva a situação (ex.: *"fiação exposta no painel do galpão 2"*) que eu monto o relatório com a imagem.' : 'O que você quer que eu faça com ele? Pode perguntar qualquer coisa sobre o conteúdo.'));
  parts.push(P.chips(fileChips(files)));
  return parts;
};
H.doc_summary = async (ctx) => {
  const files = (await ctxFiles(ctx)).filter((f) => f.kind !== 'image' || files0(ctx));
  if (!files.length) return [P.md('Não encontrei nenhum documento nesta conversa. Anexe pelo 📎 e me diga o que precisa.')];
  const parts = [];
  for (const f of files.slice(0, 4)) parts.push(P.md(fileSummaryMD(f)));
  parts.push(P.chips(fileChips(files)));
  return parts;
};
const files0 = (ctx) => ctx.files && ctx.files.length;
H.doc_report = async (ctx) => {
  ctx.res.slots.docType = 'resumo_doc';
  ctx.res.slots.fromFile = true;
  return H.doc_generate(ctx);
};
H.doc_validity = async (ctx) => {
  const files = (await ctxFiles(ctx)).filter((f) => f.kind !== 'image');
  const lines = [];
  for (const f of files) {
    const v = f.analysis.validity || [];
    const tb = (f.analysis.tables || []).flatMap((t) => t.cols.filter((c) => c.validity).map((c) => `${t.name} › ${c.name}: ${c.validity.vencidos} vencido(s), ${c.validity.aVencer} vencendo em 30 dias, ${c.validity.ok} em dia`));
    if (v.length || tb.length) lines.push(`**${f.name}:**\n` + [...v.map((x) => `• ${x.status === 'vencido' ? '⚠️' : x.status === 'vence em breve' ? '⏳' : '✅'} ${x.raw} — ${x.status}${x.days != null ? ` (${x.days < 0 ? 'há ' + -x.days : 'em ' + x.days} dias)` : ''}: “${truncate(x.context, 90)}”`), ...tb.map((x) => '• 📅 ' + x)].join('\n'));
    else lines.push(`**${f.name}:** não encontrei datas de validade/vencimento.`);
  }
  return [P.md(lines.join('\n\n') || 'Nenhum documento no contexto.'), P.chips([{ label: '🗂️ Controlar validades numa aba', send: 'Crie uma aba com os dados desta planilha' }])];
};
H.doc_epis = async (ctx) => {
  const files = (await ctxFiles(ctx)).filter((f) => f.kind !== 'image');
  return [P.md(files.map((f) => `**${f.name}:** ${f.analysis.epis.length ? f.analysis.epis.join(', ') : 'nenhum EPI identificado'}${f.analysis.cas.length ? ` · CAs: ${f.analysis.cas.join(', ')}` : ''}`).join('\n') || 'Nenhum documento no contexto.')];
};
H.doc_nrs = async (ctx) => {
  const files = (await ctxFiles(ctx)).filter((f) => f.kind !== 'image');
  return [P.md(files.map((f) => `**${f.name}:** ${f.analysis.nrs.length ? f.analysis.nrs.map((n) => nrLabel(n)).join('; ') : 'nenhuma NR citada'}`).join('\n') || 'Nenhum documento no contexto.')];
};
H.doc_risks = async (ctx) => {
  const files = (await ctxFiles(ctx)).filter((f) => f.kind !== 'image');
  const out = files.map((f) => {
    const acts = (f.analysis.activities || []).map((id) => ACT_BY_ID[id]).filter(Boolean);
    return `**${f.name}:** ${f.analysis.hazards.length ? 'riscos citados — ' + f.analysis.hazards.join(', ') : 'não encontrei riscos explícitos'}.${acts.length ? `\nAtividades reconhecidas: ${acts.map((a) => a.nome).join(', ')}.` : ''}`;
  });
  return [P.md(out.join('\n\n') || 'Nenhum documento no contexto.'), P.chips([{ label: '⚠️ Gerar APR com base nele', send: 'Crie uma APR com base neste documento' }, { label: '🗂️ Inventário de riscos', send: 'Gere um inventário de riscos com base neste documento' }])];
};
H.doc_qa = async (ctx) => {
  const files = (await ctxFiles(ctx)).filter((f) => f.kind !== 'image' && f.text);
  if (!files.length) return H.kb_search(ctx);
  const q = ctx.res.raw;
  const hits = [];
  for (const f of files) for (const h of docSearch(f, q, 3)) hits.push({ ...h, file: f });
  hits.sort((a, b) => b.score - a.score);
  const good = hits.filter((h) => h.coverage >= 0.3).slice(0, 3);
  if (!good.length) {
    const kb = kbIndex().search(q, 1)[0];
    return [P.md(`Não encontrei isso ${files.length > 1 ? 'nos documentos' : `em **${files[0].name}**`}. 🤔${kb && kb.score > 3 ? '\nMas posso responder pela minha base de conhecimento — quer?' : ''}`), P.chips([kb && kb.score > 3 ? { label: 'Responder pela base de SST', send: q.replace(/\b(nesse|neste|desse|deste|no) (documento|arquivo)\b/gi, '').trim() } : null, { label: 'Resumo do documento', send: 'Resuma o documento' }])];
  }
  return [P.md(`Encontrei isto ${files.length > 1 ? 'nos documentos' : `em **${files[0].name}**`}:\n` + good.map((h) => `> ${highlightTerms(bestSnippet(h.text, q, 380), q).replace(/\n/g, ' ')}\n— _${h.file.name}${h.page ? `, pág. ${h.page}` : ''}_`).join('\n\n'))];
};
H.image_ocr = async (ctx) => {
  const imgs = (await ctxFiles(ctx)).filter((f) => f.kind === 'image' && f.image);
  if (!imgs.length) return [P.md('Anexe a imagem pelo 📎 para eu tentar ler o texto.')];
  if (!isOnline()) return [P.md('Para ler o texto de imagens (OCR) eu preciso baixar o leitor na primeira vez — e estou sem internet ou em modo estritamente offline. 😕 Enquanto isso, descreva a foto que eu monto o relatório com ela.')];
  const out = [];
  for (const f of imgs.slice(0, 3)) {
    try {
      bus.emit('status', `Lendo texto de ${f.name}…`);
      const txt = await ocrImage(f.image.dataUrl, (s) => bus.emit('status', 'OCR: ' + s));
      f.text = txt;
      f.analysis = { ...analyzeDoc({ ...f, kind: 'text' }), type: 'foto' };
      await fileStore.put(f);
      out.push(`**${f.name}:**\n${txt ? '```\n' + truncate(txt, 3000) + '\n```' : '(nenhum texto reconhecido)'}`);
    } catch (e) {
      out.push(`**${f.name}:** não consegui ler (${e.message}).`);
    }
  }
  bus.emit('status', '');
  return [P.md(out.join('\n\n')), P.chips([{ label: 'Resumir o texto', send: 'Resuma o documento' }])];
};
H.photo_report = async (ctx) => {
  ctx.res.slots.docType = 'inspecao';
  return H.doc_generate(ctx);
};

H.site_read = async (ctx) => {
  const url = ctx.res.slots.url;
  if (!url) return [P.md('Me passe o endereço do site (ex.: *"leia o site https://…"*).')];
  try {
    bus.emit('status', 'Lendo o site…');
    const rep = await readSite(url);
    bus.emit('status', '');
    ctx.chat.state.lastSite = rep.url;
    const parts = [P.md(`🌐 **${rep.title || rep.host}** — ${rep.host} _(lido via ${rep.via}, ${fmtDateTime(rep.fetchedAt)})_\n${rep.description ? '_' + truncate(rep.description, 220) + '_\n' : ''}${rep.summary.length ? '\n**Resumo:**\n' + rep.summary.slice(0, 5).map((s) => '• ' + truncate(s, 260)).join('\n') : ''}${rep.tables.length ? `\n\n📊 Encontrei **${rep.tables.length} tabela(s)** de dados${rep.tables[0] ? ` (ex.: “${rep.tables[0].caption}”)` : ''}.` : ''}`)];
    if (rep.numbers.length) parts.push(P.kpis(rep.numbers.slice(0, 4).map((n) => ({ label: n.label, value: n.value, unit: n.pct ? '%' : n.money ? 'R$' : '', hint: n.context }))));
    if (rep.links.length) parts.push(P.sources([{ title: rep.title || rep.host, url: rep.url }, ...rep.links.slice(0, 4).map((l) => ({ title: l.text, url: l.url }))]));
    parts.push(P.chips([{ label: '✨ Criar aba com gráficos deste site', send: `Crie uma aba a partir do site ${rep.url}` }, { label: '🧾 Resumo em PDF', action: { kind: 'site_pdf', url: rep.url } }]));
    return parts;
  } catch (e) {
    bus.emit('status', '');
    return [P.md(`Não consegui ler **${url}** 😕\n${e.message}\n\nConfira o endereço. Alguns sites bloqueiam leitura automática — se o OPS 360° já tem um leitor de sites próprio, dá para conectá-lo (veja \`fetcher\` no LEIA-ME).`)];
  }
};

async function handleTab(ctx) {
  const r = await tabCommand(ctx.res.intent, ctx.res, { chat: ctx.chat, files: await ctxFiles(ctx), currentTabId: ctx.ui.currentTabId, currentSubId: ctx.ui.currentSubId });
  if (r.tabId) ctx.chat.state.lastTab = r.tabId;
  ctx.effects.openTab = r.open ? { tabId: r.tabId, subId: r.subId } : null;
  if (r.exportTab) ctx.effects.exportTab = r.exportTab;
  return r.parts;
}
for (const k of ['tab_create', 'tab_edit', 'tab_list', 'tab_open', 'tab_delete', 'tab_export', 'tab_undo', 'tab_from_site', 'tab_from_file']) H[k] = handleTab;

// ---- Documentos ---------------------------------------------------------------------------------
function nextStepChips(docType, act) {
  const nm = act && !act.generic ? act.nome.toLowerCase() : '';
  const base = {
    apr: [{ label: 'Gerar em Word', send: 'Agora em Word' }, nm && act.pt ? { label: 'Permissão de trabalho', send: `Gera uma PT de ${nm}` } : null, nm ? { label: 'Checklist da atividade', send: `Faz um checklist de ${nm}` } : null, { label: 'Adicionar um risco', send: 'Adicione o risco de ' }],
    pt: [{ label: 'APR da atividade', send: nm ? `Faz uma APR de ${nm}` : 'Faz uma APR' }, { label: 'Gerar em Word', send: 'Agora em Word' }],
    dds: [{ label: 'Lista de presença maior', send: 'Mude para 30 pessoas' }, { label: 'Comunicado sobre o tema', send: nm ? `Faz um comunicado sobre ${nm}` : 'Faz um comunicado de segurança' }, { label: 'Gerar em Word', send: 'Agora em Word' }],
    checklist: [{ label: 'Gerar em Excel', send: 'Agora em Excel' }, { label: 'Adicionar item', send: 'Adicione o item ' }, { label: '🗂️ Transformar em aba', send: 'Crie uma aba para controlar inspeções com campos: data, equipamento, inspetor, resultado, observação' }],
    inspecao: [{ label: 'Plano de ação 5W2H', send: 'Monta um plano de ação 5W2H' }, { label: 'Comunicado/alerta', send: 'Faz um alerta de segurança sobre isso' }],
  }[docType] || [{ label: 'Gerar em Word', send: 'Agora em Word' }, { label: 'Gerar em Excel', send: 'Agora em Excel' }];
  return base.filter(Boolean).slice(0, 4);
}
function activityOptionsChips() {
  const top = memory.top('activities', 3).map((x) => ACT_BY_ID[x.key]).filter(Boolean);
  const common = ['empilhadeira', 'altura', 'eletrica', 'quente', 'confinado', 'maquinas', 'andaime', 'quimicos', 'manutencao', 'escada', 'icamento', 'limpeza'].map((id) => ACT_BY_ID[id]);
  return uniq([...top, ...common]).slice(0, 10).map((a) => ({ label: a.nome, send: a.nome }));
}
H.doc_generate = async (ctx, override = {}) => {
  const { res, chat } = ctx;
  const st = chat.state;
  const docType = override.docType || res.slots.docType || res.docType || (res.slots.followUp && st.lastDoc ? st.lastDoc.type : null);
  if (!docType || !GENERATORS[docType]) return H.ask_doctype(ctx);
  const follow = !!(res.slots.followUp || override.followUp) && st.lastDoc;
  const params = { ...(follow ? st.lastDoc.params : {}), ...(override.params || {}), ...res.slots.params };
  if (params.data && !(params.data instanceof Date)) params.data = new Date(params.data);
  if (!params.detail) params.detail = memory.preferredDetail() || undefined;
  const all = await ctxFiles(ctx);
  const photos = all.filter((f) => f.kind === 'image' && f.image);
  const docsF = all.filter((f) => f.kind !== 'image' && f.text && f.text.length > 30);
  const wantsFile = res.slots.fromFile || docType === 'resumo_doc' || (docsF.length && /(desse|deste|nesse|neste|dess[ae]|dest[ae]|com base|a partir|baseado|usando|transform|convert|conforme o)/.test(res.t));
  const fromFile = override.fromFile || (wantsFile ? docsF[0] : null);
  if (docType === 'resumo_doc' && !fromFile) return [P.md('Anexe o documento que você quer que eu analise (📎) e peça o relatório de novo.')];
  let acts = override.acts || (res.slots.acts && res.slots.acts.length ? res.slots.acts : []);
  if (!acts.length && follow) acts = (st.lastDoc.actIds || []).map((id) => ACT_BY_ID[id]).filter(Boolean);
  if (!acts.length && fromFile) acts = findActivities(fromFile.text.slice(0, 30000), memory.data.synonyms);
  const description = override.description || extractDescription(res.raw);
  if (!acts.length && (photos.length || docType === 'inspecao')) acts = findActivities(description, memory.data.synonyms);
  const needsAct = ['apr', 'pt', 'os', 'pop', 'ficha_epi', 'inventario'].includes(docType);
  if (!acts.length && needsAct && !override.allowGeneric && !(follow && st.lastDoc.custom)) {
    st.pending = { kind: 'activity', docType, params, text: res.raw };
    return [P.md(`Para qual atividade é ${artigo(docType)} **${DOC_TYPES_GEN[docType].label}**? Me diga com suas palavras (ex.: *troca de telhas no galpão*, *solda de tubulação*) ou escolha:`), P.chips(activityOptionsChips())];
  }
  let act = follow && st.lastDoc.custom && !res.slots.acts.length ? deepClone(st.lastDoc.custom) : acts.length ? mergeActivities(acts) : genericActivity(override.activityName || params.tema || '');
  if (override.custom) act = override.custom;
  const gctx = { text: res.raw, act, acts: acts.length ? acts : [act], actDetected: acts.length > 0 || !!override.custom, params, profile: memory.profile, fromFile, photos, description, steps: fromFile ? extractSteps(fromFile.text) : null };
  let out;
  try {
    out = GENERATORS[docType](gctx);
  } catch (e) {
    console.error('[OPS360IA] gerador', docType, e);
    return [P.md(`Tive um problema ao montar ${artigo(docType)} ${shortDoc(docType)} 😕 (${e.message}). Tente reformular o pedido.`)];
  }
  const doc = out.doc;
  doc.chatId = chat.id;
  doc.request = res.raw;
  await docStore.put(doc);
  st.lastDoc = { type: docType, actIds: acts.map((a) => a.id), params, docId: doc.id, text: res.raw, fileId: fromFile ? fromFile.id : null, custom: override.custom || (follow && st.lastDoc.custom) || null };
  st.pending = null;
  const fmt = res.format || null;
  const intro = override.intro || pick(['Pronto! ✅', 'Feito! ✅', 'Aqui está! 📄', 'Prontinho! ✅']);
  const warnGeneric = act.generic && needsAct ? '\n\n⚠️ Não reconheci a atividade na minha biblioteca, então usei uma base genérica — revise com a equipe ou me descreva melhor (equipamentos, altura, energia, produtos) que eu refaço.' : '';
  const fmtNote = fmt === 'print' ? '\nAbrindo a impressão…' : fmt ? `\nBaixando em **${fmt.toUpperCase()}**…` : '';
  return [P.md(`${intro} ${out.resumo}${warnGeneric}${fmtNote}`), P.doc(doc, fmt), P.chips(nextStepChips(docType, act))];
};
H.doc_reformat = async (ctx) => {
  const ld = ctx.chat.state.lastDoc;
  const doc = ld && (await docStore.get(ld.docId));
  if (!doc) return [P.md('Qual documento? Me diga o tipo (ex.: *APR de solda em Word*).')];
  const fmt = ctx.res.format;
  return [P.md(`Claro! Aqui está **${doc.title}** em ${fmt === 'print' ? 'modo de impressão' : fmt.toUpperCase()}.`), P.doc(doc, fmt)];
};
H.doc_modify = async (ctx) => {
  const { res, chat } = ctx;
  const ld = chat.state.lastDoc;
  if (!ld) return H.unknown(ctx);
  const op = res.slots.op;
  const acts = (ld.actIds || []).map((id) => ACT_BY_ID[id]).filter(Boolean);
  let custom = ld.custom ? deepClone(ld.custom) : acts.length ? deepClone(mergeActivities(acts)) : genericActivity(ld.params.tema);
  const params = { ...ld.params };
  let what = '';
  if (op === 'add' || op === 'remove') {
    const item = cleanName((/\b(?:risco|perigo|item|itens|epi|etapa|medida|controle|ponto|pergunta)s?\s+(?:de|do|da|com|:)?\s*(.+)$/i.exec(res.raw) || [])[1] || '');
    if (!item) return [P.md('Qual item? Ex.: *"adicione o risco de ruído"* ou *"adicione o item verificar extintor"*.')];
    what = item;
    const isEpi = /\bepis?\b/i.test(res.raw);
    if (op === 'add') {
      if (isEpi) custom.epis = uniq([...custom.epis, capFirst(item)]);
      else if (['checklist', 'dds', 'comunicado'].includes(ld.type)) params.extraItems = [...(params.extraItems || []), capFirst(item)];
      else {
        let hz = null, best = 0;
        for (const a of ACTIVITIES)
          for (const p of a.perigos) {
            const s = dice(p[1], item) + (norm(p[1]).includes(norm(item)) ? 0.5 : 0);
            if (s > best) {
              best = s;
              hz = p;
            }
          }
        custom.perigos = [...custom.perigos, hz && best > 0.45 ? deepClone(hz) : ['Todas', capFirst(item), 'A avaliar com a equipe', 3, 3, ['Definir medidas de controle com a equipe executante']]];
      }
    } else {
      const k = norm(item);
      if (isEpi) custom.epis = custom.epis.filter((e) => !norm(e).includes(k));
      else if (['checklist', 'dds', 'comunicado'].includes(ld.type)) params.removeItems = [...(params.removeItems || []), k];
      else custom.perigos = custom.perigos.filter((p) => !norm(p[1]).includes(k));
    }
  } else if (op === 'param') {
    Object.assign(params, extractParams(res.raw));
    const m = /\b(?:para|como)\s+["“]?([^"”]+?)["”]?$/.exec(res.raw);
    if (m && /\blocal|setor\b/i.test(res.raw)) params.local = capFirst(m[1]);
    if (m && /\bempresa\b/i.test(res.raw)) params.empresa = m[1];
    if (m && /\bresponsavel|responsável\b/i.test(res.raw)) params.responsavel = titleCase(m[1]);
    if (m && /\btema\b/i.test(res.raw)) params.tema = m[1];
  } else if (op === 'detail') params.detail = /(curt|resum|simples|enxug)/.test(res.t) ? 'resumido' : 'completo';
  const r = await H.doc_generate({ ...ctx, res: { ...res, slots: { ...res.slots, acts: [], params: {}, docType: ld.type } } }, { docType: ld.type, params, custom, followUp: true, intro: op === 'add' ? `Incluí **${what}**. ✅` : op === 'remove' ? `Removi **${what}**. ✅` : 'Atualizado! ✅' });
  return r;
};
H.pending_answer = async (ctx) => {
  const { chat, res } = ctx;
  const pd = chat.state.pending;
  chat.state.pending = null;
  if (pd.kind === 'ask_name') {
    const w = (res.raw.replace(/^(meu nome [eé]|me chamo|sou o|sou a|sou|pode me chamar de|é)\s+/i, '').match(/[A-Za-zÀ-ÿ]+/) || [])[0];
    if (w && w.length >= 2 && !/^(nao|não|oi|ola|olá|bom|boa|tudo)$/i.test(w)) {
      memory.setProfile('name', capFirst(w.toLowerCase()));
      return [P.md(`Prazer, ${capFirst(w.toLowerCase())}! 😊 Em que posso ajudar na segurança hoje?`), P.chips(greetingChips())];
    }
    return H.greet({ ...ctx, chat: { ...chat, state: { ...chat.state } } });
  }
  if (pd.kind === 'activity') {
    const acts = findActivities(res.raw, memory.data.synonyms);
    if (acts.length) {
      // aprende: palavras do pedido original que não eram conhecidas → atividade escolhida
      const known = new Set(tokenize('faz faca gera gere cria crie monta monte uma um apr pt dds checklist os pop ficha epi de para do da em no na inventario riscos permissao trabalho ordem servico procedimento'));
      const novel = words(pd.text).filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !known.has(stem(w)) && !/^\d+$/.test(w));
      if (novel.length && novel.length <= 3) novel.forEach((w) => memory.learnSynonym(w, acts[0].id));
      const r = await H.doc_generate({ ...ctx, res: { ...res, raw: pd.text, t: norm(pd.text), slots: { ...res.slots, docType: pd.docType, acts, params: pd.params }, format: detectFormat(norm(pd.text)) } }, {});
      if (novel.length && novel.length <= 3) r.unshift(P.md(`Entendido! Vou lembrar que **${novel.join(' ')}** tem a ver com **${acts[0].nome.toLowerCase()}**. 🧠`));
      return r;
    }
    return H.doc_generate({ ...ctx, res: { ...res, raw: pd.text, t: norm(pd.text), slots: { ...res.slots, docType: pd.docType, acts: [], params: pd.params }, format: detectFormat(norm(pd.text)) } }, { allowGeneric: true, activityName: res.raw.trim() });
  }
  return H.unknown(ctx);
};
H.kb_search = (ctx) => {
  const q = ctx.res.raw;
  const facts = memory.recallFacts(q, 2);
  const hits = kbIndex().search(q, 3);
  const top = hits[0];
  const parts = [];
  if (facts.length) parts.push(P.md(`📌 Você me disse: ${facts.map((f) => `“${f.text}”`).join('; ')}`));
  if (top && top.score > 2.2 && top.coverage >= 0.4) {
    const m = top.meta;
    if (m.kind === 'nr') return [...parts, ...H.nr_info({ ...ctx, res: { ...ctx.res, slots: { ...ctx.res.slots, nr: m.n } } })];
    if (m.kind === 'glossary') {
      const g = GLOSSARY[m.i];
      return [...parts, ...H.define({ ...ctx, res: { ...ctx.res, slots: { ...ctx.res.slots, glossary: { termo: g[0], definicao: g[2], nrs: g[3], dica: g[4] } } } })];
    }
    if (m.kind === 'activity') return [...parts, ...H.activity_info({ ...ctx, res: { ...ctx.res, slots: { ...ctx.res.slots, acts: [ACT_BY_ID[m.id]] } } })];
    if (m.kind === 'advice') return [...parts, ...H.advice({ ...ctx, res: { ...ctx.res, slots: { ...ctx.res.slots, advice: ADVICE.find((a) => a.id === m.id) } } })];
  }
  if (parts.length) return parts;
  return H.unknown(ctx);
};
H.short = (ctx) => H.kb_search(ctx);
H.unknown = (ctx) => {
  const t = ctx.res.t;
  const guesses = [];
  const acts = findActivities(t, memory.data.synonyms);
  if (acts.length) guesses.push({ label: `Riscos de ${acts[0].nome.toLowerCase()}`, send: `Quais os riscos de ${acts[0].nome.toLowerCase()}?`, learnFrom: ctx.res.raw });
  const kb = kbIndex().search(t, 2);
  for (const k of kb) {
    if (k.meta.kind === 'nr') guesses.push({ label: `NR-${k.meta.n}`, send: `O que diz a NR-${k.meta.n}?`, learnFrom: ctx.res.raw });
    if (k.meta.kind === 'glossary') guesses.push({ label: `O que é ${GLOSSARY[k.meta.i][0]}`, send: `O que é ${GLOSSARY[k.meta.i][0]}?`, learnFrom: ctx.res.raw });
    if (k.meta.kind === 'advice') guesses.push({ label: ADVICE.find((a) => a.id === k.meta.id).titulo, send: ADVICE.find((a) => a.id === k.meta.id).titulo, learnFrom: ctx.res.raw });
  }
  guesses.push({ label: '📄 Gerar um documento', send: 'O que você sabe fazer?', learnFrom: null }, { label: '✨ Criar uma aba', send: 'Crie uma nova aba', learnFrom: ctx.res.raw });
  ctx.chat.state.lastFallback = ctx.res.raw;
  return [P.md(pick(['Hmm, não entendi muito bem 🤔', 'Não tenho certeza do que você quis dizer 🤔', 'Não captei direito 🤔']) + ' Você quis dizer alguma destas? Se escolher, eu **aprendo** para as próximas vezes.'), P.chips(guesses.slice(0, 5))];
};

// ---- Entrada principal --------------------------------------------------------------------------
async function aiRespond(chat, { text, files = [], meta = {} }, ui = {}) {
  const res = classify(text, { files, activeFiles: chat.state.activeFiles, lastDoc: chat.state.lastDoc, lastIntent: chat.state.lastIntent, pending: chat.state.pending, workspaceOpen: !!ui.workspaceOpen });
  if (meta.forceIntent) res.intent = meta.forceIntent;
  const ctx = { chat, res, files, ui, effects: {} };
  const pendingBefore = chat.state.pending;
  let parts;
  try {
    const fn = H[res.intent] || H.unknown;
    parts = await fn(ctx);
  } catch (e) {
    console.error('[OPS360IA]', e);
    parts = [P.md(`Ops, algo deu errado aqui 😕 (${e.message}). Pode tentar de novo?`)];
  }
  if (res.greeted && res.intent !== 'greet' && nameOf()) parts.unshift(P.md(`${pick(['Oi', 'Olá'])}, ${nameOf()}!`));
  // aprendizado: o usuário escolheu uma sugestão depois de um "não entendi"
  if (meta.learnFrom && res.intent !== 'unknown' && res.intent !== 'short') memory.learn(meta.learnFrom, res.intent, { docType: res.docType || null });
  if (res.intent !== 'pending_answer') chat.state.lastIntent = res.intent;
  if (res.intent !== 'pending_answer' && pendingBefore && chat.state.pending === pendingBefore) chat.state.pending = null;
  memory.noteTurn(text, res);
  const firstReal = chat.autoTitle && !['greet', 'howareyou', 'user_state', 'thanks', 'bye', 'compliment', 'empty', 'short', 'unknown', 'pending_answer', 'set_name', 'help'].includes(res.intent);
  if (firstReal) {
    chat.title = autoTitle(text || (files[0] && files[0].name) || 'Conversa', res);
    chat.autoTitle = false;
  }
  return { parts, intent: res.intent, effects: ctx.effects, res };
}
