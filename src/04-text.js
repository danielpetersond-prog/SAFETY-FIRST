// ---------------------------------------------------------------------------
// 04 · Processamento de linguagem (pt-BR): tokens, radicais, busca BM25,
//      resumo extrativo, palavras-chave e extração de entidades de SST.
// ---------------------------------------------------------------------------
const STOPWORDS = new Set(
  (
    'a o as os um uma uns umas de do da dos das d em no na nos nas num numa por pelo pela pelos pelas para pra pro pros pras ' +
    'com sem sob sobre ate apos entre contra desde e ou mas porem que se como quando onde qual quais quem cujo cuja ' +
    'este esta estes estas isto esse essa esses essas isso aquele aquela aqueles aquelas aquilo ' +
    'eu tu ele ela nos vos eles elas me te lhe lhes meu minha meus minhas teu tua seu sua seus suas nosso nossa nossos nossas ' +
    'ao aos a as e foi era sao ser sera sendo sido ter tem tinha tenho temos ha havia esta estao estava estar estou ' +
    'ja nao sim muito muita muitos muitas mais menos tambem so bem ainda cada todo toda todos todas outro outra outros outras ' +
    'mesmo mesma la aqui ai entao pois porque assim etc tal tais algum alguma alguns algumas nenhum nenhuma qualquer ' +
    'voce voces vc vcs gente favor pode podem poderia deve devem sobre seja sejam fazer faz feito vai vou vamos ' +
    'quero queria gostaria preciso precisa oi ola ne tipo coisa coisas aquela dela dele deles delas nele nela lo la los las'
  ).split(/\s+/)
);

function stem(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  // plural
  if (/(oes|aes)$/.test(w)) w = w.slice(0, -3) + 'ao';
  else if (/ais$/.test(w)) w = w.slice(0, -3) + 'al';
  else if (/eis$/.test(w) && w.length > 5) w = w.slice(0, -3) + 'el';
  else if (/ois$/.test(w)) w = w.slice(0, -3) + 'ol';
  else if (/ns$/.test(w)) w = w.slice(0, -2) + 'm';
  else if (/(res|zes|les)$/.test(w) && w.length > 5) w = w.slice(0, -2);
  else if (/[^s]s$/.test(w) && w.length > 3) w = w.slice(0, -1);
  const SUF = [
    'amente', 'mente', 'acoes', 'icoes', 'acao', 'icao', 'ucao', 'cao', 'idades', 'idade', 'ismos', 'ismo', 'istas', 'ista',
    'aveis', 'avel', 'iveis', 'ivel', 'adoras', 'adores', 'adora', 'ador', 'amentos', 'amento', 'imentos', 'imento',
    'ancias', 'ancia', 'encias', 'encia', 'ando', 'endo', 'indo', 'ados', 'adas', 'idos', 'idas', 'ado', 'ada', 'ido', 'ida',
    'aria', 'eria', 'eiro', 'eira', 'ar', 'er', 'ir', 'ao', 'o', 'a', 'e',
  ];
  for (const s of SUF) {
    if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length);
  }
  return w;
}
function words(text) {
  return norm(text).match(/[a-z0-9]+(?:[-][a-z0-9]+)*/g) || [];
}
function tokenize(text, keepStop = false) {
  const out = [];
  for (const w of words(text)) {
    if (!keepStop && (STOPWORDS.has(w) || w.length < 2)) continue;
    // "nr-35" vira "nr35"; "nr" sozinho é mantido
    out.push(/^nr-?\d+$/.test(w) ? w.replace('-', '') : stem(w));
  }
  return out;
}

// Distância de edição limitada (para tolerar erros de digitação)
function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
// Similaridade de strings por bigramas (nomes de abas, títulos)
function dice(a, b) {
  a = norm(a).replace(/\s+/g, ' ');
  b = norm(b).replace(/\s+/g, ' ');
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bg = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const A = bg(a), B = bg(b);
  let inter = 0;
  for (const [g, c] of A) if (B.has(g)) inter += Math.min(c, B.get(g));
  return (2 * inter) / (a.length + b.length - 2);
}

// ---- BM25 --------------------------------------------------------------------
class BM25 {
  constructor({ k1 = 1.4, b = 0.72 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.docs = [];
    this.df = new Map();
    this.totalLen = 0;
  }
  add(id, text, meta) {
    const toks = tokenize(text);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
    this.docs.push({ id, tf, len: toks.length || 1, meta, text });
    this.totalLen += toks.length || 1;
    return this;
  }
  _expand(qt) {
    // termos ausentes no vocabulário: procura vizinhos com 1-2 letras de diferença
    const out = [];
    for (const t of qt) {
      if (this.df.has(t)) out.push([t, 1]);
      else if (t.length >= 5) {
        for (const v of this.df.keys()) {
          if (v[0] === t[0] && Math.abs(v.length - t.length) <= 2 && editDistance(t, v, t.length >= 8 ? 2 : 1) <= (t.length >= 8 ? 2 : 1)) out.push([v, 0.7]);
        }
      }
    }
    return out;
  }
  search(query, k = 5, minScore = 0.01) {
    const N = this.docs.length;
    if (!N) return [];
    const avgdl = this.totalLen / N;
    const qt = this._expand(uniq(tokenize(query)));
    if (!qt.length) return [];
    const res = [];
    for (const d of this.docs) {
      let s = 0, hits = 0;
      for (const [t, w] of qt) {
        const f = d.tf.get(t);
        if (!f) continue;
        hits++;
        const df = this.df.get(t);
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        s += w * idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / avgdl)));
      }
      if (s > minScore) res.push({ id: d.id, score: s, coverage: hits / qt.length, meta: d.meta, text: d.text });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

// ---- Frases, resumo, palavras-chave ---------------------------------------------
const ABBR = /\b(art|arts|inc|n|no|sr|sra|dr|dra|eng|prof|etc|ex|p|pag|fl|fls|obs|min|max|aprox|cap|item|al|av|tel|ltda|cia)\.\s/gi;
function sentences(text) {
  const t = String(text || '')
    .replace(/\r/g, '')
    .replace(ABBR, (m) => m.replace('. ', '.§'))
    .replace(/nº\.\s/gi, 'nº.§');
  return t
    .split(/(?<=[.!?])\s+(?=["“(•\-–]?[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9])|\n+/)
    .map((s) => s.replace(/§/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 1);
}
const SAFETY_TERMS = new Set(
  tokenize(
    'risco perigo acidente seguranca epi epc nr norma obrigatorio proibido treinamento inspecao emergencia controle medida ' +
      'queda choque incendio exposicao protecao prevencao responsavel validade prazo deve devera'
  )
);
function summarize(text, n = 5) {
  const all = sentences(text);
  let sents = all.filter((s) => s.length >= 25 && s.length <= 420 && /[a-zà-ú]{3}/i.test(s));
  if (!sents.length) sents = all.slice(0, n);
  if (sents.length <= n) return sents;
  const tf = new Map();
  const toks = sents.map((s) => uniq(tokenize(s)));
  toks.forEach((ts) => ts.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1)));
  const maxTf = Math.max(1, ...tf.values());
  const scored = sents.map((s, i) => {
    const ts = toks[i];
    let sc = ts.reduce((a, t) => a + (tf.get(t) || 0) / maxTf, 0) / Math.sqrt(ts.length + 2);
    if (i < 3) sc += 0.25;
    else if (i < 8) sc += 0.08;
    if (ts.some((t) => SAFETY_TERMS.has(t))) sc += 0.15;
    if (/^\s*(\d+(\.\d+)*|[a-z]\))\s/.test(s)) sc += 0.05;
    return { s, i, sc, ts };
  });
  const chosen = [];
  for (const c of scored.sort((a, b) => b.sc - a.sc)) {
    if (chosen.some((x) => jaccard(x.ts, c.ts) > 0.55)) continue;
    chosen.push(c);
    if (chosen.length >= n) break;
  }
  return chosen.sort((a, b) => a.i - b.i).map((c) => c.s);
}
function keywords(text, n = 10) {
  const counts = new Map();
  const surface = new Map();
  for (const w of norm(text).match(/[a-z][a-z0-9-]{3,}/g) || []) {
    if (STOPWORDS.has(w)) continue;
    const s = stem(w);
    counts.set(s, (counts.get(s) || 0) + 1);
    const sm = surface.get(s) || new Map();
    sm.set(w, (sm.get(w) || 0) + 1);
    surface.set(s, sm);
  }
  // recupera a grafia original (com acento) mais comum
  const orig = new Map();
  for (const w of String(text).match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9-]{3,}/g) || []) {
    const k = norm(w);
    if (!orig.has(k)) orig.set(k, w.toLowerCase());
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] * Math.min(1.6, 0.6 + b[0].length / 8) - a[1] * Math.min(1.6, 0.6 + a[0].length / 8))
    .slice(0, n)
    .map(([s]) => {
      const best = [...surface.get(s).entries()].sort((a, b) => b[1] - a[1])[0][0];
      return orig.get(best) || best;
    });
}

// ---- Entidades ------------------------------------------------------------------
function extractNRs(text) {
  const out = new Set();
  const re = /\bNR[\s\-–.]*0?(\d{1,2})\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const n = +m[1];
    if (n >= 1 && n <= 38) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}
function extractCAs(text) {
  const out = new Set();
  const re = /\bC\.?\s?A\.?\s*(?:n[º°o.]*\s*)?[:\-–]?\s*(\d{3,6})\b/g;
  let m;
  while ((m = re.exec(text))) out.add(m[1]);
  return [...out];
}
function extractDates(text) {
  const out = [];
  const re = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b|\b(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const d = parseDateBR(m[0]);
    if (!d) continue;
    // contexto = a frase/linha onde a data aparece (limitada a ~160 caracteres)
    const ls = Math.max(text.lastIndexOf('\n', m.index - 1), text.lastIndexOf('. ', m.index - 1) + 1, m.index - 110, 0);
    let le = text.slice(m.index).search(/\n|\.\s/);
    le = le < 0 ? text.length : Math.min(m.index + le + 1, m.index + m[0].length + 60);
    let a = ls;
    if (a > 0 && /\w/.test(text[a - 1] || '')) {
      const sp = text.indexOf(' ', a);
      if (sp > 0 && sp < m.index) a = sp + 1;
    }
    out.push({ date: d, raw: m[0], index: m.index, line: text.slice(text.lastIndexOf('\n', m.index - 1) + 1, m.index), context: text.slice(a, le).replace(/\s+/g, ' ').trim() });
  }
  return out;
}
function extractValidity(text, ref = new Date()) {
  const out = [];
  for (const d of extractDates(text)) {
    // tabelas (linhas com " | ") são avaliadas por coluna em profileTable
    if (d.line.includes(' | ')) continue;
    const before = norm(d.line.slice(-80));
    if (!/(validade|vencimento|vence|valido ate|valida ate|expira|venc\.|proxima (recarga|inspecao|reciclagem|revisao)|reciclagem)/.test(before)) continue;
    const days = daysBetween(ref, d.date);
    out.push({ ...d, days, status: days < 0 ? 'vencido' : days <= 30 ? 'vence em breve' : 'válido' });
  }
  return out;
}
function extractMisc(text) {
  const grab = (re) => uniq((text.match(re) || []).map((s) => s.trim())).slice(0, 12);
  return {
    cnpj: grab(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g),
    cpf: grab(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g).map((c) => c.slice(0, 4) + '***.***-' + c.slice(-2)),
    emails: grab(/[\w.+-]+@[\w-]+\.[\w.-]+/g),
    phones: grab(/(?:\(?\d{2}\)?\s?)?9?\d{4}-?\d{4}\b/g).filter((p) => p.replace(/\D/g, '').length >= 10),
    cas: grab(/\b\d{2,7}-\d{2}-\d\b/g),
    onu: grab(/\b(?:ONU|UN)\s?\d{4}\b/g),
    percent: grab(/\b\d{1,3}(?:[.,]\d+)?\s?%/g),
    money: grab(/R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g),
    measures: grab(/\b\d+(?:[.,]\d+)?\s?(?:dB\(?A?\)?|kV|kW|°C|ºC|kg|m²|m³|ppm|lux|mg\/m³)/gi),
  };
}
// Números com contexto (para "KPIs" de sites e documentos)
function extractKeyNumbers(text, max = 8) {
  const out = [];
  const re = /(?:R\$\s?)?\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b|(?:R\$\s?)?\b\d+(?:,\d+)?\s?(?:%|mil\b|milh(?:ões|oes|ão|ao)\b|bilh(?:ões|oes|ão|ao)\b)|\b\d{2,}(?:,\d+)?\b/g;
  for (const s of sentences(text)) {
    if (s.length > 260) continue;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(s))) {
      const raw = m[0].trim();
      if (/^(19|20)\d{2}$/.test(raw)) continue; // anos
      const v = parseNumBR(raw.replace(/^R\$\s?/, '').replace(/\s?%$/, ''));
      if (isNaN(v)) continue;
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 60).replace(/^[\s,.:;]+/, '');
      const label = truncate(after.split(/[.,;:(]/)[0].trim(), 48) || truncate(s, 48);
      if (label.length < 3) continue;
      out.push({ value: v, raw, label: capFirst(label), context: s, pct: /%$/.test(raw), money: /^R\$/.test(raw) });
      if (out.length >= max * 3) break;
    }
  }
  const seen = new Set();
  return out
    .filter((k) => {
      const key = norm(k.label).slice(0, 20);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}
// Divide um texto longo em trechos (para perguntas e respostas sobre documentos)
function chunkText(text, pageBreaks, size = 700) {
  const chunks = [];
  const paras = String(text || '').split(/\n{2,}|\n(?=\s*(?:\d+(?:\.\d+)*\s|[-•]\s|[A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚ ]{6,}\n))/);
  let buf = '', start = 0, pos = 0;
  const pageAt = (i) => {
    if (!pageBreaks || !pageBreaks.length) return null;
    let p = 1;
    for (let k = 0; k < pageBreaks.length; k++) if (i >= pageBreaks[k]) p = k + 2;
    return p;
  };
  for (const p of paras) {
    const idx = text.indexOf(p, pos);
    if (idx >= 0) pos = idx + p.length;
    if (!buf) start = idx >= 0 ? idx : pos;
    if ((buf + '\n' + p).length > size && buf) {
      chunks.push({ text: buf.trim(), page: pageAt(start) });
      buf = p;
      start = idx >= 0 ? idx : pos;
    } else buf = buf ? buf + '\n' + p : p;
    while (buf.length > size * 1.6) {
      const cut = buf.lastIndexOf('. ', size) > 200 ? buf.lastIndexOf('. ', size) + 1 : size;
      chunks.push({ text: buf.slice(0, cut).trim(), page: pageAt(start) });
      buf = buf.slice(cut);
    }
  }
  if (buf.trim()) chunks.push({ text: buf.trim(), page: pageAt(start) });
  return chunks;
}
