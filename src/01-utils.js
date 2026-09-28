// ---------------------------------------------------------------------------
// 01 · Utilitários gerais (DOM, texto, datas, números, arquivos)
// ---------------------------------------------------------------------------
const VERSION = '3.0.0';
const PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
const IS_USERSCRIPT = typeof GM_info !== 'undefined';

// Evita montar duas vezes (script incluído duas vezes ou userscript + <script>)
if (PAGE.__OPS360IA_LOADED__) return;
PAGE.__OPS360IA_LOADED__ = VERSION;

const DEFAULT_PROXIES = [
  'https://api.allorigins.win/raw?url={url}',
  'https://corsproxy.io/?url={url}',
  'https://api.codetabs.com/v1/proxy?quest={url}',
  'https://r.jina.ai/{rawurl}',
];

const CFG = Object.assign(
  {
    mount: null, //            seletor/elemento onde o painel deve ser montado
    replaceLegacy: true, //    esconde o painel antigo "OPS360° IA" e monta no lugar dele
    assistantName: 'Aurora',
    userName: null, //         nome do usuário (se o app já souber)
    company: null, //          empresa padrão para documentos
    navSelector: null, //      barra de abas do app (para injetar as abas criadas pela IA)
    slackSelector: null, //    botão flutuante do Slack
    slackDock: true, //        ativa o dock inteligente do Slack
    strictOffline: false, //   true = nunca usa internet (sites, OCR, pdf.js)
    proxies: DEFAULT_PROXIES, // leitores públicos usados quando o site não libera CORS
    fetcher: null, //          function(url) => Promise<string|{text,contentType}> do app
    force: false, //           userscript: montar mesmo sem detectar o OPS 360°
    zIndex: 2147483000,
  },
  PAGE.OPS360IA_CONFIG || {}
);

// ---- DOM -------------------------------------------------------------------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  appendKids(el, children);
  return el;
}
function appendKids(el, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendKids(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}
function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
}
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function uid(prefix = 'id') {
  const r = (crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 4e9, Math.random() * 4e9]);
  return `${prefix}_${Date.now().toString(36)}${(r[0] >>> 0).toString(36)}${(r[1] >>> 0).toString(36).slice(0, 4)}`;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function debounce(fn, ms) {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a) => {
    clearTimeout(t);
    fn(...a);
  };
  return d;
}
function throttle(fn, ms) {
  let last = 0, t;
  return (...a) => {
    const now = Date.now();
    clearTimeout(t);
    if (now - last >= ms) {
      last = now;
      fn(...a);
    } else t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last));
  };
}
function hashStr(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}
const pick = (arr, seed) => arr[(seed == null ? Math.floor(Math.random() * arr.length) : hashStr(String(seed)) % arr.length)];
const uniq = (arr) => [...new Set(arr)];
const deepClone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

// ---- Texto -----------------------------------------------------------------
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function slug(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
}
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function titleCase(s) {
  const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'para', 'com', 'por', 'na', 'no']);
  return String(s || '')
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : /^[A-Z0-9-]{2,}$/.test(w) ? w : capFirst(w.toLowerCase())))
    .join(' ');
}
function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}
function listPT(items, conj = 'e') {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a.join('');
  return a.slice(0, -1).join(', ') + ` ${conj} ` + a[a.length - 1];
}

// ---- Números (pt-BR) --------------------------------------------------------
function parseNumBR(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  s = s.replace(/^R\$\s*/i, '').replace(/\s/g, '').replace(/%$/, '');
  let mult = 1;
  const m = s.match(/^(-?[\d.,]+)\s*(mil|mi|milh(?:oes|ões|ao|ão)|bi|bilh(?:oes|ões|ao|ão)|k|m)?$/i);
  if (!m) return NaN;
  s = m[1];
  const suf = (m[2] || '').toLowerCase();
  if (suf === 'mil' || suf === 'k') mult = 1e3;
  else if (suf.startsWith('mi') || suf === 'm') mult = 1e6;
  else if (suf.startsWith('bi')) mult = 1e9;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const dec = s.length - lastComma - 1;
    s = (s.match(/,/g).length > 1 || dec === 3) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot > -1) {
    const dec = s.length - lastDot - 1;
    if (s.match(/\./g).length > 1 || (dec === 3 && !/^-?0\./.test(s))) s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n * mult;
}
function fmtNum(n, dec) {
  if (n == null || isNaN(n)) return '—';
  const d = dec != null ? dec : Math.abs(n) >= 100 || Number.isInteger(n) ? 0 : 1;
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtCompact(n) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return fmtNum(n / 1e9, 1) + ' bi';
  if (a >= 1e6) return fmtNum(n / 1e6, 1) + ' mi';
  if (a >= 1e4) return fmtNum(n / 1e3, 1) + ' mil';
  return fmtNum(n, Number.isInteger(n) ? 0 : a < 10 ? 2 : 1);
}
function humanSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
}

// ---- Datas -------------------------------------------------------------------
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_ABR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const pad2 = (n) => String(n).padStart(2, '0');
function fmtDate(d) {
  d = d instanceof Date ? d : new Date(d);
  if (isNaN(d)) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function fmtDateTime(d) {
  d = d instanceof Date ? d : new Date(d);
  return `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtDateLong(d) {
  d = d instanceof Date ? d : new Date(d);
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}
function isoDate(d) {
  d = d instanceof Date ? d : new Date(d);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}
// Interpreta datas em texto: 30/09/2026, 30-09-26, 2026-09-30, "30 de setembro de 2026", "hoje", "amanhã"
function parseDateBR(s, ref = new Date()) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const t = norm(s);
  if (/^hoje\b/.test(t)) return startOfDay(ref);
  if (/^amanha\b/.test(t)) return addDays(startOfDay(ref), 1);
  if (/^ontem\b/.test(t)) return addDays(startOfDay(ref), -1);
  let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = t.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return validDate(y, +m[2], +m[1]);
  }
  m = t.match(/\b(\d{1,2})\s*(?:de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s*(?:de\s+)?(\d{4}))?/);
  if (m) {
    const mi = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'].indexOf(m[2]);
    return validDate(m[3] ? +m[3] : ref.getFullYear(), mi + 1, +m[1]);
  }
  m = t.match(/\b(\d{1,2})[/.\-](\d{1,2})\b/);
  if (m && +m[2] <= 12) return validDate(ref.getFullYear(), +m[2], +m[1]);
  return null;
}
function validDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const x = new Date(y, mo - 1, d);
  return x.getMonth() === mo - 1 ? x : null;
}
// Converte número serial do Excel em data
function excelDate(n) {
  const d = new Date(Math.round((n - 25569) * 86400000));
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function greetingByHour(d = new Date()) {
  const hr = d.getHours();
  return hr < 5 ? 'Boa noite' : hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite';
}

// ---- Arquivos / bytes -------------------------------------------------------
const readAsArrayBuffer = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(file);
  });
const readAsDataURL = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
function decodeText(u8) {
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) u8 = u8.subarray(3);
  else if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  else if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(u8);
  }
}
const utf8 = (s) => new TextEncoder().encode(s);
function latin1(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return s;
}
function latin1Bytes(s) {
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return u8;
}
function concatBytes(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
function dataUrlToBytes(url) {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function bytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e2) {}
    ta.remove();
    return ok;
  }
}
function loadScript(src, globalName, timeout = 25000) {
  return new Promise((res, rej) => {
    if (globalName && PAGE[globalName]) return res(PAGE[globalName]);
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    const t = setTimeout(() => rej(new Error('timeout ' + src)), timeout);
    s.onload = () => {
      clearTimeout(t);
      res(globalName ? PAGE[globalName] || window[globalName] : true);
    };
    s.onerror = () => {
      clearTimeout(t);
      rej(new Error('falha ao carregar ' + src));
    };
    document.head.appendChild(s);
  });
}
const isOnline = () => !CFG.strictOffline && navigator.onLine !== false;

// ---- Barramento de eventos ----------------------------------------------------
const bus = {
  _h: {},
  on(ev, fn) {
    (this._h[ev] = this._h[ev] || []).push(fn);
    return () => this.off(ev, fn);
  },
  off(ev, fn) {
    this._h[ev] = (this._h[ev] || []).filter((f) => f !== fn);
  },
  emit(ev, data) {
    for (const f of this._h[ev] || []) {
      try {
        f(data);
      } catch (e) {
        console.error('[OPS360IA]', ev, e);
      }
    }
  },
};
const log = (...a) => (PAGE.OPS360IA_DEBUG ? console.log('[OPS360IA]', ...a) : undefined);
