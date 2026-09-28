// ---------------------------------------------------------------------------
// 10 · Análise inteligente de documentos: tipo, resumo, NRs, EPIs, CAs,
//      validades, riscos, alertas de conformidade e perguntas sobre o texto.
// ---------------------------------------------------------------------------
const DOC_TYPES = [
  ['apr', 'Análise Preliminar de Risco (APR)', 'analise preliminar de risco|apr|perigo|medidas de controle|etapa|probabilidade|severidade|risco residual', 'analise preliminar de risco'],
  ['pt', 'Permissão de Trabalho', 'permissao de trabalho|permissao de entrada|pet|liberacao|emitente|executante|encerramento', 'permissao de trabalho|permissao de entrada e trabalho'],
  ['aso', 'Atestado de Saúde Ocupacional (ASO)', 'atestado de saude ocupacional|apto|inapto|admissional|periodico|demissional|medico examinador|crm|exames complementares', 'atestado de saude ocupacional'],
  ['pgr', 'Programa de Gerenciamento de Riscos (PGR)', 'programa de gerenciamento de riscos|inventario de riscos|plano de acao|gro|avaliacao de riscos|ghe|grupo homogeneo', 'programa de gerenciamento de riscos|inventario de riscos'],
  ['ppra', 'PPRA (programa antigo)', 'programa de prevencao de riscos ambientais|ppra', 'programa de prevencao de riscos ambientais'],
  ['pcmso', 'PCMSO', 'programa de controle medico|pcmso|periodicidade dos exames|medico responsavel|relatorio analitico', 'programa de controle medico de saude ocupacional'],
  ['ltcat', 'Laudo técnico (LTCAT/insalubridade/periculosidade)', 'laudo tecnico|ltcat|insalubridade|periculosidade|agente nocivo|aposentadoria especial|conclusao', 'laudo tecnico das condicoes ambientais|laudo de insalubridade|laudo de periculosidade'],
  ['fds', 'Ficha com Dados de Segurança (FDS/FISPQ)', 'ficha de informacoes de seguranca|ficha com dados de seguranca|fispq|fds|identificacao do produto|composicao|primeiros socorros|combate a incendio|numero cas|numero onu|pictograma|frases de perigo|14725', 'fispq|ficha com dados de seguranca|ficha de informacoes de seguranca de produto'],
  ['os', 'Ordem de Serviço de SST', 'ordem de servico|obrigacoes|proibicoes|riscos da funcao|ciente|penalidades|recomendacoes', 'ordem de servico'],
  ['certificado', 'Certificado de treinamento', 'certificado|certificamos|carga horaria|concluiu|curso|instrutor|conteudo programatico|participou', 'certificamos|certificado de conclusao'],
  ['ficha_epi', 'Ficha de entrega de EPI', 'ficha de entrega|ficha de controle|epi|data de entrega|devolucao|assinatura do colaborador|termo de responsabilidade', 'ficha de entrega|controle de entrega de epi|ficha de epi'],
  ['procedimento', 'Procedimento / POP / Instrução de trabalho', 'procedimento|objetivo|escopo|campo de aplicacao|responsabilidades|definicoes|descricao das atividades|referencias|instrucao de trabalho|pop', 'procedimento operacional|instrucao de trabalho|procedimento de seguranca'],
  ['inspecao', 'Relatório de inspeção / auditoria', 'inspecao|nao conformidade|evidencia|constatacao|auditoria|recomendacao|registro fotografico', 'relatorio de inspecao|nao conformidade|relatorio de auditoria'],
  ['acidente', 'Relatório de acidente / investigação', 'acidente|investigacao|causa raiz|testemunha|lesao|ocorrencia|acidentado|5 porques|ishikawa', 'investigacao de acidente|analise de acidente|comunicacao de acidente|relatorio de acidente'],
  ['ata', 'Ata de reunião', 'ata|reuniao|presentes|pauta|deliberacoes|secretario|cipa', 'ata da reuniao|ata de reuniao|ata de eleicao'],
  ['checklist', 'Checklist de inspeção', 'checklist|check list|conforme|nao conforme|n/a|verificacao|item', 'checklist|lista de verificacao'],
  ['dds', 'DDS', 'dialogo diario de seguranca|dds|tema do dia|participantes', 'dialogo diario de seguranca'],
  ['norma', 'Norma / legislação', 'portaria|norma regulamentadora|subitem|anexo|disposicoes|vigencia|revoga', 'norma regulamentadora'],
  ['contrato', 'Contrato', 'contrato|clausula|contratante|contratada|rescisao', 'clausula primeira|do objeto'],
].map(([id, label, kw, strong]) => ({ id, label, kw: kw.split('|'), strong: strong.split('|') }));

function detectDocType(text, kind) {
  const t = ' ' + norm(text.slice(0, 60000)) + ' ';
  const head = norm(text.slice(0, 1500));
  let best = null, bestScore = 0;
  for (const dt of DOC_TYPES) {
    let s = 0;
    for (const k of dt.kw) {
      const re = new RegExp('\\b' + escapeRe(k) + '\\b', 'g');
      s += Math.min(4, (t.match(re) || []).length);
    }
    for (const k of dt.strong) {
      if (head.includes(k)) s += 12;
      else if (t.includes(k)) s += 5;
    }
    if (s > bestScore) {
      best = dt;
      bestScore = s;
    }
  }
  if ((kind === 'xlsx' || kind === 'csv' || kind === 'ods') && (!best || bestScore < 14)) return { id: 'planilha', label: 'Planilha de controle', score: bestScore };
  if (!best || bestScore < 5) return { id: 'documento', label: 'Documento geral', score: bestScore };
  return { id: best.id, label: best.label, score: bestScore };
}

function guessField(text, labels) {
  for (const l of labels) {
    const re = new RegExp('(?:^|\\n|\\|)\\s*' + l + '\\s*[:\\-–]\\s*([^\\n|]{2,90})', 'i');
    const m = re.exec(text);
    if (m) {
      const v = m[1].replace(/_{3,}.*/, '').trim();
      if (v && !/^[_.\s-]+$/.test(v)) return v;
    }
  }
  return null;
}

// Perfil de uma tabela: cabeçalho, tipos de coluna e estatísticas
function profileTable(rows) {
  rows = (rows || []).filter((r) => r && r.some((c) => String(c).trim() !== ''));
  if (!rows.length) return null;
  let hi = 0;
  for (let i = 0; i < Math.min(rows.length - 1, 6); i++) {
    const ne = rows[i].filter((c) => String(c).trim() !== '');
    if (ne.length >= Math.max(1, rows[i].length * 0.5) && ne.every((c) => isNaN(parseNumBR(c)) || /[a-z]/i.test(c))) {
      hi = i;
      break;
    }
  }
  const width = Math.max(...rows.map((r) => r.length));
  const head = Array.from({ length: width }, (_, i) => String((rows[hi] || [])[i] || '').trim() || `Coluna ${i + 1}`);
  const body = rows.slice(hi + 1).map((r) => Array.from({ length: width }, (_, i) => String(r[i] == null ? '' : r[i]).trim()));
  const monthRe = /^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?(\s*[/-]?\s*\d{2,4})?$/;
  const cols = head.map((name, ci) => {
    const vals = body.map((r) => r[ci]).filter((v) => v !== '');
    const nums = vals.map(parseNumBR).filter((n) => !isNaN(n));
    const dates = vals.filter((v) => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$|^\d{4}-\d{2}-\d{2}/.test(v)).map((v) => parseDateBR(v)).filter(Boolean);
    const u = new Set(vals.map(norm));
    let type = 'text';
    if (vals.length && dates.length / vals.length >= 0.7) type = 'date';
    else if (vals.length && vals.filter((v) => monthRe.test(norm(v))).length / vals.length >= 0.7) type = 'period';
    else if (vals.length && nums.length / vals.length >= 0.8) type = /^(ano|year)$/i.test(norm(name)) && nums.every((n) => n > 1900 && n < 2200) ? 'period' : 'number';
    else if (u.size <= Math.max(2, Math.min(15, vals.length * 0.6))) type = 'category';
    const c = { name, index: ci, type, filled: vals.length, unique: u.size };
    if (type === 'number') {
      c.sum = nums.reduce((a, b) => a + b, 0);
      c.min = Math.min(...nums);
      c.max = Math.max(...nums);
      c.avg = c.sum / (nums.length || 1);
      c.pct = vals.some((v) => /%$/.test(v)) || (/%|percent|taxa/.test(norm(name)) && c.max <= 100);
    }
    if (type === 'date') {
      c.dates = dates;
      if (/(valid|venc|expira|proxim|reciclag|recarga|revalid)/.test(norm(name))) {
        const now = new Date();
        c.validity = {
          vencidos: dates.filter((d) => daysBetween(now, d) < 0).length,
          aVencer: dates.filter((d) => daysBetween(now, d) >= 0 && daysBetween(now, d) <= 30).length,
          ok: dates.filter((d) => daysBetween(now, d) > 30).length,
        };
      }
    }
    return c;
  });
  return { headerIndex: hi, head, body, cols, rows: body.length };
}

function analyzeDoc(rec) {
  const text = rec.text || '';
  const t = norm(text);
  if (rec.kind === 'image') {
    const ex = (rec.image && rec.image.exif) || {};
    const alerts = [];
    if (rec.image && rec.image.brightness != null && rec.image.brightness < 0.22) alerts.push('📷 A foto está bem escura — pode dificultar a evidência no relatório.');
    return {
      type: 'foto', typeLabel: 'Foto / imagem', summary: [], keywords: [], nrs: [], cas: [], validity: [], dates: [], epis: [], hazards: [], activities: [], alerts,
      photoDate: ex.date || null, gps: ex.lat != null ? { lat: ex.lat, lon: ex.lon } : null, camera: [ex.make, ex.model].filter(Boolean).join(' '),
    };
  }
  const dt = detectDocType(text, rec.kind);
  const validity = extractValidity(text);
  const nrs = extractNRs(text);
  const epis = EPI_CATALOG.filter((e) => e[1].split(',').some((k) => new RegExp('\\b' + escapeRe(norm(k))).test(t))).map((e) => e[0]);
  const hazards = HAZARD_TERMS.filter((h) => h[1].split(',').some((k) => t.includes(norm(k)))).map((h) => h[0]);
  const alerts = [];
  for (const v of validity.slice(0, 8)) {
    if (v.status === 'vencido') alerts.push(`⚠️ Vencido há ${-v.days} dia(s): “${truncate(v.context, 90)}”`);
    else if (v.status === 'vence em breve') alerts.push(`⏳ Vence em ${v.days} dia(s): “${truncate(v.context, 90)}”`);
  }
  if (/\bppra\b|programa de prevencao de riscos ambientais/.test(t)) alerts.push('📌 O documento cita o PPRA, que foi substituído pelo PGR (NR-01/NR-09) desde janeiro de 2022 — vale atualizar.');
  if (/\bnr[\s-]*0?2\b(?!\d)/.test(t) || /\bnr[\s-]*27\b/.test(t)) alerts.push('📌 Há referência a NR revogada (NR-02 ou NR-27).');
  if (['apr', 'pt', 'os', 'ficha_epi', 'checklist'].includes(dt.id) && !/assinatura|assinado|visto|rubrica/.test(t)) alerts.push('✍️ Não encontrei campos de assinatura — documentos de SST precisam de ciência/aprovação.');
  if (dt.id === 'aso' && /\binapto\b/.test(t) && !/\bapto\b[^a-z]*\(?\s*x/.test(t)) alerts.push('🩺 O ASO menciona “inapto” — confira a conclusão antes de liberar a atividade.');
  if (dt.id === 'certificado') {
    const ch = /carga hor[aá]ria[^0-9]{0,20}(\d{1,3})\s*h/i.exec(text);
    const hours = ch ? +ch[1] : null;
    const rules = { 35: 8, 10: 40, 33: 16, 20: 4 };
    for (const n of nrs) if (rules[n] && hours != null && hours < rules[n]) alerts.push(`🎓 Carga horária de ${hours}h parece abaixo do mínimo usual para NR-${n} (${rules[n]}h no treinamento inicial).`);
  }
  if (dt.id === 'fds') {
    const secs = new Set((t.match(/\b(?:secao|seção)\s*(\d{1,2})/g) || []).map((x) => +x.replace(/\D/g, '')));
    if (secs.size && secs.size < 12) alerts.push(`🧪 Encontrei ${secs.size} das 16 seções esperadas numa FDS (ABNT NBR 14725).`);
  }
  let tableProfiles = [];
  const tbls = rec.sheets || rec.tables || [];
  for (const tb of tbls.slice(0, 8)) {
    const p = profileTable(tb.rows);
    if (!p) continue;
    tableProfiles.push({ name: tb.name, rows: p.rows, cols: p.cols.map((c) => ({ name: c.name, type: c.type, validity: c.validity || null })) });
    for (const c of p.cols) {
      if (c.validity && (c.validity.vencidos || c.validity.aVencer)) {
        alerts.push(`📅 ${tb.name}: ${c.validity.vencidos} vencido(s) e ${c.validity.aVencer} vencendo em 30 dias (coluna “${c.name}”).`);
      }
    }
  }
  const words = (text.match(/\S+/g) || []).length;
  return {
    type: dt.id,
    typeLabel: dt.label,
    words,
    summary: text.length > 200 ? summarize(text, words > 1500 ? 6 : 4) : text ? [truncate(text, 400)] : [],
    keywords: keywords(text, 10),
    nrs,
    cas: extractCAs(text),
    validity: validity.map((v) => ({ date: isoDate(v.date), raw: v.raw, days: v.days, status: v.status, context: truncate(v.context, 140) })),
    dates: extractDates(text).slice(0, 15).map((d) => ({ date: isoDate(d.date), raw: d.raw })),
    epis,
    hazards,
    activities: findActivities(text.slice(0, 30000), {}, 3).map((a) => a.id),
    misc: extractMisc(text),
    empresa: guessField(text, ['empresa', 'raz[aã]o social', 'contratante', 'cliente', 'empregador']),
    responsavel: guessField(text, ['respons[aá]vel', 'elaborado por', 'emitente', 't[eé]cnico de seguran[cç]a', 'engenheiro', 'instrutor']),
    local: guessField(text, ['local', 'setor', '[aá]rea', 'unidade', 'obra', 'endere[cç]o']),
    colaborador: guessField(text, ['colaborador', 'funcion[aá]rio', 'empregado', 'nome do trabalhador', 'nome']),
    tables: tableProfiles,
    alerts,
  };
}

// Perguntas e respostas sobre um documento (busca por trechos relevantes)
const _docIndexCache = new Map();
function docIndex(rec) {
  if (_docIndexCache.has(rec.id)) return _docIndexCache.get(rec.id);
  const ix = new BM25();
  const chunks = chunkText(rec.text || '', rec.pageBreaks, 650);
  chunks.forEach((c, i) => ix.add(i, c.text, { page: c.page }));
  const v = { ix, chunks };
  _docIndexCache.set(rec.id, v);
  return v;
}
function docSearch(rec, question, k = 3) {
  const { ix } = docIndex(rec);
  return ix.search(question, k).map((r) => ({ text: r.text, page: r.meta.page, score: r.score, coverage: r.coverage }));
}
// Destaca (em **negrito**) as palavras da pergunta dentro do trecho
function highlightTerms(snippet, question) {
  const qs = new Set(tokenize(question));
  return snippet.replace(/[A-Za-zÀ-ÿ0-9-]{3,}/g, (w) => (qs.has(tokenize(w)[0]) ? `**${w}**` : w));
}
function bestSnippet(text, question, max = 420) {
  const sents = sentences(text);
  const qs = new Set(tokenize(question));
  let best = 0, bestI = 0;
  sents.forEach((s, i) => {
    const sc = tokenize(s).filter((t) => qs.has(t)).length;
    if (sc > best) {
      best = sc;
      bestI = i;
    }
  });
  let out = sents[bestI] || text;
  let i = bestI + 1;
  while (i < sents.length && out.length + sents[i].length < max) out += ' ' + sents[i++];
  if (bestI > 0 && out.length + sents[bestI - 1].length < max) out = sents[bestI - 1] + ' ' + out;
  return truncate(out, max);
}
