// ==UserScript==
// @name         OPS 360° IA — Aurora v3
// @namespace    ops360
// @version      3.0.0
// @description  Assistente de SST 100% local do OPS 360°: vários chats com memória, anexos com instrução, leitura e geração de documentos, abas criadas pela IA e dock inteligente do Slack.
// @match        *://*/*
// @match        file:///*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==
/*
 * OPS 360° IA — Aurora v3.0.0
 * ---------------------------------------------------------------------------
 * Arquivo único, sem dependências. Funciona de 3 formas:
 *   1) <script src="ops360-ia.js"></script> no final do index.html do OPS 360°
 *   2) Userscript (Tampermonkey/Violentmonkey) — só ativa em páginas do OPS 360°
 *   3) Extensão/página interna — basta incluir o arquivo
 * Configuração opcional ANTES do script:  window.OPS360IA_CONFIG = { ... }
 * Veja LEIA-ME.md para todas as opções e para o padrão de abas (blueprints).
 * O código-fonte modular fica em src/ e é montado por scripts/build.mjs.
 */

(function () {
'use strict';

/* ===== 01-utils.js ===== */
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


/* ===== 02-storage.js ===== */
// ---------------------------------------------------------------------------
// 02 · Armazenamento local (IndexedDB, com fallback para localStorage/memória)
//      Tudo fica no navegador do usuário — nada é enviado para servidores.
// ---------------------------------------------------------------------------
const DB_NAME = 'ops360ia_v3';
const DB_STORES = ['kv', 'chats', 'files', 'tabs', 'docs'];
const LS_PREFIX = 'ops360ia3:';

const db = {
  _idb: null,
  _mode: 'memory',
  _mem: Object.fromEntries(DB_STORES.map((s) => [s, new Map()])),
  _ready: null,

  open() {
    if (this._ready) return this._ready;
    this._ready = new Promise((resolve) => {
      let idb;
      try {
        idb = PAGE.indexedDB || window.indexedDB;
      } catch (e) {
        idb = null;
      }
      if (!idb) return resolve(this._fallback());
      let req;
      try {
        req = idb.open(DB_NAME, 1);
      } catch (e) {
        return resolve(this._fallback());
      }
      const timer = setTimeout(() => resolve(this._fallback()), 4000);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of DB_STORES) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, s === 'kv' ? undefined : { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        this._idb = req.result;
        this._mode = 'idb';
        this._idb.onversionchange = () => this._idb.close();
        resolve('idb');
      };
      req.onerror = req.onblocked = () => {
        clearTimeout(timer);
        resolve(this._fallback());
      };
    });
    return this._ready;
  },

  _fallback() {
    try {
      const k = LS_PREFIX + 'probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      this._mode = 'ls';
      for (const s of DB_STORES) {
        const raw = localStorage.getItem(LS_PREFIX + s);
        if (raw) {
          const obj = JSON.parse(raw);
          this._mem[s] = new Map(Object.entries(obj));
        }
      }
    } catch (e) {
      this._mode = 'memory';
    }
    return this._mode;
  },
  _dirty: new Set(),
  _persistLS(store) {
    this._dirty.add(store);
    this._flushLS();
  },
  _flushLS: debounce(() => {
    if (db._mode !== 'ls') return;
    for (const store of db._dirty) {
      try {
        localStorage.setItem(LS_PREFIX + store, JSON.stringify(Object.fromEntries(db._mem[store])));
      } catch (e) {
        console.warn('[OPS360IA] armazenamento cheio — ', store, e);
      }
    }
    db._dirty.clear();
  }, 400),

  _tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this._idb.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      const r = fn(os);
      if (r) r.onsuccess = () => (result = r.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  },

  async get(store, key) {
    await this.open();
    if (this._mode === 'idb') {
      try {
        return await this._tx(store, 'readonly', (os) => os.get(key));
      } catch (e) {
        return undefined;
      }
    }
    return deepClone(this._mem[store].get(key));
  },
  async put(store, value, key) {
    await this.open();
    if (this._mode === 'idb') {
      try {
        return await this._tx(store, 'readwrite', (os) => (store === 'kv' ? os.put(value, key) : os.put(value)));
      } catch (e) {
        console.warn('[OPS360IA] falha ao salvar', store, e);
        return;
      }
    }
    this._mem[store].set(store === 'kv' ? key : value.id, deepClone(value));
    if (this._mode === 'ls' && store !== 'files') this._persistLS(store);
  },
  async del(store, key) {
    await this.open();
    if (this._mode === 'idb') {
      try {
        return await this._tx(store, 'readwrite', (os) => os.delete(key));
      } catch (e) {
        return;
      }
    }
    this._mem[store].delete(key);
    if (this._mode === 'ls') this._persistLS(store);
  },
  async all(store) {
    await this.open();
    if (this._mode === 'idb') {
      try {
        return (await this._tx(store, 'readonly', (os) => os.getAll())) || [];
      } catch (e) {
        return [];
      }
    }
    return [...this._mem[store].values()].map(deepClone);
  },
  async clear(store) {
    await this.open();
    if (this._mode === 'idb') {
      try {
        return await this._tx(store, 'readwrite', (os) => os.clear());
      } catch (e) {
        return;
      }
    }
    this._mem[store].clear();
    if (this._mode === 'ls') this._persistLS(store);
  },
};

// Chave/valor com cache síncrono (preferências da interface)
const kv = {
  _cache: new Map(),
  async load(keys) {
    for (const k of keys) {
      const v = await db.get('kv', k);
      if (v !== undefined) this._cache.set(k, v);
    }
  },
  get(k, def) {
    return this._cache.has(k) ? this._cache.get(k) : def;
  },
  set(k, v) {
    this._cache.set(k, v);
    db.put('kv', deepClone(v), k);
  },
};


/* ===== 03-zip.js ===== */
// ---------------------------------------------------------------------------
// 03 · ZIP (leitura e escrita) + inflate/deflate nativos do navegador
//      Usado para ler DOCX/XLSX/PPTX/ODT e para gerar DOCX/XLSX/pacotes de abas.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Executa um (De)CompressionStream e devolve tudo o que conseguiu ler,
// mesmo se o fluxo terminar com erro (PDFs com lixo no final, por exemplo).
async function pipeStream(u8, stream) {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks = [];
  const readAll = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } catch (e) {
      /* fim com erro: mantém o parcial */
    }
  })();
  writer.write(u8).catch(() => {});
  writer.close().catch(() => {});
  await readAll;
  return concatBytes(chunks);
}
const hasStreams = typeof DecompressionStream !== 'undefined';
async function inflate(u8, raw = false) {
  if (!hasStreams) throw new Error('Navegador sem suporte a DecompressionStream');
  return pipeStream(u8, new DecompressionStream(raw ? 'deflate-raw' : 'deflate'));
}
async function deflate(u8, raw = false) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    return await pipeStream(u8, new CompressionStream(raw ? 'deflate-raw' : 'deflate'));
  } catch (e) {
    return null;
  }
}

// ---- Leitura ------------------------------------------------------------------
async function zipRead(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Arquivo ZIP inválido');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder('utf-8');
  for (let i = 0; i < count && p + 46 <= u8.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const loff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    entries.set(name, { name, method, csize, size, loff });
    p += 46 + nlen + xlen + clen;
  }
  const zip = {
    entries,
    names: () => [...entries.keys()],
    has: (n) => entries.has(n),
    async bytes(name) {
      const e = entries.get(name);
      if (!e) return null;
      const lnlen = dv.getUint16(e.loff + 26, true);
      const lxlen = dv.getUint16(e.loff + 28, true);
      const start = e.loff + 30 + lnlen + lxlen;
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method === 8) return inflate(data, true);
      throw new Error('Compressão ZIP não suportada: ' + e.method);
    },
    async text(name) {
      const b = await zip.bytes(name);
      return b ? decodeText(b) : null;
    },
  };
  return zip;
}

// ---- Escrita --------------------------------------------------------------------
// files: [{ name, data: Uint8Array|string }]
async function zipWrite(files, { compress = true } = {}) {
  const enc = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    let method = 0;
    let body = data;
    if (compress && data.length > 128) {
      const d = await deflate(data, true);
      if (d && d.length < data.length) {
        method = 8;
        body = d;
      }
    }
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // nomes em UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    local.push(lh, body);
    central.push(ch);
    offset += lh.length + body.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return concatBytes([...local, ...central, end]);
}

// XML helpers usados por leitores/escritores OOXML
const xmlEsc = (s) =>
  String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function parseXML(str) {
  const doc = new DOMParser().parseFromString(str, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    // tenta de novo removendo caracteres inválidos
    return new DOMParser().parseFromString(str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''), 'application/xml');
  }
  return doc;
}
// getElementsByTagName ignorando prefixo de namespace (w:p, a:t, text:p ...)
function tags(node, local) {
  const out = node.getElementsByTagNameNS ? node.getElementsByTagNameNS('*', local) : [];
  return Array.from(out);
}
const localName = (n) => n.localName || (n.nodeName || '').replace(/^.*:/, '');


/* ===== 04-text.js ===== */
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


/* ===== 05-kb-nr.js ===== */
// ---------------------------------------------------------------------------
// 05 · Base de conhecimento: Normas Regulamentadoras, glossário, orientações
//      Resumos para orientação rápida — sempre confira o texto vigente em
//      gov.br/trabalho-e-emprego (as NRs são atualizadas com frequência).
// ---------------------------------------------------------------------------
const NR_SOURCE = 'https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes';

const NRS = {
  1: {
    titulo: 'Disposições Gerais e Gerenciamento de Riscos Ocupacionais',
    resumo: 'Define as regras comuns a todas as NRs e o GRO (Gerenciamento de Riscos Ocupacionais), materializado no PGR (Programa de Gerenciamento de Riscos).',
    pontos: [
      'O GRO deve ser implementado por estabelecimento; o PGR contém, no mínimo, o inventário de riscos e o plano de ação.',
      'Avaliação de riscos por gravidade × probabilidade, incluindo fatores ergonômicos e, desde a Portaria MTE nº 1.419/2024, os fatores de riscos psicossociais relacionados ao trabalho.',
      'Hierarquia de controles: eliminação, substituição/minimização, proteção coletiva, medidas administrativas e, por último, EPI.',
      'O trabalhador deve ser informado sobre riscos e medidas de prevenção (ordens de serviço, procedimentos, treinamentos).',
      'Direito de recusa: o trabalhador pode interromper a atividade diante de risco grave e iminente, comunicando imediatamente o superior.',
      'Treinamentos: inicial, periódico e eventual; permite EAD/semipresencial conforme o Anexo II e aproveitamento de treinamentos em certas condições.',
    ],
    documentos: ['PGR (inventário de riscos + plano de ação)', 'Ordens de serviço/procedimentos', 'Registros de capacitação'],
    palavras: 'gro pgr gerenciamento inventario plano de acao risco psicossocial direito de recusa ordem de servico treinamento ead',
  },
  3: { titulo: 'Embargo e Interdição', resumo: 'Trata do embargo de obra e da interdição de atividade, máquina ou setor quando a fiscalização constata grave e iminente risco ao trabalhador.', pontos: ['Medidas de urgência aplicadas pela Auditoria-Fiscal do Trabalho.', 'Durante a paralisação, os salários são devidos normalmente.'], palavras: 'embargo interdicao risco grave iminente fiscalizacao' },
  4: {
    titulo: 'Serviços Especializados em Segurança e Medicina do Trabalho (SESMT)',
    resumo: 'Define quando a empresa precisa manter SESMT e com quais profissionais, conforme o grau de risco da atividade (CNAE) e o número de empregados.',
    pontos: [
      'Dimensionamento pelo grau de risco (Anexo I) e pelo nº de empregados do estabelecimento (Anexo II).',
      'Profissionais: engenheiro de segurança, médico do trabalho, técnico de segurança, enfermeiro do trabalho e técnico/auxiliar de enfermagem do trabalho.',
      'Permite SESMT compartilhado/individual conforme regras da norma.',
    ],
    palavras: 'sesmt tecnico de seguranca engenheiro medico do trabalho dimensionamento grau de risco cnae',
  },
  5: {
    titulo: 'Comissão Interna de Prevenção de Acidentes e de Assédio (CIPA)',
    resumo: 'Regula a CIPA, comissão formada por representantes do empregador e dos empregados para prevenir acidentes, doenças e assédio no trabalho.',
    pontos: [
      'Dimensionamento conforme o Quadro I (grau de risco × nº de empregados); abaixo do quadro, a empresa nomeia um representante.',
      'Mandato de 1 ano, permitida uma reeleição; estabilidade do eleito desde o registro da candidatura até 1 ano após o mandato.',
      'Treinamento dos membros: 8h (grau de risco 1), 12h (GR 2), 16h (GR 3) e 20h (GR 4).',
      'Reuniões ordinárias mensais, conforme calendário; participação na identificação de riscos e no acompanhamento do PGR.',
      'Com a Lei 14.457/2022, passou a atuar também na prevenção e no combate ao assédio sexual e outras formas de violência.',
    ],
    documentos: ['Atas de eleição, posse e reuniões', 'Calendário de reuniões', 'Certificados de treinamento dos cipeiros'],
    palavras: 'cipa cipeiro assedio eleicao mandato sipat reuniao comissao',
  },
  6: {
    titulo: 'Equipamentos de Proteção Individual (EPI)',
    resumo: 'Estabelece regras para seleção, fornecimento, uso, guarda e registro de EPIs, que só podem ser usados com CA (Certificado de Aprovação) válido.',
    pontos: [
      'Empregador: fornecer gratuitamente o EPI adequado ao risco, exigir o uso, orientar e treinar, substituir quando danificado ou extraviado, higienizar/manter e registrar o fornecimento.',
      'Empregado: usar o EPI apenas para a finalidade, responsabilizar-se pela guarda e conservação e comunicar qualquer alteração que o torne impróprio.',
      'Todo EPI precisa de CA válido emitido pelo órgão nacional competente.',
      'O registro de entrega pode ser feito em livros, fichas ou sistema eletrônico (inclusive biometria).',
      'A recusa injustificada ao uso do EPI fornecido constitui ato faltoso do empregado (CLT, art. 158, parágrafo único).',
    ],
    documentos: ['Ficha de entrega de EPI', 'Registro de treinamentos de uso', 'Seleção técnica do EPI no PGR'],
    palavras: 'epi ca certificado de aprovacao ficha de epi entrega uso obrigatorio protetor auricular luva capacete oculos mascara',
  },
  7: {
    titulo: 'Programa de Controle Médico de Saúde Ocupacional (PCMSO)',
    resumo: 'Obriga o PCMSO, que planeja e registra os exames médicos ocupacionais de acordo com os riscos do PGR.',
    pontos: [
      'Exames: admissional, periódico, de retorno ao trabalho, de mudança de risco ocupacional e demissional — cada um gera um ASO.',
      'Retorno ao trabalho: antes de reassumir, quando afastado por 30 dias ou mais por doença ou acidente (ocupacional ou não).',
      'Periodicidade definida no PCMSO conforme os riscos (em geral anual para expostos a riscos e a cada 2 anos para os demais).',
      'Relatório analítico anual do PCMSO.',
    ],
    documentos: ['PCMSO', 'ASOs', 'Relatório analítico'],
    palavras: 'pcmso aso exame admissional periodico demissional retorno medico do trabalho audiometria',
  },
  8: { titulo: 'Edificações', resumo: 'Requisitos mínimos de segurança nas edificações: pisos, escadas, rampas, aberturas, proteção contra quedas e intempéries.', pontos: ['Pisos sem saliências ou depressões que prejudiquem a circulação.', 'Aberturas nos pisos e paredes protegidas contra quedas.', 'Escadas e rampas resistentes, com corrimão e piso antiderrapante quando necessário.'], palavras: 'edificacao piso escada rampa abertura guarda-corpo' },
  9: {
    titulo: 'Avaliação e Controle das Exposições Ocupacionais a Agentes Físicos, Químicos e Biológicos',
    resumo: 'Complementa o GRO com requisitos para identificar, avaliar e controlar exposições a agentes físicos, químicos e biológicos.',
    pontos: [
      'Avaliações quantitativas quando necessárias para dimensionar a exposição e verificar a eficácia das medidas.',
      'Nível de ação: metade do limite de exposição (para ruído, dose de 0,5 — equivalente a 80 dB(A) em 8h), a partir do qual se iniciam ações preventivas.',
      'Anexos tratam de vibração, calor e agentes químicos específicos.',
    ],
    palavras: 'agente fisico quimico biologico exposicao nivel de acao dosimetria avaliacao quantitativa vibracao calor',
  },
  10: {
    titulo: 'Segurança em Instalações e Serviços em Eletricidade',
    resumo: 'Requisitos para trabalhos em instalações elétricas: projeto, medidas de controle, desenergização, qualificação e autorização dos trabalhadores.',
    pontos: [
      'Só trabalham com eletricidade profissionais qualificados, habilitados ou capacitados e formalmente autorizados.',
      'Curso básico de 40h; complementar SEP de 40h para o Sistema Elétrico de Potência; reciclagem bienal e em caso de troca de função/empresa, afastamento superior a 3 meses ou mudanças significativas.',
      'Desenergização: seccionamento → impedimento de reenergização (bloqueio e etiquetagem) → constatação da ausência de tensão → aterramento temporário com equipotencialização → proteção dos elementos energizados na zona controlada → sinalização de impedimento.',
      'Prontuário das Instalações Elétricas obrigatório para carga instalada acima de 75 kW.',
      'Faixas: extrabaixa tensão até 50 V CA/120 V CC; baixa tensão até 1000 V CA/1500 V CC; acima disso, alta tensão.',
    ],
    documentos: ['Prontuário das instalações elétricas', 'Diagramas unifilares', 'Procedimentos e autorizações', 'Certificados NR-10'],
    palavras: 'eletricidade eletrica choque arco eletrico desenergizacao bloqueio etiquetagem loto sep painel quadro alta tensao baixa tensao',
  },
  11: {
    titulo: 'Transporte, Movimentação, Armazenagem e Manuseio de Materiais',
    resumo: 'Regras para equipamentos de movimentação (empilhadeiras, pontes rolantes, talhas, esteiras) e para armazenagem de materiais.',
    pontos: [
      'Equipamentos devem indicar em local visível a carga máxima de trabalho permitida.',
      'Operadores de equipamentos motorizados devem ser habilitados e portar cartão de identificação com nome e fotografia; o cartão vale 1 ano e a revalidação exige exame de saúde completo.',
      'Equipamentos motorizados devem ter sinal de advertência sonora (buzina).',
      'Em locais fechados, a emissão de gases de motores a combustão deve ser controlada.',
      'Materiais armazenados sem obstruir portas, equipamentos de incêndio e saídas de emergência.',
    ],
    palavras: 'empilhadeira movimentacao carga armazenagem ponte rolante talha esteira transpaleteira cartao operador',
  },
  12: {
    titulo: 'Segurança no Trabalho em Máquinas e Equipamentos',
    resumo: 'Princípios e medidas de proteção para garantir a segurança em todas as fases de uso de máquinas: projeto, instalação, operação, manutenção e descarte.',
    pontos: [
      'Zonas de perigo protegidas por proteções fixas, móveis com intertravamento ou dispositivos de segurança (cortinas de luz, comandos bimanuais etc.).',
      'Dispositivos de parada de emergência acessíveis e que não possam ser rearmados sem intenção.',
      'Manutenção, limpeza e ajustes com a máquina parada e com bloqueio das fontes de energia (energia zero).',
      'Operadores capacitados e máquinas com manual e sinalização em língua portuguesa.',
      'Apreciação de riscos segundo normas técnicas (ex.: ABNT NBR ISO 12100). Anexos tratam de prensas, injetoras, motosserras e outros.',
    ],
    palavras: 'maquina equipamento prensa protecao intertravamento parada de emergencia bloqueio motosserra injetora serra torno',
  },
  13: {
    titulo: 'Caldeiras, Vasos de Pressão, Tubulações e Tanques Metálicos de Armazenamento',
    resumo: 'Requisitos de instalação, inspeção, operação e manutenção de caldeiras, vasos de pressão, tubulações e tanques.',
    pontos: [
      'Profissional Habilitado (PH) responsável por inspeções e projetos.',
      'Prontuário, registro de segurança e relatórios de inspeção (inicial, periódica e extraordinária).',
      'Operador de caldeira com treinamento de segurança na operação e estágio prático.',
      'Válvulas de segurança, instrumentos de pressão e placa de identificação obrigatórios.',
    ],
    palavras: 'caldeira vaso de pressao tubulacao tanque vapor valvula de seguranca inspecao ph',
  },
  14: { titulo: 'Fornos', resumo: 'Fornos devem ter construção sólida, revestimento refratário e instalação que evite acúmulo de gases e exposição a altas temperaturas.', pontos: ['Proteção contra queimaduras e contra vazamento de gases.', 'Escadas e plataformas de acesso seguras.'], palavras: 'forno calor refratario gases' },
  15: {
    titulo: 'Atividades e Operações Insalubres',
    resumo: 'Define limites de tolerância e as atividades insalubres, que dão direito ao adicional de insalubridade.',
    pontos: [
      'Adicional de 40% (grau máximo), 20% (médio) ou 10% (mínimo), conforme a NR-15 (há discussão judicial sobre a base de cálculo).',
      'Ruído contínuo (Anexo 1): 85 dB(A) para 8h; a cada 5 dB a mais, o tempo permitido cai pela metade (ex.: 90 dB(A) → 4h; 95 dB(A) → 2h; 100 dB(A) → 1h).',
      'Outros anexos: ruído de impacto, calor, radiações, vibrações, frio, umidade, agentes químicos, poeiras minerais e agentes biológicos.',
      'A eliminação ou neutralização da insalubridade cessa o adicional (medidas coletivas ou EPI eficaz).',
    ],
    palavras: 'insalubridade insalubre adicional limite de tolerancia ruido calor poeira agente quimico biologico',
  },
  16: {
    titulo: 'Atividades e Operações Perigosas',
    resumo: 'Define as atividades perigosas, que dão direito ao adicional de periculosidade de 30% sobre o salário-base.',
    pontos: ['Explosivos, inflamáveis, energia elétrica, segurança pessoal/patrimonial com exposição a violência, motocicleta e radiações ionizantes.', 'O adicional não é acumulável com o de insalubridade (o trabalhador escolhe o mais vantajoso).'],
    palavras: 'periculosidade perigoso adicional 30 inflamavel explosivo eletricidade vigilante motociclista',
  },
  17: {
    titulo: 'Ergonomia',
    resumo: 'Parâmetros para adaptar as condições de trabalho às características dos trabalhadores, com foco em conforto, segurança e desempenho.',
    pontos: [
      'Avaliação Ergonômica Preliminar (AEP) das situações de trabalho e Análise Ergonômica do Trabalho (AET) quando necessário.',
      'Levantamento, transporte e descarga de materiais; mobiliário; equipamentos; condições ambientais; organização do trabalho.',
      'Anexos específicos para checkout e teleatendimento/telemarketing.',
    ],
    palavras: 'ergonomia postura aep aet mobiliario cadeira levantamento de peso ler dort pausa organizacao do trabalho',
  },
  18: {
    titulo: 'Segurança e Saúde no Trabalho na Indústria da Construção',
    resumo: 'Diretrizes de SST em obras de construção: PGR da obra, áreas de vivência, escavações, proteção contra quedas, andaimes, movimentação de cargas, instalações elétricas.',
    pontos: [
      'PGR da construção elaborado por profissional legalmente habilitado em SST.',
      'Proteção de periferia com guarda-corpo (travessão superior a 1,20 m, intermediário a 0,70 m e rodapé de 0,20 m) ou outra solução coletiva.',
      'Escavações com mais de 1,25 m exigem garantia de estabilidade dos taludes (escoramento/taludamento).',
      'Andaimes, plataformas, escadas e rampas conforme requisitos da norma; treinamento admissional e periódico.',
    ],
    palavras: 'construcao obra andaime escavacao vala periferia guarda-corpo canteiro concretagem demolicao',
  },
  19: { titulo: 'Explosivos', resumo: 'Requisitos para fabricação, manuseio, armazenamento e transporte de explosivos.', pontos: ['Depósitos com distâncias de segurança e controle de acesso.', 'Observância da regulamentação do Exército (produtos controlados).'], palavras: 'explosivo detonacao paiol polvora' },
  20: {
    titulo: 'Segurança e Saúde no Trabalho com Inflamáveis e Combustíveis',
    resumo: 'Requisitos para extração, produção, armazenamento, transferência, manuseio e manipulação de inflamáveis e líquidos combustíveis.',
    pontos: [
      'Instalações classificadas (classes I, II e III) conforme atividade e capacidade.',
      'Capacitação por tipo de atividade/instalação: integração, básico, intermediário, avançado I e II e específico.',
      'Prontuário da instalação, análise de riscos, controle de fontes de ignição e plano de resposta a emergências.',
      'Intervenções (manutenção, trabalho a quente) com permissão de trabalho.',
    ],
    palavras: 'inflamavel combustivel gasolina diesel etanol glp tanque abastecimento posto',
  },
  21: { titulo: 'Trabalhos a Céu Aberto', resumo: 'Exige proteção dos trabalhadores contra intempéries: abrigos, medidas contra insolação, calor, frio, umidade e ventos.', pontos: ['Abrigos para proteção contra intempéries.', 'Água potável e medidas contra insolação.'], palavras: 'ceu aberto sol calor chuva intemperie abrigo' },
  22: { titulo: 'Segurança e Saúde Ocupacional na Mineração', resumo: 'Requisitos específicos para atividades de mineração, com PGR próprio, CIPAMIN e controles de subsolo, explosivos, ventilação e estabilidade.', pontos: ['Programa de gerenciamento de riscos específico da mineração.'], palavras: 'mineracao mina subsolo cipamin' },
  23: {
    titulo: 'Proteção Contra Incêndios',
    resumo: 'Obriga medidas de prevenção e combate a incêndio, saídas de emergência e informação/treinamento dos trabalhadores, conforme a legislação estadual e normas técnicas.',
    pontos: [
      'Saídas suficientes, sinalizadas e desobstruídas para rápida evacuação.',
      'Equipamentos de combate a incêndio conforme o Corpo de Bombeiros do estado (instruções técnicas).',
      'Informar os trabalhadores sobre uso de equipamentos, evacuação e alarmes.',
      'Classes de fogo: A (sólidos), B (líquidos/gases inflamáveis), C (equipamentos energizados), D (metais pirofóricos), K (óleos e gorduras de cozinha).',
    ],
    palavras: 'incendio extintor brigada rota de fuga saida de emergencia alarme hidrante evacuacao classe de fogo',
  },
  24: {
    titulo: 'Condições Sanitárias e de Conforto nos Locais de Trabalho',
    resumo: 'Requisitos de instalações sanitárias, vestiários, refeitórios, cozinhas, alojamentos e água potável.',
    pontos: ['Instalações sanitárias separadas por sexo, na proporção de uma para cada 20 trabalhadores ou fração.', 'Água potável em condições higiênicas.', 'Vestiários quando houver troca de roupa ou exigência de higienização.'],
    palavras: 'sanitario banheiro vestiario refeitorio agua potavel alojamento conforto',
  },
  25: { titulo: 'Resíduos Industriais', resumo: 'Gerenciamento de resíduos sólidos, líquidos e gasosos de forma a proteger a saúde dos trabalhadores e o meio ambiente.', pontos: ['Resíduos identificados, segregados, acondicionados e destinados adequadamente.'], palavras: 'residuo lixo industrial descarte' },
  26: {
    titulo: 'Sinalização e Identificação de Segurança',
    resumo: 'Cores e sinalização de segurança em ambientes de trabalho e classificação/rotulagem de produtos químicos (GHS).',
    pontos: [
      'Cores para identificar equipamentos de segurança, delimitar áreas e identificar tubulações, conforme normas técnicas oficiais.',
      'Produtos químicos classificados e rotulados pelo GHS (ABNT NBR 14725), com Ficha com Dados de Segurança (FDS) disponível.',
      'A sinalização complementa — não substitui — as medidas de prevenção.',
    ],
    palavras: 'sinalizacao cor placa faixa demarcacao ghs rotulagem fds fispq sinalizacao vertical sinalizacao horizontal',
  },
  28: { titulo: 'Fiscalização e Penalidades', resumo: 'Procedimentos de fiscalização e gradação das multas por descumprimento das NRs.', pontos: ['Multas graduadas conforme a infração e o porte da empresa.'], palavras: 'fiscalizacao multa penalidade auto de infracao' },
  29: { titulo: 'Segurança e Saúde no Trabalho Portuário', resumo: 'Requisitos para operações portuárias, a bordo e em terra.', pontos: ['Plano de controle de emergência e requisitos de movimentação de cargas.'], palavras: 'porto portuario estiva' },
  30: { titulo: 'Segurança e Saúde no Trabalho Aquaviário', resumo: 'Requisitos para trabalhadores em embarcações comerciais.', pontos: [], palavras: 'aquaviario embarcacao navio' },
  31: { titulo: 'Segurança e Saúde no Trabalho na Agricultura, Pecuária, Silvicultura, Exploração Florestal e Aquicultura', resumo: 'Requisitos de SST no meio rural, com PGRTR, uso de agrotóxicos, máquinas agrícolas e condições de vivência.', pontos: ['PGRTR — Programa de Gerenciamento de Riscos no Trabalho Rural.', 'Regras para aplicação e armazenamento de agrotóxicos.'], palavras: 'rural agricultura agrotoxico trator pecuaria' },
  32: {
    titulo: 'Segurança e Saúde no Trabalho em Serviços de Saúde',
    resumo: 'Proteção de trabalhadores de serviços de saúde contra riscos biológicos, químicos e radiações.',
    pontos: ['Vedado reencapar e desconectar agulhas manualmente.', 'Vacinação gratuita (tétano, difteria, hepatite B e as previstas no PCMSO).', 'Vedado uso de adornos, calçados abertos e consumo de alimentos nos postos com risco biológico.'],
    palavras: 'saude hospital clinica perfurocortante agulha biologico vacina enfermagem',
  },
  33: {
    titulo: 'Segurança e Saúde nos Trabalhos em Espaços Confinados',
    resumo: 'Requisitos para identificar espaços confinados e controlar os riscos da entrada e do trabalho neles.',
    pontos: [
      'Espaço confinado: não projetado para ocupação humana contínua, com meios limitados de entrada e saída e onde exista ou possa existir atmosfera perigosa.',
      'Entrada somente com PET (Permissão de Entrada e Trabalho), vigia permanente e supervisor de entrada.',
      'Monitoramento da atmosfera antes e durante o trabalho (O₂ entre 19,5% e 23%, inflamáveis abaixo de 10% do LIE, tóxicos abaixo dos limites).',
      'Capacitação: 16h para trabalhadores autorizados e vigias; 40h para supervisores de entrada; reciclagem periódica anual.',
      'Equipe de resgate e procedimentos de emergência definidos; proibido trabalho individual.',
    ],
    documentos: ['PET', 'Cadastro dos espaços confinados', 'Certificados NR-33', 'Registros de monitoramento'],
    palavras: 'espaco confinado pet vigia supervisor de entrada tanque silo galeria atmosfera oxigenio lie',
  },
  34: { titulo: 'Condições e Meio Ambiente de Trabalho na Indústria da Construção, Reparação e Desmonte Naval', resumo: 'Requisitos para estaleiros: trabalho a quente, pintura, jateamento, movimentação de cargas e espaços confinados.', pontos: [], palavras: 'naval estaleiro navio' },
  35: {
    titulo: 'Trabalho em Altura',
    resumo: 'Requisitos para todo trabalho acima de 2,00 m do nível inferior onde haja risco de queda: planejamento, organização, execução, treinamento e resgate.',
    pontos: [
      'Trabalho em altura: atividade executada acima de 2,00 m do nível inferior, onde haja risco de queda.',
      'Treinamento inicial teórico e prático de no mínimo 8h; reciclagem bienal de 8h; eventual em mudança de procedimento, após evento relevante, retorno de afastamento superior a 90 dias ou mudança de empresa.',
      'Trabalhador formalmente autorizado e com aptidão para trabalho em altura registrada no ASO.',
      'Análise de Risco para todo trabalho em altura; Permissão de Trabalho para atividades não rotineiras.',
      'Sistema de proteção contra quedas: preferência à proteção coletiva; proteção individual (cinto paraquedista, talabarte, trava-quedas) com ancoragem adequada.',
      'Plano de emergência e resgate com recursos disponíveis.',
    ],
    documentos: ['Análise de Risco (AR)', 'Permissão de Trabalho (PT)', 'Certificados NR-35', 'Autorização formal', 'ASO com aptidão'],
    palavras: 'altura queda cinto paraquedista talabarte trava-quedas ancoragem linha de vida andaime telhado escada resgate',
  },
  36: { titulo: 'Segurança e Saúde no Trabalho em Empresas de Abate e Processamento de Carnes e Derivados', resumo: 'Requisitos para frigoríficos: pausas psicofisiológicas, ergonomia, frio, facas e agentes biológicos.', pontos: ['Pausas psicofisiológicas distribuídas na jornada.', 'Controle do frio e da umidade.'], palavras: 'frigorifico abate carne camara fria' },
  37: { titulo: 'Segurança e Saúde em Plataformas de Petróleo', resumo: 'Requisitos de SST para plataformas de petróleo em águas jurisdicionais brasileiras.', pontos: [], palavras: 'plataforma petroleo offshore' },
  38: { titulo: 'Segurança e Saúde no Trabalho nas Atividades de Limpeza Urbana e Manejo de Resíduos Sólidos', resumo: 'Requisitos para coleta, varrição, triagem e destinação de resíduos sólidos urbanos.', pontos: ['Controle de riscos de atropelamento, biológicos e ergonômicos na coleta.'], palavras: 'limpeza urbana coleta de lixo gari residuo solido' },
};
NRS[2] = { titulo: 'Inspeção Prévia (revogada)', resumo: 'A NR-02 foi revogada em 2019.', pontos: [], palavras: 'inspecao previa revogada', revogada: true };
NRS[27] = { titulo: 'Registro Profissional do Técnico de Segurança (revogada)', resumo: 'A NR-27 foi revogada em 2008.', pontos: [], palavras: 'registro tecnico revogada', revogada: true };

// Tabela de ruído da NR-15 (Anexo 1): nível dB(A) → minutos permitidos por dia
const NR15_RUIDO = [[85, 480], [86, 420], [87, 360], [88, 300], [89, 270], [90, 240], [91, 210], [92, 180], [93, 160], [94, 135], [95, 120], [96, 105], [98, 75], [100, 60], [102, 45], [104, 35], [105, 30], [106, 25], [108, 20], [110, 15], [112, 10], [114, 8], [115, 7]];

// ---- Glossário ------------------------------------------------------------------
const GLOSSARY = [
  ['sinalização vertical', 'placas de sinalização,sinalizacao por placas', 'São as placas de segurança fixadas em paredes, colunas, postes ou suportes (proibição, obrigação, alerta, emergência e orientação). No trânsito interno, incluem placas de velocidade máxima, "PARE", área de empilhadeiras etc. Complementa a sinalização horizontal (marcações no piso).', [26, 23], 'Posicione na altura da visão, com boa iluminação, e use pictogramas padronizados (ABNT NBR 13434 para emergência e ISO 7010).'],
  ['sinalização horizontal', 'demarcacao de piso,faixa de piso,faixas amarelas', 'São as marcações pintadas ou adesivadas no piso: faixas de circulação de pedestres e veículos, áreas de armazenagem, zebrados de áreas de risco, setas e áreas livres na frente de extintores e painéis.', [26, 11], 'Faixas de circulação bem conservadas reduzem atropelamentos por empilhadeiras.'],
  ['APR', 'analise preliminar de risco,analise preliminar de riscos', 'Análise Preliminar de Risco: documento que identifica, antes da atividade, as etapas, os perigos, os riscos, sua classificação e as medidas de controle, com a participação de quem executa.', [1], 'Faça a APR com a equipe, no local, e revise se as condições mudarem.'],
  ['AR', 'analise de risco', 'Análise de Risco: avaliação dos riscos de uma atividade específica. Na NR-35 é exigida para todo trabalho em altura.', [35, 1], ''],
  ['PT', 'permissao de trabalho', 'Permissão de Trabalho: autorização escrita, emitida para atividades não rotineiras ou de alto risco (altura, quente, eletricidade), com as medidas que devem estar implementadas antes do início, validade e responsáveis.', [35, 10, 20], 'A PT vale para aquela atividade, local e turno — encerre-a formalmente ao final.'],
  ['PET', 'permissao de entrada e trabalho', 'Permissão de Entrada e Trabalho: documento exigido pela NR-33 para entrada em espaço confinado, com medições da atmosfera, bloqueios, equipe, vigia e resgate.', [33], ''],
  ['DDS', 'dialogo diario de seguranca,dialogo de seguranca', 'Diálogo Diário de Segurança: conversa rápida (5 a 15 minutos) antes do início da jornada para tratar de riscos, lições aprendidas e comportamentos seguros.', [1], 'Um bom DDS é curto, prático, faz perguntas ao grupo e termina com um compromisso.'],
  ['EPI', 'equipamento de protecao individual', 'Equipamento de Proteção Individual: dispositivo de uso individual destinado a proteger contra riscos à segurança e saúde. Deve ter CA válido e é a última barreira na hierarquia de controles.', [6], ''],
  ['EPC', 'equipamento de protecao coletiva', 'Equipamento de Proteção Coletiva: protege todos os trabalhadores expostos — guarda-corpos, redes, enclausuramento de ruído, exaustão, proteções de máquinas, sinalização.', [1, 12, 18], 'Sempre priorize EPC antes do EPI.'],
  ['CA', 'certificado de aprovacao', 'Certificado de Aprovação: número emitido pelo Ministério do Trabalho que autoriza a comercialização e o uso de um EPI. Deve estar válido e gravado no equipamento.', [6], 'Consulte a validade do CA no sistema oficial (CAEPI) antes de comprar.'],
  ['ASO', 'atestado de saude ocupacional', 'Atestado de Saúde Ocupacional: documento emitido pelo médico após cada exame ocupacional (admissional, periódico, retorno, mudança de risco e demissional), com a conclusão de aptidão.', [7], ''],
  ['PCMSO', 'programa de controle medico de saude ocupacional', 'Programa de Controle Médico de Saúde Ocupacional: planeja os exames médicos conforme os riscos do PGR e acompanha a saúde dos trabalhadores.', [7], ''],
  ['PGR', 'programa de gerenciamento de riscos', 'Programa de Gerenciamento de Riscos: documento do GRO com o inventário de riscos e o plano de ação de cada estabelecimento.', [1], ''],
  ['GRO', 'gerenciamento de riscos ocupacionais', 'Gerenciamento de Riscos Ocupacionais: processo contínuo de identificar perigos, avaliar riscos, implementar e acompanhar medidas de prevenção (NR-01).', [1], ''],
  ['LTCAT', 'laudo tecnico das condicoes ambientais do trabalho', 'Laudo Técnico das Condições Ambientais do Trabalho: documento previdenciário que caracteriza a exposição a agentes nocivos para fins de aposentadoria especial.', [], ''],
  ['PPP', 'perfil profissiografico previdenciario', 'Perfil Profissiográfico Previdenciário: histórico laboral do trabalhador com as exposições a agentes nocivos; hoje é emitido eletronicamente via eSocial.', [], ''],
  ['CAT', 'comunicacao de acidente de trabalho', 'Comunicação de Acidente de Trabalho: deve ser emitida até o primeiro dia útil seguinte ao acidente e, em caso de morte, imediatamente (Lei 8.213/91, art. 22). No eSocial, evento S-2210.', [], 'Mesmo sem afastamento, o acidente de trabalho deve ser comunicado.'],
  ['acidente de trabalho', 'acidente do trabalho', 'É o que ocorre pelo exercício do trabalho a serviço da empresa, provocando lesão corporal ou perturbação funcional que cause morte, perda ou redução da capacidade para o trabalho (Lei 8.213/91, art. 19). Doenças ocupacionais e acidentes de trajeto são equiparados em certas condições.', [], ''],
  ['quase acidente', 'near miss,quase-acidente,incidente sem lesao', 'Evento que poderia ter causado lesão ou dano, mas não causou por acaso ou pouca margem. Registrar quase acidentes é uma das formas mais eficientes de prevenir acidentes graves.', [], 'Facilite o reporte (QR code, caixa, app) e dê retorno rápido a quem reportou.'],
  ['incidente', '', 'Ocorrência relacionada ao trabalho que resultou ou poderia ter resultado em lesão, doença ou dano. Inclui acidentes e quase acidentes.', [], ''],
  ['CIPA', 'comissao interna de prevencao de acidentes', 'Comissão Interna de Prevenção de Acidentes e de Assédio: formada por representantes do empregador e dos empregados para prevenir acidentes, doenças e assédio.', [5], ''],
  ['SESMT', 'servicos especializados em seguranca e medicina do trabalho', 'Serviços Especializados em Segurança e em Medicina do Trabalho: equipe de profissionais de SST dimensionada pela NR-04.', [4], ''],
  ['SIPAT', 'semana interna de prevencao de acidentes', 'Semana Interna de Prevenção de Acidentes do Trabalho: evento anual de conscientização organizado pela CIPA com o SESMT.', [5], 'Varie os formatos: gincanas, teatro, simulados e depoimentos engajam mais que palestras longas.'],
  ['LOTO', 'bloqueio e etiquetagem,lockout tagout,lockout', 'Lockout/Tagout — bloqueio e etiquetagem: procedimento para isolar e travar todas as fontes de energia (elétrica, hidráulica, pneumática, mecânica, térmica) com cadeados e etiquetas pessoais antes de manutenção ou limpeza.', [10, 12], 'Cada executante coloca o próprio cadeado; teste a energia zero antes de iniciar.'],
  ['FDS', 'fispq,ficha de informacoes de seguranca,ficha com dados de seguranca', 'Ficha com Dados de Segurança (antiga FISPQ): documento de 16 seções com perigos, composição, primeiros socorros, combate a incêndio, manuseio, EPIs e descarte de um produto químico (ABNT NBR 14725).', [26], 'A seção 8 indica os controles de exposição e EPIs.'],
  ['GHS', 'sistema globalmente harmonizado', 'Sistema Globalmente Harmonizado de classificação e rotulagem de produtos químicos, com pictogramas, palavras de advertência e frases de perigo.', [26], ''],
  ['LIE', 'limite inferior de explosividade,lel', 'Limite Inferior de Explosividade: menor concentração de um gás ou vapor no ar capaz de queimar/explodir. Em espaços confinados, a entrada exige inflamáveis abaixo de 10% do LIE.', [33, 20], ''],
  ['IPVS', 'imediatamente perigoso a vida ou a saude', 'Atmosfera Imediatamente Perigosa à Vida ou à Saúde: exige proteção respiratória de adução de ar (máscara autônoma ou linha de ar).', [33], ''],
  ['HHT', 'homem hora trabalhada,horas homem trabalhadas', 'Horas-homem de exposição ao risco: soma das horas trabalhadas por todos os empregados no período; base das taxas de frequência e gravidade (NBR 14280).', [], ''],
  ['taxa de frequência', 'tf,taxa de frequencia de acidentes', 'Taxa de Frequência (NBR 14280) = nº de acidentes × 1.000.000 ÷ HHT. Indica quantos acidentes ocorrem a cada milhão de horas trabalhadas.', [], 'Peça: "calcule a taxa de frequência com 3 acidentes e 450.000 HHT".'],
  ['taxa de gravidade', 'tg', 'Taxa de Gravidade (NBR 14280) = (dias perdidos + dias debitados) × 1.000.000 ÷ HHT.', [], ''],
  ['hierarquia de controles', 'hierarquia das medidas de controle', 'Ordem de prioridade das medidas de prevenção: eliminação → substituição → controles de engenharia/proteção coletiva → medidas administrativas → EPI.', [1], ''],
  ['SPIQ', 'sistema de protecao individual contra quedas', 'Sistema de Proteção Individual contra Quedas: conjunto de ancoragem, elemento de ligação (talabarte/trava-quedas) e cinturão paraquedista.', [35], ''],
  ['SPCQ', 'sistema de protecao coletiva contra quedas', 'Sistema de Proteção Coletiva contra Quedas: guarda-corpos, redes de proteção, fechamento de aberturas — preferencial ao SPIQ.', [35, 18], ''],
  ['talabarte', '', 'Elemento de ligação que conecta o cinturão paraquedista ao ponto de ancoragem. O talabarte duplo em Y permite ficar conectado 100% do tempo durante deslocamentos.', [35], ''],
  ['trava-quedas', 'trava quedas', 'Dispositivo que bloqueia automaticamente em caso de queda, deslizando em linha de vida (rígida/flexível) ou retrátil.', [35], ''],
  ['linha de vida', 'linha de ancoragem', 'Linha (cabo de aço, corda ou trilho) instalada entre ancoragens para permitir deslocamento conectado. Deve ser projetada por profissional legalmente habilitado.', [35], ''],
  ['ponto de ancoragem', 'ancoragem', 'Ponto destinado a suportar a carga de retenção de queda. Deve ser inspecionado e ter resistência dimensionada.', [35], ''],
  ['zona controlada', 'zona de risco', 'Na NR-10, zona controlada é o entorno de parte energizada restrito a trabalhadores autorizados; a zona de risco só pode ser acessada com técnicas e ferramentas apropriadas.', [10], ''],
  ['desenergização', 'desenergizacao', 'Sequência da NR-10 para considerar uma instalação desenergizada: seccionamento, impedimento de reenergização, constatação da ausência de tensão, aterramento temporário, proteção dos elementos energizados e sinalização.', [10], ''],
  ['arco elétrico', 'arco eletrico', 'Descarga elétrica através do ar que gera calor intenso, luz, pressão e projeção de metal fundido. A vestimenta deve ter ATPV compatível com a energia incidente calculada.', [10], ''],
  ['ATPV', 'arc thermal performance value', 'Valor de desempenho térmico ao arco (cal/cm²) de uma vestimenta antichama; deve ser maior que a energia incidente do local.', [10], ''],
  ['PFF2', 'respirador pff2,mascara pff2', 'Peça Facial Filtrante classe 2: respirador descartável para poeiras, névoas e fumos (e agentes biológicos). Precisa de boa vedação no rosto — barba compromete a proteção.', [6], 'Faça ensaio de vedação e troque quando sujo, danificado ou com dificuldade para respirar.'],
  ['PCA', 'programa de conservacao auditiva', 'Programa de Conservação Auditiva: conjunto de ações para prevenir a perda auditiva — avaliação do ruído, controles, EPI adequado, audiometrias e treinamento.', [7, 9], ''],
  ['PPR', 'programa de protecao respiratoria', 'Programa de Proteção Respiratória: seleção, uso, ensaio de vedação, manutenção e treinamento para respiradores (Fundacentro).', [6], ''],
  ['PAIR', 'perda auditiva induzida por ruido', 'Perda Auditiva Induzida por Ruído: perda gradual, irreversível e indolor causada por exposição prolongada a ruído elevado.', [7, 15], ''],
  ['dosimetria', 'dosimetro', 'Avaliação da exposição ao ruído ao longo da jornada com um dosímetro, resultando em dose (%) e nível equivalente.', [9, 15], ''],
  ['insalubridade', 'adicional de insalubridade', 'Condição de trabalho com exposição a agentes nocivos acima dos limites de tolerância (NR-15), que dá direito a adicional de 10%, 20% ou 40%.', [15], ''],
  ['periculosidade', 'adicional de periculosidade', 'Condição de risco acentuado (inflamáveis, explosivos, eletricidade, violência, motocicleta, radiações) que dá direito a adicional de 30% (NR-16).', [16], ''],
  ['AEP', 'avaliacao ergonomica preliminar', 'Avaliação Ergonômica Preliminar: avaliação inicial das situações de trabalho exigida pela NR-17, podendo ser qualitativa e simplificada.', [17], ''],
  ['AET', 'analise ergonomica do trabalho', 'Análise Ergonômica do Trabalho: análise aprofundada, exigida quando a AEP indica necessidade ou em situações previstas na NR-17.', [17], ''],
  ['5S', 'cinco s,housekeeping', 'Método de organização: Seiri (utilização), Seiton (ordenação), Seiso (limpeza), Seiketsu (padronização) e Shitsuke (disciplina). Organização e limpeza reduzem quedas, cortes e incêndios.', [], ''],
  ['5 porquês', '5 porques,cinco porques', 'Técnica de investigação que pergunta "por quê?" sucessivamente (em geral 5 vezes) até chegar à causa raiz de um problema ou acidente.', [], ''],
  ['Ishikawa', 'diagrama de ishikawa,espinha de peixe,6m', 'Diagrama de causa e efeito (espinha de peixe) que organiza as causas em categorias: Método, Mão de obra, Máquina, Material, Meio ambiente e Medida.', [], ''],
  ['5W2H', 'plano 5w2h', 'Ferramenta de plano de ação: What (o quê), Why (por quê), Where (onde), When (quando), Who (quem), How (como) e How much (quanto custa).', [], ''],
  ['POP', 'procedimento operacional padrao,instrucao de trabalho', 'Procedimento Operacional Padrão: descreve passo a passo como executar uma tarefa de forma segura e padronizada.', [], ''],
  ['ordem de serviço', 'os de seguranca,ordem de servico de seguranca', 'Documento que informa ao trabalhador os riscos da função, as medidas de prevenção, EPIs, obrigações e proibições (NR-01, item 1.4.1). Deve ter a ciência do empregado.', [1], ''],
  ['direito de recusa', 'recusa ao trabalho,interromper atividade', 'O trabalhador pode interromper suas atividades quando constatar situação de risco grave e iminente para sua vida ou saúde, informando imediatamente o superior (NR-01).', [1], ''],
  ['espaço confinado', 'espaco confinado', 'Ambiente não projetado para ocupação humana contínua, com meios limitados de entrada e saída e onde existe ou pode existir atmosfera perigosa (NR-33).', [33], ''],
  ['trabalho em altura', '', 'Toda atividade executada acima de 2,00 m do nível inferior, onde haja risco de queda (NR-35).', [35], ''],
  ['trabalho a quente', 'trabalho quente', 'Atividades que geram calor, chama ou faíscas (solda, corte, esmerilhamento) capazes de iniciar incêndio ou explosão. Exigem permissão de trabalho, afastamento de inflamáveis e vigia de fogo.', [20, 23], ''],
  ['brigada de incêndio', 'brigada de emergencia,brigadista', 'Grupo de trabalhadores treinados para prevenção, abandono de área, combate a princípios de incêndio e primeiros socorros, dimensionado conforme normas do Corpo de Bombeiros.', [23], ''],
  ['rota de fuga', 'saida de emergencia,rota de evacuacao', 'Caminho sinalizado e desobstruído até um local seguro (ponto de encontro) em caso de emergência.', [23, 26], ''],
  ['extintor', 'extintores,classes de extintor', 'Classes: A (sólidos — água, espuma, pó ABC), B (líquidos inflamáveis — espuma, CO₂, pó), C (equipamentos energizados — CO₂, pó BC/ABC), D (metais — pó especial), K (óleo de cozinha — agente classe K).', [23], 'Mantenha a área em frente ao extintor livre e sinalizada, com inspeção mensal visual.'],
  ['ato inseguro', 'condicao insegura', 'Termos antigos que classificavam causas de acidentes em comportamento (ato) ou ambiente (condição). Hoje se prefere analisar fatores organizacionais e falhas de barreiras, sem buscar culpados.', [], ''],
  ['riscos psicossociais', 'fatores psicossociais,saude mental,estresse,burnout', 'Fatores relacionados à organização do trabalho (sobrecarga, metas abusivas, assédio, falta de autonomia, conflitos) que podem causar adoecimento físico e mental. Devem ser considerados no GRO (NR-01).', [1, 17, 5], ''],
  ['eSocial SST', 'esocial,s-2210,s-2220,s-2240', 'Eventos de SST no eSocial: S-2210 (CAT), S-2220 (monitoramento da saúde — ASO) e S-2240 (condições ambientais — agentes nocivos).', [], ''],
  ['NBR 14280', 'nbr14280', 'Norma ABNT de cadastro de acidentes do trabalho: define critérios de registro e as taxas de frequência e gravidade.', [], ''],
  ['ISO 45001', 'iso45001', 'Norma internacional de sistemas de gestão de saúde e segurança ocupacional, baseada no ciclo PDCA e na participação dos trabalhadores.', [], ''],
];

// ---- Orientações práticas (situações do dia a dia) -------------------------------
const ADVICE = [
  {
    id: 'epi_recusa',
    gatilhos: /(nao (usa|usam|quer|querem|gosta|gostam)|recusa|se recusa|resiste|resistencia|esquece|tira|tiram|retira).{0,40}(epi|protetor|abafador|plug|capacete|oculos|luva|mascara|respirador|cinto|botina|bota)|(epi|protetor|abafador|capacete|oculos|luva|mascara|cinto).{0,30}(nao (usa|usam)|sem uso|recusa)/,
    titulo: 'Equipe que não usa o EPI',
    passos: [
      '**Entenda o porquê** antes de cobrar: converse com 2–3 pessoas. Os motivos mais comuns são desconforto (tamanho, calor, pressão), atrapalhar a comunicação, falta de hábito ou de exemplo da liderança.',
      '**Resolva a causa**: ofereça opções de modelo e tamanho (ex.: plug moldável × concha para protetor auricular), faça ajuste individual e teste de vedação quando aplicável.',
      '**Treine de forma prática**: mostre o risco real (para ruído, a PAIR é irreversível e indolor — a pessoa só percebe quando já perdeu audição) e como colocar corretamente.',
      '**Liderança dá o exemplo**: supervisores e visitantes usando o EPI na área, sempre.',
      '**Sinalize e padronize**: placas de uso obrigatório na entrada da área e ficha de entrega assinada (NR-06).',
      '**Acompanhe**: inspeções rápidas de uso, feedback positivo para quem usa e conversa individual com quem não usa.',
      '**Último recurso**: a recusa injustificada ao uso do EPI é ato faltoso (CLT art. 158) — aplique medidas disciplinares progressivas e documentadas.',
      '**E não esqueça a hierarquia de controles**: reduzir o risco na fonte (manutenção, enclausuramento, barreiras) diminui a dependência do EPI.',
    ],
    nrs: [6, 1],
    ofertas: [['DDS sobre o tema', 'Faz um DDS sobre uso de protetor auricular'], ['Ficha de entrega de EPI', 'Gera uma ficha de entrega de EPI'], ['Comunicado de uso obrigatório', 'Faz um comunicado de uso obrigatório de protetor auricular']],
  },
  {
    id: 'acidente_ocorreu',
    gatilhos: /(aconteceu|ocorreu|teve|tivemos|houve|sofreu|se machucou|machucou|caiu|cortou|quebrou|atropel).{0,40}(acidente|lesao|ferido|machucad|queda|corte|fratura)|acidente (hoje|agora|ontem|grave)/,
    titulo: 'Acidente aconteceu — primeiros passos',
    passos: [
      '**Socorro primeiro**: garanta a segurança da cena e acione o atendimento (SAMU 192 / Bombeiros 193). Não mova a vítima se houver suspeita de lesão na coluna.',
      '**Isole a área** e preserve o local e as evidências (fotos, equipamentos, documentos).',
      '**Comunique** a liderança, o SESMT/CIPA e o RH.',
      '**Emita a CAT** até o 1º dia útil seguinte (em caso de morte, imediatamente) — evento S-2210 no eSocial.',
      '**Investigue** com a equipe em até 24–72h: descreva o ocorrido, ouça testemunhas e use 5 porquês/Ishikawa para chegar às causas raiz (sem buscar culpados).',
      '**Plano de ação** (5W2H) com prazos e responsáveis, e **compartilhe as lições aprendidas** em DDS.',
    ],
    nrs: [1],
    ofertas: [['Relatório de investigação', 'Gera um relatório de investigação de acidente'], ['Plano de ação 5W2H', 'Monta um plano de ação 5W2H'], ['Alerta de segurança', 'Faz um alerta de segurança sobre o acidente']],
  },
  {
    id: 'quase_acidente',
    gatilhos: /(ninguem|pouca gente|equipe nao|nao) (reporta|relata|comunica|registra).{0,30}(quase|incidente|desvio)|aumentar (os )?(reportes|relatos)|cultura de seguranca/,
    titulo: 'Aumentar o reporte de quase acidentes',
    passos: [
      '**Facilite**: formulário de 1 minuto, QR code nas áreas, caixa física e reporte verbal ao líder.',
      '**Cultura justa**: deixe claro que reportar não gera punição — erros honestos viram aprendizado.',
      '**Dê retorno rápido**: todo reporte recebe resposta e, quando possível, uma ação visível.',
      '**Reconheça**: destaque os melhores reportes do mês no DDS.',
      '**Mostre o impacto**: indicadores simples (reportes × ações concluídas) no mural.',
    ],
    nrs: [1, 5],
    ofertas: [['Aba de registro de ocorrências', 'Crie uma aba para registrar quase acidentes com campos: data, setor, descrição, gravidade, status'], ['DDS sobre quase acidentes', 'Faz um DDS sobre a importância de reportar quase acidentes']],
  },
  {
    id: 'fiscalizacao',
    gatilhos: /(fiscalizacao|fiscal|auditoria|auditor|ministerio do trabalho|mte).{0,40}(vem|vai|chegando|semana|amanha|visita|preparar)|preparar (para|pra) (a )?(fiscalizacao|auditoria)/,
    titulo: 'Preparação para fiscalização/auditoria',
    passos: [
      '**PGR** atualizado (inventário de riscos + plano de ação) e **PCMSO** com relatório analítico.',
      '**ASOs** em dia de todos os empregados.',
      '**Treinamentos** obrigatórios com certificados válidos (NR-05, 06, 10, 11, 12, 33, 35 etc., conforme as atividades).',
      '**Fichas de entrega de EPI** assinadas, com CAs válidos.',
      '**CIPA/representante nomeado**: atas de eleição, posse e reuniões.',
      '**Ordens de serviço**, procedimentos, PTs/APRs arquivadas e inspeções registradas.',
      '**Prontuários** (elétrico NR-10, caldeiras NR-13) e laudos (LTCAT, insalubridade/periculosidade).',
      '**Eventos do eSocial SST** (S-2210, S-2220, S-2240) enviados.',
    ],
    nrs: [1, 7, 6, 5, 28],
    ofertas: [['Checklist documental', 'Faz um checklist de documentos para fiscalização'], ['Plano de ação', 'Monta um plano de ação 5W2H para a auditoria']],
  },
  {
    id: 'altura_sem_cinto',
    gatilhos: /(sem cinto|sem talabarte|nao (usa|usam|estava) (o )?cinto|desconectad|sem estar preso).{0,40}|(altura|telhado|andaime).{0,40}(sem cinto|sem protecao|sem epi)/,
    titulo: 'Trabalho em altura sem proteção',
    passos: [
      '**Pare a atividade imediatamente** — é risco grave e iminente (direito/dever de interrupção, NR-01).',
      'Verifique se há **PT e AR** emitidas e se o trabalhador é **treinado (NR-35), autorizado e apto no ASO**.',
      'Garanta **proteção coletiva** (guarda-corpo, fechamento de aberturas) ou **ancoragem adequada** para o cinto paraquedista com talabarte duplo.',
      'Retome somente com as barreiras implementadas e o **plano de resgate** disponível.',
      'Registre como desvio grave e trate a causa (pressa, falta de ancoragem, falta de EPI, supervisão).',
    ],
    nrs: [35, 1],
    ofertas: [['APR de trabalho em altura', 'Faz uma APR de trabalho em altura'], ['PT de trabalho em altura', 'Gera uma permissão de trabalho em altura']],
  },
  {
    id: 'calor',
    gatilhos: /(muito )?(calor|quente demais|temperatura alta|insolacao|desidrata)/,
    titulo: 'Calor excessivo no trabalho',
    passos: [
      '**Avalie a exposição** (IBUTG, conforme NR-15 Anexo 3 e NR-09) nas áreas e atividades críticas.',
      '**Hidratação**: água fresca próxima e incentivo a beber pouco e sempre.',
      '**Pausas e revezamento** em locais frescos; atividades pesadas nos horários mais amenos.',
      '**Aclimatação** gradual de novos trabalhadores e de quem volta de férias.',
      '**Controles**: ventilação, exaustão, barreiras de radiação térmica, roupas leves e protetor solar/chapéu a céu aberto (NR-21).',
      '**Treine** para reconhecer sinais de exaustão e insolação (tontura, náusea, câimbras, confusão).',
    ],
    nrs: [15, 9, 21],
    ofertas: [['DDS sobre calor', 'Faz um DDS sobre exposição ao calor']],
  },
  {
    id: 'empilhadeira_sem_habilitacao',
    gatilhos: /(sem (treinamento|curso|cartao|habilitacao)|nao (e|tem) (habilitado|treinado)).{0,40}(empilhadeira|operador)|(empilhadeira|operador).{0,40}(sem (treinamento|curso|cartao|habilitacao))/,
    titulo: 'Operador de empilhadeira sem capacitação',
    passos: [
      '**Retire da operação** até concluir a capacitação — chave sob controle da liderança.',
      'Providencie **treinamento de operador** e **cartão de identificação** com nome e foto (NR-11), válido por 1 ano com exame de saúde para revalidar.',
      'Implante **checklist pré-operacional** diário e **autorização formal** dos operadores.',
      'Revise rotas, sinalização horizontal e velocidade máxima na área.',
    ],
    nrs: [11],
    ofertas: [['Checklist de empilhadeira', 'Gera um checklist de empilhadeira'], ['APR de empilhadeira', 'Faz uma APR de empilhadeira']],
  },
  {
    id: 'engajamento',
    gatilhos: /(engajar|motivar|conscientizar|envolver).{0,40}(equipe|time|pessoal|colaboradores|trabalhadores)|(campanha|ideias?) (de|para|pra) (seguranca|sipat|dds)/,
    titulo: 'Engajar a equipe em segurança',
    passos: [
      '**DDS participativo**: perguntas, casos reais da própria área e rodízio de quem conduz.',
      '**Reconhecimento** de comportamentos seguros e de bons reportes — não só de "dias sem acidentes".',
      '**Liderança visível**: caminhadas de segurança com escuta ativa.',
      '**Gamificação**: desafios por equipe (5S, inspeções, quiz de NR) com metas simples.',
      '**Comunicação visual**: mural com indicadores, alertas e lições aprendidas.',
      '**Dê voz**: implemente sugestões dos trabalhadores e mostre o antes/depois.',
    ],
    nrs: [1, 5],
    ofertas: [['Aba de indicadores', 'Crie uma aba de indicadores de segurança'], ['DDS criativo', 'Faz um DDS sobre percepção de risco']],
  },
  {
    id: 'psicossocial',
    gatilhos: /(saude mental|burnout|estresse|estressad|ansiedade|assedio|pressao (demais|excessiva)|sobrecarga)/,
    titulo: 'Riscos psicossociais e saúde mental',
    passos: [
      '**Inclua no GRO/PGR** os fatores psicossociais (NR-01): sobrecarga, metas, conflitos, assédio, jornada, falta de autonomia.',
      '**Ouça as pessoas**: pesquisas anônimas, rodas de conversa e canais seguros de denúncia (a CIPA também atua contra assédio — NR-05).',
      '**Organização do trabalho**: pausas, distribuição justa de tarefas, clareza de papéis, metas realistas.',
      '**Lideranças preparadas** para acolher e encaminhar; divulgue apoio psicológico disponível (CVV 188).',
      '**Monitore** afastamentos, rotatividade e absenteísmo como sinais de alerta.',
    ],
    nrs: [1, 5, 17],
    ofertas: [['DDS sobre saúde mental', 'Faz um DDS sobre saúde mental no trabalho']],
  },
  {
    id: 'terceiros',
    gatilhos: /(terceirizad|prestador|empreiteira|contratada|terceiros).{0,40}(seguranca|controle|documento|integracao|gestao)/,
    titulo: 'Gestão de terceiros/contratadas',
    passos: [
      '**Exija documentação antes da mobilização**: PGR/APR da atividade, ASOs, treinamentos (NRs aplicáveis), fichas de EPI.',
      '**Integração de segurança** obrigatória com as regras do local.',
      '**PT e acompanhamento** nas atividades de risco, com responsável da contratante.',
      '**Inspeções e indicadores** da contratada (desvios, acidentes, HHT).',
      '**Contrato** com cláusulas de SST e consequências por descumprimento.',
    ],
    nrs: [1],
    ofertas: [['Checklist de contratadas', 'Faz um checklist de documentação de terceiros']],
  },
  {
    id: 'quimicos_sem_fds',
    gatilhos: /(sem (fds|fispq|rotulo|identificacao)|nao tem (fds|fispq)|produto (sem|nao identificado))/,
    titulo: 'Produtos químicos sem FDS ou rótulo',
    passos: [
      '**Segregue** o produto e não utilize até identificá-lo.',
      '**Solicite a FDS** ao fabricante/fornecedor (obrigatória) e mantenha acessível aos trabalhadores.',
      '**Rotule** conforme GHS (ABNT NBR 14725): pictogramas, palavra de advertência e frases de perigo — inclusive em recipientes de transferência.',
      '**Armazene por compatibilidade**, com contenção e ventilação.',
      '**Treine** sobre perigos, EPIs (seção 8 da FDS) e emergências (seções 4 a 6).',
    ],
    nrs: [26, 9],
    ofertas: [['APR de produtos químicos', 'Faz uma APR de manuseio de produtos químicos']],
  },
  {
    id: 'housekeeping',
    gatilhos: /(bagunca|desorganiz|sujeira|sujo|housekeeping|organizacao e limpeza|5s)/,
    titulo: 'Organização e limpeza (5S)',
    passos: [
      '**Comece pequeno**: uma área piloto com o time que trabalha nela.',
      '**Descarte** o que não é usado, **defina lugar** para cada coisa (demarcação de piso) e **limpe** inspecionando.',
      '**Padronize** com fotos do "como deve estar" e **audite** semanalmente com checklist simples.',
      '**Mostre o resultado**: antes/depois e ranking entre áreas.',
    ],
    nrs: [26, 23],
    ofertas: [['Checklist 5S', 'Gera um checklist de 5S'], ['Aba de auditorias 5S', 'Crie uma aba para controlar auditorias 5S com campos: data, área, nota, responsável']],
  },
];

// ---- Conversa (small talk) ------------------------------------------------------------
const SMALLTALK = {
  como_esta: [
    'Tudo ótimo — ou o mais perto disso que uma IA consegue 😄 E aí, como você tá?',
    'Por aqui tudo em ordem, com os EPIs digitais ajustados 😄 E você, como está?',
    'Funcionando a todo vapor (com válvula de segurança calibrada 😉). E você, tudo bem?',
  ],
  bem: ['Que bom! 😊 Me conta: em que posso te ajudar hoje?', 'Fico feliz! Bora deixar o dia mais seguro? Me diz o que precisa.', 'Show! Tô por aqui para o que precisar — documentos, dúvidas de NR, abas novas…'],
  mal: [
    'Poxa, sinto muito. Se quiser, me conta o que houve — às vezes ajuda organizar as ideias. E se for algo mais pesado, o CVV atende 24h pelo 188. 💙',
    'Que pena… respira fundo. Posso aliviar alguma tarefa pra você agora? Posso gerar documentos, checklists ou resumir arquivos.',
  ],
  obrigado: ['Por nada! Conte comigo. 🦺', 'Imagina! Segurança em primeiro lugar — e eu tô aqui pra isso.', 'Disponha! Se precisar de mais alguma coisa, é só chamar.'],
  tchau: ['Até mais! Bom trabalho e volte sempre em segurança. 👋', 'Tchau! Qualquer coisa, tô por aqui.', 'Até logo! Lembre-se: ninguém se machuca hoje. 💪'],
  elogio: ['Obrigada! 😊 Você também manda bem. Vamos seguir?', 'Assim eu fico sem graça 😄 Obrigada! O que mais posso fazer por você?'],
};


/* ===== 06-kb-activities.js ===== */
// ---------------------------------------------------------------------------
// 06 · Biblioteca de atividades (perigos, controles, EPIs, checklists, DDS)
//      Alimenta APR, PT, checklist, DDS, OS, POP, ficha de EPI e inventário.
//      Perigo: [etapa, perigo, risco/consequência, probabilidade 1-5, severidade 1-5, [controles]]
// ---------------------------------------------------------------------------
const ACTIVITIES = [
  {
    id: 'empilhadeira', nome: 'Operação de empilhadeira', pt: null, nrs: [11, 12, 17, 26],
    termos: ['empilhadeira', 'empilhadeiras', 'empilhar', 'transpaleteira eletrica', 'forklift', 'rebocador', 'clark'],
    etapas: ['Inspeção pré-operacional', 'Deslocamento com e sem carga', 'Elevação e empilhamento', 'Carga e descarga em docas', 'Recarga de bateria / troca de GLP', 'Estacionamento e desligamento'],
    perigos: [
      ['Inspeção pré-operacional', 'Equipamento com defeito (freios, direção, garfos, mastro, correntes)', 'Perda de controle, queda de carga, colisão', 3, 4, ['Checklist pré-operacional diário assinado', 'Equipamento reprovado bloqueado e etiquetado — não operar', 'Manutenção preventiva conforme plano']],
      ['Deslocamento com e sem carga', 'Circulação compartilhada com pedestres', 'Atropelamento', 3, 5, ['Rotas de pedestres e de empilhadeiras segregadas e demarcadas no piso', 'Velocidade máxima definida e sinalizada', 'Buzina em cruzamentos, alarme de ré e luz de advertência', 'Espelhos convexos em cruzamentos cegos']],
      ['Deslocamento com e sem carga', 'Carga obstruindo a visão, rampas e piso irregular', 'Colisão, tombamento lateral ou frontal', 3, 5, ['Transitar de ré quando a carga obstruir a visão', 'Carga baixa (15–20 cm do piso) durante o deslocamento', 'Em rampas, carga voltada para o lado mais alto', 'Cinto de segurança afivelado', 'Piso conservado e sinalizado']],
      ['Elevação e empilhamento', 'Carga acima da capacidade ou mal acondicionada', 'Tombamento, queda de materiais sobre pessoas', 3, 5, ['Respeitar a placa de capacidade (centro de carga e altura)', 'Paletes íntegros e cargas estabilizadas (filme/cintas)', 'Proibido elevar pessoas nos garfos', 'Ninguém sob garfos elevados ou carga suspensa']],
      ['Carga e descarga em docas', 'Afastamento do caminhão / vão entre doca e veículo', 'Queda da empilhadeira da doca', 2, 5, ['Calços nas rodas do caminhão e/ou trava de doca', 'Niveladora de doca inspecionada', 'Confirmar freio do caminhão acionado antes de entrar']],
      ['Recarga de bateria / troca de GLP', 'Hidrogênio na recarga de baterias ou vazamento de GLP', 'Incêndio, explosão, queimadura química', 2, 5, ['Sala de recarga ventilada, sinalizada e sem fontes de ignição', 'Luvas e óculos/viseira para manusear baterias', 'Troca de GLP por pessoa treinada, testando vazamentos com espuma', 'Extintor adequado próximo']],
      ['Todas', 'Operador não habilitado', 'Acidentes por imperícia', 2, 5, ['Somente operador treinado, autorizado e com cartão de identificação com foto válido (NR-11)', 'Chaves sob controle da liderança']],
      ['Todas', 'Gases de motor a combustão em ambiente fechado', 'Intoxicação por monóxido de carbono', 2, 4, ['Preferir empilhadeira elétrica em áreas fechadas', 'Ventilação e monitoramento de CO', 'Motor regulado (manutenção)']],
      ['Todas', 'Vibração de corpo inteiro e postura', 'Dores lombares, lesões musculoesqueléticas', 3, 2, ['Assento com suspensão regulável', 'Pausas e revezamento', 'Pneus e piso em bom estado']],
    ],
    epis: ['Calçado de segurança com biqueira', 'Colete refletivo', 'Capacete de segurança (onde houver risco de queda de materiais)', 'Protetor auricular (quando o ruído exigir)', 'Luvas de proteção para manuseio de cargas', 'Óculos de proteção (recarga de baterias)'],
    requisitos: ['Operador capacitado e autorizado, com cartão de identificação com nome e foto em local visível (NR-11) — validade de 1 ano', 'Checklist pré-operacional diário', 'Capacidade de carga indicada no equipamento', 'Buzina, alarme de ré e luzes funcionando', 'Plano de circulação com rotas sinalizadas (NR-26)'],
    checklist: ['Freio de serviço e freio de estacionamento', 'Direção sem folgas', 'Garfos sem trincas, empenos ou desgaste excessivo', 'Mastro, correntes e roletes sem danos e lubrificados', 'Sistema hidráulico sem vazamentos', 'Pneus/rodas em bom estado', 'Buzina funcionando', 'Alarme sonoro de ré e luz de advertência', 'Faróis e luzes de sinalização', 'Cinto de segurança em bom estado', 'Protetor do operador (santo-antônio) e grade de carga', 'Bateria/cabos sem danos (elétrica) ou cilindro de GLP fixo e sem vazamento', 'Placa de capacidade legível', 'Extintor (quando exigido) carregado e lacrado', 'Painel sem alertas de falha'],
    dds: ['A empilhadeira não tem freio para pedestre: respeite as faixas e busque contato visual.', 'Nunca transporte pessoas nos garfos.', 'Carga baixa, velocidade baixa e atenção redobrada em cruzamentos.', 'Se a carga tapar a visão, ande de ré.', 'Equipamento com defeito é equipamento parado: bloqueie e comunique.'],
  },
  {
    id: 'altura', nome: 'Trabalho em altura', pt: 'altura', nrs: [35, 18, 6, 1],
    termos: ['trabalho em altura', 'altura', 'plataforma elevatoria', 'pta', 'cesto aereo', 'plataforma tesoura', 'balancim', 'cadeirinha', 'fachada', 'linha de vida', 'acima de 2 metros', 'mezanino', 'caixa d agua', 'poste', 'torre'],
    etapas: ['Planejamento, AR e emissão da PT', 'Isolamento e sinalização da área', 'Instalação e inspeção do sistema de proteção contra quedas', 'Acesso ao ponto de trabalho', 'Execução da atividade', 'Descida, desmobilização e liberação da área'],
    perigos: [
      ['Execução da atividade', 'Queda de pessoa de nível diferente (acima de 2 m)', 'Morte ou lesões graves', 3, 5, ['Priorizar proteção coletiva (guarda-corpo, rodapé, redes, fechamento de aberturas)', 'Cinto paraquedista com talabarte duplo/trava-quedas conectado 100% do tempo', 'Ancoragem inspecionada e dimensionada por profissional legalmente habilitado', 'PT emitida e AR assinada antes do início']],
      ['Execução da atividade', 'Queda de materiais e ferramentas', 'Pessoas atingidas no nível inferior', 3, 4, ['Área abaixo isolada e sinalizada', 'Ferramentas amarradas (cordeletes/porta-ferramentas)', 'Rodapé nas plataformas', 'Capacete com jugular para todos na área']],
      ['Planejamento, AR e emissão da PT', 'Condições climáticas adversas (vento, chuva, raios)', 'Queda, choque elétrico', 2, 5, ['Suspender com ventos fortes, chuva ou descargas atmosféricas', 'Consultar a previsão do tempo no planejamento']],
      ['Acesso ao ponto de trabalho', 'Proximidade de rede elétrica energizada', 'Choque elétrico / arco', 2, 5, ['Manter distâncias de segurança (NR-10) ou desenergizar', 'Levantamento prévio de interferências', 'Escadas e ferramentas isolantes']],
      ['Execução da atividade', 'Suspensão inerte após retenção de queda', 'Síndrome da suspensão inerte, óbito', 2, 5, ['Plano de resgate com equipe e equipamentos no local', 'Resgate em poucos minutos', 'Treinamento prático de resgate']],
      ['Planejamento, AR e emissão da PT', 'Mal súbito ou condição de saúde inadequada', 'Queda', 2, 5, ['ASO com aptidão para trabalho em altura', 'Verificar condições do trabalhador antes de subir (sono, medicação, álcool)']],
      ['Instalação e inspeção do sistema de proteção contra quedas', 'Falha de EPI ou de ancoragem', 'Queda', 2, 5, ['Inspeção de cinto, talabarte, trava-quedas e conectores antes do uso', 'Descartar equipamento que reteve queda ou com danos', 'Registro de inspeções periódicas']],
      ['Execução da atividade', 'Posturas forçadas e esforço em altura', 'Fadiga, lesões musculoesqueléticas', 3, 2, ['Plataformas de trabalho adequadas', 'Pausas e revezamento']],
    ],
    epis: ['Cinto de segurança tipo paraquedista', 'Talabarte duplo (Y) com absorvedor de energia', 'Trava-quedas (retrátil ou para linha de vida)', 'Capacete com jugular', 'Calçado de segurança antiderrapante', 'Luvas de proteção', 'Óculos de proteção'],
    requisitos: ['Treinamento NR-35 (inicial de 8h teórico e prático; reciclagem bienal de 8h)', 'Autorização formal do trabalhador', 'ASO com aptidão para trabalho em altura', 'Análise de Risco (AR) e Permissão de Trabalho (PT) para atividades não rotineiras', 'Plano de emergência e resgate', 'Supervisão da atividade'],
    checklist: ['PT emitida e assinada', 'AR realizada com a equipe', 'Treinamento NR-35 válido e aptidão no ASO', 'Área abaixo isolada e sinalizada', 'Ancoragem definida e inspecionada', 'Cinto paraquedista sem cortes, costuras íntegras e fivelas funcionando', 'Talabarte e absorvedor sem acionamento e sem danos', 'Trava-quedas testado', 'Condições climáticas favoráveis', 'Ferramentas amarradas', 'Equipe e kit de resgate disponíveis', 'Iluminação adequada'],
    dds: ['Acima de 2 metros com risco de queda é trabalho em altura: AR e PT antes de subir.', 'Conectado 100% do tempo — use o talabarte duplo.', 'Inspecione seu cinto como se sua vida dependesse dele (porque depende).', 'Proteção coletiva vem antes do cinto.', 'No resgate, tempo é vida: suspensão inerte mata em minutos.'],
  },
  {
    id: 'confinado', nome: 'Trabalho em espaço confinado', pt: 'confinado', nrs: [33, 6, 1],
    termos: ['espaco confinado', 'confinado', 'tanque', 'silo', 'galeria', 'poco de visita', 'cisterna', 'reator', 'vaso interno', 'tubulao', 'bueiro', 'boca de lobo', 'caixa de passagem', 'interior de tanque', 'moega', 'digestor'],
    etapas: ['Planejamento e emissão da PET', 'Isolamento de energias e bloqueios', 'Avaliação da atmosfera', 'Ventilação', 'Entrada e execução', 'Saída e encerramento da PET'],
    perigos: [
      ['Avaliação da atmosfera', 'Deficiência de oxigênio (abaixo de 19,5%)', 'Asfixia, morte', 3, 5, ['Medição antes e durante com detector calibrado (O₂, LIE, H₂S, CO)', 'Ventilação/exaustão mecânica contínua', 'Proibir a entrada com valores fora dos limites']],
      ['Avaliação da atmosfera', 'Atmosfera inflamável ou explosiva', 'Explosão, incêndio', 2, 5, ['Inflamáveis abaixo de 10% do LIE', 'Iluminação e ferramentas à prova de explosão', 'Controle de fontes de ignição e aterramento']],
      ['Entrada e execução', 'Gases e vapores tóxicos (H₂S, CO, solventes)', 'Intoxicação, morte', 3, 5, ['Monitoramento contínuo', 'Proteção respiratória adequada — adução de ar em atmosfera IPVS']],
      ['Isolamento de energias e bloqueios', 'Energias perigosas (agitadores, válvulas, linhas de produto)', 'Esmagamento, afogamento, queimaduras', 2, 5, ['Bloqueio e etiquetagem de todas as fontes (LOTO)', 'Raquetear/isolar linhas', 'Teste de energia zero']],
      ['Entrada e execução', 'Engolfamento (grãos, pós, líquidos)', 'Soterramento, afogamento', 2, 5, ['Esvaziar e isolar a alimentação', 'Cinto com ponto dorsal e sistema de resgate conectado']],
      ['Entrada e execução', 'Dificuldade de saída e de resgate', 'Óbito do trabalhador ou de socorristas', 3, 5, ['Vigia permanente do lado de fora (não entra)', 'Equipe de resgate treinada, tripé e guincho posicionados', 'Comunicação constante vigia–entrantes']],
      ['Entrada e execução', 'Calor, esforço e posturas restritas', 'Exaustão, lesões', 3, 3, ['Pausas, hidratação e revezamento', 'Iluminação e ventilação adequadas']],
    ],
    epis: ['Detector multigás calibrado (O₂, LIE, H₂S, CO)', 'Cinto paraquedista com ponto dorsal', 'Tripé e guincho/trava-quedas de resgate', 'Proteção respiratória adequada ao risco', 'Capacete com jugular', 'Luvas e vestimenta adequadas', 'Lanterna à prova de explosão', 'Calçado de segurança'],
    requisitos: ['PET emitida pelo supervisor de entrada', 'Vigia exclusivo e permanente', 'Capacitação NR-33: 16h (autorizados e vigias) e 40h (supervisores), com reciclagem anual', 'Espaço confinado identificado e sinalizado', 'Plano de resgate e equipe de emergência', 'Proibido trabalho individual'],
    checklist: ['PET emitida e assinada', 'Espaço identificado e sinalizado', 'Fontes de energia bloqueadas e etiquetadas', 'Linhas isoladas/raqueteadas', 'Detector calibrado e testado', 'O₂ entre 19,5% e 23%', 'Inflamáveis abaixo de 10% do LIE', 'H₂S e CO abaixo dos limites', 'Ventilação funcionando', 'Vigia designado e treinado', 'Equipamentos de resgate posicionados', 'Comunicação testada', 'Trabalhadores com capacitação NR-33 válida'],
    dds: ['Nunca entre para socorrer sem proteção — a maioria das vítimas é de socorristas.', 'O detector é o seu nariz: meça antes e durante.', 'O vigia não entra, em hipótese alguma.', 'Sem PET, sem entrada.'],
  },
  {
    id: 'quente', nome: 'Trabalho a quente (solda, corte e esmerilhamento)', pt: 'quente', nrs: [18, 20, 23, 6, 12],
    termos: ['solda', 'soldagem', 'soldar', 'soldador', 'trabalho a quente', 'corte a quente', 'oxicorte', 'macarico', 'plasma', 'eletrodo', 'mig', 'tig'],
    etapas: ['Emissão da PT de trabalho a quente', 'Preparação e isolamento da área', 'Montagem do equipamento (cilindros, mangueiras, máquina)', 'Execução da solda/corte', 'Vigilância de fogo pós-trabalho', 'Desmobilização'],
    perigos: [
      ['Execução da solda/corte', 'Faíscas e respingos próximos a materiais combustíveis', 'Incêndio, explosão', 3, 5, ['Remover/proteger combustíveis num raio de ~11 m (mantas antichama)', 'PT de trabalho a quente', 'Vigia de fogo durante e por no mínimo 30 minutos após', 'Extintor adequado ao lado']],
      ['Execução da solda/corte', 'Fumos metálicos e gases', 'Intoxicação, doenças respiratórias', 3, 3, ['Exaustão localizada', 'Ventilação do ambiente', 'Respirador adequado (PFF2 ou com filtro para fumos)']],
      ['Execução da solda/corte', 'Radiação ultravioleta e infravermelha', 'Queimaduras nos olhos (fotoceratite) e pele', 3, 3, ['Máscara de solda com filtro de tonalidade adequada', 'Biombos/cortinas para proteger terceiros', 'Vestimenta que cubra a pele']],
      ['Montagem do equipamento (cilindros, mangueiras, máquina)', 'Retrocesso de chama / vazamento de gases', 'Explosão de cilindros ou mangueiras', 2, 5, ['Válvulas corta-chamas (antirretrocesso) no maçarico e no regulador', 'Cilindros em pé, acorrentados e com capacete', 'Teste de vazamento com espuma', 'Mangueiras sem emendas improvisadas']],
      ['Execução da solda/corte', 'Choque elétrico (solda elétrica)', 'Choque, queimaduras', 2, 5, ['Cabos e porta-eletrodo sem danos', 'Aterramento da peça', 'Luvas secas; não trabalhar em ambiente molhado']],
      ['Execução da solda/corte', 'Contato com superfícies quentes e escória', 'Queimaduras', 3, 3, ['Luvas e avental de raspa, mangote e perneira', 'Sinalizar peças quentes']],
      ['Execução da solda/corte', 'Ruído do esmerilhamento/corte', 'Perda auditiva', 3, 2, ['Protetor auricular']],
      ['Execução da solda/corte', 'Projeção de partículas no esmerilhamento', 'Lesões oculares', 3, 3, ['Óculos de proteção sob a máscara e protetor facial', 'Coifa da esmerilhadeira instalada']],
    ],
    epis: ['Máscara de solda (filtro adequado ou escurecimento automático)', 'Óculos de proteção e protetor facial (esmerilhamento)', 'Luvas de raspa para soldador', 'Avental, mangote e perneira de raspa', 'Vestimenta antichama', 'Respirador para fumos metálicos', 'Protetor auricular', 'Calçado de segurança', 'Touca/balaclava antichama'],
    requisitos: ['Permissão de Trabalho a quente emitida', 'Área livre de inflamáveis ou protegida', 'Vigia de fogo designado', 'Extintor adequado no local', 'Soldadores capacitados', 'Em espaços confinados ou em altura, atender também NR-33/NR-35'],
    checklist: ['PT de trabalho a quente emitida', 'Combustíveis removidos ou protegidos (raio ~11 m)', 'Aberturas e frestas protegidas contra faíscas', 'Extintor adequado no local', 'Vigia de fogo designado', 'Cilindros em pé, acorrentados, com capacete', 'Válvulas corta-chamas instaladas', 'Mangueiras e reguladores sem vazamentos', 'Cabos e porta-eletrodo em bom estado', 'Exaustão/ventilação funcionando', 'Biombos para proteger terceiros', 'EPIs completos'],
    dds: ['Uma faísca pode viajar mais de 10 metros: limpe a área antes de começar.', 'O vigia de fogo fica até depois do fim do trabalho.', 'Nunca olhe o arco sem proteção — nem "só um pouquinho".', 'Cilindro deitado ou solto é bomba em potencial.'],
  },
  {
    id: 'eletrica', nome: 'Serviços em eletricidade', pt: 'eletrica', nrs: [10, 6, 1, 26],
    termos: ['eletrica', 'eletricidade', 'eletricista', 'painel eletrico', 'quadro eletrico', 'quadro de distribuicao', 'subestacao', 'cabine primaria', 'disjuntor', 'fiacao', 'instalacao eletrica', 'manutencao eletrica', 'rede eletrica', 'tomada', 'motor eletrico', 'energizado', 'cabo', 'lampada', 'luminaria', 'iluminacao'],
    etapas: ['Planejamento e liberação (PT/autorização)', 'Desenergização e bloqueio', 'Teste de ausência de tensão e aterramento', 'Execução do serviço', 'Retirada de bloqueios e reenergização', 'Testes e liberação'],
    perigos: [
      ['Execução do serviço', 'Contato com partes energizadas', 'Choque elétrico, morte', 3, 5, ['Desenergização conforme NR-10 (seccionar, bloquear, testar, aterrar, sinalizar)', 'Ferramentas isoladas e luvas isolantes com classe compatível', 'Somente profissional autorizado NR-10']],
      ['Execução do serviço', 'Arco elétrico', 'Queimaduras graves, lesões oculares', 2, 5, ['Vestimenta antichama com ATPV adequado ao estudo de energia incidente', 'Protetor facial para arco', 'Manobras com distância segura/procedimento']],
      ['Retirada de bloqueios e reenergização', 'Reenergização acidental', 'Choque elétrico', 2, 5, ['Bloqueio com cadeado pessoal e etiqueta (LOTO)', 'Comunicação e controle das chaves', 'Aterramento temporário']],
      ['Execução do serviço', 'Trabalho em altura (escadas, postes, luminárias)', 'Queda', 2, 4, ['Escada de fibra inspecionada', 'Atender NR-35 acima de 2 m']],
      ['Execução do serviço', 'Instalações improvisadas / sobrecarga', 'Incêndio', 2, 4, ['Proibir gambiarras e extensões improvisadas', 'Proteções (disjuntores, DR) dimensionadas']],
      ['Testes e liberação', 'Área energizada sem controle de acesso', 'Choque em terceiros', 2, 5, ['Isolar e sinalizar a zona controlada', 'Painéis fechados e identificados']],
    ],
    epis: ['Luvas isolantes (classe compatível com a tensão) com luva de cobertura', 'Vestimenta antichama com ATPV adequado', 'Capacete classe B com jugular', 'Protetor facial para arco / óculos de proteção', 'Calçado de segurança isolante sem partes metálicas', 'Detector de tensão testado', 'Cadeados e etiquetas de bloqueio'],
    requisitos: ['Curso NR-10 básico (40h) e complementar SEP (40h) quando aplicável; reciclagem bienal', 'Autorização formal e ASO apto', 'Procedimento de trabalho e PT para serviços críticos', 'Prontuário das instalações elétricas (carga acima de 75 kW)', 'Trabalho em dupla em serviços de risco'],
    checklist: ['Autorização NR-10 válida', 'PT/ordem de serviço emitida', 'Circuito identificado no diagrama', 'Seccionamento realizado', 'Cadeado e etiqueta instalados por cada executante', 'Ausência de tensão testada (detector testado antes e depois)', 'Aterramento temporário instalado', 'Zona controlada isolada e sinalizada', 'Luvas isolantes inspecionadas (teste de ar)', 'Vestimenta com ATPV adequado', 'Ferramentas isoladas em bom estado', 'Extintor CO₂/pó próximo'],
    dds: ['Todo circuito é considerado energizado até prova em contrário.', 'Seu cadeado, sua vida: cada executante coloca o próprio bloqueio.', 'Teste o detector antes e depois de medir.', 'Gambiarra não é solução — é risco de incêndio e choque.'],
  },
  {
    id: 'maquinas', nome: 'Operação de máquinas e equipamentos', pt: null, nrs: [12, 6, 17, 1],
    termos: ['maquina', 'maquinas', 'prensa', 'torno', 'fresadora', 'guilhotina', 'injetora', 'dobradeira', 'calandra', 'misturador', 'esteira', 'transportador', 'cilindro', 'moinho', 'triturador', 'extrusora', 'serra fita', 'serra de bancada', 'picador', 'embaladora', 'operacao de maquina', 'operador de maquina'],
    etapas: ['Inspeção e preparação da máquina', 'Partida e operação', 'Alimentação e retirada de peças', 'Ajustes, setup e limpeza', 'Desligamento'],
    perigos: [
      ['Alimentação e retirada de peças', 'Acesso a partes móveis e zonas de prensagem', 'Esmagamento, amputação', 3, 5, ['Proteções fixas e móveis intertravadas', 'Dispositivos de segurança (cortina de luz, bimanual)', 'Proibido burlar ou retirar proteções']],
      ['Ajustes, setup e limpeza', 'Partida inesperada durante ajuste/limpeza', 'Esmagamento, amputação', 3, 5, ['Bloqueio e etiquetagem (energia zero)', 'Procedimento de setup seguro', 'Ferramentas de limpeza (sem mãos na zona de perigo)']],
      ['Partida e operação', 'Enroscamento de roupas, cabelos ou adornos', 'Lesões graves', 2, 5, ['Proibido adornos e roupas soltas', 'Cabelos presos', 'Luvas somente quando não houver risco de enroscamento']],
      ['Partida e operação', 'Projeção de partículas/fragmentos', 'Lesões oculares e cortes', 3, 3, ['Anteparos e proteções', 'Óculos de proteção']],
      ['Partida e operação', 'Ruído', 'Perda auditiva', 3, 3, ['Manutenção e enclausuramento', 'Protetor auricular', 'Audiometria (PCMSO)']],
      ['Partida e operação', 'Falha de comando / parada de emergência inoperante', 'Acidente grave', 2, 5, ['Teste diário da parada de emergência', 'Manutenção dos sistemas de segurança']],
      ['Todas', 'Choque elétrico', 'Choque, queimaduras', 2, 5, ['Painéis fechados, aterramento', 'Intervenções elétricas só por autorizados NR-10']],
      ['Partida e operação', 'Posturas e repetitividade', 'LER/DORT', 3, 2, ['Altura de trabalho adequada', 'Pausas e rodízio']],
    ],
    epis: ['Óculos de proteção', 'Protetor auricular', 'Calçado de segurança', 'Luvas adequadas (quando não houver risco de enroscamento)', 'Avental/vestimenta adequada', 'Touca/rede para cabelos longos'],
    requisitos: ['Operador capacitado e autorizado (NR-12)', 'Manual e procedimentos em português', 'Sistemas de segurança funcionando', 'Bloqueio de energias na manutenção', 'Sinalização de perigos na máquina'],
    checklist: ['Proteções fixas instaladas e íntegras', 'Proteções móveis com intertravamento funcionando', 'Parada de emergência testada', 'Dispositivos de segurança (cortina/bimanual) funcionando', 'Comandos identificados em português', 'Sem vazamentos (óleo, ar)', 'Cabos e painel elétrico íntegros e fechados', 'Área limpa e organizada ao redor', 'Sinalização de segurança legível', 'Operador sem adornos e com EPIs'],
    dds: ['Proteção de máquina não é opcional: burlar é jogar com os próprios dedos.', 'Ajuste e limpeza só com energia zero e cadeado.', 'Luva perto de parte giratória puxa a mão junto.', 'Parada de emergência testada todo início de turno.'],
  },
  {
    id: 'andaime', nome: 'Montagem e uso de andaimes', pt: 'altura', nrs: [18, 35, 6],
    termos: ['andaime', 'andaimes', 'andaime tubular', 'andaime fachadeiro', 'torre de andaime', 'plataforma de trabalho'],
    etapas: ['Planejamento e projeto', 'Preparação da base e montagem', 'Inspeção e liberação (etiqueta)', 'Acesso e uso', 'Desmontagem'],
    perigos: [
      ['Acesso e uso', 'Queda de altura', 'Morte ou lesões graves', 3, 5, ['Guarda-corpo (1,20 m), travessão intermediário (0,70 m) e rodapé (0,20 m)', 'Plataforma totalmente forrada e travada', 'Cinto paraquedista conectado durante montagem/desmontagem']],
      ['Preparação da base e montagem', 'Colapso ou tombamento do andaime', 'Queda, soterramento por materiais', 2, 5, ['Base firme e nivelada com sapatas', 'Estaiamento/ancoragem à estrutura conforme projeto', 'Montagem por trabalhadores capacitados', 'Rodas travadas; proibido deslocar com pessoas']],
      ['Acesso e uso', 'Queda de materiais', 'Pessoas atingidas', 3, 4, ['Rodapé e telas', 'Área abaixo isolada', 'Não acumular materiais na plataforma']],
      ['Acesso e uso', 'Acesso inadequado (escalar pelas travessas)', 'Queda', 3, 4, ['Escada de acesso incorporada ou rampa', 'Três pontos de contato']],
      ['Planejamento e projeto', 'Proximidade de rede elétrica', 'Choque elétrico', 2, 5, ['Respeitar distâncias de segurança', 'Desenergizar ou isolar a rede']],
    ],
    epis: ['Cinto paraquedista com talabarte duplo', 'Capacete com jugular', 'Calçado de segurança antiderrapante', 'Luvas de proteção'],
    requisitos: ['Projeto e montagem conforme NR-18 e normas técnicas', 'Montadores capacitados', 'Inspeção diária com etiqueta de liberação (verde/vermelha)', 'Treinamento NR-35 para os usuários'],
    checklist: ['Base firme, nivelada, com sapatas', 'Peças sem amassados, trincas ou corrosão', 'Travamentos e contraventamentos instalados', 'Ancoragem/estaiamento conforme projeto', 'Plataforma completamente forrada e fixada', 'Guarda-corpo e rodapé em todo o perímetro', 'Escada de acesso instalada', 'Rodas travadas (andaime móvel)', 'Etiqueta de liberação válida', 'Área abaixo isolada'],
    dds: ['Andaime sem etiqueta verde não se usa.', 'Nunca escale pelas travessas — use a escada de acesso.', 'Não improvise: tábua solta e guarda-corpo faltando derrubam gente todo ano.'],
  },
  {
    id: 'escada', nome: 'Uso de escada portátil', pt: null, nrs: [35, 18, 6],
    termos: ['escada', 'escada portatil', 'escada de mao', 'escada extensivel', 'escada tesoura', 'escada de abrir'],
    etapas: ['Inspeção da escada', 'Posicionamento e fixação', 'Subida e descida', 'Execução da tarefa', 'Recolhimento e guarda'],
    perigos: [
      ['Subida e descida', 'Queda da escada', 'Fraturas, traumatismo', 3, 4, ['Três pontos de contato', 'Não usar os dois últimos degraus', 'Não carregar materiais nas mãos (usar bolsa/cordas)']],
      ['Posicionamento e fixação', 'Escorregamento ou tombamento da escada', 'Queda', 3, 4, ['Inclinação de 1:4 (≈75°)', 'Sapatas antiderrapantes', 'Amarrar no topo ou ter alguém segurando a base', 'Ultrapassar 1 m acima do ponto de apoio superior']],
      ['Inspeção da escada', 'Escada danificada ou improvisada', 'Queda', 2, 4, ['Inspeção antes do uso', 'Retirar de uso escadas com defeito', 'Proibido escadas improvisadas']],
      ['Execução da tarefa', 'Contato elétrico com escada metálica', 'Choque elétrico', 2, 5, ['Usar escada de fibra em serviços elétricos', 'Manter distância de redes energizadas']],
      ['Execução da tarefa', 'Trabalho acima de 2 m', 'Queda de altura', 2, 5, ['Aplicar NR-35 (AR, cinto e ancoragem quando necessário)', 'Preferir plataforma/PTA para tarefas longas']],
    ],
    epis: ['Calçado de segurança antiderrapante', 'Capacete com jugular', 'Luvas de proteção', 'Cinto paraquedista (acima de 2 m, conforme AR)'],
    requisitos: ['Escada em bom estado e adequada à tarefa', 'Escada de mão com até 7 m de extensão', 'NR-35 aplicável acima de 2 m'],
    checklist: ['Montantes sem trincas ou empenos', 'Degraus firmes e limpos', 'Sapatas antiderrapantes presentes', 'Travas/limitadores de abertura funcionando (tesoura)', 'Escada de fibra para serviços elétricos', 'Piso firme e nivelado', 'Inclinação 1:4 e ultrapassando 1 m o apoio', 'Área de trabalho sinalizada'],
    dds: ['A escada é para acesso, não para trabalho prolongado.', 'Três pontos de contato, sempre.', 'Escada de alumínio e eletricidade não combinam.'],
  },
  {
    id: 'icamento', nome: 'Içamento e movimentação de cargas (guindaste, ponte rolante, talha)', pt: null, nrs: [11, 12, 18, 35],
    termos: ['icamento', 'guindaste', 'munck', 'ponte rolante', 'talha', 'grua', 'rigging', 'carga suspensa', 'pórtico', 'portico', 'guincho', 'cinta de elevacao', 'manilha', 'estropo'],
    etapas: ['Plano de içamento (rigging)', 'Inspeção de equipamento e acessórios', 'Posicionamento e patolamento', 'Amarração da carga', 'Içamento e movimentação', 'Assentamento e desengate'],
    perigos: [
      ['Içamento e movimentação', 'Queda da carga suspensa', 'Morte, lesões graves', 3, 5, ['Plano de içamento com capacidade verificada', 'Ninguém sob carga suspensa — área isolada', 'Cabos-guia para controlar a carga']],
      ['Posicionamento e patolamento', 'Tombamento do guindaste', 'Morte, danos graves', 2, 5, ['Patolamento total em solo firme com calços', 'Respeitar a tabela de carga e o raio', 'Limite de vento (anemômetro)']],
      ['Inspeção de equipamento e acessórios', 'Falha de acessórios (cintas, cabos, manilhas, ganchos)', 'Queda da carga', 2, 5, ['Acessórios certificados com carga de trabalho identificada', 'Inspeção antes do uso e descarte dos danificados', 'Trava de segurança no gancho']],
      ['Amarração da carga', 'Prensamento de mãos e corpo', 'Esmagamento', 3, 4, ['Não posicionar mãos entre carga e acessório', 'Luvas e comunicação clara com o sinaleiro']],
      ['Içamento e movimentação', 'Contato com rede elétrica', 'Choque elétrico', 2, 5, ['Distâncias de segurança da rede', 'Observador exclusivo para interferências']],
      ['Içamento e movimentação', 'Falha de comunicação', 'Movimento indevido, colisão', 3, 4, ['Sinaleiro/amarrador treinado e único', 'Rádio ou sinais padronizados']],
    ],
    epis: ['Capacete com jugular', 'Calçado de segurança', 'Luvas de proteção', 'Colete refletivo', 'Óculos de proteção'],
    requisitos: ['Operador qualificado e autorizado', 'Sinaleiro/amarrador capacitado', 'Plano de içamento para cargas críticas', 'Equipamento com inspeções e manutenções em dia', 'Área isolada durante a operação'],
    checklist: ['Plano de içamento aprovado', 'Peso da carga conhecido', 'Tabela de carga compatível com raio e lança', 'Patolas estendidas sobre calços em solo firme', 'Cintas/cabos/manilhas certificados e sem danos', 'Gancho com trava de segurança', 'Área isolada e sinalizada', 'Sinaleiro definido', 'Condições de vento adequadas', 'Distância de redes elétricas verificada'],
    dds: ['Carga suspensa: se passar por baixo, pode ser a última vez.', 'Só uma pessoa dá sinais ao operador.', 'Cinta cortada ou desfiada vai para o lixo, não para o içamento.'],
  },
  {
    id: 'quimicos', nome: 'Manuseio e armazenamento de produtos químicos', pt: null, nrs: [26, 9, 15, 20, 6],
    termos: ['produto quimico', 'produtos quimicos', 'quimico', 'acido', 'soda caustica', 'solvente', 'thinner', 'cloro', 'hipoclorito', 'amonia', 'diluicao', 'fracionamento', 'transvase', 'reagente', 'agrotoxico', 'resina', 'tinta'],
    etapas: ['Recebimento e armazenamento', 'Transporte interno', 'Fracionamento/transferência', 'Uso no processo', 'Descarte de resíduos e embalagens'],
    perigos: [
      ['Uso no processo', 'Inalação de vapores e gases', 'Intoxicação, irritação respiratória', 3, 4, ['Ventilação/exaustão localizada', 'Recipientes fechados', 'Proteção respiratória conforme FDS (seção 8)']],
      ['Fracionamento/transferência', 'Contato com pele e olhos (respingos)', 'Queimaduras químicas, dermatites', 3, 4, ['Luvas e óculos/viseira compatíveis com o produto', 'Lava-olhos e chuveiro de emergência próximos', 'Funil e bombas adequadas para transferência']],
      ['Recebimento e armazenamento', 'Armazenamento de produtos incompatíveis', 'Reações perigosas, incêndio, gases tóxicos', 2, 5, ['Armazenar por compatibilidade', 'Bacia de contenção', 'Local ventilado e sinalizado']],
      ['Uso no processo', 'Produtos inflamáveis', 'Incêndio, explosão', 2, 5, ['Afastar fontes de ignição', 'Aterramento na transferência', 'Extintores adequados']],
      ['Transporte interno', 'Derramamento/vazamento', 'Contaminação, quedas, exposição', 3, 3, ['Kit de emergência para derramamento', 'Transporte em recipientes fechados e em carrinhos adequados']],
      ['Uso no processo', 'Falta de informação (sem FDS/rótulo)', 'Uso incorreto, exposição', 3, 4, ['FDS disponível e treinada', 'Rotulagem GHS em todos os recipientes, inclusive secundários']],
      ['Uso no processo', 'Ingestão acidental', 'Intoxicação', 1, 4, ['Proibido comer, beber e fumar na área', 'Higiene das mãos', 'Nunca usar embalagens de alimentos']],
    ],
    epis: ['Luvas de proteção química compatíveis (nitrílica, neoprene, PVC — ver FDS)', 'Óculos de ampla visão ou protetor facial', 'Respirador com filtro adequado (ver FDS)', 'Avental impermeável', 'Botas de PVC ou calçado impermeável'],
    requisitos: ['FDS de todos os produtos acessível (ABNT NBR 14725)', 'Rotulagem GHS', 'Treinamento sobre perigos e emergências', 'Lava-olhos e chuveiro de emergência', 'Armazenamento por compatibilidade'],
    checklist: ['FDS disponível no local', 'Recipientes rotulados (GHS)', 'Produtos incompatíveis separados', 'Bacia de contenção em bom estado', 'Ventilação funcionando', 'Kit de derramamento completo', 'Lava-olhos/chuveiro testados', 'Extintor adequado', 'EPIs compatíveis disponíveis', 'Sem alimentos na área'],
    dds: ['Leia o rótulo e a FDS antes de usar — a seção 8 diz qual EPI usar.', 'Nunca misture produtos de limpeza: cloro + amônia gera gás tóxico.', 'Recipiente sem rótulo é perigo desconhecido.'],
  },
  {
    id: 'escavacao', nome: 'Escavações e valas', pt: null, nrs: [18, 33, 6],
    termos: ['escavacao', 'escavar', 'vala', 'valas', 'trincheira', 'retroescavadeira', 'fundacao', 'tubulao', 'rede enterrada', 'buraco'],
    etapas: ['Consulta a interferências enterradas', 'Isolamento e sinalização', 'Escavação', 'Escoramento/taludamento', 'Trabalho no interior da vala', 'Reaterro'],
    perigos: [
      ['Trabalho no interior da vala', 'Desmoronamento das paredes', 'Soterramento, morte', 3, 5, ['Escoramento ou taludamento para profundidade acima de 1,25 m (projeto)', 'Material escavado a distância maior que metade da profundidade', 'Inspeção diária e após chuvas']],
      ['Isolamento e sinalização', 'Queda de pessoas na vala', 'Fraturas', 3, 4, ['Guarda-corpo/isolamento e sinalização noturna', 'Passarelas com guarda-corpo para travessia']],
      ['Consulta a interferências enterradas', 'Rompimento de redes (gás, elétrica, água)', 'Explosão, choque, alagamento', 2, 5, ['Consulta aos cadastros das concessionárias', 'Sondagem manual próxima às redes']],
      ['Escavação', 'Máquinas operando próximas a pessoas', 'Atropelamento, prensamento', 3, 5, ['Área de giro isolada', 'Sinaleiro', 'Alarme de ré']],
      ['Trabalho no interior da vala', 'Atmosfera perigosa em valas profundas', 'Asfixia, intoxicação', 2, 5, ['Medição de gases', 'Avaliar se é espaço confinado (NR-33)']],
      ['Trabalho no interior da vala', 'Acesso e saída inadequados', 'Queda, dificuldade de fuga', 3, 3, ['Escadas a cada 15 m de vala, ultrapassando 1 m a borda']],
    ],
    epis: ['Capacete com jugular', 'Calçado de segurança', 'Luvas', 'Colete refletivo', 'Botas de borracha (lama/água)'],
    requisitos: ['Projeto de escoramento quando necessário', 'Inspeção por pessoa qualificada', 'Sinalização diurna e noturna', 'Controle de interferências'],
    checklist: ['Interferências consultadas', 'Escoramento/talude adequado', 'Material escavado afastado da borda', 'Escadas de acesso posicionadas', 'Área isolada e sinalizada (inclusive à noite)', 'Sem água acumulada', 'Máquinas com área de giro isolada', 'Medição de gases (se necessário)'],
    dds: ['Um metro cúbico de terra pesa mais de uma tonelada.', 'Não entre em vala sem escoramento só "para uma coisinha rápida".'],
  },
  {
    id: 'telhado', nome: 'Trabalho em telhados e coberturas', pt: 'altura', nrs: [35, 18, 6],
    termos: ['telhado', 'telhados', 'cobertura', 'telha', 'telhas', 'calha', 'rufo', 'claraboia', 'fibrocimento', 'telha translucida', 'laje'],
    etapas: ['Planejamento, AR e PT', 'Instalação de linha de vida e passarelas', 'Acesso à cobertura', 'Execução', 'Descida e limpeza'],
    perigos: [
      ['Execução', 'Queda através de telhas frágeis (fibrocimento, translúcidas)', 'Morte ou lesões graves', 3, 5, ['Passarelas/tábuas apoiadas na estrutura — nunca pisar direto nas telhas', 'Telas ou proteção sob claraboias', 'Linha de vida e cinto paraquedista']],
      ['Execução', 'Queda pela borda da cobertura', 'Morte ou lesões graves', 3, 5, ['Guarda-corpo provisório ou linha de vida', 'Conexão 100% do tempo']],
      ['Execução', 'Queda de materiais', 'Pessoas atingidas', 3, 4, ['Isolar a área abaixo', 'Içar materiais com cordas/sacos, não arremessar']],
      ['Planejamento, AR e PT', 'Chuva, vento e superfície escorregadia', 'Queda', 2, 5, ['Suspender com chuva/vento', 'Calçado antiderrapante']],
      ['Execução', 'Calor e radiação solar', 'Insolação, desidratação', 3, 3, ['Hidratação e pausas', 'Protetor solar e roupas adequadas']],
      ['Execução', 'Redes e equipamentos elétricos na cobertura', 'Choque elétrico', 2, 5, ['Identificar e isolar interferências', 'Distâncias de segurança']],
    ],
    epis: ['Cinto paraquedista com talabarte duplo/trava-quedas', 'Capacete com jugular', 'Calçado antiderrapante', 'Luvas', 'Protetor solar e óculos com proteção UV'],
    requisitos: ['Treinamento NR-35 e ASO apto', 'AR e PT', 'Linha de vida projetada por profissional habilitado', 'Plano de resgate'],
    checklist: ['PT emitida', 'Linha de vida instalada e inspecionada', 'Passarelas sobre telhas frágeis', 'Claraboias protegidas', 'Área abaixo isolada', 'Clima favorável', 'Resgate disponível'],
    dds: ['Telha não é piso: sempre passarela sobre a estrutura.', 'Claraboia parece firme — mas não é.'],
  },
  {
    id: 'manutencao', nome: 'Manutenção mecânica com bloqueio de energias (LOTO)', pt: null, nrs: [12, 10, 1, 6],
    termos: ['manutencao', 'manutencao mecanica', 'mecanico', 'bloqueio', 'loto', 'lockout', 'energia zero', 'troca de peca', 'lubrificacao', 'reparo', 'conserto', 'setup'],
    etapas: ['Planejamento e comunicação', 'Identificação das fontes de energia', 'Desligamento e bloqueio (LOTO)', 'Alívio de energias residuais e teste de energia zero', 'Execução da manutenção', 'Retirada de bloqueios e retorno à operação'],
    perigos: [
      ['Execução da manutenção', 'Liberação inesperada de energia (elétrica, pneumática, hidráulica, mecânica, térmica, gravitacional)', 'Esmagamento, amputação, choque, queimadura', 3, 5, ['Bloqueio com cadeado pessoal e etiqueta em todas as fontes', 'Alívio de pressões e travamento de partes suspensas', 'Teste de energia zero antes de iniciar']],
      ['Execução da manutenção', 'Partes móveis e pontos de prensagem', 'Esmagamento', 3, 4, ['Calços e suportes para componentes', 'Ferramentas adequadas']],
      ['Execução da manutenção', 'Superfícies quentes, vapor, fluidos', 'Queimaduras', 3, 3, ['Aguardar resfriamento', 'Luvas e vestimenta adequadas']],
      ['Execução da manutenção', 'Movimentação de peças pesadas', 'Lesões musculoesqueléticas, queda de peça', 3, 3, ['Talhas/meios mecânicos', 'Trabalho em dupla']],
      ['Execução da manutenção', 'Óleos, graxas e produtos', 'Dermatites, quedas por piso escorregadio', 3, 2, ['Luvas nitrílicas', 'Limpeza imediata de derramamentos']],
      ['Retirada de bloqueios e retorno à operação', 'Retorno com pessoas na área ou proteções não recolocadas', 'Acidente grave', 2, 5, ['Verificar área livre e proteções instaladas', 'Retirada do cadeado somente pelo dono']],
    ],
    epis: ['Óculos de proteção', 'Luvas de proteção mecânica / nitrílica', 'Calçado de segurança', 'Capacete (quando aplicável)', 'Protetor auricular', 'Cadeados e etiquetas de bloqueio pessoais'],
    requisitos: ['Procedimento de bloqueio por equipamento', 'Cadeado pessoal e intransferível', 'Capacitação em LOTO e NR-12', 'Permissão de trabalho para manutenções críticas'],
    checklist: ['Operação comunicada', 'Todas as fontes de energia identificadas', 'Equipamento desligado', 'Cadeados e etiquetas de todos os executantes', 'Energias residuais aliviadas', 'Partes suspensas travadas', 'Teste de energia zero realizado', 'Ferramentas adequadas e em bom estado', 'Proteções recolocadas ao final', 'Área liberada antes do religamento'],
    dds: ['Se você não colocou seu cadeado, você não está protegido.', 'Energia zero se testa, não se supõe.'],
  },
  {
    id: 'manual', nome: 'Movimentação manual de cargas', pt: null, nrs: [17, 11, 6],
    termos: ['movimentacao manual', 'carregar peso', 'levantamento de peso', 'levantar peso', 'carga manual', 'sacaria', 'sacos', 'carregar caixas', 'separacao de pedidos', 'paleteira manual', 'carrinho de carga', 'descarregar manualmente'],
    etapas: ['Avaliação da carga e do trajeto', 'Levantamento', 'Transporte', 'Descarga e empilhamento'],
    perigos: [
      ['Levantamento', 'Sobrecarga na coluna (peso excessivo, frequência)', 'Lombalgia, hérnia de disco', 4, 3, ['Meios mecânicos (paleteiras, carrinhos, talhas)', 'Levantamento em dupla para cargas pesadas', 'Técnica correta: carga próxima ao corpo, costas retas, força nas pernas']],
      ['Transporte', 'Posturas inadequadas e torção do tronco', 'Lesões musculoesqueléticas', 4, 2, ['Girar com os pés, não com o tronco', 'Altura de pega entre joelhos e ombros']],
      ['Levantamento', 'Repetitividade', 'LER/DORT', 3, 3, ['Pausas e rodízio de tarefas', 'AEP/AET conforme NR-17']],
      ['Descarga e empilhamento', 'Prensamento e cortes nas mãos', 'Lesões nas mãos', 3, 2, ['Luvas de proteção', 'Atenção aos pontos de pega']],
      ['Transporte', 'Queda da carga nos pés / escorregões', 'Contusões, fraturas', 3, 3, ['Calçado com biqueira', 'Trajeto livre e piso seco']],
    ],
    epis: ['Luvas de proteção', 'Calçado de segurança com biqueira'],
    requisitos: ['Avaliação ergonômica (AEP/AET) — NR-17', 'Treinamento em levantamento seguro', 'Limite legal de 60 kg para remoção individual (CLT art. 198) — o ideal é bem menos', 'Para mulheres, 20 kg (contínuo) e 25 kg (ocasional) — CLT art. 390'],
    checklist: ['Peso da carga identificado', 'Meios mecânicos disponíveis', 'Trajeto livre e sem desníveis', 'Piso seco e limpo', 'Altura das prateleiras adequada', 'Pausas definidas'],
    dds: ['Dobre os joelhos, não a coluna.', 'Pesado demais? Peça ajuda ou use o carrinho — hérnia não tem devolução.'],
  },
  {
    id: 'ruido', nome: 'Atividades com exposição a ruído', pt: null, nrs: [15, 9, 7, 6],
    termos: ['ruido', 'barulho', 'barulhento', 'protetor auricular', 'abafador', 'plug', 'decibel', 'decibeis', 'db', 'audiometria', 'pair', 'surdez'],
    etapas: ['Avaliação do ruído (dosimetria)', 'Controles na fonte e na trajetória', 'Seleção e uso de protetor auricular', 'Monitoramento audiométrico'],
    perigos: [
      ['Avaliação do ruído (dosimetria)', 'Exposição a ruído acima de 85 dB(A)', 'Perda auditiva irreversível (PAIR), zumbido', 4, 3, ['Controles na fonte (manutenção, enclausuramento, amortecedores)', 'Barreiras acústicas', 'Rodízio para reduzir o tempo de exposição']],
      ['Seleção e uso de protetor auricular', 'Protetor inadequado ou mal colocado', 'Proteção insuficiente', 3, 3, ['Seleção pelo NRRsf e conforto', 'Treinamento prático de colocação', 'Opções de tamanho e modelo']],
      ['Todas', 'Dificuldade de comunicação e de ouvir alarmes', 'Acidentes', 2, 4, ['Sinalização visual complementar', 'Protetores com atenuação adequada (sem superproteção)']],
      ['Monitoramento audiométrico', 'Falta de acompanhamento audiométrico', 'PAIR não detectada', 2, 3, ['Audiometrias conforme PCMSO', 'Programa de Conservação Auditiva (PCA)']],
    ],
    epis: ['Protetor auricular tipo plug (espuma ou silicone)', 'Protetor auricular tipo concha (abafador)'],
    requisitos: ['Dosimetria de ruído (NR-09/NR-15)', 'PCA — Programa de Conservação Auditiva', 'Audiometrias no PCMSO', 'Sinalização de uso obrigatório'],
    checklist: ['Níveis de ruído avaliados', 'Áreas ruidosas sinalizadas', 'Protetores disponíveis em tamanhos/modelos', 'Trabalhadores treinados na colocação', 'Uso efetivo verificado', 'Audiometrias em dia'],
    dds: ['Perda auditiva não dói e não volta.', 'Se precisa gritar para falar com alguém a 1 metro, o ruído passou de 85 dB.', 'Protetor bom é o que fica no ouvido o tempo todo.'],
  },
  {
    id: 'ferramentas', nome: 'Uso de ferramentas elétricas portáteis', pt: null, nrs: [12, 10, 6],
    termos: ['esmerilhadeira', 'lixadeira', 'furadeira', 'serra circular', 'serra marmore', 'makita', 'parafusadeira', 'martelete', 'rompedor', 'ferramenta eletrica', 'ferramentas eletricas', 'policorte', 'rocadeira', 'rocada'],
    etapas: ['Inspeção da ferramenta', 'Preparação da peça e do local', 'Execução', 'Troca de acessórios', 'Guarda'],
    perigos: [
      ['Execução', 'Ruptura de disco / projeção de partículas', 'Lesões graves nos olhos, rosto e corpo', 3, 4, ['Coifa de proteção sempre instalada', 'Disco compatível com a rotação da máquina e dentro da validade', 'Óculos e protetor facial']],
      ['Execução', 'Cortes e rebote (kickback)', 'Lacerações graves', 3, 4, ['Empunhadura auxiliar, duas mãos na ferramenta', 'Peça fixada (morsa/grampo)', 'Posição fora da linha de corte']],
      ['Inspeção da ferramenta', 'Choque elétrico (cabo danificado, sem aterramento)', 'Choque', 2, 5, ['Inspeção de cabo e plugue', 'Tomadas com aterramento e DR', 'Não usar em ambientes molhados']],
      ['Troca de acessórios', 'Acionamento acidental na troca de disco/broca', 'Cortes', 2, 4, ['Retirar da tomada/bateria antes da troca']],
      ['Execução', 'Ruído e vibração', 'PAIR, síndrome da vibração', 3, 2, ['Protetor auricular', 'Pausas; ferramentas com antivibração']],
      ['Execução', 'Faíscas próximas a inflamáveis', 'Incêndio', 2, 4, ['Tratar como trabalho a quente (PT) quando houver inflamáveis']],
    ],
    epis: ['Óculos de proteção e protetor facial', 'Protetor auricular', 'Luvas de proteção (quando não houver risco de enroscamento)', 'Calçado de segurança', 'Avental de raspa (esmerilhamento)'],
    requisitos: ['Ferramentas com proteções originais', 'Treinamento de uso', 'Instalações com aterramento e DR'],
    checklist: ['Carcaça sem trincas', 'Cabo e plugue sem danos/emendas', 'Coifa/protetor instalado', 'Empunhadura auxiliar', 'Disco/broca adequado e sem danos', 'Gatilho funcionando (sem trava indevida)', 'Tomada aterrada'],
    dds: ['Coifa retirada = rosto exposto.', 'Troca de disco? Tire da tomada antes.'],
  },
  {
    id: 'caldeira', nome: 'Operação de caldeiras e vasos de pressão', pt: null, nrs: [13, 6, 23],
    termos: ['caldeira', 'caldeiras', 'vaso de pressao', 'vasos de pressao', 'autoclave', 'compressor de ar', 'reservatorio de ar', 'vapor', 'boiler'],
    etapas: ['Verificações antes da partida', 'Partida e operação', 'Controle de nível, pressão e combustão', 'Purgas e tratamento da água', 'Parada e manutenção'],
    perigos: [
      ['Partida e operação', 'Sobrepressão / falha de dispositivos de segurança', 'Explosão, morte', 2, 5, ['Válvulas de segurança calibradas e testadas', 'Manômetros aferidos', 'Inspeções de segurança pelo PH (NR-13)']],
      ['Controle de nível, pressão e combustão', 'Falta de água (nível baixo)', 'Superaquecimento, explosão', 2, 5, ['Controle e alarme de nível testados', 'Operador capacitado presente']],
      ['Partida e operação', 'Vapor e superfícies quentes', 'Queimaduras graves', 3, 4, ['Isolamento térmico', 'Luvas e vestimenta adequadas', 'Não abrir drenos sem alívio de pressão']],
      ['Partida e operação', 'Explosão na fornalha (combustível)', 'Explosão, incêndio', 2, 5, ['Pré-purga da fornalha', 'Sistema de detecção de chama']],
      ['Partida e operação', 'Ruído', 'Perda auditiva', 3, 3, ['Protetor auricular', 'Enclausuramento']],
    ],
    epis: ['Luvas térmicas', 'Óculos e protetor facial', 'Protetor auricular', 'Calçado de segurança', 'Vestimenta de proteção térmica'],
    requisitos: ['Operador com treinamento de segurança na operação de caldeiras (NR-13)', 'Prontuário e registro de segurança', 'Inspeções periódicas por profissional habilitado', 'Placa de identificação'],
    checklist: ['Nível de água visível e correto', 'Manômetro funcionando e aferido', 'Válvulas de segurança testadas', 'Alarmes e intertravamentos testados', 'Livro de registro atualizado', 'Casa de caldeiras ventilada e com saídas livres', 'Tratamento da água em dia'],
    dds: ['A válvula de segurança é o último guardião: nunca trave ou regule por conta própria.'],
  },
  {
    id: 'inflamaveis', nome: 'Abastecimento e manuseio de inflamáveis e combustíveis', pt: null, nrs: [20, 16, 23, 26],
    termos: ['inflamavel', 'inflamaveis', 'combustivel', 'combustiveis', 'abastecimento', 'abastecer', 'diesel', 'gasolina', 'etanol', 'glp', 'gas', 'tanque de combustivel', 'posto de combustivel', 'gerador'],
    etapas: ['Preparação e sinalização', 'Aterramento e conexões', 'Abastecimento/transferência', 'Desconexão', 'Controle de derramamentos'],
    perigos: [
      ['Abastecimento/transferência', 'Vapores inflamáveis e fontes de ignição', 'Incêndio, explosão', 2, 5, ['Motor desligado, proibido fumar e usar celular', 'Equipamentos elétricos adequados a áreas classificadas', 'Extintores e plano de emergência']],
      ['Aterramento e conexões', 'Eletricidade estática', 'Ignição dos vapores', 2, 5, ['Aterramento e equipotencialização', 'Vazão controlada']],
      ['Abastecimento/transferência', 'Exposição a vapores (benzeno na gasolina)', 'Intoxicação, efeitos crônicos', 3, 4, ['Ficar a favor do vento, evitar inalar', 'Sistemas de recuperação de vapores']],
      ['Controle de derramamentos', 'Derramamento', 'Incêndio, contaminação, quedas', 3, 3, ['Kit de contenção', 'Bacia de contenção nos tanques']],
    ],
    epis: ['Luvas nitrílicas', 'Óculos de proteção', 'Vestimenta de algodão/antichama (sem sintéticos)', 'Calçado de segurança'],
    requisitos: ['Capacitação NR-20 conforme a atividade/instalação', 'Análise de riscos e plano de resposta a emergências', 'Área sinalizada e classificada'],
    checklist: ['Motor e equipamentos desligados', 'Aterramento conectado', 'Sem fontes de ignição', 'Extintor próximo', 'Kit de derramamento disponível', 'Sinalização de proibido fumar'],
    dds: ['O vapor é que pega fogo — e ele é invisível.'],
  },
  {
    id: 'docas', nome: 'Carga e descarga de caminhões', pt: null, nrs: [11, 17, 35, 6],
    termos: ['carga e descarga', 'descarga de caminhao', 'carregamento', 'descarregamento', 'doca', 'docas', 'caminhao', 'carreta', 'bau', 'lona', 'expedicao', 'recebimento de mercadoria'],
    etapas: ['Chegada e manobra do veículo', 'Calçamento e travamento', 'Abertura de portas/lonas', 'Carga/descarga', 'Liberação do veículo'],
    perigos: [
      ['Chegada e manobra do veículo', 'Manobra de ré com pessoas na área', 'Atropelamento', 3, 5, ['Área de manobra isolada', 'Sinaleiro/manobrista', 'Alarme sonoro de ré']],
      ['Carga/descarga', 'Queda da carroceria/plataforma', 'Fraturas', 3, 4, ['Plataformas de acesso com guarda-corpo', 'Proibido pular da carroceria', 'NR-35 quando acima de 2 m']],
      ['Abertura de portas/lonas', 'Carga deslocada que cai ao abrir', 'Pessoas atingidas', 3, 4, ['Abrir portas lentamente, fora da linha de queda', 'Verificar amarração']],
      ['Calçamento e travamento', 'Movimentação do veículo durante a operação', 'Prensamento contra a doca', 2, 5, ['Calços nas rodas e chave com a liderança/trava de doca', 'Motorista fora da cabine em área segura']],
      ['Carga/descarga', 'Movimentação manual intensa', 'Lesões musculoesqueléticas', 4, 3, ['Meios mecânicos', 'Rodízio e pausas']],
    ],
    epis: ['Calçado de segurança', 'Luvas de proteção', 'Colete refletivo', 'Capacete (quando houver risco de queda de materiais)'],
    requisitos: ['Procedimento de doca (calço/trava)', 'Área de pedestres demarcada', 'Treinamento de movimentação de cargas'],
    checklist: ['Veículo calçado e freado', 'Área de manobra isolada', 'Niveladora/trava de doca funcionando', 'Iluminação adequada no baú', 'Carga amarrada/estável', 'Motorista em área segura'],
    dds: ['Caminhão parado não é caminhão seguro: calço e trava antes de entrar.'],
  },
  {
    id: 'veiculos', nome: 'Condução de veículos a serviço', pt: null, nrs: [1],
    termos: ['dirigir', 'direcao', 'motorista', 'veiculo', 'carro da empresa', 'moto', 'motocicleta', 'viagem', 'transporte de pessoas', 'direcao defensiva', 'frota'],
    etapas: ['Checklist do veículo', 'Planejamento da rota', 'Condução', 'Paradas e descanso', 'Estacionamento'],
    perigos: [
      ['Condução', 'Colisões e capotamentos', 'Morte, lesões graves', 3, 5, ['Direção defensiva e respeito aos limites', 'Cinto de segurança para todos', 'Veículo com manutenção em dia']],
      ['Paradas e descanso', 'Fadiga e sono ao volante', 'Acidentes graves', 3, 5, ['Pausas planejadas (motorista profissional: 30 min a cada 5h30 de direção)', 'Não dirigir após jornada extensa']],
      ['Condução', 'Uso de celular', 'Distração, colisões', 3, 5, ['Proibido usar celular ao dirigir', 'Parar em local seguro para atender']],
      ['Checklist do veículo', 'Falha mecânica (freios, pneus, luzes)', 'Perda de controle', 2, 5, ['Checklist diário', 'Manutenção preventiva']],
    ],
    epis: ['Cinto de segurança (veículo)', 'Capacete certificado, luvas e jaqueta (motocicleta)'],
    requisitos: ['CNH válida e compatível', 'Treinamento de direção defensiva', 'Checklist do veículo', 'Política de álcool zero e celular zero'],
    checklist: ['Pneus (calibragem e desgaste)', 'Freios', 'Luzes e setas', 'Nível de óleo e água', 'Cintos de segurança', 'Documentação', 'Triângulo, estepe e macaco'],
    dds: ['Nenhuma mensagem vale uma vida: celular guardado ao dirigir.'],
  },
  {
    id: 'poda', nome: 'Poda e corte de árvores (motosserra)', pt: 'altura', nrs: [12, 35, 10, 6],
    termos: ['poda', 'podar', 'corte de arvore', 'arvore', 'arvores', 'motosserra', 'supressao vegetal', 'galhos', 'jardinagem'],
    etapas: ['Avaliação da árvore e do entorno', 'Isolamento da área', 'Acesso (escalada/plataforma)', 'Corte', 'Remoção e destinação dos galhos'],
    perigos: [
      ['Corte', 'Queda de galhos e troncos', 'Pessoas atingidas, morte', 3, 5, ['Isolar área com raio de pelo menos 2 vezes a altura da árvore (derrubada)', 'Plano de corte e direção de queda', 'Capacete']],
      ['Corte', 'Corte com a motosserra / rebote', 'Lacerações graves', 3, 5, ['Motosserra com freio de corrente, pino pega-corrente, protetor da mão e trava do acelerador', 'Capacitação específica', 'Calça/perneira anticorte']],
      ['Acesso (escalada/plataforma)', 'Queda de altura', 'Morte ou lesões graves', 2, 5, ['NR-35: AR, PT, cinto e ancoragem', 'Plataforma elevatória quando possível']],
      ['Avaliação da árvore e do entorno', 'Proximidade de rede elétrica', 'Choque elétrico', 2, 5, ['Desligamento da rede pela concessionária', 'Profissionais habilitados para poda em rede']],
      ['Corte', 'Ruído e vibração', 'PAIR, lesões', 3, 3, ['Abafador acoplado ao capacete', 'Pausas']],
      ['Avaliação da árvore e do entorno', 'Animais peçonhentos e insetos', 'Picadas, reações alérgicas', 2, 3, ['Inspeção prévia', 'Luvas e perneiras']],
    ],
    epis: ['Capacete com protetor facial de tela e abafador acoplado', 'Calça ou perneira anticorte', 'Luvas de proteção', 'Botina com biqueira', 'Cinto paraquedista (em altura)', 'Colete refletivo'],
    requisitos: ['Operador de motosserra capacitado (NR-12, Anexo V)', 'NR-35 para trabalhos em altura', 'Autorização ambiental quando exigida'],
    checklist: ['Área isolada', 'Freio de corrente funcionando', 'Corrente afiada e tensionada', 'Trava do acelerador funcionando', 'Rede elétrica verificada', 'Rota de fuga definida', 'EPIs anticorte completos'],
    dds: ['Planeje a rota de fuga antes do primeiro corte.'],
  },
  {
    id: 'escritorio', nome: 'Trabalho administrativo e em escritório', pt: null, nrs: [17, 24, 23, 1],
    termos: ['escritorio', 'administrativo', 'computador', 'home office', 'teletrabalho', 'digitacao', 'monitor', 'cadeira', 'posto de trabalho', 'atendimento', 'recepcao'],
    etapas: ['Organização do posto', 'Trabalho com computador', 'Deslocamentos internos', 'Pausas'],
    perigos: [
      ['Trabalho com computador', 'Posturas inadequadas e mobiliário não ajustável', 'Dores e lesões musculoesqueléticas', 3, 2, ['Cadeira ajustável com apoio lombar', 'Monitor na altura dos olhos, a 50–70 cm', 'Apoio para os pés quando necessário']],
      ['Trabalho com computador', 'Repetitividade (digitação, mouse)', 'LER/DORT', 3, 3, ['Pausas e alongamentos', 'Teclado e mouse adequados']],
      ['Trabalho com computador', 'Fadiga visual', 'Desconforto visual, cefaleia', 3, 2, ['Iluminação adequada sem reflexos', 'Regra 20-20-20 (a cada 20 min, olhar a 6 m por 20 s)']],
      ['Organização do posto', 'Sobrecarga, metas e conflitos', 'Estresse, adoecimento mental', 3, 3, ['Organização do trabalho e metas realistas', 'Canal de escuta e combate ao assédio']],
      ['Deslocamentos internos', 'Fios, pisos molhados e gavetas abertas', 'Queda no mesmo nível', 2, 3, ['Organização de cabos', 'Piso limpo e seco']],
      ['Organização do posto', 'Extensões e adaptadores sobrecarregados', 'Incêndio, choque', 2, 4, ['Tomadas suficientes', 'Proibido "benjamins" em série']],
    ],
    epis: ['Não há EPI típico — foco em ergonomia e organização'],
    requisitos: ['AEP das situações de trabalho (NR-17)', 'Mobiliário adequado', 'Rotas de fuga e extintores (NR-23)'],
    checklist: ['Cadeira ajustável', 'Monitor na altura dos olhos', 'Iluminação adequada', 'Cabos organizados', 'Tomadas sem sobrecarga', 'Rotas de fuga livres', 'Extintores sinalizados e desobstruídos'],
    dds: ['Seu corpo não foi feito para 8 horas parado: levante-se a cada hora.'],
  },
  {
    id: 'limpeza', nome: 'Limpeza e conservação', pt: null, nrs: [6, 9, 17, 26, 32],
    termos: ['limpeza', 'faxina', 'conservacao', 'zeladoria', 'higienizacao', 'lavagem', 'lavar', 'sanitario', 'banheiro', 'lixo', 'coleta de lixo', 'hidrojateamento', 'hidrojato'],
    etapas: ['Preparação de produtos e materiais', 'Sinalização da área', 'Execução da limpeza', 'Recolhimento de resíduos', 'Guarda de materiais'],
    perigos: [
      ['Preparação de produtos e materiais', 'Contato e inalação de produtos de limpeza', 'Irritação, queimaduras químicas, intoxicação', 3, 3, ['Diluição correta conforme rótulo/FDS', 'Nunca misturar produtos', 'Luvas de borracha/nitrílicas e óculos']],
      ['Execução da limpeza', 'Piso molhado e escorregadio', 'Quedas', 4, 3, ['Placa "piso molhado"', 'Calçado antiderrapante', 'Limpar metade do corredor por vez']],
      ['Recolhimento de resíduos', 'Agentes biológicos e perfurocortantes no lixo', 'Infecções, cortes', 3, 3, ['Luvas resistentes', 'Não comprimir sacos de lixo com as mãos', 'Vacinação em dia']],
      ['Execução da limpeza', 'Posturas e esforço repetitivo', 'Lesões musculoesqueléticas', 3, 2, ['Cabos de tamanho adequado', 'Carrinhos funcionais', 'Rodízio de tarefas']],
      ['Execução da limpeza', 'Equipamentos elétricos em ambientes molhados', 'Choque elétrico', 2, 4, ['Equipamentos com cabos íntegros', 'Tomadas protegidas (DR)']],
    ],
    epis: ['Luvas de borracha/nitrílicas', 'Óculos de proteção', 'Botas antiderrapantes', 'Avental impermeável', 'Máscara quando indicado na FDS'],
    requisitos: ['Treinamento sobre produtos e FDS', 'Produtos rotulados', 'Sinalização de piso molhado'],
    checklist: ['Produtos rotulados e diluídos corretamente', 'Placas de piso molhado disponíveis', 'EPIs disponíveis', 'Carrinhos em bom estado', 'Sacos de lixo adequados'],
    dds: ['Cloro + amônia = gás tóxico: nunca misture produtos.'],
  },
  {
    id: 'demolicao', nome: 'Demolição', pt: null, nrs: [18, 35, 6, 15],
    termos: ['demolicao', 'demolir', 'quebrar parede', 'derrubar', 'desmonte'],
    etapas: ['Planejamento e desligamento de redes', 'Isolamento', 'Demolição', 'Remoção de entulho'],
    perigos: [
      ['Demolição', 'Colapso estrutural não controlado', 'Soterramento, morte', 2, 5, ['Plano de demolição por profissional habilitado', 'Demolir de cima para baixo', 'Escoramentos provisórios']],
      ['Demolição', 'Queda de materiais', 'Pessoas atingidas', 3, 4, ['Isolamento amplo', 'Calhas/tubos para entulho']],
      ['Demolição', 'Poeira (sílica) e fibras de amianto', 'Doenças respiratórias graves', 3, 4, ['Umidificação', 'Respirador adequado', 'Identificar amianto antes (remoção especializada)']],
      ['Planejamento e desligamento de redes', 'Redes de gás, energia e água ativas', 'Explosão, choque', 2, 5, ['Desligar e confirmar com as concessionárias']],
      ['Demolição', 'Queda de altura', 'Lesões graves', 2, 5, ['NR-35', 'Proteção de aberturas']],
    ],
    epis: ['Capacete com jugular', 'Óculos de proteção', 'Respirador PFF2 ou superior', 'Luvas', 'Calçado de segurança', 'Protetor auricular'],
    requisitos: ['Plano de demolição', 'Desligamento de redes confirmado', 'Isolamento da área'],
    checklist: ['Plano de demolição aprovado', 'Redes desligadas', 'Área isolada', 'Amianto verificado', 'Umidificação disponível'],
    dds: ['Na demolição, o planejamento é o que segura o prédio.'],
  },
  {
    id: 'pintura', nome: 'Pintura (com solventes e em altura)', pt: null, nrs: [26, 9, 35, 6],
    termos: ['pintura', 'pintar', 'pintor', 'spray', 'pistola de pintura', 'verniz', 'esmalte', 'epoxi', 'jateamento'],
    etapas: ['Preparação de superfície', 'Preparo da tinta', 'Aplicação', 'Secagem e limpeza'],
    perigos: [
      ['Aplicação', 'Vapores de solventes', 'Intoxicação, tontura', 3, 4, ['Ventilação/exaustão', 'Respirador com filtro para vapores orgânicos']],
      ['Aplicação', 'Atmosfera inflamável', 'Incêndio', 2, 5, ['Sem fontes de ignição', 'Equipamentos adequados', 'Extintor próximo']],
      ['Aplicação', 'Trabalho em altura (fachadas, paredes altas)', 'Queda', 2, 5, ['NR-35 e plataformas adequadas']],
      ['Preparação de superfície', 'Poeira do lixamento', 'Irritação respiratória', 3, 3, ['PFF2', 'Aspiração']],
      ['Aplicação', 'Contato com pele e olhos', 'Dermatites, irritação', 3, 2, ['Luvas e óculos', 'Macacão']],
    ],
    epis: ['Respirador com filtro para vapores orgânicos', 'Óculos de proteção', 'Luvas nitrílicas', 'Macacão', 'Calçado de segurança'],
    requisitos: ['FDS das tintas e solventes', 'Ventilação adequada', 'NR-35 quando em altura'],
    checklist: ['FDS disponível', 'Ventilação funcionando', 'Sem fontes de ignição', 'Respiradores com filtros válidos', 'Resíduos acondicionados'],
    dds: ['Cheiro fraco não quer dizer vapor fraco.'],
  },
  {
    id: 'frio', nome: 'Trabalho em câmaras frias', pt: null, nrs: [36, 15, 17, 6],
    termos: ['camara fria', 'camaras frias', 'frigorifico', 'congelado', 'resfriado', 'tunel de congelamento', 'ambiente frio'],
    etapas: ['Entrada na câmara', 'Movimentação de produtos', 'Saída e recuperação térmica'],
    perigos: [
      ['Movimentação de produtos', 'Exposição ao frio intenso', 'Hipotermia, lesões por frio', 3, 3, ['Vestimenta térmica completa', 'Pausa de recuperação térmica (CLT art. 253: 20 min a cada 1h40 em ambientes frios)']],
      ['Entrada na câmara', 'Aprisionamento acidental', 'Hipotermia grave', 2, 5, ['Dispositivo de abertura interna', 'Alarme interno', 'Controle de entrada']],
      ['Movimentação de produtos', 'Piso escorregadio (gelo)', 'Quedas', 3, 3, ['Piso antiderrapante e limpeza do gelo', 'Calçado adequado']],
      ['Movimentação de produtos', 'Movimentação de cargas', 'Lesões musculoesqueléticas', 3, 3, ['Meios mecânicos', 'Rodízio']],
    ],
    epis: ['Japona/jaqueta térmica', 'Calça térmica', 'Luvas térmicas', 'Touca/capuz térmico', 'Botas térmicas antiderrapantes', 'Meias térmicas'],
    requisitos: ['Pausas de recuperação térmica', 'Dispositivo de abertura interna e alarme', 'Treinamento sobre riscos do frio'],
    checklist: ['Abertura interna funcionando', 'Alarme interno testado', 'Iluminação funcionando', 'Piso sem gelo acumulado', 'Vestimentas térmicas disponíveis'],
    dds: ['Nunca entre na câmara sem avisar alguém.'],
  },
];

// Palavras que remetem a mais de uma atividade (atividades compostas)
const ACTIVITY_HINTS = {
  lampada: ['eletrica', 'escada'], luminaria: ['eletrica', 'escada'], 'ar condicionado': ['eletrica', 'altura'], 'ar-condicionado': ['eletrica', 'altura'],
  'caixa d agua': ['confinado', 'altura'], 'caixa dagua': ['confinado', 'altura'], gerador: ['eletrica', 'inflamaveis'], compressor: ['maquinas', 'caldeira'],
  esmerilhadeira: ['ferramentas', 'quente'], policorte: ['ferramentas', 'quente'], fachada: ['altura', 'pintura'], 'limpeza de vidros': ['altura', 'limpeza'],
  'limpeza de tanque': ['confinado', 'quimicos'], 'pintura de fachada': ['altura', 'pintura'], 'rede eletrica': ['eletrica', 'altura'], poste: ['eletrica', 'altura'],
  'solda em altura': ['quente', 'altura'], 'solda em tanque': ['quente', 'confinado'], telhado: ['telhado', 'altura'], 'painel solar': ['eletrica', 'telhado'],
};
const EPI_CATALOG = [
  ['Capacete de segurança', 'capacete'], ['Óculos de proteção', 'oculos'], ['Protetor facial', 'protetor facial,viseira'],
  ['Protetor auricular', 'protetor auricular,abafador,plug,concha,protetor de ouvido'], ['Respirador/máscara', 'respirador,mascara,pff1,pff2,pff3,semifacial,facial inteira,filtro quimico'],
  ['Luvas de proteção', 'luva,luvas'], ['Calçado de segurança', 'botina,calcado de seguranca,bota,sapato de seguranca'], ['Cinto paraquedista', 'cinto paraquedista,cinturao,cinto de seguranca tipo paraquedista'],
  ['Talabarte', 'talabarte'], ['Trava-quedas', 'trava-quedas,trava quedas'], ['Avental', 'avental'], ['Mangote', 'mangote'], ['Perneira', 'perneira'],
  ['Vestimenta antichama', 'antichama,atpv,vestimenta fr'], ['Creme de proteção', 'creme de protecao,creme protetor'], ['Colete refletivo', 'colete refletivo,colete'], ['Máscara de solda', 'mascara de solda,escudo de solda'],
];
const HAZARD_TERMS = [
  ['ruído', 'ruido,barulho,decibe'], ['calor', 'calor,ibutg,temperatura elevada'], ['frio', 'frio,camara fria'], ['vibração', 'vibracao'], ['radiação', 'radiacao'],
  ['poeira', 'poeira,particulado,silica'], ['fumos metálicos', 'fumos'], ['vapores/gases', 'vapor,vapores,gases,gas toxico'], ['produtos químicos', 'produto quimico,quimicos,solvente,acido,soda'],
  ['agentes biológicos', 'biologico,virus,bacteria,fungo,sangue'], ['queda de altura', 'queda de altura,trabalho em altura,queda de nivel,sem guarda-corpo,sem guarda corpo,guarda-corpo,abertura no piso,borda sem protecao,telhado,andaime,sem cinto'], ['queda no mesmo nível', 'escorreg,tropec,mesmo nivel,piso molhado,oleo no piso,piso irregular,buraco no piso,cabos no chao,desnivel'],
  ['choque elétrico', 'choque eletrico,energizado,eletricidade,fiacao,fio desencapado,fios expostos,fio exposto,painel eletrico,quadro eletrico,quadro de energia,tomada,cabo eletrico,gambiarra,extensao improvisada,disjuntor'], ['arco elétrico', 'arco eletrico'], ['prensamento/esmagamento', 'prensamento,esmagamento,prensagem,sem protecao,protecao removida,correia exposta,polia,engrenagem,partes moveis'], ['corte', 'corte,cortante,laceracao'],
  ['atropelamento/colisão', 'atropelamento,colisao,empilhadeira,faixa de pedestre,pedestre,manobra,ponto cego'], ['incêndio/explosão', 'incendio,explosao,inflamavel,extintor,faisca,combustivel,vazamento de gas,botijao,glp,rota de fuga obstruida,saida de emergencia'], ['soterramento', 'soterramento,desmoronamento'],
  ['asfixia/deficiência de O₂', 'asfixia,deficiencia de oxigenio,espaco confinado'], ['ergonômico', 'ergonomic,postura,repetitiv,levantamento de peso,ler,dort'],
  ['projeção de partículas', 'projecao de particulas,estilhaco'], ['queda de materiais', 'queda de materiais,queda de objetos,carga suspensa'], ['psicossocial', 'psicossocial,assedio,estresse,sobrecarga'],
];


/* ===== 07-kb-helpers.js ===== */
// ---------------------------------------------------------------------------
// 07 · Consultas à base de conhecimento (atividades, NRs, glossário, busca)
// ---------------------------------------------------------------------------
const ACT_BY_ID = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const padded = (text) => ' ' + norm(text).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';

// Detecta atividades citadas no texto. extraSyn = sinônimos aprendidos {palavra: idAtividade}
function findActivities(text, extraSyn = {}, max = 3) {
  const t = padded(text);
  const scores = new Map();
  const bump = (id, s) => scores.set(id, Math.max(scores.get(id) || 0, s));
  for (const a of ACTIVITIES) {
    for (const term of a.termos) {
      const nt = padded(term);
      if (t.includes(nt) || (nt.length > 5 && t.includes(nt.slice(0, -1) + 's '))) bump(a.id, nt.trim().length + (nt.trim().includes(' ') ? 4 : 0));
    }
    if (t.includes(padded(a.nome))) bump(a.id, 40);
  }
  for (const [k, ids] of Object.entries(ACTIVITY_HINTS)) if (t.includes(padded(k))) ids.forEach((id, i) => bump(id, 9 - i * 3));
  for (const [w, id] of Object.entries(extraSyn || {})) if (ACT_BY_ID[id] && t.includes(padded(w))) bump(id, 20);
  // tolerância a erros de digitação em palavras longas
  if (!scores.size) {
    const ws = t.trim().split(' ').filter((w) => w.length >= 6);
    for (const a of ACTIVITIES) {
      for (const term of a.termos) {
        if (term.includes(' ') || term.length < 6) continue;
        if (ws.some((w) => w[0] === term[0] && editDistance(w, term, 2) <= (term.length >= 9 ? 2 : 1))) bump(a.id, 6);
      }
    }
  }
  // atividades que já contêm outra (telhado e andaime já incluem os perigos de altura)
  const IMPLIES = { telhado: ['altura'], andaime: ['altura'] };
  for (const [k, list] of Object.entries(IMPLIES)) if (scores.has(k)) list.forEach((id) => scores.delete(id));
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return [];
  const top = ranked[0][1];
  return ranked
    .filter(([, s], i) => i === 0 || s >= Math.min(6, top * 0.5))
    .slice(0, max)
    .map(([id]) => ACT_BY_ID[id]);
}

// Junta atividades compostas em um "perfil" único para documentos
function mergeActivities(acts) {
  if (!acts || !acts.length) return null;
  if (acts.length === 1) return acts[0];
  const m = {
    id: acts.map((a) => a.id).join('+'),
    nome: listPT(acts.map((a) => a.nome.replace(/^(Operação|Uso|Serviços|Trabalho) (de |em |com )?/i, (x) => x))),
    pt: acts.find((a) => a.pt) ? acts.find((a) => a.pt).pt : null,
    nrs: uniq(acts.flatMap((a) => a.nrs)).sort((a, b) => a - b),
    termos: acts.flatMap((a) => a.termos),
    etapas: uniq(acts.flatMap((a) => a.etapas)).slice(0, 9),
    perigos: acts.flatMap((a) => a.perigos),
    epis: uniq(acts.flatMap((a) => a.epis)),
    requisitos: uniq(acts.flatMap((a) => a.requisitos)),
    checklist: uniq(acts.flatMap((a) => a.checklist)),
    dds: uniq(acts.flatMap((a) => a.dds)),
    composta: acts.map((a) => a.id),
  };
  // remove perigos duplicados (mesmo texto)
  const seen = new Set();
  m.perigos = m.perigos.filter((p) => {
    const k = norm(p[1]).slice(0, 40);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return m;
}

// Atividade genérica — usada quando nada é reconhecido (o documento pede revisão)
function genericActivity(desc) {
  const nome = desc ? capFirst(desc) : 'Atividade geral';
  return {
    id: 'generica', nome, pt: null, nrs: [1, 6], termos: [], generic: true,
    etapas: ['Preparação e planejamento', 'Execução', 'Finalização e limpeza'],
    perigos: [
      ['Preparação e planejamento', 'Falta de planejamento / desconhecimento dos riscos da tarefa', 'Acidentes diversos', 3, 3, ['Reunião pré-tarefa com a equipe', 'Procedimento e responsabilidades definidos']],
      ['Execução', 'Queda no mesmo nível (piso, materiais, cabos)', 'Contusões, entorses', 3, 2, ['Área organizada e limpa', 'Iluminação adequada']],
      ['Execução', 'Uso de ferramentas manuais', 'Cortes, contusões', 3, 2, ['Ferramentas adequadas e em bom estado', 'Luvas de proteção']],
      ['Execução', 'Posturas e esforço físico', 'Lesões musculoesqueléticas', 3, 2, ['Pausas e revezamento', 'Meios auxiliares para cargas']],
      ['Execução', 'Projeção de partículas', 'Lesões oculares', 2, 3, ['Óculos de proteção']],
      ['Finalização e limpeza', 'Resíduos e materiais soltos', 'Tropeços, cortes', 2, 2, ['Limpeza e descarte correto ao final']],
    ],
    epis: ['Calçado de segurança', 'Óculos de proteção', 'Luvas de proteção adequadas', 'Capacete (se houver risco de queda de objetos)'],
    requisitos: ['Trabalhadores capacitados para a tarefa', 'Ordem de serviço com os riscos da função (NR-01)'],
    checklist: ['Área de trabalho organizada', 'Ferramentas em bom estado', 'EPIs disponíveis e em uso', 'Equipe orientada sobre os riscos', 'Rotas de fuga livres', 'Extintor acessível'],
    dds: ['Pare, pense e planeje antes de começar.', 'Viu um risco? Comunique — prevenção é trabalho de todos.'],
  };
}

function riskLevel(p, s) {
  const r = p * s;
  if (r >= 20) return { r, nivel: 'Crítico', cor: '#d03b3b', tone: 'critical' };
  if (r >= 10) return { r, nivel: 'Alto', cor: '#ec835a', tone: 'serious' };
  if (r >= 5) return { r, nivel: 'Moderado', cor: '#fab219', tone: 'warning' };
  return { r, nivel: 'Baixo', cor: '#0ca30c', tone: 'good' };
}

function findGlossary(text) {
  const t = padded(text);
  const words = t.trim().split(' ').length;
  let best = null, bestLen = 0;
  for (const g of GLOSSARY) {
    for (const n of [g[0], ...String(g[1] || '').split(',')].filter(Boolean)) {
      const nn = padded(n);
      if (nn.trim().length <= 3 && words > 6) continue; // siglas curtas só em perguntas curtas
      if (t.includes(nn) && nn.length > bestLen) {
        best = g;
        bestLen = nn.length;
      }
    }
  }
  return best ? { termo: best[0], definicao: best[2], nrs: best[3], dica: best[4] } : null;
}

function findAdvice(text) {
  const t = norm(text);
  return ADVICE.find((a) => a.gatilhos.test(t)) || null;
}

let _kbIndex = null;
function kbIndex() {
  if (_kbIndex) return _kbIndex;
  const ix = new BM25();
  for (const [n, nr] of Object.entries(NRS)) ix.add('nr:' + n, `NR-${n} ${nr.titulo} ${nr.resumo} ${nr.palavras || ''} ${(nr.pontos || []).join(' ')}`, { kind: 'nr', n: +n });
  GLOSSARY.forEach((g, i) => ix.add('g:' + i, `${g[0]} ${g[1]} ${g[2]}`, { kind: 'glossary', i }));
  ACTIVITIES.forEach((a) => ix.add('a:' + a.id, `${a.nome} ${a.termos.join(' ')} ${a.perigos.map((p) => p[1] + ' ' + p[2]).join(' ')}`, { kind: 'activity', id: a.id }));
  ADVICE.forEach((a) => ix.add('ad:' + a.id, `${a.titulo} ${a.passos.join(' ')}`, { kind: 'advice', id: a.id }));
  _kbIndex = ix;
  return ix;
}
function nrSearch(text, k = 3) {
  const ix = new BM25();
  for (const [n, nr] of Object.entries(NRS)) if (!nr.revogada) ix.add(+n, `${nr.titulo} ${nr.titulo} ${nr.palavras || ''} ${nr.resumo}`);
  return ix.search(text, k).map((r) => r.id);
}
function nrLabel(n) {
  const nr = NRS[n];
  return nr ? `NR-${String(n).padStart(2, '0')} — ${nr.titulo}` : `NR-${n}`;
}
// Tempo máximo de exposição a ruído (NR-15 Anexo 1), em minutos
function ruidoTempo(db) {
  if (db < 85) return Infinity;
  const exact = NR15_RUIDO.find((r) => r[0] === Math.round(db));
  if (exact) return exact[1];
  return Math.round(480 / Math.pow(2, (db - 85) / 5));
}


/* ===== 08-pdfread.js ===== */
// ---------------------------------------------------------------------------
// 08 · Leitor de PDF nativo (extração de texto 100% offline)
//      Suporta FlateDecode/LZW/ASCIIHex/ASCII85, object streams, ToUnicode,
//      Encoding/Differences, fontes Type0 (2 bytes) e Form XObjects.
//      Para PDFs protegidos ou escaneados, tenta pdf.js/OCR se houver internet.
// ---------------------------------------------------------------------------
const PDF_WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const PDF_DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
const isWs = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';

class PdfName {
  constructor(v) {
    this.v = v;
  }
}
class PdfRef {
  constructor(n, g) {
    this.n = n;
    this.g = g;
  }
}
class PdfStr {
  constructor(v) {
    this.v = v; // bytes em string latin1
  }
}

// Lê um valor PDF a partir de s[i]; devolve [valor, próximoÍndice]
function pdfValue(s, i) {
  const n = s.length;
  for (;;) {
    while (i < n && isWs(s[i])) i++;
    if (s[i] === '%') {
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
      continue;
    }
    break;
  }
  const c = s[i];
  if (c === '<' && s[i + 1] === '<') {
    i += 2;
    const d = {};
    for (;;) {
      while (i < n && isWs(s[i])) i++;
      if (s[i] === '%') {
        while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
        continue;
      }
      if (i >= n) break;
      if (s[i] === '>' && s[i + 1] === '>') {
        i += 2;
        break;
      }
      const [k, j] = pdfValue(s, i);
      if (!(k instanceof PdfName)) {
        i = j + 1;
        continue;
      }
      const [v, j2] = pdfValue(s, j);
      d[k.v] = v;
      i = j2;
    }
    return [d, i];
  }
  if (c === '[') {
    i++;
    const arr = [];
    for (;;) {
      while (i < n && isWs(s[i])) i++;
      if (i >= n) break;
      if (s[i] === ']') {
        i++;
        break;
      }
      const [v, j] = pdfValue(s, i);
      if (j <= i) {
        i++;
        continue;
      }
      arr.push(v);
      i = j;
    }
    return [arr, i];
  }
  if (c === '(') return pdfLiteral(s, i);
  if (c === '<') {
    const e = s.indexOf('>', i);
    const hex = s.slice(i + 1, e).replace(/[^0-9a-fA-F]/g, '');
    let out = '';
    for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt((hex[k] + (hex[k + 1] || '0')), 16));
    return [new PdfStr(out), e + 1];
  }
  if (c === '/') {
    let j = i + 1;
    while (j < n && !isWs(s[j]) && !PDF_DELIM.has(s[j])) j++;
    const raw = s.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    return [new PdfName(raw), j];
  }
  if ((c >= '0' && c <= '9') || c === '-' || c === '+' || c === '.') {
    let j = i + 1;
    while (j < n && /[0-9.]/.test(s[j])) j++;
    const num = parseFloat(s.slice(i, j));
    // referência "n g R"?
    const m = /^\s+(\d+)\s+R(?![A-Za-z])/.exec(s.slice(j, j + 16));
    if (m && Number.isInteger(num)) return [new PdfRef(num, +m[1]), j + m[0].length];
    return [num, j];
  }
  let j = i;
  while (j < n && !isWs(s[j]) && !PDF_DELIM.has(s[j])) j++;
  const word = s.slice(i, j);
  if (word === 'true') return [true, j];
  if (word === 'false') return [false, j];
  if (word === 'null') return [null, j];
  return [{ op: word }, j === i ? i + 1 : j];
}
function pdfLiteral(s, i) {
  let depth = 0, out = '';
  const n = s.length;
  i++;
  for (; i < n; i++) {
    const c = s[i];
    if (c === '\\') {
      const d = s[++i];
      if (d === 'n') out += '\n';
      else if (d === 'r') out += '\r';
      else if (d === 't') out += '\t';
      else if (d === 'b') out += '\b';
      else if (d === 'f') out += '\f';
      else if (d >= '0' && d <= '7') {
        let oct = d;
        while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      } else if (d === '\r') {
        if (s[i + 1] === '\n') i++;
      } else if (d === '\n') {
        /* continuação de linha */
      } else out += d;
    } else if (c === '(') {
      depth++;
      out += c;
    } else if (c === ')') {
      if (depth === 0) return [new PdfStr(out), i + 1];
      depth--;
      out += c;
    } else out += c;
  }
  return [new PdfStr(out), i];
}

// ---- Filtros --------------------------------------------------------------------
function lzwDecode(u8, early = 1) {
  const out = [];
  let dict = [], bits = 9, buf = 0, nbits = 0, prev = null;
  const reset = () => {
    dict = [];
    for (let k = 0; k < 256; k++) dict.push([k]);
    dict.push(null, null);
    bits = 9;
  };
  reset();
  for (let i = 0; i < u8.length; i++) {
    buf = (buf << 8) | u8[i];
    nbits += 8;
    while (nbits >= bits) {
      const code = (buf >> (nbits - bits)) & ((1 << bits) - 1);
      nbits -= bits;
      if (code === 256) {
        reset();
        prev = null;
        continue;
      }
      if (code === 257) return new Uint8Array(out);
      let entry;
      if (code < dict.length && dict[code]) entry = dict[code];
      else if (prev) entry = prev.concat([prev[0]]);
      else continue;
      for (const b of entry) out.push(b);
      if (prev) dict.push(prev.concat([entry[0]]));
      prev = entry;
      if (dict.length + early >= 1 << bits && bits < 12) bits++;
    }
  }
  return new Uint8Array(out);
}
function asciiHexDecode(u8) {
  const s = latin1(u8).replace(/[^0-9a-fA-F>]/g, '');
  const e = s.indexOf('>');
  const hex = e >= 0 ? s.slice(0, e) : s;
  const out = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex[i] + (hex[i + 1] || '0'), 16);
  return out;
}
function ascii85Decode(u8) {
  let s = latin1(u8).replace(/\s/g, '');
  if (s.startsWith('<~')) s = s.slice(2);
  const e = s.indexOf('~>');
  if (e >= 0) s = s.slice(0, e);
  const out = [];
  let tuple = [];
  for (const ch of s) {
    if (ch === 'z' && !tuple.length) {
      out.push(0, 0, 0, 0);
      continue;
    }
    tuple.push(ch.charCodeAt(0) - 33);
    if (tuple.length === 5) {
      let v = 0;
      for (const t of tuple) v = v * 85 + t;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      tuple = [];
    }
  }
  if (tuple.length) {
    const len = tuple.length;
    while (tuple.length < 5) tuple.push(84);
    let v = 0;
    for (const t of tuple) v = v * 85 + t;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, len - 1));
  }
  return new Uint8Array(out);
}
function runLengthDecode(u8) {
  const out = [];
  for (let i = 0; i < u8.length; ) {
    const len = u8[i++];
    if (len === 128) break;
    if (len < 128) {
      for (let k = 0; k <= len; k++) out.push(u8[i++]);
    } else {
      const b = u8[i++];
      for (let k = 0; k < 257 - len; k++) out.push(b);
    }
  }
  return new Uint8Array(out);
}
function pngUnpredict(u8, parms) {
  const colors = parms.Colors || 1, bpc = parms.BitsPerComponent || 8, cols = parms.Columns || 1;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * cols) / 8);
  const out = [];
  let prev = new Uint8Array(rowLen);
  for (let i = 0; i + rowLen < u8.length + 1; i += rowLen + 1) {
    const ft = u8[i];
    const row = u8.slice(i + 1, i + 1 + rowLen);
    for (let k = 0; k < row.length; k++) {
      const a = k >= bpp ? row[k - bpp] : 0, b = prev[k], c = k >= bpp ? prev[k - bpp] : 0;
      if (ft === 1) row[k] = (row[k] + a) & 255;
      else if (ft === 2) row[k] = (row[k] + b) & 255;
      else if (ft === 3) row[k] = (row[k] + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        row[k] = (row[k] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (const x of row) out.push(x);
    prev = row;
  }
  return new Uint8Array(out);
}

// ---- Codificações de fontes simples ------------------------------------------------
const WIN_ANSI = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i));
let MAC_ROMAN = WIN_ANSI;
try {
  MAC_ROMAN = new TextDecoder('macintosh').decode(Uint8Array.from({ length: 256 }, (_, i) => i));
} catch (e) {}
const GLYPH_SPECIAL = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '’', quoteleft: '‘',
  parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '-', period: '.', slash: '/', colon: ':', semicolon: ';',
  less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_',
  grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', bullet: '•', endash: '–', emdash: '—', quotedblleft: '“', quotedblright: '”', quotesinglbase: '‚', quotedblbase: '„',
  ellipsis: '…', degree: '°', ordfeminine: 'ª', ordmasculine: 'º', section: '§', paragraph: '¶', copyright: '©', registered: '®', trademark: '™', Euro: '€',
  sterling: '£', cent: '¢', yen: '¥', multiply: '×', divide: '÷', plusminus: '±', mu: 'µ', twosuperior: '²', threesuperior: '³', onesuperior: '¹',
  onehalf: '½', onequarter: '¼', threequarters: '¾', guillemotleft: '«', guillemotright: '»', guilsinglleft: '‹', guilsinglright: '›', exclamdown: '¡',
  questiondown: '¿', germandbls: 'ß', periodcentered: '·', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', nbspace: ' ', nonbreakingspace: ' ',
  dagger: '†', daggerdbl: '‡', perthousand: '‰', florin: 'ƒ', circumflex: 'ˆ', tilde: '˜', dotlessi: 'ı', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ',
  oslash: 'ø', Oslash: 'Ø', logicalnot: '¬', brokenbar: '¦', currency: '¤', dieresis: '¨', macron: '¯', acute: '´', cedilla: '¸', sfthyphen: '-',
  lslash: 'ł', Lslash: 'Ł', eth: 'ð', Eth: 'Ð', thorn: 'þ', Thorn: 'Þ', checkmark: '✓', arrowright: '→',
};
const DIACRITIC = { acute: '́', grave: '̀', circumflex: '̂', tilde: '̃', dieresis: '̈', ring: '̊', cedilla: '̧', caron: '̌' };
function glyphToUnicode(name) {
  if (!name) return '';
  if (GLYPH_SPECIAL[name]) return GLYPH_SPECIAL[name];
  if (name.length === 1) return name;
  let m = /^uni([0-9A-Fa-f]{4,})$/.exec(name);
  if (m) {
    let out = '';
    for (let k = 0; k + 4 <= m[1].length; k += 4) out += String.fromCharCode(parseInt(m[1].slice(k, k + 4), 16));
    return out;
  }
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  m = /^([A-Za-z])(acute|grave|circumflex|tilde|dieresis|ring|cedilla|caron)$/.exec(name);
  if (m) return (m[1] + DIACRITIC[m[2]]).normalize('NFC');
  const base = name.split(/[._]/)[0];
  if (base !== name) return glyphToUnicode(base);
  return '';
}

// ---- ToUnicode CMap ---------------------------------------------------------------
function utf16be(hex) {
  let s = '';
  for (let k = 0; k + 4 <= hex.length; k += 4) s += String.fromCharCode(parseInt(hex.slice(k, k + 4), 16));
  if (hex.length % 4 === 2) s += String.fromCharCode(parseInt(hex.slice(-2), 16));
  return s;
}
function parseCMap(str) {
  const map = new Map();
  let bytes = 0;
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(str);
  if (cs) bytes = cs[1].length / 2;
  let m;
  const reChar = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = reChar.exec(str))) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g;
    let p;
    while ((p = re.exec(m[1]))) {
      map.set(parseInt(p[1], 16), utf16be(p[2]));
      if (!bytes) bytes = p[1].length / 2;
    }
  }
  const reRange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = reRange.exec(str))) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g;
    let p;
    while ((p = re.exec(m[1]))) {
      const lo = parseInt(p[1], 16), hi = Math.min(parseInt(p[2], 16), lo + 65535);
      if (!bytes) bytes = p[1].length / 2;
      if (p[3][0] === '[') {
        const items = p[3].match(/<([0-9a-fA-F]*)>/g) || [];
        items.forEach((it, k) => map.set(lo + k, utf16be(it.slice(1, -1))));
      } else {
        const dst = p[3].slice(1, -1);
        const head = dst.slice(0, -4), last = parseInt(dst.slice(-4) || '0', 16);
        for (let c = lo; c <= hi; c++) map.set(c, utf16be(head) + String.fromCharCode(last + (c - lo)));
      }
    }
  }
  return { map, bytes: bytes || 1 };
}

// ---- Documento ---------------------------------------------------------------------
class PdfDoc {
  constructor(u8) {
    this.u8 = u8;
    this.s = latin1(u8);
    this.objs = new Map();
    this.fontCache = new Map();
    this.encrypted = /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(this.s.slice(-4096)) || /trailer[\s\S]{0,400}\/Encrypt/.test(this.s);
  }
  scan() {
    const s = this.s;
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) {
      const num = +m[1];
      let [val, i] = [null, m.index + m[0].length];
      try {
        [val, i] = pdfValue(s, i);
      } catch (e) {
        continue;
      }
      const entry = { num, val };
      let j = i;
      while (j < s.length && isWs(s[j])) j++;
      if (s.startsWith('stream', j) && val && typeof val === 'object') {
        let start = j + 6;
        if (s[start] === '\r') start++;
        if (s[start] === '\n') start++;
        let len = typeof val.Length === 'number' ? val.Length : -1;
        let end = -1;
        if (len >= 0 && /^\s*endstream/.test(s.slice(start + len, start + len + 20))) end = start + len;
        else {
          end = s.indexOf('endstream', start);
          if (end < 0) end = s.length;
          while (end > start && (s[end - 1] === '\n' || s[end - 1] === '\r')) end--;
        }
        entry.stream = [start, end];
        re.lastIndex = end;
      }
      this.objs.set(num, entry);
    }
  }
  get(v, depth = 0) {
    while (v instanceof PdfRef && depth++ < 20) {
      const e = this.objs.get(v.n);
      v = e ? e.val : null;
    }
    return v;
  }
  entryOf(v) {
    return v instanceof PdfRef ? this.objs.get(v.n) : null;
  }
  async streamBytes(entry) {
    if (!entry || !entry.stream) return null;
    const dict = entry.val || {};
    let data = this.u8.subarray(entry.stream[0], entry.stream[1]);
    let filters = this.get(dict.Filter);
    let parms = this.get(dict.DecodeParms);
    if (!filters) return data;
    if (!Array.isArray(filters)) filters = [filters];
    if (!Array.isArray(parms)) parms = [parms];
    for (let k = 0; k < filters.length; k++) {
      const f = filters[k] instanceof PdfName ? filters[k].v : '';
      const p = this.get(parms[k]) || {};
      if (f === 'FlateDecode' || f === 'Fl') {
        let out = await inflate(data).catch(() => null);
        if (!out || !out.length) out = await inflate(data, true).catch(() => null);
        if (!out) return null;
        data = p.Predictor >= 10 ? pngUnpredict(out, p) : out;
      } else if (f === 'LZWDecode' || f === 'LZW') {
        data = lzwDecode(data, p.EarlyChange === 0 ? 0 : 1);
        if (p.Predictor >= 10) data = pngUnpredict(data, p);
      } else if (f === 'ASCIIHexDecode' || f === 'AHx') data = asciiHexDecode(data);
      else if (f === 'ASCII85Decode' || f === 'A85') data = ascii85Decode(data);
      else if (f === 'RunLengthDecode' || f === 'RL') data = runLengthDecode(data);
      else return null; // imagens (DCT, JPX, CCITT) não interessam aqui
    }
    return data;
  }
  async expandObjectStreams() {
    for (const e of [...this.objs.values()]) {
      const v = e.val;
      if (!e.stream || !v || !(v.Type instanceof PdfName) || v.Type.v !== 'ObjStm') continue;
      const bytes = await this.streamBytes(e);
      if (!bytes) continue;
      const s = latin1(bytes);
      const N = v.N | 0, first = v.First | 0;
      const head = s.slice(0, first).trim().split(/\s+/).map(Number);
      for (let k = 0; k < N; k++) {
        const num = head[2 * k], off = head[2 * k + 1];
        if (this.objs.has(num) || isNaN(off)) continue;
        try {
          const [val] = pdfValue(s, first + off);
          this.objs.set(num, { num, val });
        } catch (err) {}
      }
    }
  }
  pages() {
    const out = [];
    let catalog = null;
    for (const e of this.objs.values()) if (e.val && e.val.Type instanceof PdfName && e.val.Type.v === 'Catalog') catalog = e.val;
    const seen = new Set();
    const walk = (node, res, depth) => {
      if (depth > 40) return;
      const key = node instanceof PdfRef ? node.n : null;
      if (key != null) {
        if (seen.has(key)) return;
        seen.add(key);
      }
      const d = this.get(node);
      if (!d || typeof d !== 'object') return;
      const r = d.Resources || res;
      const kids = this.get(d.Kids);
      if (Array.isArray(kids)) kids.forEach((k) => walk(k, r, depth + 1));
      else if (d.Contents !== undefined || (d.Type instanceof PdfName && d.Type.v === 'Page')) out.push({ dict: d, res: r });
    };
    if (catalog) walk(catalog.Pages, null, 0);
    if (!out.length) {
      for (const e of this.objs.values()) if (e.val && e.val.Type instanceof PdfName && e.val.Type.v === 'Page') out.push({ dict: e.val, res: e.val.Resources });
    }
    return out;
  }
  async font(ref) {
    const key = ref instanceof PdfRef ? ref.n : null;
    if (key != null && this.fontCache.has(key)) return this.fontCache.get(key);
    const f = this.get(ref) || {};
    const subtype = f.Subtype instanceof PdfName ? f.Subtype.v : '';
    let toUni = null;
    const tuEntry = this.entryOf(f.ToUnicode);
    if (tuEntry) {
      const b = await this.streamBytes(tuEntry);
      if (b) toUni = parseCMap(latin1(b));
    }
    const twoByte = subtype === 'Type0';
    let table = WIN_ANSI.split('');
    const diffs = {};
    const enc = this.get(f.Encoding);
    const baseName = enc instanceof PdfName ? enc.v : enc && enc.BaseEncoding instanceof PdfName ? enc.BaseEncoding.v : '';
    if (baseName === 'MacRomanEncoding') table = MAC_ROMAN.split('');
    if (enc && typeof enc === 'object' && Array.isArray(enc.Differences)) {
      let code = 0;
      for (const it of enc.Differences) {
        if (typeof it === 'number') code = it;
        else if (it instanceof PdfName) diffs[code++] = glyphToUnicode(it.v);
      }
    }
    // larguras reais dos glifos (1/1000 em) para posicionar o texto com precisão
    const widths = new Map();
    let dw = 0, wScale = 1;
    if (twoByte) {
      const desc = this.get((this.get(f.DescendantFonts) || [])[0]) || {};
      dw = typeof desc.DW === 'number' ? desc.DW : 1000;
      const W = this.get(desc.W) || [];
      for (let k = 0; k < W.length; ) {
        const a = this.get(W[k]), b = this.get(W[k + 1]);
        if (Array.isArray(b)) {
          b.forEach((w, j) => widths.set(a + j, this.get(w)));
          k += 2;
        } else {
          const w = this.get(W[k + 2]);
          for (let c = a; c <= Math.min(b, a + 65535); c++) widths.set(c, w);
          k += 3;
        }
      }
    } else {
      const fc = this.get(f.FirstChar) | 0;
      const W = this.get(f.Widths);
      if (Array.isArray(W)) W.forEach((w, j) => widths.set(fc + j, this.get(w)));
      const fd = this.get(f.FontDescriptor) || {};
      dw = this.get(fd.MissingWidth) || 0;
      const fm = this.get(f.FontMatrix);
      if (subtype === 'Type3' && Array.isArray(fm)) wScale = (fm[0] || 0.001) * 1000;
    }
    const hasW = widths.size > 0;
    const font = {
      twoByte,
      run(str) {
        let text = '', adv = 0, n = 0, sp = 0;
        const step = twoByte ? 2 : 1;
        for (let i = 0; i < str.length; i += step) {
          const code = step === 2 ? (str.charCodeAt(i) << 8) | (str.charCodeAt(i + 1) || 0) : str.charCodeAt(i);
          let ch;
          if (toUni && toUni.map.has(code)) ch = toUni.map.get(code);
          else if (diffs[code] !== undefined) ch = diffs[code];
          else ch = step === 1 ? table[code] || '' : '';
          text += ch;
          n++;
          if (code === 32 && step === 1) sp++;
          const w = widths.get(code);
          adv += ((w == null ? dw : w) * wScale) / 1000;
        }
        return { text, adv: hasW ? adv : null, n, sp };
      },
      decode(str) {
        return this.run(str).text;
      },
    };
    if (key != null) this.fontCache.set(key, font);
    return font;
  }
  async contentOf(page) {
    const c = this.get(page.dict.Contents);
    const refs = Array.isArray(c) ? c : [page.dict.Contents];
    const parts = [];
    for (const r of refs) {
      const e = this.entryOf(r);
      const b = e ? await this.streamBytes(e) : null;
      if (b) parts.push(latin1(b));
    }
    return parts.join('\n');
  }
  async pageText(page) {
    const content = await this.contentOf(page);
    return this.runContent(content, this.get(page.res) || {}, 0);
  }
  async runContent(content, res, depth) {
    const fonts = this.get(res.Font) || {};
    const xobjs = this.get(res.XObject) || {};
    const s = content;
    const n = s.length;
    const stack = [];
    let out = '';
    let font = null, fontSize = 10, scale = 1, leading = 0;
    let lx = 0, ly = 0, lastY = null, curX = null, tc = 0, tw = 0;
    const arrStack = [];
    // mostra um trecho e avança a posição horizontal (curX) pela largura real dos glifos
    const show = (str) => {
      const r = font ? font.run(str) : { text: str, adv: null, n: str.length, sp: (str.match(/ /g) || []).length };
      if (!r.text) return;
      out += r.text;
      if (curX !== null) {
        const em = r.adv != null ? r.adv : estRunWidth(r.text);
        curX += (em * fontSize + tc * r.n + tw * r.sp) * scale;
      }
    };
    const moveTo = (x, y) => {
      const fs = Math.max(1, Math.abs(fontSize * scale));
      if (lastY !== null && Math.abs(y - lastY) > fs * 0.4) {
        if (!out.endsWith('\n')) out += Math.abs(y - lastY) > fs * 2.2 ? '\n\n' : '\n';
      } else if (curX !== null && x > curX + fs * 0.15 && out && !/\s$/.test(out)) out += ' ';
      lx = x;
      ly = y;
      lastY = y;
      curX = x;
    };
    let i = 0;
    while (i < n) {
      const c = s[i];
      if (isWs(c)) {
        i++;
        continue;
      }
      if (c === '%') {
        while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
        continue;
      }
      if (c === '[') {
        arrStack.push(stack.length);
        i++;
        continue;
      }
      if (c === ']') {
        const at = arrStack.pop();
        if (at !== undefined) stack.push(stack.splice(at));
        i++;
        continue;
      }
      let val, j;
      try {
        [val, j] = pdfValue(s, i);
      } catch (e) {
        i++;
        continue;
      }
      i = j > i ? j : i + 1;
      if (!val || typeof val !== 'object' || !('op' in val)) {
        stack.push(val);
        continue;
      }
      const op = val.op;
      const args = stack.splice(0);
      switch (op) {
        case 'BT':
          lx = ly = 0;
          break;
        case 'Tf': {
          const nm = args[0] instanceof PdfName ? args[0].v : '';
          fontSize = typeof args[1] === 'number' ? args[1] : fontSize;
          font = fonts[nm] ? await this.font(fonts[nm]) : null;
          break;
        }
        case 'TL':
          leading = args[0] || 0;
          break;
        case 'Tc':
          tc = args[0] || 0;
          break;
        case 'Tw':
          tw = args[0] || 0;
          break;
        case 'Td':
          moveTo(lx + (args[0] || 0) * scale, ly + (args[1] || 0) * scale);
          break;
        case 'TD':
          leading = -(args[1] || 0);
          moveTo(lx + (args[0] || 0) * scale, ly + (args[1] || 0) * scale);
          break;
        case 'Tm':
          scale = Math.hypot(args[2] || 0, args[3] || 1) || 1;
          moveTo(args[4] || 0, args[5] || 0);
          break;
        case 'T*':
          moveTo(lx, ly - leading * scale);
          break;
        case "'":
        case '"':
          if (op === '"') {
            tw = args[0] || 0;
            tc = args[1] || 0;
          }
          moveTo(lx, ly - leading * scale);
          if (args[args.length - 1] instanceof PdfStr) show(args[args.length - 1].v);
          break;
        case 'Tj':
          if (args[0] instanceof PdfStr) show(args[0].v);
          break;
        case 'TJ':
          for (const it of args[0] || []) {
            if (it instanceof PdfStr) show(it.v);
            else if (typeof it === 'number') {
              if (curX !== null) curX -= (it / 1000) * fontSize * scale;
              if (it < -200 && out && !/\s$/.test(out)) out += ' ';
            }
          }
          break;
        case 'BI': {
          const e = s.slice(i).search(/\sEI(\s|$)/);
          i = e < 0 ? n : i + e + 3;
          break;
        }
        case 'Do': {
          if (depth > 3) break;
          const nm = args[0] instanceof PdfName ? args[0].v : '';
          const e = this.entryOf(xobjs[nm]);
          const d = e && e.val;
          if (d && d.Subtype instanceof PdfName && d.Subtype.v === 'Form') {
            const b = await this.streamBytes(e);
            if (b) {
              const sub = await this.runContent(latin1(b), this.get(d.Resources) || res, depth + 1);
              if (sub.trim()) out += (out && !/\s$/.test(out) ? '\n' : '') + sub;
            }
          }
          break;
        }
        default:
          break;
      }
    }
    return out;
  }
}

// Largura aproximada (em "em") de um trecho, para decidir se há espaço entre trechos
function estRunWidth(s) {
  let w = 0;
  for (const ch of s) {
    if (/[MWÆŒ]/.test(ch)) w += 0.85;
    else if (/[Iİ|]/.test(ch)) w += 0.28;
    else if (/[A-ZÀ-Ý]/.test(ch)) w += 0.68;
    else if (/[mwæœ]/.test(ch)) w += 0.8;
    else if (/[ijlíìîï]/.test(ch)) w += 0.23;
    else if (/[frt]/.test(ch)) w += 0.33;
    else if (/[a-zà-ÿ0-9]/.test(ch)) w += 0.53;
    else if (ch === ' ') w += 0.28;
    else w += 0.33;
  }
  return w;
}

// Qualidade do texto extraído (0..1): proporção de caracteres "normais"
function textQuality(t) {
  if (!t) return 0;
  const sample = t.slice(0, 6000);
  const good = (sample.match(/[A-Za-zÀ-ÿ0-9\s.,;:!?()%/\-–—"'ºª°§$R@]/g) || []).length;
  return good / sample.length;
}

async function pdfExtractNative(u8) {
  const doc = new PdfDoc(u8);
  doc.scan();
  await doc.expandObjectStreams();
  const pages = doc.pages();
  const texts = [];
  for (const p of pages) {
    try {
      texts.push((await doc.pageText(p)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
    } catch (e) {
      texts.push('');
    }
  }
  let title = '';
  for (const e of doc.objs.values()) {
    if (e.val && e.val.Title instanceof PdfStr && (e.val.Producer || e.val.Creator || e.val.Author !== undefined)) {
      const raw = e.val.Title.v;
      title = raw.startsWith('þÿ') ? utf16be([...raw.slice(2)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')) : raw;
    }
  }
  return { pages: texts, pageCount: pages.length, encrypted: doc.encrypted, title: title.trim() };
}

async function pdfExtractPdfJs(u8) {
  if (!isOnline()) throw new Error('offline');
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const lib = await loadScript(base + 'pdf.min.js', 'pdfjsLib');
  lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
  const pdf = await lib.getDocument({ data: u8.slice() }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n').trim());
  }
  return { pages, pageCount: pdf.numPages, via: 'pdf.js', pdf };
}

// Leitura completa com estratégias de recuperação
async function readPdf(u8, onProgress) {
  let res = null, warn = [];
  try {
    res = await pdfExtractNative(u8);
  } catch (e) {
    warn.push('Leitor nativo falhou: ' + e.message);
  }
  const joined = res ? res.pages.join('\n\n') : '';
  const weak = !res || res.encrypted || joined.replace(/\s/g, '').length < Math.max(40, (res.pageCount || 1) * 25) || textQuality(joined) < 0.85;
  if (weak && isOnline()) {
    try {
      onProgress && onProgress('Lendo com o leitor avançado (pdf.js)…');
      const r2 = await pdfExtractPdfJs(u8);
      const j2 = r2.pages.join('\n\n');
      if (j2.replace(/\s/g, '').length > joined.replace(/\s/g, '').length * 0.8 && textQuality(j2) >= textQuality(joined) - 0.02) {
        res = { ...r2, title: res && res.title };
        warn = [];
      }
    } catch (e) {
      /* sem internet ou bloqueado */
    }
  }
  if (!res) throw new Error('Não foi possível ler este PDF.');
  const text = res.pages.join('\n\n');
  if (res.encrypted && text.replace(/\s/g, '').length < 20) warn.push('PDF protegido por senha/criptografia — não consegui extrair o texto offline.');
  else if (text.replace(/\s/g, '').length < 20) warn.push('Este PDF parece ser digitalizado (imagem). Para ler o texto, é preciso OCR (disponível com internet).');
  return { ...res, text, warnings: warn };
}


/* ===== 09-readers.js ===== */
// ---------------------------------------------------------------------------
// 09 · Leitores de arquivos: PDF, Word, Excel, PowerPoint, OpenDocument,
//      CSV, TXT, HTML, JSON, RTF, imagens (EXIF, miniatura, OCR opcional)
// ---------------------------------------------------------------------------
const MAX_FILE_MB = 40;
const KIND_BY_EXT = {
  pdf: 'pdf', docx: 'docx', docm: 'docx', dotx: 'docx', xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx', pptx: 'pptx', ppsx: 'pptx',
  odt: 'odt', ods: 'ods', odp: 'odp', csv: 'csv', tsv: 'csv', txt: 'text', md: 'text', log: 'text', ini: 'text', yaml: 'text', yml: 'text',
  json: 'json', html: 'html', htm: 'html', xml: 'xml', rtf: 'rtf', doc: 'legacy', xls: 'legacy', ppt: 'legacy',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', bmp: 'image', heic: 'heic', heif: 'heic',
};
const KIND_LABEL = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', odt: 'Documento ODT', ods: 'Planilha ODS', odp: 'Apresentação ODP', csv: 'Planilha CSV', text: 'Texto', json: 'JSON', html: 'Página HTML', xml: 'XML', rtf: 'RTF', legacy: 'Office antigo', image: 'Imagem', heic: 'Imagem HEIC', unknown: 'Arquivo' };
const KIND_ICON = { pdf: '📕', docx: '📘', xlsx: '📗', pptx: '📙', odt: '📘', ods: '📗', odp: '📙', csv: '📗', text: '📄', json: '🧾', html: '🌐', xml: '🧾', rtf: '📄', legacy: '📄', image: '🖼️', heic: '🖼️', unknown: '📎' };

function fileKind(name, mime) {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  if (KIND_BY_EXT[ext]) return KIND_BY_EXT[ext];
  if (/^image\//.test(mime)) return 'image';
  if (/pdf/.test(mime)) return 'pdf';
  if (/^text\//.test(mime)) return 'text';
  return 'unknown';
}

async function readFileRecord(file, onProgress = () => {}) {
  const kind = fileKind(file.name, file.type);
  const rec = {
    id: uid('file'), name: file.name, mime: file.type || '', size: file.size, kind, addedAt: Date.now(),
    text: '', pages: null, pageBreaks: null, tables: [], sheets: null, meta: {}, warnings: [], image: null,
  };
  if (file.size > MAX_FILE_MB * 1048576) {
    rec.warnings.push(`Arquivo muito grande (${humanSize(file.size)}). O limite é ${MAX_FILE_MB} MB.`);
    rec.analysis = analyzeDoc(rec);
    return rec;
  }
  const buf = new Uint8Array(await readAsArrayBuffer(file));
  try {
    if (kind === 'pdf') {
      onProgress('Lendo PDF…');
      const r = await readPdf(buf, onProgress);
      rec.pages = r.pages;
      rec.text = r.text;
      rec.meta.pageCount = r.pageCount;
      rec.meta.via = r.via || 'nativo';
      if (r.title) rec.meta.title = r.title;
      rec.warnings.push(...r.warnings);
      let off = 0;
      rec.pageBreaks = r.pages.map((p) => (off += p.length + 2));
    } else if (kind === 'docx') {
      onProgress('Lendo documento Word…');
      Object.assign(rec, await readDocx(await zipRead(buf)));
    } else if (kind === 'xlsx') {
      onProgress('Lendo planilha…');
      Object.assign(rec, await readXlsx(await zipRead(buf)));
    } else if (kind === 'pptx') {
      onProgress('Lendo apresentação…');
      Object.assign(rec, await readPptx(await zipRead(buf)));
    } else if (kind === 'odt' || kind === 'ods' || kind === 'odp') {
      onProgress('Lendo documento OpenDocument…');
      Object.assign(rec, await readOdf(await zipRead(buf), kind));
    } else if (kind === 'csv') {
      const t = decodeText(buf);
      const rows = parseCSV(t);
      rec.tables = [{ name: file.name, rows }];
      rec.sheets = [{ name: file.name.replace(/\.[^.]+$/, ''), rows }];
      rec.text = rows.map((r) => r.join(' | ')).join('\n');
    } else if (kind === 'text' || kind === 'xml') {
      rec.text = decodeText(buf);
      if (kind === 'xml') rec.text = rec.text.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
    } else if (kind === 'json') {
      const t = decodeText(buf);
      Object.assign(rec, readJsonText(t));
    } else if (kind === 'html') {
      Object.assign(rec, htmlToRecord(decodeText(buf)));
    } else if (kind === 'rtf') {
      rec.text = rtfToText(decodeText(buf));
    } else if (kind === 'legacy') {
      rec.text = legacyStrings(buf);
      rec.warnings.push('Formato antigo do Office (.doc/.xls/.ppt): extraí o texto possível. Para leitura completa, salve como .docx/.xlsx/.pptx.');
    } else if (kind === 'image') {
      onProgress('Processando imagem…');
      rec.image = await readImage(file, buf);
      rec.meta.exif = rec.image.exif;
    } else if (kind === 'heic') {
      rec.warnings.push('Fotos HEIC (iPhone) não são exibidas pela maioria dos navegadores. Envie em JPG/PNG (no iPhone: Ajustes › Câmera › Formatos › Mais Compatível).');
    } else {
      const t = decodeText(buf.subarray(0, 2e6));
      if (textQuality(t) > 0.9) rec.text = t;
      else rec.warnings.push('Formato não reconhecido — não consegui ler o conteúdo.');
    }
  } catch (e) {
    console.warn('[OPS360IA] leitura', file.name, e);
    rec.warnings.push('Não consegui ler este arquivo: ' + (e.message || e));
  }
  rec.text = (rec.text || '').replace(/\u0000/g, '').trim();
  rec.analysis = analyzeDoc(rec);
  return rec;
}

// ---- Word (DOCX) ---------------------------------------------------------------------
function ooxmlParaText(p) {
  let s = '';
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      const ln = localName(c);
      if (ln === 't' || ln === 'delText') s += ln === 't' ? c.textContent : '';
      else if (ln === 'tab') s += '\t';
      else if (ln === 'br' || ln === 'cr') s += '\n';
      else if (ln === 'noBreakHyphen') s += '-';
      else if (ln === 'sym') s += '•';
      else if (ln !== 'rPr' && ln !== 'pPr' && ln !== 'instrText') walk(c);
    }
  };
  walk(p);
  return s;
}
function closestLocal(node, name) {
  let n = node.parentNode;
  while (n && n.nodeType === 1) {
    if (localName(n) === name) return n;
    n = n.parentNode;
  }
  return null;
}
async function readDocx(zip) {
  const xml = await zip.text('word/document.xml');
  if (!xml) throw new Error('document.xml ausente');
  const doc = parseXML(xml);
  const body = tags(doc, 'body')[0] || doc.documentElement;
  const lines = [], tables = [], headings = [];
  const handle = (node) => {
    for (const el of node.childNodes) {
      if (el.nodeType !== 1) continue;
      const ln = localName(el);
      if (ln === 'p') {
        const txt = ooxmlParaText(el).trim();
        if (!txt) {
          lines.push('');
          continue;
        }
        const st = tags(el, 'pStyle')[0];
        const style = st ? st.getAttribute('w:val') || st.getAttribute('val') || '' : '';
        const isList = tags(el, 'numPr').length > 0 || /(list|lista|bullet|marcador|numera)/i.test(style);
        if (/^(heading|titulo|ttulo|title|cabealho)\d*/i.test(style) || /^T[ií]tulo/i.test(style)) {
          lines.push('\n' + txt);
          headings.push(txt);
        } else lines.push((isList ? '• ' : '') + txt);
      } else if (ln === 'tbl') {
        const rows = tags(el, 'tr')
          .filter((tr) => closestLocal(tr, 'tbl') === el)
          .map((tr) =>
            tags(tr, 'tc')
              .filter((tc) => closestLocal(tc, 'tbl') === el)
              .map((tc) => tags(tc, 'p').map(ooxmlParaText).join(' ').replace(/\s+/g, ' ').trim())
          );
        if (rows.length) {
          tables.push({ name: `Tabela ${tables.length + 1}`, rows });
          lines.push(rows.map((r) => r.join(' | ')).join('\n'));
        }
      } else if (ln === 'sdt' || ln === 'sdtContent' || ln === 'customXml' || ln === 'ins') handle(el);
    }
  };
  handle(body);
  // cabeçalhos e rodapés costumam ter nome da empresa, código e revisão
  const extra = [];
  for (const n of zip.names().filter((x) => /^word\/(header|footer)\d*\.xml$/.test(x)).slice(0, 4)) {
    const hx = parseXML(await zip.text(n));
    const t = tags(hx, 'p').map(ooxmlParaText).join(' ').replace(/\s+/g, ' ').trim();
    if (t) extra.push(t);
  }
  const core = await zip.text('docProps/core.xml');
  const meta = {};
  if (core) {
    const cx = parseXML(core);
    const t = tags(cx, 'title')[0];
    const a = tags(cx, 'creator')[0];
    if (t && t.textContent.trim()) meta.title = t.textContent.trim();
    if (a && a.textContent.trim()) meta.author = a.textContent.trim();
  }
  meta.headerFooter = uniq(extra).join(' · ');
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), tables, meta: { ...meta, headings } };
}

// ---- Excel (XLSX) --------------------------------------------------------------------
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
async function readXlsx(zip) {
  const wb = parseXML((await zip.text('xl/workbook.xml')) || '<x/>');
  const rels = parseXML((await zip.text('xl/_rels/workbook.xml.rels')) || '<x/>');
  const relMap = {};
  for (const r of tags(rels, 'Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
  const ss = [];
  const ssx = await zip.text('xl/sharedStrings.xml');
  if (ssx) for (const si of tags(parseXML(ssx), 'si')) ss.push(tags(si, 't').map((t) => t.textContent).join(''));
  // estilos → formatos de data
  const dateStyles = new Set();
  const stx = await zip.text('xl/styles.xml');
  if (stx) {
    const sd = parseXML(stx);
    const custom = {};
    for (const nf of tags(sd, 'numFmt')) custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode') || '';
    const cellXfs = tags(sd, 'cellXfs')[0];
    if (cellXfs) {
      tags(cellXfs, 'xf').forEach((xf, idx) => {
        const id = +xf.getAttribute('numFmtId');
        const code = custom[id] || '';
        if (BUILTIN_DATE_FMTS.has(id) || (/[dmy]/i.test(code.replace(/\[[^\]]*\]|"[^"]*"/g, '')) && !/^[#0.,%\s]+$/.test(code))) dateStyles.add(idx);
      });
    }
  }
  const sheets = [];
  for (const sh of tags(wb, 'sheet').slice(0, 20)) {
    const name = sh.getAttribute('name');
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relMap[rid] || '';
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    const path = 'xl/' + target;
    const sx = await zip.text(path);
    if (!sx) continue;
    const sdoc = parseXML(sx);
    const rows = [];
    for (const row of tags(sdoc, 'row').slice(0, 5000)) {
      const r = [];
      for (const c of tags(row, 'c')) {
        const ci = colIndex(c.getAttribute('r'));
        if (ci > 60) continue;
        const t = c.getAttribute('t');
        const vEl = tags(c, 'v')[0];
        let v = vEl ? vEl.textContent : '';
        if (t === 's') v = ss[+v] || '';
        else if (t === 'inlineStr') v = tags(c, 't').map((x) => x.textContent).join('');
        else if (t === 'b') v = v === '1' ? 'VERDADEIRO' : 'FALSO';
        else if (v !== '' && dateStyles.has(+(c.getAttribute('s') || -1)) && !isNaN(+v) && +v > 1000 && +v < 80000) v = fmtDate(excelDate(+v));
        else if (v !== '' && !isNaN(+v) && t !== 'str') v = String(+(+v).toFixed(6)).replace('.', ',');
        while (r.length < ci) r.push('');
        r[ci] = v;
      }
      const rn = +row.getAttribute('r') - 1;
      while (rows.length < rn && rows.length < 5000) rows.push([]);
      rows.push(r);
    }
    const trimmed = trimTable(rows);
    if (trimmed.length) sheets.push({ name, rows: trimmed });
  }
  const text = sheets.map((s) => `## ${s.name}\n` + s.rows.map((r) => r.join(' | ')).join('\n')).join('\n\n');
  return { sheets, tables: sheets.map((s) => ({ name: s.name, rows: s.rows })), text, meta: { sheetCount: sheets.length } };
}
function trimTable(rows) {
  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  const width = Math.max(0, ...nonEmpty.map((r) => r.length));
  let lastCol = 0;
  for (const r of nonEmpty) for (let k = 0; k < r.length; k++) if (String(r[k] || '').trim()) lastCol = Math.max(lastCol, k);
  return nonEmpty.map((r) => {
    const x = r.slice(0, Math.min(width, lastCol + 1));
    while (x.length < lastCol + 1) x.push('');
    return x.map((c) => String(c == null ? '' : c).trim());
  });
}

// ---- PowerPoint (PPTX) ---------------------------------------------------------------
async function readPptx(zip) {
  const slides = zip
    .names()
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
  const pages = [];
  for (const s of slides) {
    const d = parseXML(await zip.text(s));
    const paras = tags(d, 'p').map((p) => tags(p, 't').map((t) => t.textContent).join('')).filter((t) => t.trim());
    pages.push(paras.join('\n'));
  }
  const text = pages.map((p, i) => `--- Slide ${i + 1} ---\n${p}`).join('\n\n');
  return { pages, text, meta: { slideCount: pages.length } };
}

// ---- OpenDocument ---------------------------------------------------------------------
async function readOdf(zip, kind) {
  const d = parseXML((await zip.text('content.xml')) || '<x/>');
  const lines = [], tables = [];
  const handle = (node) => {
    for (const el of node.childNodes) {
      if (el.nodeType !== 1) continue;
      const ln = localName(el);
      if (ln === 'h') lines.push('\n' + el.textContent.trim());
      else if (ln === 'p') lines.push(el.textContent.trim());
      else if (ln === 'list-item') lines.push('• ' + el.textContent.trim());
      else if (ln === 'table') {
        const rows = [];
        for (const tr of tags(el, 'table-row').slice(0, 3000)) {
          const rep = Math.min(+(tr.getAttribute('table:number-rows-repeated') || 1), 3);
          const r = [];
          for (const tc of tags(tr, 'table-cell')) {
            const n = Math.min(+(tc.getAttribute('table:number-columns-repeated') || 1), 30);
            for (let k = 0; k < n; k++) r.push(tc.textContent.trim());
          }
          for (let k = 0; k < rep; k++) rows.push(r);
        }
        const t = trimTable(rows);
        if (t.length) {
          tables.push({ name: el.getAttribute('table:name') || `Tabela ${tables.length + 1}`, rows: t });
          lines.push(t.map((r) => r.join(' | ')).join('\n'));
        }
      } else handle(el);
    }
  };
  handle(tags(d, 'body')[0] || d.documentElement);
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, tables, sheets: kind === 'ods' ? tables : null };
}

// ---- CSV / JSON / HTML / RTF / legados ------------------------------------------------
function parseCSV(text) {
  const first = text.split(/\r?\n/).slice(0, 5).join('\n');
  const cands = [';', ',', '\t', '|'];
  const delim = cands.map((d) => [d, (first.match(new RegExp(escapeRe(d), 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length > 20000) break;
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return trimTable(rows);
}
function readJsonText(t) {
  let data;
  try {
    data = JSON.parse(t);
  } catch (e) {
    return { text: t, warnings: ['JSON inválido — lido como texto.'] };
  }
  const table = jsonToTable(data);
  return { text: JSON.stringify(data, null, 2).slice(0, 200000), tables: table ? [{ name: 'Dados', rows: table }] : [], sheets: table ? [{ name: 'Dados', rows: table }] : null };
}
function jsonToTable(data) {
  let arr = Array.isArray(data) ? data : null;
  if (!arr && data && typeof data === 'object') {
    const k = Object.keys(data).find((x) => Array.isArray(data[x]) && data[x].length && typeof data[x][0] === 'object');
    if (k) arr = data[k];
  }
  if (!arr || !arr.length || typeof arr[0] !== 'object') return null;
  const flat = (o, p = '', out = {}) => {
    for (const [k, v] of Object.entries(o || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(out).length < 40) flat(v, p + k + '.', out);
      else out[p + k] = Array.isArray(v) ? v.join(', ') : v;
    }
    return out;
  };
  const rows = arr.slice(0, 5000).map((o) => flat(o));
  const cols = uniq(rows.flatMap((r) => Object.keys(r))).slice(0, 40);
  return [cols, ...rows.map((r) => cols.map((c) => (r[c] == null ? '' : String(r[c]))))];
}
function htmlToRecord(html, baseUrl) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  const site = parseSiteDoc(d, baseUrl || '');
  return { text: site.text, tables: site.tables.map((t, i) => ({ name: t.caption || `Tabela ${i + 1}`, rows: [t.head, ...t.rows].filter((r) => r && r.length) })), meta: { title: site.title } };
}
function rtfToText(rtf) {
  let s = rtf.replace(/\{\\\*[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '');
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (m, h) => WIN_ANSI[parseInt(h, 16)]);
  s = s.replace(/\\u(-?\d+)\??/g, (m, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n));
  s = s.replace(/\\(par|line)\b ?/g, '\n').replace(/\\tab\b ?/g, '\t');
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, '').replace(/[{}]/g, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
function legacyStrings(u8) {
  // procura trechos de texto em UTF-16LE e em cp1252 dentro do binário
  const out = [];
  let cur = '';
  for (let i = 0; i + 1 < u8.length; i += 2) {
    const code = u8[i] | (u8[i + 1] << 8);
    if ((code >= 32 && code < 0x2000) || code === 10 || code === 13) cur += String.fromCharCode(code);
    else {
      if (cur.replace(/\s/g, '').length >= 6) out.push(cur);
      cur = '';
    }
  }
  if (out.join('').length < 200) {
    cur = '';
    for (let i = 0; i < u8.length; i++) {
      const b = u8[i];
      if ((b >= 32 && b < 127) || b >= 192 || b === 10 || b === 13) cur += WIN_ANSI[b];
      else {
        if (cur.replace(/\s/g, '').length >= 8) out.push(cur);
        cur = '';
      }
    }
  }
  return out
    .filter((t) => /[a-zà-ú]{3}/i.test(t) && textQuality(t) > 0.9)
    .join('\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 500000);
}

// ---- Imagens -------------------------------------------------------------------------
function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('imagem inválida'));
    img.src = src;
  });
}
function imgToCanvas(img, max) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k));
  c.height = Math.max(1, Math.round(h0 * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
async function readImage(file, u8) {
  const src = await readAsDataURL(file);
  const img = await loadImg(src);
  const big = imgToCanvas(img, 1600);
  const small = imgToCanvas(img, 360);
  let brightness = null;
  try {
    const px = small.getContext('2d').getImageData(0, 0, small.width, small.height).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 16) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    brightness = sum / (px.length / 16) / 255;
  } catch (e) {}
  return {
    dataUrl: big.toDataURL('image/jpeg', 0.86),
    thumb: small.toDataURL('image/jpeg', 0.72),
    width: img.naturalWidth,
    height: img.naturalHeight,
    exif: /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name) ? parseExif(u8) : null,
    brightness,
  };
}
function parseExif(u8) {
  try {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint16(0) !== 0xffd8) return null;
    let p = 2;
    while (p + 4 < u8.length) {
      const marker = dv.getUint16(p);
      const len = dv.getUint16(p + 2);
      if (marker === 0xffe1 && dv.getUint32(p + 4) === 0x45786966) {
        const t = p + 10;
        const le = dv.getUint16(t) === 0x4949;
        const g16 = (o) => dv.getUint16(t + o, le), g32 = (o) => dv.getUint32(t + o, le);
        const out = {};
        const readIfd = (off, tagsWanted) => {
          const n = g16(off);
          const res = {};
          for (let k = 0; k < n; k++) {
            const e = off + 2 + k * 12;
            const tag = g16(e), type = g16(e + 2), cnt = g32(e + 4);
            if (!tagsWanted.includes(tag)) continue;
            const valOff = cnt * (type === 5 ? 8 : type === 3 ? 2 : type === 4 ? 4 : 1) > 4 ? g32(e + 8) : e + 8;
            if (type === 2) {
              let s = '';
              for (let q = 0; q < cnt - 1; q++) s += String.fromCharCode(dv.getUint8(t + valOff + q));
              res[tag] = s.trim();
            } else if (type === 3) res[tag] = g16(valOff);
            else if (type === 4) res[tag] = g32(valOff);
            else if (type === 5) {
              const arr = [];
              for (let q = 0; q < cnt; q++) arr.push(g32(valOff + q * 8) / (g32(valOff + q * 8 + 4) || 1));
              res[tag] = arr;
            }
          }
          return res;
        };
        const ifd0 = readIfd(g32(4), [0x010f, 0x0110, 0x0132, 0x8769, 0x8825, 0x0112]);
        if (ifd0[0x010f]) out.make = ifd0[0x010f];
        if (ifd0[0x0110]) out.model = ifd0[0x0110];
        let dt = ifd0[0x0132];
        if (ifd0[0x8769]) {
          const ex = readIfd(ifd0[0x8769], [0x9003]);
          if (ex[0x9003]) dt = ex[0x9003];
        }
        if (dt) {
          const m = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(dt);
          if (m) out.date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toISOString();
        }
        if (ifd0[0x8825]) {
          const g = readIfd(ifd0[0x8825], [1, 2, 3, 4]);
          if (g[2] && g[4]) {
            const dec = (a) => a[0] + a[1] / 60 + a[2] / 3600;
            out.lat = +(dec(g[2]) * (g[1] === 'S' ? -1 : 1)).toFixed(6);
            out.lon = +(dec(g[4]) * (g[3] === 'W' ? -1 : 1)).toFixed(6);
          }
        }
        return Object.keys(out).length ? out : null;
      }
      if ((marker & 0xff00) !== 0xff00) break;
      p += 2 + len;
    }
  } catch (e) {}
  return null;
}

// OCR opcional (Tesseract.js, carregado sob demanda quando há internet)
async function ocrImage(dataUrl, onProgress = () => {}) {
  if (!isOnline()) throw new Error('OCR precisa de internet na primeira vez (modo estritamente offline ativo ou sem conexão).');
  const T = await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', 'Tesseract', 40000);
  const res = await T.recognize(dataUrl, 'por', {
    logger: (m) => m.status && onProgress(`${m.status.replace('recognizing text', 'reconhecendo texto')} ${m.progress ? Math.round(m.progress * 100) + '%' : ''}`),
  });
  return (res && res.data && res.data.text ? res.data.text : '').trim();
}


/* ===== 10-analyze.js ===== */
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


/* ===== 11-docmodel.js ===== */
// ---------------------------------------------------------------------------
// 11 · Modelo de documento + renderização em HTML (pré-visualização/impressão)
//      Blocos: kv, h, p, ul, ol, table, check, callout, img, gallery, sign,
//              matrix, lines, spacer, pagebreak
// ---------------------------------------------------------------------------
const DOC_BRAND = { dark: '#0f2a2e', accent: '#2dd4bf', head: '#134e4a', light: '#e8f5f3', line: '#c9d3d6', zebra: '#f5f8f8', ink: '#16232a', muted: '#5b6b70' };
const TONES = {
  info: { bar: '#2a78d6', bg: '#eef5fd', title: 'Informação' },
  ok: { bar: '#0ca30c', bg: '#eefaf0', title: 'Boa prática' },
  warn: { bar: '#eda100', bg: '#fff8e6', title: 'Atenção' },
  danger: { bar: '#d03b3b', bg: '#fdeeee', title: 'Importante' },
};

let _docSeq = 0;
function docCode(prefix) {
  const d = new Date();
  _docSeq = (_docSeq + 1) % 100;
  return `${prefix}-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(_docSeq)}`;
}
function newDoc(type, title, extra = {}) {
  return {
    id: uid('doc'), type, title, subtitle: '', code: docCode((DOC_PREFIX[type] || 'DOC').toUpperCase()), date: fmtDate(new Date()), revision: '00',
    orientation: 'portrait', company: '', blocks: [], createdAt: Date.now(), ...extra,
  };
}
const DOC_PREFIX = { apr: 'APR', pt: 'PT', dds: 'DDS', checklist: 'CHK', os: 'OS', ficha_epi: 'EPI', inspecao: 'RI', investigacao: 'INV', plano_acao: 'PA', pop: 'POP', lista_presenca: 'LP', comunicado: 'COM', treinamento: 'TRE', inventario: 'INV-R', pae: 'PAE', resumo_doc: 'ANL', chat: 'CONV', tab: 'ABA' };

// Texto de célula (string ou {text})
const cellText = (c) => (c == null ? '' : typeof c === 'object' ? String(c.text == null ? '' : c.text) : String(c));
// **negrito** → runs
function richRuns(text) {
  const runs = [];
  String(text == null ? '' : text)
    .split(/(\*\*[^*]+\*\*)/g)
    .forEach((part) => {
      if (!part) return;
      if (/^\*\*[^*]+\*\*$/.test(part)) runs.push({ text: part.slice(2, -2), bold: true });
      else runs.push({ text: part, bold: false });
    });
  return runs;
}
const mdInline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
function lumOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const inkOn = (hex) => (lumOf(hex) > 0.36 ? '#16232a' : '#ffffff');

// Converte o documento em texto simples (para copiar/Slack/busca)
function docToText(doc) {
  const out = [`${doc.title}${doc.subtitle ? ' — ' + doc.subtitle : ''}`, `${doc.code} · ${doc.date}`, ''];
  for (const b of doc.blocks) {
    if (b.t === 'h') out.push('', b.text.toUpperCase());
    else if (b.t === 'p') out.push(b.text.replace(/\*\*/g, ''));
    else if (b.t === 'kv') out.push(b.items.map(([k, v]) => `${k}: ${v || '______'}`).join(' | '));
    else if (b.t === 'ul' || b.t === 'ol') b.items.forEach((it, i) => out.push(`${b.t === 'ol' ? i + 1 + '.' : '•'} ${cellText(it).replace(/\*\*/g, '')}`));
    else if (b.t === 'table') {
      out.push(b.head.join(' | '));
      b.rows.forEach((r) => out.push(r.map(cellText).join(' | ')));
    } else if (b.t === 'check') b.items.forEach((it, i) => out.push(`${i + 1}. [ ] ${it}`));
    else if (b.t === 'callout') out.push(`${b.title || ''}: ${b.text}`);
    else if (b.t === 'sign') out.push(b.items.map((s) => `${s}: ____________`).join('   '));
  }
  return out.join('\n');
}

function renderDocHTML(doc, { forPrint = false } = {}) {
  const land = doc.orientation === 'landscape';
  const parts = [];
  const blockHTML = (b) => {
    switch (b.t) {
      case 'h':
        return `<h${b.level === 2 ? 3 : 2} class="h">${esc(b.text)}</h${b.level === 2 ? 3 : 2}>`;
      case 'p':
        return `<p>${mdInline(b.text).replace(/\n/g, '<br>')}</p>`;
      case 'ul':
      case 'ol':
        return `<${b.t}>${b.items.map((i) => `<li>${mdInline(cellText(i))}</li>`).join('')}</${b.t}>`;
      case 'kv':
        return `<div class="kv" style="grid-template-columns:repeat(${b.cols || 2},1fr)">${b.items
          .map(([k, v, span]) => `<div class="kvi"${span ? ` style="grid-column:span ${span}"` : ''}><span>${esc(k)}</span><b>${v ? esc(v) : '&nbsp;'}</b></div>`)
          .join('')}</div>`;
      case 'table': {
        const w = b.widths ? b.widths.map((x) => `<col style="width:${(x * 100).toFixed(1)}%">`).join('') : '';
        return `<table class="tb${b.small ? ' sm' : ''}"><colgroup>${w}</colgroup><thead><tr>${b.head.map((hd) => `<th>${esc(hd)}</th>`).join('')}</tr></thead><tbody>${b.rows
          .map(
            (r) =>
              `<tr>${r
                .map((c) => {
                  const o = typeof c === 'object' && c ? c : { text: c };
                  const st = o.fill ? ` style="background:${o.fill};color:${o.color || inkOn(o.fill)};font-weight:600;text-align:center"` : o.align ? ` style="text-align:${o.align}"` : '';
                  return `<td${st}>${o.box ? '<span class="box"></span>' : mdInline(o.text == null ? '' : o.text).replace(/\n/g, '<br>')}</td>`;
                })
                .join('')}</tr>`
          )
          .join('')}</tbody></table>`;
      }
      case 'check':
        return `<table class="tb ck"><thead><tr><th style="width:5%">Nº</th><th>Item verificado</th>${(b.cols || ['C', 'NC', 'NA'])
          .map((c) => `<th style="width:6%">${esc(c)}</th>`)
          .join('')}<th style="width:24%">Observação</th></tr></thead><tbody>${b.items
          .map((it, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc(it)}</td>${(b.cols || ['C', 'NC', 'NA']).map(() => '<td style="text-align:center"><span class="box"></span></td>').join('')}<td></td></tr>`)
          .join('')}</tbody></table>${b.legend ? `<p class="legend">${esc(b.legend)}</p>` : ''}`;
      case 'callout': {
        const tn = TONES[b.tone || 'info'];
        return `<div class="co" style="border-left-color:${tn.bar};background:${tn.bg}"><b>${esc(b.title || tn.title)}</b><div>${mdInline(b.text).replace(/\n/g, '<br>')}</div></div>`;
      }
      case 'img':
        return `<figure class="fig"><img src="${b.src}" style="max-width:${Math.round((b.width || 0.7) * 100)}%"><figcaption>${esc(b.caption || '')}</figcaption></figure>`;
      case 'gallery':
        return `<div class="gal" style="grid-template-columns:repeat(${b.cols || 2},1fr)">${b.items
          .map((it) => `<figure class="fig"><img src="${it.src}"><figcaption>${esc(it.caption || '')}</figcaption></figure>`)
          .join('')}</div>`;
      case 'sign':
        return `<div class="sg" style="grid-template-columns:repeat(${Math.min(3, b.items.length)},1fr)">${b.items
          .map((s) => `<div><div class="ln"></div><b>${esc(s)}</b><span>Nome: ______________________</span><span>Data: ____/____/______</span></div>`)
          .join('')}</div>`;
      case 'matrix': {
        let rows = '';
        for (let p = 5; p >= 1; p--) {
          rows += `<tr><th>${p}</th>`;
          for (let s = 1; s <= 5; s++) {
            const rl = riskLevel(p, s);
            rows += `<td style="background:${rl.cor};color:${inkOn(rl.cor)}">${p * s}</td>`;
          }
          rows += '</tr>';
        }
        return `<div class="mx"><table><tbody>${rows}<tr><th></th>${[1, 2, 3, 4, 5].map((s) => `<th>${s}</th>`).join('')}</tr></tbody></table><div class="mxl"><b>Probabilidade (P)</b> × <b>Severidade (S)</b><br>1–4 Baixo · 5–9 Moderado · 10–16 Alto · 20–25 Crítico<br><small>P: 1 rara · 2 improvável · 3 possível · 4 provável · 5 quase certa<br>S: 1 insignificante · 2 leve · 3 moderada · 4 grave · 5 catastrófica</small></div></div>`;
      }
      case 'lines':
        return `<div class="lines">${b.label ? `<b>${esc(b.label)}</b>` : ''}${'<div class="l"></div>'.repeat(b.n || 3)}</div>`;
      case 'spacer':
        return `<div style="height:${b.h || 10}px"></div>`;
      case 'pagebreak':
        return '<div class="pb"></div>';
      default:
        return '';
    }
  };
  for (const b of doc.blocks) parts.push(blockHTML(b));
  const css = `
  @page{size:A4 ${land ? 'landscape' : 'portrait'};margin:11mm}
  *{box-sizing:border-box} body{margin:0;background:${forPrint ? '#fff' : '#e9eef0'};font:10.5px/1.45 "Segoe UI",Helvetica,Arial,sans-serif;color:${DOC_BRAND.ink}}
  .page{background:#fff;max-width:${land ? 1120 : 800}px;margin:${forPrint ? 0 : '18px auto'};padding:${forPrint ? 0 : '26px 30px'};box-shadow:${forPrint ? 'none' : '0 6px 30px rgba(0,0,0,.12)'};border-radius:${forPrint ? 0 : 6}px}
  .hd{display:flex;gap:14px;align-items:center;background:${DOC_BRAND.dark};color:#fff;border-radius:8px;padding:12px 16px;border-bottom:3px solid ${DOC_BRAND.accent};-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .hd .t{flex:1} .hd h1{margin:0;font-size:17px;letter-spacing:.2px} .hd .st{color:#99f6e4;font-size:11.5px;margin-top:2px}
  .hd .br{font-size:10px;opacity:.85;font-weight:700;letter-spacing:.5px} .hd .mt{text-align:right;font-size:10px;line-height:1.5;opacity:.95}
  .h{font-size:12.5px;color:${DOC_BRAND.head};border-bottom:1.5px solid ${DOC_BRAND.accent};padding-bottom:3px;margin:16px 0 8px;text-transform:uppercase;letter-spacing:.3px} h3.h{font-size:11.5px;text-transform:none}
  p{margin:6px 0} ul,ol{margin:6px 0 6px 18px;padding:0} li{margin:2px 0}
  .kv{display:grid;gap:0;border:1px solid ${DOC_BRAND.line};border-radius:6px;overflow:hidden;margin:10px 0}
  .kvi{padding:5px 8px;border-right:1px solid ${DOC_BRAND.line};border-bottom:1px solid ${DOC_BRAND.line};min-height:34px} .kvi span{display:block;font-size:8.5px;text-transform:uppercase;color:${DOC_BRAND.muted};letter-spacing:.4px} .kvi b{font-weight:600}
  table.tb{width:100%;border-collapse:collapse;margin:8px 0;table-layout:fixed} .tb th{background:${DOC_BRAND.head};color:#fff;font-size:9.5px;text-align:left;padding:5px 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .tb td{border:1px solid ${DOC_BRAND.line};padding:5px 6px;vertical-align:top;font-size:9.8px;word-wrap:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact} .tb tbody tr:nth-child(even) td{background-color:${DOC_BRAND.zebra}}
  .tb.sm td{font-size:9px} .tb thead{display:table-header-group} .tb tr{break-inside:avoid}
  .box{display:inline-block;width:11px;height:11px;border:1.2px solid #445;border-radius:2px}
  .co{border-left:4px solid;border-radius:6px;padding:8px 12px;margin:10px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact} .co b{display:block;margin-bottom:2px}
  .fig{margin:10px 0;text-align:center;break-inside:avoid} .fig img{border-radius:6px;border:1px solid ${DOC_BRAND.line};max-height:360px} .fig figcaption{font-size:9.5px;color:${DOC_BRAND.muted};margin-top:4px}
  .gal{display:grid;gap:12px} .gal img{width:100%;max-height:260px;object-fit:contain}
  .sg{display:grid;gap:24px;margin:28px 0 8px;break-inside:avoid} .sg>div{display:flex;flex-direction:column;gap:3px;font-size:9.5px} .sg .ln{border-bottom:1px solid #333;height:34px}
  .mx{display:flex;gap:16px;align-items:center;margin:10px 0;break-inside:avoid} .mx table{border-collapse:collapse} .mx td,.mx th{width:26px;height:20px;text-align:center;font-size:9px;border:1px solid #fff;-webkit-print-color-adjust:exact;print-color-adjust:exact} .mxl{font-size:9.5px;line-height:1.5}
  .lines .l{border-bottom:1px solid #999;height:22px} .legend{font-size:9px;color:${DOC_BRAND.muted}}
  .pb{break-after:page;height:0} .ft{margin-top:18px;border-top:1px solid ${DOC_BRAND.line};padding-top:6px;font-size:8.5px;color:${DOC_BRAND.muted};display:flex;justify-content:space-between}
  @media print{.page{box-shadow:none;margin:0;padding:0}}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(doc.title)} ${esc(doc.code)}</title><style>${css}</style></head><body><div class="page">
  <div class="hd"><div class="t"><div class="br">OPS 360°${doc.company ? ' · ' + esc(doc.company) : ''}</div><h1>${esc(doc.title)}</h1>${doc.subtitle ? `<div class="st">${esc(doc.subtitle)}</div>` : ''}</div>
  <div class="mt">Código: <b>${esc(doc.code)}</b><br>Data: ${esc(doc.date)}<br>Revisão: ${esc(doc.revision)}</div></div>
  ${parts.join('\n')}
  <div class="ft"><span>OPS 360° IA · gerado em ${fmtDateTime(new Date())} · revise e valide com o responsável técnico antes do uso</span><span>${esc(doc.code)}</span></div>
  </div></body></html>`;
}

// Impressão via iframe oculto (permite "Salvar como PDF" pelo navegador)
function printHTML(html) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(f);
  const d = f.contentDocument;
  d.open();
  d.write(html);
  d.close();
  setTimeout(() => {
    try {
      f.contentWindow.focus();
      f.contentWindow.print();
    } catch (e) {
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
        w.print();
      }
    }
    setTimeout(() => f.remove(), 60000);
  }, 350);
}


/* ===== 12-pdfwrite.js ===== */
// ---------------------------------------------------------------------------
// 12 · Gerador de PDF nativo (download direto, sem bibliotecas, 100% offline)
//      Fontes padrão Helvetica (WinAnsi) + ZapfDingbats, imagens JPEG,
//      tabelas com quebra de página e cabeçalho repetido, rodapé paginado.
// ---------------------------------------------------------------------------
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const HELV_SPECIAL = {
  '€': [556, 556], '‚': [222, 278], 'ƒ': [556, 556], '„': [333, 500], '…': [1000, 1000], '†': [556, 556], '‡': [556, 556], 'ˆ': [333, 333], '‰': [1000, 1000],
  '‹': [333, 333], 'Œ': [1000, 1000], '‘': [222, 278], '’': [222, 278], '“': [333, 500], '”': [333, 500], '•': [350, 350], '–': [556, 556], '—': [1000, 1000],
  '˜': [333, 333], '™': [1000, 1000], '›': [333, 333], 'œ': [944, 944], ' ': [278, 278], '¡': [333, 333], '¢': [556, 556], '£': [556, 556], '¤': [556, 556],
  '¥': [556, 556], '¦': [260, 280], '§': [556, 556], '¨': [333, 333], '©': [737, 737], 'ª': [370, 370], '«': [556, 556], '¬': [584, 584], '­': [333, 333],
  '®': [737, 737], '¯': [333, 333], '°': [400, 400], '±': [584, 584], '²': [333, 333], '³': [333, 333], '´': [333, 333], 'µ': [556, 611], '¶': [537, 556],
  '·': [278, 278], '¸': [333, 333], '¹': [333, 333], 'º': [365, 365], '»': [556, 556], '¼': [834, 834], '½': [834, 834], '¾': [834, 834], '¿': [611, 611],
  'Æ': [1000, 1000], 'Ð': [722, 722], '×': [584, 584], 'Ø': [778, 778], 'Þ': [667, 667], 'ß': [611, 611], 'æ': [889, 889], 'ð': [556, 611], '÷': [584, 584], 'ø': [611, 611], 'þ': [556, 611],
};
const CP1252 = new Map();
for (let i = 0; i < 256; i++) if (!CP1252.has(WIN_ANSI[i])) CP1252.set(WIN_ANSI[i], i);
const TRANSLIT = {
  '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '↑': '^', '↓': 'v', '⇒': '=>', '✓': 'OK', '✔': 'OK', '✗': 'X', '✘': 'X', '☐': '[ ]', '☑': '[x]', '⚠': '!', '≈': '~', '≠': '!=',
  '−': '-', '′': "'", '″': '"', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', 'ﬁ': 'fi', 'ﬂ': 'fl', 'Δ': 'D', 'Ω': 'Ohm', 'α': 'a', 'β': 'b', 'μ': 'µ',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '‑': '-', '‐': '-', '‒': '-', '―': '—', '●': '•', '▪': '•', '■': '•', '◆': '•', '★': '*', '·': '·',
};
function pdfSanitize(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    if (ch === '\t') out += '    ';
    else if (ch === '\n') out += '\n';
    else if (ch === '\r') continue;
    else if (CP1252.has(ch) && ch.charCodeAt(0) >= 32) out += ch;
    else if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else {
      const base = ch.normalize('NFD')[0];
      if (base && CP1252.has(base) && base.charCodeAt(0) >= 32 && base !== ch) out += base;
      // emojis e símbolos fora do WinAnsi são removidos
    }
  }
  return out;
}
function helvWidth(ch, bold) {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return (bold ? HELV_B : HELV)[c - 32];
  const sp = HELV_SPECIAL[ch];
  if (sp) return sp[bold ? 1 : 0];
  const base = ch.normalize('NFD')[0];
  if (base === 'i' || base === 'I') return 278;
  const bc = base.charCodeAt(0);
  if (bc >= 32 && bc <= 126) return (bold ? HELV_B : HELV)[bc - 32];
  return 556;
}
function textWidth(s, size, bold) {
  let w = 0;
  for (const ch of s) w += helvWidth(ch, bold);
  return (w * size) / 1000;
}
function pdfEscape(s) {
  let out = '';
  for (const ch of s) {
    const c = CP1252.get(ch);
    if (c === undefined) continue;
    if (c === 40 || c === 41 || c === 92) out += '\\' + ch;
    else if (c < 32 || c > 126) out += '\\' + c.toString(8).padStart(3, '0');
    else out += ch;
  }
  return out;
}
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#000000');
  const n = parseInt(m ? m[1] : '000000', 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => +v.toFixed(3));
}
const n2 = (v) => +(+v).toFixed(2);

// JPEG: dimensões e componentes a partir do marcador SOF
function jpegInfo(u8) {
  let p = 2;
  while (p + 9 < u8.length) {
    if (u8[p] !== 0xff) {
      p++;
      continue;
    }
    const m = u8[p + 1];
    const len = (u8[p + 2] << 8) | u8[p + 3];
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { h: (u8[p + 5] << 8) | u8[p + 6], w: (u8[p + 7] << 8) | u8[p + 8], comps: u8[p + 9] };
    }
    p += 2 + len;
  }
  return null;
}
async function toJpegBytes(src) {
  if (/^data:image\/jpe?g/i.test(src)) {
    const bytes = dataUrlToBytes(src);
    const info = jpegInfo(bytes);
    if (info && info.comps === 3) return { bytes, w: info.w, h: info.h };
  }
  const img = await loadImg(src);
  const c = imgToCanvas(img, 1600);
  const bytes = dataUrlToBytes(c.toDataURL('image/jpeg', 0.88));
  return { bytes, w: c.width, h: c.height };
}
async function prepareDocImages(doc) {
  const map = new Map();
  let k = 0;
  for (const b of doc.blocks) {
    const srcs = b.t === 'img' ? [b.src] : b.t === 'gallery' ? b.items.map((i) => i.src) : [];
    for (const s of srcs) {
      if (!s || map.has(s)) continue;
      try {
        const j = await toJpegBytes(s);
        map.set(s, { ...j, name: 'Im' + ++k });
      } catch (e) {
        console.warn('[OPS360IA] imagem ignorada no PDF', e);
      }
    }
  }
  return map;
}

class PdfLayout {
  constructor(doc, images) {
    this.doc = doc;
    this.images = images || new Map();
    this.land = doc.orientation === 'landscape';
    this.W = this.land ? 841.89 : 595.28;
    this.H = this.land ? 595.28 : 841.89;
    this.m = { l: 34, r: 34, t: 32, b: 44 };
    this.cw = this.W - this.m.l - this.m.r;
    this.base = this.land ? 8.6 : 9.2;
    this.pages = [];
    this.newPage(true);
  }
  get bottom() {
    return this.H - this.m.b;
  }
  newPage(first = false) {
    this.p = { ops: [], images: new Set() };
    this.pages.push(this.p);
    this.y = this.m.t;
    if (first) this.mainHeader();
    else this.smallHeader();
  }
  ensure(h) {
    if (this.y + h > this.bottom) {
      this.newPage();
      return true;
    }
    return false;
  }
  op(s) {
    this.p.ops.push(s);
  }
  rect(x, y, w, h, { fill, stroke, lw = 0.6 } = {}) {
    const Y = this.H - y - h;
    if (fill) this.op(`${hexToRgb(fill).join(' ')} rg`);
    if (stroke) this.op(`${hexToRgb(stroke).join(' ')} RG ${lw} w`);
    this.op(`${n2(x)} ${n2(Y)} ${n2(w)} ${n2(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
  }
  roundRect(x, y, w, h, r, { fill, stroke, lw = 0.6 } = {}) {
    const Y = this.H - y - h, k = 0.5523 * r;
    if (fill) this.op(`${hexToRgb(fill).join(' ')} rg`);
    if (stroke) this.op(`${hexToRgb(stroke).join(' ')} RG ${lw} w`);
    this.op(
      [
        `${n2(x + r)} ${n2(Y)} m`, `${n2(x + w - r)} ${n2(Y)} l`, `${n2(x + w - r + k)} ${n2(Y)} ${n2(x + w)} ${n2(Y + r - k)} ${n2(x + w)} ${n2(Y + r)} c`,
        `${n2(x + w)} ${n2(Y + h - r)} l`, `${n2(x + w)} ${n2(Y + h - r + k)} ${n2(x + w - r + k)} ${n2(Y + h)} ${n2(x + w - r)} ${n2(Y + h)} c`,
        `${n2(x + r)} ${n2(Y + h)} l`, `${n2(x + r - k)} ${n2(Y + h)} ${n2(x)} ${n2(Y + h - r + k)} ${n2(x)} ${n2(Y + h - r)} c`,
        `${n2(x)} ${n2(Y + r)} l`, `${n2(x)} ${n2(Y + r - k)} ${n2(x + r - k)} ${n2(Y)} ${n2(x + r)} ${n2(Y)} c`, fill && stroke ? 'b' : fill ? 'f' : 's',
      ].join(' ')
    );
  }
  line(x1, y1, x2, y2, { stroke = DOC_BRAND.line, lw = 0.5 } = {}) {
    this.op(`${hexToRgb(stroke).join(' ')} RG ${lw} w ${n2(x1)} ${n2(this.H - y1)} m ${n2(x2)} ${n2(this.H - y2)} l S`);
  }
  // y = linha de base medida a partir do topo
  text(str, x, y, { size = this.base, bold = false, italic = false, color = DOC_BRAND.ink, align = 'left', font } = {}) {
    const s = pdfSanitize(str);
    if (!s) return 0;
    const w = textWidth(s, size, bold);
    const xx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const f = font || (bold ? 'F2' : italic ? 'F3' : 'F1');
    this.op(`BT ${hexToRgb(color).join(' ')} rg /${f} ${n2(size)} Tf 1 0 0 1 ${n2(xx)} ${n2(this.H - y)} Tm (${pdfEscape(s)}) Tj ET`);
    return w;
  }
  check(x, y, size = 8) {
    this.op(`BT ${hexToRgb(DOC_BRAND.head).join(' ')} rg /F4 ${size} Tf 1 0 0 1 ${n2(x)} ${n2(this.H - y)} Tm (4) Tj ET`);
  }
  wrap(text, size, bold, maxW) {
    const out = [];
    for (const para of pdfSanitize(text).split('\n')) {
      let line = '';
      for (const w of para.split(' ')) {
        const cand = line ? line + ' ' + w : w;
        if (textWidth(cand, size, bold) <= maxW) {
          line = cand;
          continue;
        }
        if (line) out.push(line);
        if (textWidth(w, size, bold) > maxW) {
          let part = '';
          for (const ch of w) {
            if (textWidth(part + ch, size, bold) > maxW && part) {
              out.push(part);
              part = ch;
            } else part += ch;
          }
          line = part;
        } else line = w;
      }
      out.push(line);
    }
    return out;
  }
  wrapRuns(runs, size, maxW) {
    const lines = [[]];
    let w = 0;
    for (const r of runs) {
      const parts = pdfSanitize(r.text).split(/(\n| )/);
      for (const part of parts) {
        if (part === '\n') {
          lines.push([]);
          w = 0;
          continue;
        }
        if (part === '') continue;
        const pw = textWidth(part, size, r.bold);
        if (part === ' ') {
          if (w > 0) {
            lines[lines.length - 1].push({ text: ' ', bold: r.bold });
            w += pw;
          }
          continue;
        }
        if (w + pw > maxW && w > 0) {
          const cur = lines[lines.length - 1];
          while (cur.length && cur[cur.length - 1].text === ' ') cur.pop();
          lines.push([]);
          w = 0;
        }
        lines[lines.length - 1].push({ text: part, bold: r.bold });
        w += pw;
      }
    }
    return lines;
  }
  mainHeader() {
    const d = this.doc, x = this.m.l, w = this.cw;
    const metaW = 150;
    const titleLines = this.wrap(d.title, 15, true, w - metaW - 40).slice(0, 2);
    const subLines = d.subtitle ? this.wrap(d.subtitle, 9, false, w - metaW - 40).slice(0, 2) : [];
    const h = 30 + titleLines.length * 18 + subLines.length * 11 + 6;
    this.roundRect(x, this.y, w, h, 7, { fill: DOC_BRAND.dark });
    this.rect(x + 7, this.y + h - 3, w - 14, 3, { fill: DOC_BRAND.accent });
    this.text('OPS 360°' + (d.company ? '  ·  ' + d.company : ''), x + 16, this.y + 17, { size: 7.5, bold: true, color: '#99f6e4' });
    let yy = this.y + 36;
    for (const tl of titleLines) {
      this.text(tl, x + 16, yy, { size: 15, bold: true, color: '#ffffff' });
      yy += 18;
    }
    for (const sl of subLines) {
      this.text(sl, x + 16, yy - 2, { size: 9, color: '#99f6e4' });
      yy += 11;
    }
    const rx = x + w - 16;
    this.text(`Código: ${d.code}`, rx, this.y + 20, { size: 8, color: '#ffffff', align: 'right' });
    this.text(`Data: ${d.date}`, rx, this.y + 32, { size: 8, color: '#ffffff', align: 'right' });
    this.text(`Revisão: ${d.revision}`, rx, this.y + 44, { size: 8, color: '#ffffff', align: 'right' });
    this.y += h + 12;
  }
  smallHeader() {
    const d = this.doc;
    this.text(truncate(d.title + (d.subtitle ? ' — ' + d.subtitle : ''), 110), this.m.l, this.y + 9, { size: 8, bold: true, color: DOC_BRAND.head });
    this.text(d.code, this.m.l + this.cw, this.y + 9, { size: 7.5, color: DOC_BRAND.muted, align: 'right' });
    this.line(this.m.l, this.y + 14, this.m.l + this.cw, this.y + 14, { stroke: DOC_BRAND.accent, lw: 0.8 });
    this.y += 24;
  }
  footers() {
    const total = this.pages.length;
    const stamp = fmtDateTime(new Date());
    this.pages.forEach((pg, i) => {
      this.p = pg;
      const y = this.H - this.m.b + 18;
      this.line(this.m.l, y - 9, this.m.l + this.cw, y - 9);
      this.text(`OPS 360° IA · gerado em ${stamp} · revise e valide com o responsável técnico antes do uso`, this.m.l, y, { size: 6.8, color: DOC_BRAND.muted });
      this.text(`Página ${i + 1} de ${total}`, this.m.l + this.cw, y, { size: 7, bold: true, color: DOC_BRAND.muted, align: 'right' });
    });
  }

  // ---- blocos ----
  render() {
    for (const b of this.doc.blocks) {
      const fn = this['b_' + b.t];
      if (fn) fn.call(this, b);
    }
    this.footers();
  }
  b_h(b) {
    const size = b.level === 2 ? 9.8 : 10.8;
    this.ensure(size * 2 + 26);
    this.y += b.level === 2 ? 6 : 10;
    const lines = this.wrap(b.level === 2 ? b.text : b.text.toUpperCase(), size, true, this.cw);
    for (const l of lines) {
      this.y += size + 2;
      this.text(l, this.m.l, this.y, { size, bold: true, color: DOC_BRAND.head });
    }
    if (b.level !== 2) this.line(this.m.l, this.y + 4, this.m.l + this.cw, this.y + 4, { stroke: DOC_BRAND.accent, lw: 1.1 });
    this.y += 10;
  }
  paraLines(lines, x, size, lh, color = DOC_BRAND.ink) {
    for (const ln of lines) {
      this.ensure(lh);
      this.y += lh;
      let xx = x;
      for (const r of ln) xx += this.text(r.text, xx, this.y - lh * 0.24, { size, bold: r.bold, color }) || textWidth(pdfSanitize(r.text), size, r.bold);
    }
  }
  b_p(b) {
    const size = b.size || this.base, lh = size * 1.42;
    this.paraLines(this.wrapRuns(richRuns(b.text), size, this.cw), this.m.l, size, lh);
    this.y += 4;
  }
  b_ul(b, ordered = false) {
    const size = this.base, lh = size * 1.4;
    b.items.forEach((it, i) => {
      const lines = this.wrapRuns(richRuns(cellText(it)), size, this.cw - 16);
      this.ensure(lh);
      const bullet = ordered ? `${i + 1}.` : '•';
      this.text(bullet, this.m.l + 3, this.y + lh - lh * 0.24, { size, bold: ordered, color: DOC_BRAND.head });
      this.paraLines(lines, this.m.l + 16, size, lh);
      this.y += 1.5;
    });
    this.y += 4;
  }
  b_ol(b) {
    this.b_ul(b, true);
  }
  b_kv(b) {
    const cols = b.cols || 2, cellW = this.cw / cols, pad = 5;
    const rows = [];
    let row = [], used = 0;
    for (const it of b.items) {
      const span = Math.min(cols, it[2] || 1);
      if (used + span > cols) {
        rows.push(row);
        row = [];
        used = 0;
      }
      row.push({ k: it[0], v: it[1], span });
      used += span;
    }
    if (row.length) rows.push(row);
    this.y += 4;
    for (const r of rows) {
      const cells = r.map((c) => ({ ...c, lines: c.v ? this.wrap(String(c.v), 8.8, true, cellW * c.span - pad * 2) : [] }));
      const h = Math.max(30, ...cells.map((c) => 17 + Math.max(1, c.lines.length) * 11.5));
      this.ensure(h);
      let x = this.m.l;
      for (const c of cells) {
        const w = cellW * c.span;
        this.rect(x, this.y, w, h, { stroke: DOC_BRAND.line, lw: 0.6 });
        this.text(String(c.k).toUpperCase(), x + pad, this.y + 10, { size: 6.4, bold: true, color: DOC_BRAND.muted });
        let yy = this.y + 22;
        for (const l of c.lines) {
          this.text(l, x + pad, yy, { size: 8.8, bold: true });
          yy += 11.5;
        }
        x += w;
      }
      if (x < this.m.l + this.cw - 1) this.rect(x, this.y, this.m.l + this.cw - x, h, { stroke: DOC_BRAND.line, lw: 0.6 });
      this.y += h;
    }
    this.y += 8;
  }
  autoWidths(head, rows, size) {
    const n = head.length, pad = 8;
    const desired = head.map((hd, i) => {
      let w = textWidth(pdfSanitize(hd), size, true);
      for (const r of rows.slice(0, 40)) {
        const c = r[i];
        const t = cellText(c);
        w = Math.max(w, Math.min(textWidth(pdfSanitize(t), size, false), 260));
      }
      return Math.max(28, w + pad);
    });
    const sum = desired.reduce((a, b) => a + b, 0);
    if (sum <= this.cw) return desired.map((d) => (d * this.cw) / sum);
    const cap = this.cw / n;
    const small = desired.map((d) => d <= cap * 0.75);
    const fixed = desired.reduce((a, d, i) => a + (small[i] ? d : 0), 0);
    const flexSum = desired.reduce((a, d, i) => a + (small[i] ? 0 : Math.sqrt(d)), 0);
    return desired.map((d, i) => (small[i] ? d : ((this.cw - fixed) * Math.sqrt(d)) / flexSum));
  }
  b_table(b) {
    const size = b.fontSize || (b.small ? this.base - 1.2 : this.base - 0.6);
    const lh = size * 1.3, pad = 4;
    const n = b.head.length;
    let widths = b.widths ? b.widths.map((w) => (w * this.cw) / b.widths.reduce((a, c) => a + c, 0)) : this.autoWidths(b.head, b.rows, size);
    const headLines = b.head.map((hd, i) => this.wrap(hd, size, true, widths[i] - pad * 2));
    const headH = Math.max(...headLines.map((l) => l.length)) * lh + pad * 2;
    const drawHead = () => {
      this.rect(this.m.l, this.y, this.cw, headH, { fill: DOC_BRAND.head });
      let x = this.m.l;
      headLines.forEach((ls, i) => {
        ls.forEach((l, k) => this.text(l, x + pad, this.y + pad + size * 0.95 + k * lh, { size, bold: true, color: '#ffffff' }));
        x += widths[i];
      });
      this.y += headH;
    };
    this.y += 2;
    // evita cabeçalho "órfão" no pé da página: reserva espaço para a 1ª linha também
    const firstRowLines = b.rows.length ? Math.max(1, ...b.head.map((_, i) => {
      const c = b.rows[0][i];
      const o = c && typeof c === 'object' ? c : { text: c };
      return o.box ? 1 : this.wrap(cellText(o), size, !!(o.bold || o.fill), widths[i] - pad * 2).length;
    })) : 1;
    this.ensure(headH + Math.min(firstRowLines, 12) * lh + pad * 2 + 4);
    drawHead();
    const maxLines = Math.max(3, Math.floor((this.bottom - (this.m.t + 24) - headH - pad * 2) / lh) - 1);
    let zebra = 0;
    for (const r of b.rows) {
      const cells = Array.from({ length: n }, (_, i) => {
        const c = r[i];
        const o = c && typeof c === 'object' ? c : { text: c };
        return { o, lines: o.box ? [''] : this.wrap(cellText(o), size, !!(o.bold || o.fill), widths[i] - pad * 2) };
      });
      const segs = Math.max(1, ...cells.map((c) => Math.ceil(c.lines.length / maxLines)));
      for (let sgi = 0; sgi < segs; sgi++) {
        const part = cells.map((c) => ({ o: c.o, lines: c.lines.slice(sgi * maxLines, (sgi + 1) * maxLines) }));
        const rowH = Math.max(lh + pad * 2, ...part.map((c) => c.lines.length * lh + pad * 2));
        if (this.y + rowH > this.bottom) {
          this.newPage();
          drawHead();
        }
        if (zebra % 2 === 1) this.rect(this.m.l, this.y, this.cw, rowH, { fill: DOC_BRAND.zebra });
        let x = this.m.l;
        part.forEach((c, i) => {
          const w = widths[i], o = c.o;
          if (o.fill) this.rect(x, this.y, w, rowH, { fill: o.fill });
          const color = o.fill ? o.color || inkOn(o.fill) : o.color || DOC_BRAND.ink;
          if (o.box) {
            this.rect(x + w / 2 - 4.5, this.y + rowH / 2 - 4.5, 9, 9, { stroke: '#445566', lw: 0.8 });
            if (o.checked) this.check(x + w / 2 - 3.6, this.y + rowH / 2 + 3, 7.5);
          } else {
            const center = o.fill || o.align === 'center';
            c.lines.forEach((l, k) =>
              this.text(l, center ? x + w / 2 : o.align === 'right' ? x + w - pad : x + pad, this.y + pad + size * 0.95 + k * lh, { size, bold: !!(o.bold || o.fill), color, align: center ? 'center' : o.align === 'right' ? 'right' : 'left' })
            );
          }
          if (i > 0) this.line(x, this.y, x, this.y + rowH);
          x += w;
        });
        this.rect(this.m.l, this.y, this.cw, rowH, { stroke: DOC_BRAND.line, lw: 0.5 });
        this.y += rowH;
      }
      zebra++;
    }
    this.y += 8;
  }
  b_check(b) {
    const cols = b.cols || ['C', 'NC', 'NA'];
    const land = this.land;
    const head = ['Nº', 'Item verificado', ...cols, 'Observação'];
    const widths = [0.05, land ? 0.55 : 0.5, ...cols.map(() => 0.065), land ? 0.205 : 0.255];
    this.b_table({ head, widths, rows: b.items.map((it, i) => [{ text: String(i + 1), align: 'center' }, it, ...cols.map(() => ({ box: true })), '']) });
    if (b.legend) this.b_p({ text: b.legend, size: this.base - 1.5 });
  }
  b_callout(b) {
    const tn = TONES[b.tone || 'info'];
    const size = this.base, lh = size * 1.4;
    const lines = this.wrapRuns(richRuns(b.text), size, this.cw - 26);
    const h = 16 + 8 + lines.length * lh + 6;
    this.ensure(Math.min(h, 200));
    const y0 = this.y + 3;
    this.roundRect(this.m.l, y0, this.cw, h, 5, { fill: tn.bg });
    this.rect(this.m.l, y0, 4, h, { fill: tn.bar });
    this.text(b.title || tn.title, this.m.l + 14, y0 + 15, { size: size + 0.4, bold: true });
    this.y = y0 + 17;
    this.paraLines(lines, this.m.l + 14, size, lh);
    this.y = Math.max(this.y, y0 + h) + 8;
  }
  drawImage(src, x, y, w, h) {
    const im = this.images.get(src);
    if (!im) return false;
    this.p.images.add(im.name);
    this.op(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(this.H - y - h)} cm /${im.name} Do Q`);
    return true;
  }
  fitImage(src, maxW, maxH) {
    const im = this.images.get(src);
    if (!im) return null;
    const k = Math.min(maxW / im.w, maxH / im.h, 1.6);
    return { w: im.w * k, h: im.h * k };
  }
  b_img(b) {
    const maxW = this.cw * (b.width || 0.7), maxH = this.land ? 300 : 360;
    const sz = this.fitImage(b.src, maxW, maxH);
    if (!sz) return;
    this.ensure(sz.h + 24);
    const x = this.m.l + (this.cw - sz.w) / 2;
    this.drawImage(b.src, x, this.y + 4, sz.w, sz.h);
    this.rect(x, this.y + 4, sz.w, sz.h, { stroke: DOC_BRAND.line, lw: 0.6 });
    this.y += sz.h + 8;
    if (b.caption) {
      for (const l of this.wrap(b.caption, 8, false, this.cw)) {
        this.y += 10;
        this.text(l, this.m.l + this.cw / 2, this.y, { size: 8, italic: true, color: DOC_BRAND.muted, align: 'center' });
      }
    }
    this.y += 10;
  }
  b_gallery(b) {
    const cols = b.cols || 2, gap = 12;
    const cellW = (this.cw - gap * (cols - 1)) / cols, maxH = this.land ? 210 : 230;
    for (let i = 0; i < b.items.length; i += cols) {
      const rowItems = b.items.slice(i, i + cols);
      const sizes = rowItems.map((it) => this.fitImage(it.src, cellW, maxH) || { w: 0, h: 0 });
      const capLines = rowItems.map((it) => (it.caption ? this.wrap(it.caption, 7.8, false, cellW) : []));
      const h = Math.max(...sizes.map((s) => s.h)) + 10 + Math.max(0, ...capLines.map((c) => c.length)) * 10;
      this.ensure(h + 6);
      rowItems.forEach((it, k) => {
        const x = this.m.l + k * (cellW + gap) + (cellW - sizes[k].w) / 2;
        if (sizes[k].w) {
          this.drawImage(it.src, x, this.y + 2, sizes[k].w, sizes[k].h);
          this.rect(x, this.y + 2, sizes[k].w, sizes[k].h, { stroke: DOC_BRAND.line, lw: 0.6 });
        }
        let yy = this.y + Math.max(...sizes.map((s) => s.h)) + 12;
        for (const l of capLines[k]) {
          this.text(l, this.m.l + k * (cellW + gap) + cellW / 2, yy, { size: 7.8, italic: true, color: DOC_BRAND.muted, align: 'center' });
          yy += 10;
        }
      });
      this.y += h + 6;
    }
  }
  b_sign(b) {
    const per = Math.min(3, b.items.length), gap = 22;
    const w = (this.cw - gap * (per - 1)) / per;
    for (let i = 0; i < b.items.length; i += per) {
      this.ensure(78);
      this.y += 30;
      b.items.slice(i, i + per).forEach((s, k) => {
        const x = this.m.l + k * (w + gap);
        this.line(x, this.y, x + w, this.y, { stroke: '#333333', lw: 0.7 });
        this.text(s, x, this.y + 11, { size: 8.4, bold: true });
        this.text('Nome: ______________________________', x, this.y + 23, { size: 7.6, color: DOC_BRAND.muted });
        this.text('Data: ____/____/________', x, this.y + 34, { size: 7.6, color: DOC_BRAND.muted });
      });
      this.y += 44;
    }
  }
  b_matrix() {
    const cell = 20, x0 = this.m.l + 14;
    this.ensure(cell * 6 + 20);
    const y0 = this.y + 6;
    for (let p = 5; p >= 1; p--) {
      const yy = y0 + (5 - p) * (cell - 4);
      this.text(String(p), x0 - 9, yy + 11, { size: 7, bold: true, color: DOC_BRAND.muted });
      for (let s = 1; s <= 5; s++) {
        const rl = riskLevel(p, s);
        this.rect(x0 + (s - 1) * cell, yy, cell - 1.5, cell - 5.5, { fill: rl.cor });
        this.text(String(p * s), x0 + (s - 1) * cell + (cell - 1.5) / 2, yy + 10.5, { size: 7, bold: true, color: inkOn(rl.cor), align: 'center' });
      }
    }
    for (let s = 1; s <= 5; s++) this.text(String(s), x0 + (s - 1) * cell + 9, y0 + 5 * (cell - 4) + 8, { size: 7, bold: true, color: DOC_BRAND.muted, align: 'center' });
    const lx = x0 + 5 * cell + 18;
    const legend = [
      [true, 'Matriz de risco — Probabilidade (P, linhas) × Severidade (S, colunas)'],
      [false, '1–4 Baixo  ·  5–9 Moderado  ·  10–16 Alto  ·  20–25 Crítico'],
      [false, 'P: 1 rara · 2 improvável · 3 possível · 4 provável · 5 quase certa'],
      [false, 'S: 1 insignificante · 2 leve · 3 moderada (afastamento) · 4 grave · 5 catastrófica'],
      [false, 'Riscos Alto/Crítico exigem medidas antes do início e liberação formal.'],
    ];
    legend.forEach(([bold, t], i) => this.text(t, lx, y0 + 12 + i * 13, { size: 8, bold, color: bold ? DOC_BRAND.head : DOC_BRAND.ink }));
    this.y = y0 + 5 * (cell - 4) + 20;
  }
  b_lines(b) {
    if (b.label) {
      this.ensure(30);
      this.y += 12;
      this.text(b.label, this.m.l, this.y, { size: this.base, bold: true });
    }
    for (let i = 0; i < (b.n || 3); i++) {
      this.ensure(20);
      this.y += 19;
      this.line(this.m.l, this.y, this.m.l + this.cw, this.y, { stroke: '#9aa5a9', lw: 0.5 });
    }
    this.y += 8;
  }
  b_spacer(b) {
    this.y += b.h || 10;
  }
  b_pagebreak() {
    this.newPage();
  }
}

async function docToPDF(doc) {
  const images = await prepareDocImages(doc);
  const L = new PdfLayout(doc, images);
  L.render();
  // ---- montagem do arquivo ----
  const objs = [];
  const add = (o) => (objs.push(o), objs.length);
  const catalog = add(null), pagesObj = add(null);
  const fonts = {
    F1: add({ body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' }),
    F2: add({ body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>' }),
    F3: add({ body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>' }),
    F4: add({ body: '<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>' }),
  };
  const imgIds = {};
  for (const im of images.values()) {
    imgIds[im.name] = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`, stream: im.bytes });
  }
  const fontRes = Object.entries(fonts).map(([k, id]) => `/${k} ${id} 0 R`).join(' ');
  const pageIds = [];
  for (const pg of L.pages) {
    const raw = latin1Bytes(pg.ops.join('\n'));
    const z = await deflate(raw);
    const contentId = z ? add({ dict: `<< /Length ${z.length} /Filter /FlateDecode >>`, stream: z }) : add({ dict: `<< /Length ${raw.length} >>`, stream: raw });
    const xo = [...pg.images].map((nm) => `/${nm} ${imgIds[nm]} 0 R`).join(' ');
    pageIds.push(
      add({ body: `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n2(L.W)} ${n2(L.H)}] /Resources << /Font << ${fontRes} >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${contentId} 0 R >>` })
    );
  }
  objs[pagesObj - 1] = { body: `<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>` };
  objs[catalog - 1] = { body: `<< /Type /Catalog /Pages ${pagesObj} 0 R /ViewerPreferences << /DisplayDocTitle true >> >>` };
  const u16 = (s) => '<FEFF' + [...String(s)].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>';
  const d = new Date();
  const info = add({
    body: `<< /Title ${u16(doc.title + (doc.subtitle ? ' — ' + doc.subtitle : ''))} /Subject ${u16(doc.code)} /Producer (OPS 360 IA ${VERSION}) /Creator (OPS 360 IA) /CreationDate (D:${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}) >>`,
  });
  const chunks = [latin1Bytes('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  let offset = chunks[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(offset);
    const headBytes = latin1Bytes(`${i + 1} 0 obj\n${o.body || o.dict}${o.stream ? '\nstream\n' : '\nendobj\n'}`);
    chunks.push(headBytes);
    offset += headBytes.length;
    if (o.stream) {
      chunks.push(o.stream);
      const tail = latin1Bytes('\nendstream\nendobj\n');
      chunks.push(tail);
      offset += o.stream.length + tail.length;
    }
  });
  const xref = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f ', ...offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n ')].join('\n') + '\n';
  chunks.push(latin1Bytes(xref + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return new Blob([concatBytes(chunks)], { type: 'application/pdf' });
}


/* ===== 13-office.js ===== */
// ---------------------------------------------------------------------------
// 13 · Geradores Word (.docx) e Excel (.xlsx) nativos
// ---------------------------------------------------------------------------
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const hexNo = (h) => String(h || '#000000').replace('#', '').toUpperCase();

function wRuns(text, o = {}) {
  const rPr = (b) =>
    `<w:rPr>${o.font ? `<w:rFonts w:ascii="${o.font}" w:hAnsi="${o.font}" w:cs="${o.font}"/>` : ''}${b ? '<w:b/>' : ''}${o.i ? '<w:i/>' : ''}${o.caps ? '<w:caps/>' : ''}${
      o.color ? `<w:color w:val="${hexNo(o.color)}"/>` : ''
    }${o.size ? `<w:sz w:val="${Math.round(o.size * 2)}"/><w:szCs w:val="${Math.round(o.size * 2)}"/>` : ''}</w:rPr>`;
  const runs = o.rich === false ? [{ text: String(text == null ? '' : text), bold: false }] : richRuns(text);
  return runs
    .map((r) =>
      String(r.text)
        .split('\n')
        .map((seg, k) => `<w:r>${rPr(o.b || r.bold)}${k ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEsc(seg)}</w:t></w:r>`)
        .join('')
    )
    .join('');
}
function wP(inner, o = {}) {
  // ordem exigida pelo schema OOXML (o Word recusa elementos fora de ordem)
  const pPr = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
    o.keepNext ? '<w:keepNext/>' : '',
    o.border ? `<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="${hexNo(o.border)}"/></w:pBdr>` : '',
    o.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${hexNo(o.shd)}"/>` : '',
    `<w:spacing w:before="${o.before || 0}" w:after="${o.after == null ? 80 : o.after}"/>`,
    o.ind ? `<w:ind w:left="${o.ind}" w:hanging="${o.hanging || 0}"/>` : '',
    o.align ? `<w:jc w:val="${o.align}"/>` : '',
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${inner}</w:p>`;
}
function wCell(inner, { w, fill, vAlign = 'top', span, borders } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${Math.round(w)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${borders || ''}${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${hexNo(fill)}"/>` : ''}<w:vAlign w:val="${vAlign}"/></w:tcPr>${inner || '<w:p/>'}</w:tc>`;
}
function wTable(rowsXml, widths, { borders = true, header = false } = {}) {
  const b = borders
    ? `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="C9D3D6"/>`).join('')}</w:tblBorders>`
    : '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
  return `<w:tbl><w:tblPr><w:tblW w:w="${Math.round(widths.reduce((a, c) => a + c, 0))}" w:type="dxa"/>${b}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="50" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths
    .map((w) => `<w:gridCol w:w="${Math.round(w)}"/>`)
    .join('')}</w:tblGrid>${rowsXml}</w:tbl>${header ? '' : ''}`;
}
function wRow(cellsXml, { header = false, cantSplit = true } = {}) {
  return `<w:tr><w:trPr>${cantSplit ? '<w:cantSplit/>' : ''}${header ? '<w:tblHeader/>' : ''}</w:trPr>${cellsXml}</w:tr>`;
}

async function docToDOCX(doc) {
  const land = doc.orientation === 'landscape';
  const pageW = land ? 16838 : 11906, pageH = land ? 11906 : 16838, mar = 720;
  const CW = pageW - mar * 2;
  const media = [];
  const rels = [];
  const body = [];
  let imgN = 0;
  const S = 9.5; // tamanho base (pt)
  // Cabeçalho em faixa escura (tabela de 1 linha)
  const hdLeft =
    wP(wRuns('OPS 360°' + (doc.company ? '  ·  ' + doc.company : ''), { b: true, color: '#99F6E4', size: 7.5, rich: false }), { after: 0 }) +
    wP(wRuns(doc.title, { b: true, color: '#FFFFFF', size: 15, rich: false }), { after: 0 }) +
    (doc.subtitle ? wP(wRuns(doc.subtitle, { color: '#99F6E4', size: 9.5, rich: false }), { after: 0 }) : '');
  const hdRight = [`Código: ${doc.code}`, `Data: ${doc.date}`, `Revisão: ${doc.revision}`].map((t) => wP(wRuns(t, { color: '#FFFFFF', size: 8, rich: false }), { after: 0, align: 'right' })).join('');
  body.push(wTable(wRow(wCell(hdLeft, { w: CW * 0.72, fill: DOC_BRAND.dark, vAlign: 'center' }) + wCell(hdRight, { w: CW * 0.28, fill: DOC_BRAND.dark, vAlign: 'center' })), [CW * 0.72, CW * 0.28], { borders: false }));
  body.push(wP('', { shd: DOC_BRAND.accent, after: 160 }).replace('<w:spacing w:before="0" w:after="160"/>', '<w:spacing w:before="0" w:after="160" w:line="60" w:lineRule="exact"/>'));

  const tableXml = (head, rows, widthsFrac, small) => {
    const n = head.length;
    const fr = widthsFrac && widthsFrac.length === n ? widthsFrac : head.map(() => 1 / n);
    const tot = fr.reduce((a, c) => a + c, 0);
    const widths = fr.map((f) => (f / tot) * CW);
    const sz = small ? S - 1.3 : S - 0.7;
    let xml = wRow(head.map((hd, i) => wCell(wP(wRuns(hd, { b: true, color: '#FFFFFF', size: sz, rich: false }), { after: 0 }), { w: widths[i], fill: DOC_BRAND.head })).join(''), { header: true });
    rows.forEach((r, ri) => {
      xml += wRow(
        head
          .map((_, i) => {
            const c = r[i];
            const o = c && typeof c === 'object' ? c : { text: c };
            const fill = o.fill || (ri % 2 ? DOC_BRAND.zebra : null);
            const inner = o.box
              ? wP(wRuns('☐', { size: sz + 2, font: 'Segoe UI Symbol', rich: false }), { after: 0, align: 'center' })
              : wP(wRuns(cellText(o), { size: sz, b: !!(o.bold || o.fill), color: o.fill ? o.color || inkOn(o.fill) : null }), { after: 0, align: o.fill || o.align === 'center' ? 'center' : o.align === 'right' ? 'right' : null });
            return wCell(inner, { w: widths[i], fill });
          })
          .join('')
      );
    });
    return wTable(xml, widths);
  };

  for (const b of doc.blocks) {
    switch (b.t) {
      case 'h':
        body.push(wP(wRuns(b.level === 2 ? b.text : b.text.toUpperCase(), { b: true, color: DOC_BRAND.head, size: b.level === 2 ? 10.5 : 11.5, rich: false }), { before: 200, after: 100, keepNext: true, border: b.level === 2 ? null : DOC_BRAND.accent }));
        break;
      case 'p':
        body.push(wP(wRuns(b.text, { size: b.size || S }), { after: 100 }));
        break;
      case 'ul':
      case 'ol':
        b.items.forEach((it, i) => body.push(wP(wRuns((b.t === 'ol' ? `${i + 1}.` : '•') + '\t', { color: DOC_BRAND.head, b: true, size: S, rich: false }) + wRuns(cellText(it), { size: S }), { ind: 360, hanging: 260, after: 40 })));
        body.push(wP('', { after: 60 }));
        break;
      case 'kv': {
        const cols = b.cols || 2, cw = CW / cols;
        let rowsX = '', cells = '', used = 0;
        const flush = () => {
          if (!cells) return;
          if (used < cols) cells += wCell('', { w: cw * (cols - used), span: cols - used });
          rowsX += wRow(cells);
          cells = '';
          used = 0;
        };
        for (const [k, v, span0] of b.items) {
          const span = Math.min(cols, span0 || 1);
          if (used + span > cols) flush();
          cells += wCell(wP(wRuns(String(k).toUpperCase(), { size: 6.5, b: true, color: DOC_BRAND.muted, rich: false }), { after: 0 }) + wP(wRuns(v || ' ', { size: 9, b: true, rich: false }), { after: 20 }), { w: cw * span, span });
          used += span;
        }
        flush();
        body.push(wTable(rowsX, Array(cols).fill(cw)));
        body.push(wP('', { after: 60 }));
        break;
      }
      case 'table':
        body.push(tableXml(b.head, b.rows, b.widths, b.small));
        body.push(wP('', { after: 80 }));
        break;
      case 'check': {
        const cols = b.cols || ['C', 'NC', 'NA'];
        body.push(tableXml(['Nº', 'Item verificado', ...cols, 'Observação'], b.items.map((it, i) => [{ text: String(i + 1), align: 'center' }, it, ...cols.map(() => ({ box: true })), '']), [0.05, land ? 0.55 : 0.5, ...cols.map(() => 0.065), land ? 0.205 : 0.255]));
        if (b.legend) body.push(wP(wRuns(b.legend, { size: 8, color: DOC_BRAND.muted }), {}));
        body.push(wP('', { after: 80 }));
        break;
      }
      case 'callout': {
        const tn = TONES[b.tone || 'info'];
        body.push(
          wTable(
            wRow(wCell(wP(wRuns(b.title || tn.title, { b: true, size: S + 0.5, rich: false }), { after: 40 }) + wP(wRuns(b.text, { size: S }), { after: 0 }), { w: CW, fill: tn.bg, borders: `<w:tcBorders><w:left w:val="single" w:sz="36" w:space="0" w:color="${hexNo(tn.bar)}"/></w:tcBorders>` })),
            [CW],
            { borders: false }
          )
        );
        body.push(wP('', { after: 80 }));
        break;
      }
      case 'img':
      case 'gallery': {
        const items = b.t === 'img' ? [{ src: b.src, caption: b.caption }] : b.items;
        for (const it of items) {
          let j;
          try {
            j = await toJpegBytes(it.src);
          } catch (e) {
            continue;
          }
          imgN++;
          const rid = 'rIdImg' + imgN;
          media.push({ name: `word/media/image${imgN}.jpeg`, data: j.bytes });
          rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${imgN}.jpeg"/>`);
          const maxWpt = ((CW / 20) * (b.t === 'img' ? b.width || 0.7 : 0.48));
          const maxHpt = land ? 300 : 340;
          const k = Math.min(maxWpt / j.w, maxHpt / j.h, 1.5);
          const cx = Math.round(j.w * k * 12700), cy = Math.round(j.h * k * 12700);
          const drawing = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imgN}" name="Imagem ${imgN}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${imgN}" name="image${imgN}.jpeg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
          body.push(wP(drawing, { align: 'center', after: 40 }));
          if (it.caption) body.push(wP(wRuns(it.caption, { i: true, size: 8, color: DOC_BRAND.muted, rich: false }), { align: 'center', after: 120 }));
        }
        break;
      }
      case 'sign': {
        const per = Math.min(3, b.items.length);
        const w = CW / per;
        for (let i = 0; i < b.items.length; i += per) {
          const cells = b.items
            .slice(i, i + per)
            .map((s) =>
              wCell(
                wP('', { after: 500 }) +
                  wP(wRuns(s, { b: true, size: 8.5, rich: false }), { after: 0, border: null }).replace('<w:pPr>', '<w:pPr><w:pBdr><w:top w:val="single" w:sz="6" w:space="1" w:color="333333"/></w:pBdr>') +
                  wP(wRuns('Nome: ________________________', { size: 7.5, color: DOC_BRAND.muted, rich: false }), { after: 0 }) +
                  wP(wRuns('Data: ____/____/________', { size: 7.5, color: DOC_BRAND.muted, rich: false }), { after: 0 }),
                { w }
              )
            )
            .join('');
          body.push(wTable(wRow(cells), Array(per).fill(w), { borders: false }));
        }
        break;
      }
      case 'matrix': {
        let rowsX = '';
        const cw = 480;
        for (let p = 5; p >= 1; p--) {
          let cells = wCell(wP(wRuns(String(p), { b: true, size: 7.5, rich: false }), { after: 0, align: 'center' }), { w: cw });
          for (let s = 1; s <= 5; s++) {
            const rl = riskLevel(p, s);
            cells += wCell(wP(wRuns(String(p * s), { b: true, size: 7.5, color: inkOn(rl.cor), rich: false }), { after: 0, align: 'center' }), { w: cw, fill: rl.cor });
          }
          rowsX += wRow(cells);
        }
        rowsX += wRow(wCell('', { w: cw }) + [1, 2, 3, 4, 5].map((s) => wCell(wP(wRuns(String(s), { b: true, size: 7.5, rich: false }), { after: 0, align: 'center' }), { w: cw })).join(''));
        body.push(wTable(rowsX, Array(6).fill(cw), { borders: false }));
        body.push(wP(wRuns('Probabilidade (P, linhas) × Severidade (S, colunas): 1–4 Baixo · 5–9 Moderado · 10–16 Alto · 20–25 Crítico.', { size: 8, color: DOC_BRAND.muted, rich: false }), { before: 60 }));
        break;
      }
      case 'lines':
        if (b.label) body.push(wP(wRuns(b.label, { b: true, size: S, rich: false }), { before: 120 }));
        for (let i = 0; i < (b.n || 3); i++) body.push(wP('', { after: 0, border: '999999' }).replace('w:after="0"', 'w:after="0" w:line="400" w:lineRule="exact"'));
        break;
      case 'spacer':
        body.push(wP('', { after: 120 }));
        break;
      case 'pagebreak':
        body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        break;
    }
  }
  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${pageW}" w:h="${pageH}"${land ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${mar}" w:right="${mar}" w:bottom="${mar}" w:left="${mar}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>`;
  const documentXml = `${XML_HEAD}<w:document ${W_NS}><w:body>${body.join('')}${sect}</w:body></w:document>`;
  const footerXml = `${XML_HEAD}<w:ftr ${W_NS}><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="C9D3D6"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${CW}"/></w:tabs></w:pPr>${wRuns(`OPS 360° IA · ${doc.code} · revise e valide antes do uso`, { size: 7, color: DOC_BRAND.muted, rich: false })}<w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:tab/><w:t xml:space="preserve">Página </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:b/><w:sz w:val="14"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple><w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:t xml:space="preserve"> de </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:rPr><w:b/><w:sz w:val="14"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
  const stylesXml = `${XML_HEAD}<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="19"/><w:szCs w:val="19"/><w:color w:val="16232A"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
  const docRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${rels.join('')}</Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files = [
    { name: '[Content_Types].xml', data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(doc.title)}</dc:title><dc:subject>${xmlEsc(doc.subtitle || '')}</dc:subject><dc:creator>OPS 360° IA</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OPS 360 IA</Application></Properties>` },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/footer1.xml', data: footerXml },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    ...media,
  ];
  return new Blob([await zipWrite(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ---- Excel ----------------------------------------------------------------------------
function colName(i) {
  let s = '';
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}
// sheets: [{ name, rows: [[...]], header: true }]
async function sheetsToXLSX(sheets, title = 'OPS 360°') {
  const safeName = (n, i) => (String(n || `Planilha ${i + 1}`).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Planilha ${i + 1}`);
  const used = new Set();
  const names = sheets.map((s, i) => {
    let n = safeName(s.name, i), k = 2;
    while (used.has(n.toLowerCase())) n = safeName(s.name, i).slice(0, 28) + ' ' + k++;
    used.add(n.toLowerCase());
    return n;
  });
  const cellXml = (v, r, c, style) => {
    const ref = colName(c) + (r + 1);
    const t = cellText(v);
    const num = /^-?\d{1,15}([.,]\d+)?$/.test(t.trim()) && !/^0\d/.test(t.trim()) ? parseNumBR(t) : NaN;
    if (!isNaN(num) && t.trim() !== '') return `<c r="${ref}" s="${style}"><v>${num}</v></c>`;
    if (t === '') return `<c r="${ref}" s="${style}"/>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(t)}</t></is></c>`;
  };
  const sheetFiles = sheets.map((s, si) => {
    const rows = s.rows || [];
    const width = Math.max(1, ...rows.map((r) => r.length));
    const colW = Array.from({ length: width }, (_, c) => Math.min(60, Math.max(8, ...rows.slice(0, 200).map((r) => Math.min(60, cellText(r[c]).length * 1.1 + 2)))));
    const data = rows
      .map((r, ri) => `<row r="${ri + 1}">${Array.from({ length: width }, (_, c) => cellXml(r[c], ri, c, s.header !== false && ri === 0 ? 1 : 2)).join('')}</row>`)
      .join('');
    const pane = s.header !== false && rows.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
    const filter = s.header !== false && rows.length > 1 ? `<autoFilter ref="A1:${colName(width - 1)}${rows.length}"/>` : '';
    return { name: `xl/worksheets/sheet${si + 1}.xml`, data: `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pane}<cols>${colW.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w.toFixed(1)}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData>${filter}</worksheet>` };
  });
  const styles = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF134E4A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC9D3D6"/></left><right style="thin"><color rgb="FFC9D3D6"/></right><top style="thin"><color rgb="FFC9D3D6"/></top><bottom style="thin"><color rgb="FFC9D3D6"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = [
    { name: '[Content_Types].xml', data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>OPS 360° IA</dc:creator></cp:coreProperties>` },
    { name: 'xl/workbook.xml', data: `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: styles },
    ...sheetFiles,
  ];
  return new Blob([await zipWrite(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function docToSheets(doc) {
  const sheets = [];
  const info = [['Campo', 'Valor'], ['Documento', doc.title], ['Descrição', doc.subtitle || ''], ['Código', doc.code], ['Data', doc.date], ['Revisão', doc.revision]];
  for (const b of doc.blocks) if (b.t === 'kv') b.items.forEach(([k, v]) => info.push([k, v || '']));
  sheets.push({ name: 'Documento', rows: info });
  let n = 0, lastH = '';
  for (const b of doc.blocks) {
    if (b.t === 'h') lastH = b.text.replace(/^\d+\.\s*/, '');
    if (b.t === 'table') sheets.push({ name: lastH || `Tabela ${++n}`, rows: [b.head, ...b.rows.map((r) => r.map((c) => (c && c.box ? '' : cellText(c))))] });
    if (b.t === 'check') sheets.push({ name: lastH || 'Checklist', rows: [['Nº', 'Item verificado', ...(b.cols || ['C', 'NC', 'NA']), 'Observação'], ...b.items.map((it, i) => [i + 1, it, ...(b.cols || ['C', 'NC', 'NA']).map(() => ''), ''])] });
    if ((b.t === 'ul' || b.t === 'ol') && lastH) sheets.push({ name: lastH, rows: [[lastH], ...b.items.map((i) => [cellText(i).replace(/\*\*/g, '')])] });
    if (['table', 'check', 'ul', 'ol'].includes(b.t)) lastH = '';
  }
  return sheets;
}
async function docToXLSX(doc) {
  return sheetsToXLSX(docToSheets(doc), doc.title);
}


/* ===== 14-generators.js ===== */
// ---------------------------------------------------------------------------
// 14 · Geradores de documentos por tipo de solicitação
//      Cada gerador recebe um contexto (atividade, parâmetros, perfil, anexos)
//      e devolve { doc, resumo } — o doc é renderizado em PDF/Word/Excel/HTML.
// ---------------------------------------------------------------------------
const DOC_TYPES_GEN = {
  apr: { label: 'APR — Análise Preliminar de Risco', icon: '⚠️' },
  pt: { label: 'Permissão de Trabalho', icon: '🪪' },
  dds: { label: 'DDS — Diálogo Diário de Segurança', icon: '🗣️' },
  checklist: { label: 'Checklist de inspeção', icon: '✅' },
  os: { label: 'Ordem de Serviço de SST (NR-01)', icon: '📋' },
  ficha_epi: { label: 'Ficha de entrega de EPI (NR-06)', icon: '🦺' },
  inspecao: { label: 'Relatório de inspeção / não conformidade', icon: '🔎' },
  investigacao: { label: 'Relatório de investigação de acidente', icon: '🧭' },
  plano_acao: { label: 'Plano de ação 5W2H', icon: '🎯' },
  pop: { label: 'Procedimento Operacional Padrão (POP)', icon: '📘' },
  lista_presenca: { label: 'Lista de presença de treinamento', icon: '🖊️' },
  comunicado: { label: 'Alerta / comunicado de segurança', icon: '📣' },
  treinamento: { label: 'Plano de treinamento', icon: '🎓' },
  inventario: { label: 'Inventário de riscos (base do PGR)', icon: '🗂️' },
  pae: { label: 'Plano de atendimento a emergências', icon: '🚨' },
  resumo_doc: { label: 'Relatório de análise de documento', icon: '🧾' },
};

// Temas de DDS que não são uma atividade específica
const DDS_TOPICS = [
  ['quase acidente', 'quase acidente|near miss|reportar|relatar incidente', 'Reportar quase acidentes salva vidas', ['Todo acidente grave costuma ser precedido por vários quase acidentes e desvios.', 'Reportar não é dedurar: é dar chance de corrigir antes que alguém se machuque.', 'O que reportar: condições inseguras, falhas de equipamento, "quase" atropelamentos, quedas de objetos.', 'Como reportar: formulário/QR code, líder imediato ou SESMT — leva 1 minuto.', 'Todo reporte recebe retorno e, quando possível, uma ação visível.'], 'Qual foi o último "quase" que você viu e não comentou?'],
  ['saúde mental', 'saude mental|estresse|ansiedade|burnout|psicossocial|emocional', 'Saúde mental também é segurança', ['Cansaço, estresse e preocupação reduzem a atenção e aumentam o risco de acidentes.', 'Sinais de alerta: irritação, isolamento, insônia, falta de concentração.', 'Converse: pedir ajuda é sinal de força. Procure a liderança, o RH ou o SESMT.', 'Respeito e zero tolerância ao assédio — use os canais de denúncia (a CIPA também atua).', 'Apoio emocional gratuito 24h: CVV 188.'], 'O que mais pesa no seu dia de trabalho e poderia ser melhorado?'],
  ['calor', 'calor|temperatura|hidrata|insolacao', 'Calor: hidratação e pausas', ['Beba água várias vezes, mesmo sem sede.', 'Sinais de alerta: tontura, dor de cabeça, náusea, câimbras e confusão.', 'Faça pausas em local fresco e respeite o revezamento.', 'Use roupas leves e protetor solar a céu aberto.', 'Viu um colega passando mal? Leve-o à sombra, ofereça água e acione ajuda.'], 'Onde há água fresca disponível na sua área?'],
  ['5S e organização', '5s|organizacao|housekeeping|limpeza da area|arrumacao', 'Organização e limpeza (5S)', ['Área desorganizada causa tropeços, cortes e incêndios.', 'Cada coisa no seu lugar — e um lugar para cada coisa.', 'Rotas de fuga, extintores e painéis sempre desobstruídos.', 'Limpar é também inspecionar: vazamentos e danos aparecem na limpeza.', 'Termine o turno deixando o posto como gostaria de encontrá-lo.'], 'O que dá para eliminar ou organizar hoje na sua área?'],
  ['percepção de risco', 'percepcao de risco|atencao|distracao|excesso de confianca|rotina', 'Percepção de risco e excesso de confiança', ['A rotina faz o risco "desaparecer" da nossa vista.', 'Antes de começar: pare, observe, pense no que pode dar errado.', 'Atalhos economizam segundos e custam vidas.', 'Pressa, cansaço, frustração e distração são estados que levam a erros.', 'Se não for seguro, não faça — use o direito de recusa.'], 'Qual atividade você faz "no automático" e merece mais atenção?'],
  ['uso de celular', 'celular|telefone|smartphone', 'Celular e distração', ['O celular tira a atenção de onde ela precisa estar.', 'Em áreas operacionais, atenda somente parado e em local seguro.', 'Nunca use celular dirigindo veículos ou operando máquinas.', 'Fones de ouvido podem impedir de ouvir alarmes e buzinas.'], 'Em quais situações da sua área o celular é mais perigoso?'],
  ['álcool e drogas', 'alcool|drogas|bebida|embriaguez|ressaca', 'Álcool, drogas e trabalho não combinam', ['Álcool e drogas reduzem reflexos, atenção e percepção de risco.', 'Os efeitos (e a ressaca) duram muito mais do que parece.', 'Medicamentos também podem causar sonolência — informe o médico do trabalho.', 'Procure ajuda: a empresa e o SUS oferecem apoio (CAPS AD).'], 'Como podemos apoiar um colega que está com dificuldades?'],
  ['prevenção de lesões nas mãos', 'maos|mao|dedos|luvas|corte nas maos', 'Proteja suas mãos', ['As mãos são as partes do corpo mais atingidas em acidentes.', 'Pontos de prensamento: nunca coloque a mão onde não consegue ver.', 'Use a luva certa para cada risco — e nunca perto de partes girantes.', 'Ferramentas adequadas e em bom estado evitam cortes.', 'Bloqueie a energia antes de desobstruir ou ajustar máquinas.'], 'Onde, na sua atividade, suas mãos ficam mais expostas?'],
  ['prevenção de incêndios', 'incendio|extintor|fogo|brigada', 'Prevenção e combate a princípios de incêndio', ['Mantenha extintores, hidrantes e rotas de fuga desobstruídos.', 'Classes de fogo: A (sólidos), B (líquidos), C (elétricos), D (metais), K (cozinha).', 'Use o extintor certo: água nunca em equipamentos energizados.', 'Técnica PASS: puxe o pino, aponte para a base, aperte o gatilho, varra.', 'Em caso de fogo que foge do controle: evacue e acione os bombeiros (193).'], 'Você sabe onde fica o extintor e o ponto de encontro mais próximos?'],
  ['primeiros socorros', 'primeiros socorros|socorro|emergencia medica|desmaio', 'Primeiros socorros: o que fazer (e o que não fazer)', ['Garanta sua segurança antes de ajudar.', 'Acione ajuda: SAMU 192 / Bombeiros 193.', 'Não mova vítimas com suspeita de lesão na coluna.', 'Sangramento: pressão direta com pano limpo.', 'Queimadura: água corrente por 10–20 min; não use pomadas caseiras.'], 'Quem são os socorristas/brigadistas do seu turno?'],
  ['coluna e ergonomia', 'coluna|lombar|postura|ergonomia|levantar peso', 'Cuide da sua coluna', ['Dobre os joelhos e mantenha a carga perto do corpo.', 'Evite torcer o tronco com carga — gire com os pés.', 'Peça ajuda ou use meios mecânicos para cargas pesadas.', 'Faça pausas e alongamentos.'], 'Qual tarefa hoje exige mais da sua coluna?'],
  ['sinalização de segurança', 'sinalizacao|placas|cores de seguranca|faixas', 'Entenda a sinalização de segurança', ['Vermelho: proibição, parada e equipamentos de combate a incêndio.', 'Amarelo: atenção/alerta. Azul: ação obrigatória (ex.: uso de EPI). Verde: emergência, rotas de fuga e primeiros socorros.', 'Sinalização vertical (placas) e horizontal (faixas no piso) trabalham juntas.', 'Respeite as faixas de pedestres e as áreas de empilhadeiras.'], 'Há alguma placa ou faixa apagada ou faltando na sua área?'],
  ['direção defensiva', 'direcao defensiva|transito|dirigir|motorista', 'Direção defensiva', ['Mantenha distância segura do veículo da frente.', 'Cinto para todos, sempre.', 'Celular guardado — nenhuma mensagem vale uma vida.', 'Cansado? Pare e descanse.'], 'Qual situação no trajeto até a empresa é mais perigosa?'],
];

const CHECKLIST_TOPICS = [
  ['extintores', 'extintor|extintores', 'Inspeção de extintores', ['Extintor no local indicado e sinalizado (placa e piso)', 'Acesso desobstruído', 'Lacre e pino de segurança intactos', 'Ponteiro do manômetro na faixa verde (quando houver)', 'Mangueira e difusor sem rachaduras ou entupimentos', 'Cilindro sem amassados, corrosão ou vazamentos', 'Etiqueta de recarga dentro da validade', 'Teste hidrostático dentro da validade', 'Quadro de instruções legível', 'Tipo adequado à classe de fogo da área', 'Fixação/altura adequadas']],
  ['EPI', 'epi|equipamentos de protecao', 'Inspeção de uso e conservação de EPIs', ['EPIs com CA válido', 'EPIs adequados aos riscos da atividade (conforme PGR)', 'Estado de conservação adequado', 'Uso correto pelos trabalhadores', 'Guarda e higienização adequadas', 'Fichas de entrega assinadas e atualizadas', 'Trabalhadores treinados para uso', 'Estoque suficiente para reposição']],
  ['5S', '5s|housekeeping|organizacao e limpeza', 'Auditoria 5S', ['Somente materiais necessários no posto (Seiri)', 'Itens identificados e em locais demarcados (Seiton)', 'Piso, máquinas e bancadas limpos (Seiso)', 'Padrões visuais afixados e seguidos (Seiketsu)', 'Rotina de 5S cumprida e registrada (Shitsuke)', 'Rotas de fuga e extintores desobstruídos', 'Resíduos segregados corretamente', 'Sem vazamentos ou derramamentos']],
  ['documentação SST (fiscalização)', 'fiscalizacao|auditoria|documentacao|documentos', 'Checklist documental para fiscalização', ['PGR com inventário de riscos e plano de ação atualizados', 'PCMSO e relatório analítico', 'ASOs de todos os empregados em dia', 'Certificados dos treinamentos obrigatórios válidos', 'Fichas de entrega de EPI assinadas com CAs válidos', 'Documentação da CIPA (eleição, posse, atas) ou nomeado', 'Ordens de serviço/procedimentos entregues aos trabalhadores', 'Prontuário das instalações elétricas (se carga > 75 kW)', 'Documentação de caldeiras e vasos de pressão (se houver)', 'Laudos (LTCAT, insalubridade/periculosidade)', 'Eventos SST do eSocial enviados (S-2210, S-2220, S-2240)', 'Registros de inspeções, PTs e APRs arquivados']],
  ['caixa de primeiros socorros', 'caixa de primeiros socorros|kit de primeiros socorros', 'Inspeção do kit de primeiros socorros', ['Kit identificado e em local de fácil acesso', 'Gazes, ataduras e esparadrapo/fita', 'Luvas descartáveis', 'Soro fisiológico', 'Tesoura sem ponta', 'Materiais dentro da validade', 'Responsável pelo kit definido', 'Lista de telefones de emergência afixada']],
  ['veículo', 'veiculo|carro|caminhao|frota', 'Checklist de veículo', ['Pneus calibrados e sem desgaste excessivo', 'Freios funcionando', 'Faróis, lanternas e setas', 'Nível de óleo e água', 'Cintos de segurança em bom estado', 'Retrovisores ajustados', 'Limpador de para-brisa', 'Triângulo, macaco e estepe', 'Documentação em dia', 'Extintor (quando exigido)']],
  ['terceiros/contratadas', 'terceiros|contratada|prestador|empreiteira', 'Checklist de documentação de contratadas', ['Contrato com cláusulas de SST', 'PGR/APR da atividade', 'ASOs dos trabalhadores', 'Certificados de treinamento (NRs aplicáveis)', 'Fichas de EPI', 'Integração de segurança realizada', 'Responsável técnico definido', 'Seguro de vida em grupo (quando exigido)']],
];

function applyItemEdits(items, p = {}) {
  let out = [...items, ...(p.extraItems || [])];
  if (p.removeItems && p.removeItems.length) out = out.filter((i) => !p.removeItems.some((k) => norm(i).includes(k)));
  return uniq(out);
}
function pickTopic(list, text) {
  const t = norm(text);
  return list.find((x) => new RegExp('(' + x[1] + ')').test(t)) || null;
}
function signLabels(ctx, extra = []) {
  return uniq([...extra, 'Elaborado por', 'Aprovado por (SESMT / responsável)']).slice(0, 3);
}
function baseKV(ctx, fields) {
  const p = ctx.params || {};
  const map = {
    empresa: ['Empresa', p.empresa || ctx.profile.company || ''],
    local: ['Local / setor', p.local || ''],
    data: ['Data', p.data ? fmtDate(p.data) : fmtDate(new Date())],
    responsavel: ['Responsável', p.responsavel || ''],
    elaborado: ['Elaborado por', p.responsavel || ctx.profile.name || ''],
    equipe: ['Equipe / executantes', p.equipe || ''],
    atividade: ['Atividade', ctx.act ? ctx.act.nome : p.tema || ''],
    funcao: ['Função / cargo', p.funcao || ''],
    horario: ['Horário', p.horario || ''],
    duracao: ['Duração', p.duracao || ''],
  };
  return fields.map((f) => (Array.isArray(f) ? f : map[f])).filter(Boolean);
}
function nrItems(nrs) {
  return uniq(nrs)
    .filter((n) => NRS[n] && !NRS[n].revogada)
    .sort((a, b) => a - b)
    .map((n) => nrLabel(n));
}
function aprRows(act, full = true) {
  const rows = act.perigos.map((p) => {
    const rl = riskLevel(p[3], p[4]);
    const rr = riskLevel(Math.max(1, p[3] - (p[4] >= 5 ? 2 : 1)), p[4] >= 5 && p[3] >= 3 ? p[4] : Math.max(1, p[4]));
    return [p[0] === 'Todas' ? 'Todas as etapas' : p[0], p[1], p[2], { text: String(p[3]), align: 'center' }, { text: String(p[4]), align: 'center' }, { text: `${rl.nivel} (${rl.r})`, fill: rl.cor }, p[5].map((c) => '• ' + c).join('\n'), { text: rr.nivel, fill: rr.cor }];
  });
  return full ? rows : rows.filter((r) => /Alto|Crítico/.test(r[5].text));
}
// requisitos/verificações extraídos de um documento (procedimentos, normas)
function extractRequirements(text, max = 25) {
  const out = [];
  for (const s0 of sentences(text)) {
    const s = s0.replace(/^[\s•\-–*]+/, '');
    if (s.length < 18 || s.length > 260) continue;
    if (/^(objetivo|escopo|finalidade|aplica[cç][aã]o|campo de aplica[cç][aã]o|refer[eê]ncias?|defini[cç][oõ]es|carga hor[aá]ria|data|revis[aã]o|elaborad[oa])\s*:/i.test(s)) continue;
    const roleVerb = /^[A-ZÀ-Ú][\wÀ-ú /()-]{2,40}:\s*(?:n[aã]o\s+)?[a-zà-ú]{3,}(?:ar|er|ir)\b/.test(s) || /^(?:[•\-–*]\s*)?(?:n[aã]o\s+)?[A-ZÀ-Úa-zà-ú][a-zà-ú]{2,}(?:ar|er|ir)\s/.test(s.trim());
    if (roleVerb || /\b(deve|devem|dever[aá]|devera|obrigat[oó]ri|proibid|[eé] necess[aá]ri|verificar|inspecionar|garantir|manter|utilizar|usar|certificar|assegurar|n[aã]o (?:se )?deve)/i.test(s)) {
      out.push(capFirst(s.replace(/^[\s•\-–\d.)]+/, '').replace(/\s+/g, ' ').replace(/[.;:]+$/, '')));
    }
    if (out.length >= max) break;
  }
  if (out.length < 5) {
    for (const l of String(text).split('\n')) {
      const m = /^\s*(?:[•\-–*]|\d+[.)])\s+(.{12,200})$/.exec(l);
      if (m && !out.includes(m[1])) out.push(capFirst(m[1].replace(/[.;:]+$/, '')));
      if (out.length >= max) break;
    }
  }
  return uniq(out).slice(0, max);
}
function extractSteps(text, max = 10) {
  const steps = [];
  for (const l of String(text).split('\n')) {
    const m = /^\s*(?:\d+(?:\.\d+)*[.)-]?|[a-z]\))\s+(.{6,120})$/i.exec(l);
    if (m) steps.push(capFirst(m[1].replace(/[.;:]+$/, '')));
    if (steps.length >= max) break;
  }
  return steps;
}
function extractIssues(text, max = 12) {
  const out = [];
  for (const s of sentences(text)) {
    if (s.length < 15 || s.length > 260) continue;
    if (/(n[aã]o conform|irregular|aus[eê]ncia|falta de|\bsem\b|danificad|vencid|obstru|inexistente|inadequad|improvis|desgastad|quebrad|exposta|expostos|vazamento|n[aã]o possui|n[aã]o h[aá])/i.test(s)) out.push(capFirst(s.replace(/^[\s•\-–\d.)]+/, '').replace(/[.;:]+$/, '')));
    if (out.length >= max) break;
  }
  return out;
}
function actionFor(issue) {
  const t = norm(issue);
  const rules = [
    [/extintor/, 'Regularizar o extintor (recarga/sinalização/desobstrução) conforme NR-23 e IT do Corpo de Bombeiros'],
    [/fiacao|fio|cabo|eletric|tomada|painel|quadro/, 'Isolar a área, desenergizar e corrigir a instalação com profissional autorizado (NR-10)'],
    [/guarda-corpo|guarda corpo|altura|queda|abertura/, 'Instalar proteção coletiva contra quedas e sinalizar a área (NR-35/NR-18)'],
    [/epi|capacete|luva|oculos|protetor|botina|cinto/, 'Fornecer/substituir o EPI com CA válido, orientar e registrar na ficha (NR-06)'],
    [/sinaliza|faixa|placa/, 'Refazer a sinalização vertical/horizontal (NR-26)'],
    [/protec|maquina|prensa|correia|polia/, 'Instalar/recolocar proteção de máquina com intertravamento (NR-12)'],
    [/vazamento|quimic|produto/, 'Conter o vazamento, limpar com kit adequado e corrigir a origem (FDS)'],
    [/treinamento|capacita|habilita|cartao/, 'Programar capacitação e retirar da atividade até a regularização'],
    [/organiza|limpeza|obstru|entulho|material/, 'Organizar e desobstruir a área (5S) e definir rotina de verificação'],
    [/vencid|validade/, 'Renovar o item/documento vencido e controlar a validade em planilha/aba'],
  ];
  const r = rules.find(([re]) => re.test(t));
  return r ? r[1] : 'Definir e implementar medida corretiva adequada ao risco';
}

// ---- Geradores ------------------------------------------------------------------------
const GENERATORS = {
  apr(ctx) {
    const act = ctx.act;
    const p = ctx.params || {};
    const doc = newDoc('apr', 'Análise Preliminar de Risco (APR)', { subtitle: act.nome + (p.local ? ' — ' + p.local : ''), orientation: 'landscape', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [['Atividade', act.nome, 2], ...baseKV(ctx, ['local', 'data']), ...baseKV(ctx, ['elaborado', 'equipe']), ['Permissão de Trabalho', act.pt ? 'Necessária (' + ptLabel(act.pt) + ')' : 'Avaliar conforme a atividade'], ['Normas de referência', nrItems(act.nrs).map((l) => l.split(' — ')[0]).join(', ')]] });
    if (act.generic) doc.blocks.push({ t: 'callout', tone: 'warn', title: 'Atividade não encontrada na biblioteca', text: 'Montei uma APR genérica. Revise as etapas e perigos com a equipe que executa a atividade — ou me diga mais detalhes (equipamentos, local, altura, energia) que eu refaço.' });
    if (ctx.fromFile) doc.blocks.push({ t: 'callout', tone: 'info', title: 'Base documental', text: `APR elaborada a partir do documento “${ctx.fromFile.name}” (${ctx.fromFile.analysis.typeLabel}) e da biblioteca de riscos do OPS 360°.` });
    doc.blocks.push({ t: 'h', text: '1. Etapas da atividade' });
    doc.blocks.push({ t: 'ol', items: ctx.steps && ctx.steps.length ? ctx.steps : act.etapas });
    doc.blocks.push({ t: 'h', text: '2. Perigos, riscos e medidas de controle' });
    const rows = aprRows(act, p.detail !== 'resumido');
    doc.blocks.push({ t: 'table', head: ['Etapa', 'Perigo', 'Risco / consequência', 'P', 'S', 'Nível', 'Medidas de controle', 'Residual'], widths: [0.12, 0.17, 0.13, 0.035, 0.035, 0.08, 0.33, 0.08], rows });
    doc.blocks.push({ t: 'matrix' });
    doc.blocks.push({ t: 'h', text: '3. EPIs obrigatórios' });
    doc.blocks.push({ t: 'ul', items: act.epis });
    doc.blocks.push({ t: 'h', text: '4. Requisitos antes do início' });
    doc.blocks.push({ t: 'ul', items: act.requisitos });
    doc.blocks.push({ t: 'h', text: '5. Em caso de emergência' });
    doc.blocks.push({ t: 'ul', items: ['Interromper a atividade e isolar a área.', 'Acionar a brigada/liderança e o atendimento externo (SAMU 192 / Bombeiros 193).', 'Não mover vítimas com suspeita de lesão na coluna; em trabalho em altura, iniciar o plano de resgate imediatamente.', 'Comunicar o SESMT e registrar o ocorrido (CAT quando aplicável).'] });
    doc.blocks.push({ t: 'h', text: '6. Referências normativas' });
    doc.blocks.push({ t: 'ul', items: nrItems(act.nrs) });
    doc.blocks.push({ t: 'callout', tone: 'danger', title: 'Condição para início', text: 'Riscos classificados como **Alto** ou **Crítico** só podem ser executados com todas as medidas de controle implementadas e a APR assinada. Se as condições mudarem, **pare e revise a APR**.' });
    doc.blocks.push({ t: 'sign', items: ['Elaborado por', 'Aprovado por (SESMT)', 'Supervisor da atividade'] });
    doc.blocks.push({ t: 'table', head: ['Nº', 'Executante (nome legível)', 'Função', 'Assinatura (ciente dos riscos)'], widths: [0.05, 0.4, 0.2, 0.35], rows: Array.from({ length: +p.pessoas > 0 ? Math.min(+p.pessoas, 30) : 6 }, (_, i) => [{ text: String(i + 1), align: 'center' }, '', '', '']) });
    const altos = act.perigos.filter((x) => x[3] * x[4] >= 10).length;
    return { doc, resumo: `APR de **${act.nome}** com ${act.perigos.length} perigos avaliados (${altos} de nível Alto/Crítico), matriz de risco P×S, ${act.epis.length} EPIs, requisitos, emergência e assinaturas. Referências: ${act.nrs.map((n) => 'NR-' + String(n).padStart(2, '0')).join(', ')}.` };
  },

  pt(ctx) {
    const act = ctx.act;
    const p = ctx.params || {};
    const tipo = p.tipoPT || act.pt || 'geral';
    const isPET = tipo === 'confinado';
    const title = isPET ? 'Permissão de Entrada e Trabalho (PET)' : `Permissão de Trabalho — ${ptLabel(tipo)}`;
    const doc = newDoc('pt', title, { subtitle: act.nome + (p.local ? ' — ' + p.local : ''), company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Nº da permissão', doc.code], ...baseKV(ctx, ['local', 'data']), ['Início (hora)', ''], ['Término previsto (hora)', ''], ['Validade', 'Somente para este turno/atividade'], ['Descrição do serviço', p.descricao || act.nome, 3], ['Empresa executante', p.empresa || ctx.profile.company || ''], ['Supervisor / emitente', p.responsavel || ''], ['Vigia / observador', '']] });
    doc.blocks.push({ t: 'h', text: '1. Pré-requisitos (marcar antes da liberação)' });
    const pre = uniq([...(act.requisitos || []), ...(PT_EXTRA[tipo] || [])]).slice(0, 14);
    doc.blocks.push({ t: 'check', items: pre, cols: ['Sim', 'Não', 'N/A'] });
    if (tipo === 'confinado' || tipo === 'quente') {
      doc.blocks.push({ t: 'h', text: '2. Monitoramento da atmosfera' });
      doc.blocks.push({ t: 'table', head: ['Parâmetro', 'Limite aceitável', 'Inicial', '1ª leitura', '2ª leitura', '3ª leitura'], widths: [0.22, 0.24, 0.135, 0.135, 0.135, 0.135], rows: [['Oxigênio (O₂)', '19,5% a 23%', '', '', '', ''], ['Inflamáveis (% LIE)', 'Abaixo de 10%', '', '', '', ''], ['Monóxido de carbono (CO)', 'Abaixo do limite de exposição', '', '', '', ''], ['Sulfeto de hidrogênio (H₂S)', 'Abaixo do limite de exposição', '', '', '', ''], ['Hora / responsável', '—', '', '', '', '']] });
      doc.blocks.push({ t: 'p', text: 'Detector nº: __________  Calibrado em: ___/___/_____  Teste de resposta (bump test) realizado: ☐ Sim' });
    }
    doc.blocks.push({ t: 'h', text: `${tipo === 'confinado' || tipo === 'quente' ? 3 : 2}. EPIs e equipamentos exigidos` });
    doc.blocks.push({ t: 'check', items: act.epis, cols: ['OK'] });
    doc.blocks.push({ t: 'h', text: 'Riscos principais e medidas' });
    doc.blocks.push({ t: 'table', head: ['Perigo', 'Medidas obrigatórias'], widths: [0.35, 0.65], rows: act.perigos.filter((x) => x[3] * x[4] >= 8).slice(0, 8).map((x) => [x[1], x[5].join('; ')]) });
    doc.blocks.push({ t: 'h', text: 'Equipe autorizada' });
    doc.blocks.push({ t: 'table', head: ['Nome', 'Função', 'Treinamento válido', 'Assinatura'], widths: [0.35, 0.2, 0.2, 0.25], rows: Array.from({ length: 5 }, () => ['', '', { box: true }, '']) });
    doc.blocks.push({ t: 'callout', tone: 'warn', title: 'Suspensão imediata', text: 'A permissão perde a validade e o trabalho deve ser interrompido se: as condições mudarem, soar alarme, houver leitura fora dos limites, ocorrer emergência ou terminar o turno. Uma nova permissão deve ser emitida.' });
    doc.blocks.push({ t: 'h', text: 'Liberação e encerramento' });
    doc.blocks.push({ t: 'sign', items: ['Emitente (libera)', 'Executante responsável', isPET ? 'Supervisor de entrada' : 'Área / operação'] });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Encerrada em (data/hora)', ''], ['Área limpa e liberada', '☐ Sim  ☐ Não'], ['Responsável pelo encerramento', '']] });
    return { doc, resumo: `${title} para **${act.nome}**: ${pre.length} pré-requisitos, ${tipo === 'confinado' || tipo === 'quente' ? 'monitoramento de gases, ' : ''}checklist de EPIs, riscos principais, equipe autorizada e campos de liberação/encerramento.` };
  },

  dds(ctx) {
    const p = ctx.params || {};
    const topic = pickTopic(DDS_TOPICS, ctx.text);
    let tema, pontos, pergunta;
    if (topic) {
      tema = topic[2];
      pontos = topic[3];
      pergunta = topic[4];
    } else if (ctx.actDetected) {
      tema = p.tema || `Segurança em ${lowerFirst(ctx.act.nome)}`;
      const top = [...ctx.act.perigos].sort((a, b) => b[3] * b[4] - a[3] * a[4]).slice(0, 3);
      pontos = uniq([...ctx.act.dds, ...top.map((x) => `${x[1]}: ${x[5][0].toLowerCase()}.`)]).slice(0, 6);
      pergunta = `Qual situação de ${lowerFirst(ctx.act.nome)} mais preocupa vocês aqui na nossa área?`;
    } else {
      const adv = findAdvice(ctx.text);
      tema = p.tema ? capFirst(p.tema) : adv ? adv.titulo : 'Segurança no dia a dia';
      pontos = adv ? adv.passos.map((x) => x.replace(/\*\*/g, '')).slice(0, 6) : DDS_TOPICS[4][3];
      pergunta = 'O que podemos fazer hoje, na prática, para reduzir esse risco?';
    }
    pontos = applyItemEdits(pontos, p);
    const doc = newDoc('dds', 'Diálogo Diário de Segurança (DDS)', { subtitle: tema, company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [['Tema', tema, 2], ...baseKV(ctx, ['data']), ['Duração', p.duracao || '10 a 15 min'], ...baseKV(ctx, ['local']), ['Conduzido por', p.responsavel || ctx.profile.name || ''], ['Nº de participantes', p.pessoas || '']] });
    doc.blocks.push({ t: 'h', text: '1. Abertura (1 min)' });
    doc.blocks.push({ t: 'p', text: `Bom dia, pessoal! Hoje vamos falar sobre **${tema.toLowerCase()}**. É um assunto rápido, mas que faz diferença para todo mundo voltar para casa bem.` });
    doc.blocks.push({ t: 'h', text: '2. Pontos-chave (5–8 min)' });
    doc.blocks.push({ t: 'ol', items: pontos });
    doc.blocks.push({ t: 'h', text: '3. Pergunta para o grupo (3 min)' });
    doc.blocks.push({ t: 'callout', tone: 'info', title: 'Vamos conversar', text: pergunta });
    doc.blocks.push({ t: 'h', text: '4. Compromisso do dia' });
    doc.blocks.push({ t: 'p', text: 'Cada participante escolhe **uma atitude** para praticar hoje. Exemplo: "Hoje eu vou parar e checar antes de começar qualquer tarefa diferente".' });
    doc.blocks.push({ t: 'lines', n: 3, label: 'Observações e sugestões do grupo' });
    doc.blocks.push({ t: 'h', text: 'Lista de presença' });
    const n = Math.min(Math.max(+p.pessoas || 15, 5), 40);
    doc.blocks.push({ t: 'table', head: ['Nº', 'Nome', 'Matrícula / função', 'Assinatura'], widths: [0.06, 0.42, 0.22, 0.3], rows: Array.from({ length: n }, (_, i) => [{ text: String(i + 1), align: 'center' }, '', '', '']) });
    doc.blocks.push({ t: 'sign', items: ['Responsável pelo DDS'] });
    return { doc, resumo: `DDS sobre **${tema}**: roteiro de 10–15 min (abertura, ${pontos.length} pontos-chave, pergunta para o grupo, compromisso) e lista de presença com ${n} linhas.` };
  },

  checklist(ctx) {
    const p = ctx.params || {};
    const topic = pickTopic(CHECKLIST_TOPICS, ctx.text);
    let titulo, itens;
    let origem = null;
    if (ctx.fromFile) {
      const doDoc = extractRequirements(ctx.fromFile.text, 30);
      titulo = `Checklist — ${ctx.fromFile.analysis.typeLabel.split(' (')[0]}`;
      if (doDoc.length >= 4) {
        itens = doDoc;
        origem = `Itens extraídos automaticamente do documento “${ctx.fromFile.name}”. Revise a redação antes de usar.`;
      } else {
        const lib = topic ? topic[3] : ctx.act.checklist;
        itens = uniq([...doDoc, ...lib]);
        origem = doDoc.length
          ? `${doDoc.length} item(ns) extraído(s) de “${ctx.fromFile.name}” (os primeiros) + ${itens.length - doDoc.length} da biblioteca de ${topic ? topic[2].toLowerCase() : lowerFirst(ctx.act.nome)}. Revise antes de usar.`
          : `Não encontrei requisitos explícitos em “${ctx.fromFile.name}”, então usei a biblioteca de ${topic ? topic[2].toLowerCase() : lowerFirst(ctx.act.nome)} (assunto identificado no documento).`;
        titulo = topic ? topic[2] : `Checklist de inspeção — ${ctx.act.nome}`;
      }
    }
    if (!itens || !itens.length) {
      if (topic) {
        titulo = topic[2];
        itens = topic[3];
      } else {
        titulo = `Checklist de inspeção — ${ctx.act.nome}`;
        itens = ctx.act.checklist;
      }
    }
    itens = applyItemEdits(itens, p);
    const doc = newDoc('checklist', titulo, { subtitle: p.local || '', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [...baseKV(ctx, ['local', 'data']), ['Equipamento / identificação', p.equipamento || ''], ['Inspetor', p.responsavel || ctx.profile.name || '']] });
    if (origem) doc.blocks.push({ t: 'callout', tone: 'info', title: 'Origem dos itens', text: origem });
    doc.blocks.push({ t: 'check', items: itens, legend: 'C = Conforme · NC = Não conforme · NA = Não se aplica. Itens NC devem gerar ação corretiva com prazo e responsável.' });
    doc.blocks.push({ t: 'kv', cols: 2, items: [['Resultado', '☐ Liberado   ☐ Liberado com restrições   ☐ Bloqueado'], ['Total de NC', '']] });
    doc.blocks.push({ t: 'h', text: 'Ações para itens não conformes' });
    doc.blocks.push({ t: 'table', head: ['Item', 'Ação corretiva', 'Responsável', 'Prazo', 'Status'], widths: [0.08, 0.44, 0.2, 0.13, 0.15], rows: Array.from({ length: 4 }, () => ['', '', '', '', '']) });
    doc.blocks.push({ t: 'sign', items: ['Inspetor', 'Responsável pela área'] });
    return { doc, resumo: `${titulo} com ${itens.length} itens (C/NC/NA + observações), resultado da inspeção, tabela de ações corretivas e assinaturas.` };
  },

  os(ctx) {
    const act = ctx.act;
    const p = ctx.params || {};
    const funcao = p.funcao || (act.generic ? 'Colaborador' : `Colaborador em ${lowerFirst(act.nome)}`);
    const doc = newDoc('os', 'Ordem de Serviço de Segurança e Saúde no Trabalho', { subtitle: `Função: ${funcao}`, company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Colaborador', ''], ['Matrícula', ''], ['Função', funcao], ...baseKV(ctx, ['local', 'data']), ['Admissão', '']] });
    doc.blocks.push({ t: 'p', text: 'Em cumprimento à **NR-01 (item 1.4.1)**, esta Ordem de Serviço informa os riscos da função, as medidas de prevenção adotadas e os procedimentos a serem seguidos.' });
    doc.blocks.push({ t: 'h', text: '1. Descrição das atividades' });
    doc.blocks.push({ t: 'ul', items: act.etapas });
    doc.blocks.push({ t: 'h', text: '2. Riscos da função e medidas de prevenção' });
    doc.blocks.push({ t: 'table', head: ['Perigo / fator de risco', 'Possível consequência', 'Medidas de prevenção'], widths: [0.3, 0.22, 0.48], rows: act.perigos.map((x) => [x[1], x[2], x[5].join('; ')]) });
    doc.blocks.push({ t: 'h', text: '3. EPIs de uso obrigatório' });
    doc.blocks.push({ t: 'ul', items: act.epis });
    doc.blocks.push({ t: 'h', text: '4. Obrigações do colaborador' });
    doc.blocks.push({ t: 'ul', items: ['Cumprir as normas e procedimentos de segurança da empresa.', 'Usar corretamente os EPIs fornecidos, responsabilizando-se por sua guarda e conservação (NR-06).', 'Participar dos treinamentos e DDS.', 'Comunicar imediatamente à liderança qualquer condição de risco, incidente ou acidente.', 'Submeter-se aos exames médicos previstos no PCMSO (NR-07).', 'Interromper a atividade diante de risco grave e iminente, comunicando o superior (direito de recusa — NR-01).'] });
    doc.blocks.push({ t: 'h', text: '5. Proibições' });
    doc.blocks.push({ t: 'ul', items: ['Executar atividades para as quais não foi treinado e autorizado.', 'Remover, burlar ou inutilizar proteções e dispositivos de segurança.', 'Trabalhar sob efeito de álcool ou drogas.', 'Improvisar ferramentas, instalações ou acessos.', 'Usar celular em áreas operacionais sem autorização.'] });
    doc.blocks.push({ t: 'h', text: '6. Em caso de acidente' });
    doc.blocks.push({ t: 'ul', items: ['Comunicar imediatamente a liderança e o SESMT.', 'Procurar atendimento no ambulatório/serviço indicado.', 'Colaborar com a investigação para evitar novos acidentes.'] });
    doc.blocks.push({ t: 'callout', tone: 'warn', title: 'Penalidades', text: 'O descumprimento das normas de segurança e a recusa injustificada ao uso de EPI constituem ato faltoso (CLT, art. 158), sujeito às medidas disciplinares cabíveis.' });
    doc.blocks.push({ t: 'p', text: 'Declaro que recebi, li e compreendi esta Ordem de Serviço e as orientações de segurança da minha função, comprometendo-me a cumpri-las.' });
    doc.blocks.push({ t: 'sign', items: ['Colaborador (ciente)', 'Responsável pela orientação', 'SESMT'] });
    return { doc, resumo: `Ordem de Serviço (NR-01) para **${funcao}**: atividades, ${act.perigos.length} riscos com medidas, EPIs, obrigações, proibições, conduta em acidentes, penalidades e termo de ciência.` };
  },

  ficha_epi(ctx) {
    const act = ctx.act;
    const p = ctx.params || {};
    const doc = newDoc('ficha_epi', 'Ficha de Controle de Entrega de EPI', { subtitle: 'NR-06 — Equipamentos de Proteção Individual', orientation: 'landscape', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [['Colaborador', p.colaborador || '', 2], ['Matrícula', ''], ['Admissão', ''], ['Função', p.funcao || (act.generic ? '' : act.nome)], ['Setor', p.local || ''], ['CPF', ''], ['Empresa', p.empresa || ctx.profile.company || '']] });
    doc.blocks.push({ t: 'h', text: 'Termo de responsabilidade' });
    doc.blocks.push({ t: 'p', text: 'Declaro ter recebido gratuitamente os EPIs abaixo, novos e em perfeitas condições, bem como treinamento sobre o uso correto, guarda e conservação. Comprometo-me a: usá-los apenas para a finalidade a que se destinam; responsabilizar-me pela guarda e conservação; comunicar qualquer alteração que os torne impróprios; e cumprir as determinações do empregador sobre o uso adequado (NR-06). Estou ciente de que a recusa injustificada ao uso constitui ato faltoso (CLT, art. 158).', size: 8.4 });
    const epis = act.epis.filter((e) => !/^não há/i.test(e));
    const rows = [...epis.map((e) => ['', e, '', '1', { text: '1ª entrega', align: 'center' }, '', '', '']), ...Array.from({ length: Math.max(4, 12 - epis.length) }, () => ['', '', '', '', '', '', '', ''])];
    doc.blocks.push({ t: 'table', head: ['Data', 'EPI / descrição', 'Nº do CA', 'Qtd.', 'Motivo', 'Assinatura do colaborador', 'Devolução', 'Visto'], widths: [0.08, 0.26, 0.08, 0.05, 0.1, 0.2, 0.1, 0.13], rows, small: true });
    doc.blocks.push({ t: 'p', text: 'Motivos: 1ª entrega · substituição por desgaste · perda/extravio · dano · higienização. Verifique a validade do CA antes de cada entrega.', size: 7.8 });
    doc.blocks.push({ t: 'sign', items: ['Colaborador', 'Responsável pela entrega'] });
    return { doc, resumo: `Ficha de entrega de EPI (NR-06) com termo de responsabilidade e ${epis.length} EPIs pré-preenchidos${act.generic ? '' : ` para ${lowerFirst(act.nome)}`} + linhas extras, campos de CA, motivo, devolução e assinaturas.` };
  },

  inspecao(ctx) {
    const p = ctx.params || {};
    const photos = ctx.photos || [];
    const desc = ctx.description || '';
    const found = HAZARD_TERMS.filter((h) => h[1].split(',').some((k) => norm(desc).includes(norm(k)))).map((h) => h[0]);
    const acts = ctx.actDetected ? [ctx.act] : [];
    const issues = uniq([...extractIssues(desc), ...(ctx.fromFile ? extractIssues(ctx.fromFile.text) : [])]);
    const nrs = uniq([...(ctx.actDetected ? ctx.act.nrs : []), ...extractNRs(desc), ...guessNRsFromText(desc)]);
    const sev = /(grave|iminente|critic|risco de morte|exposta|energizad|sem guarda|altura|queda)/.test(norm(desc)) ? 'Alto' : /(moderad|atencao|improvis|desgast)/.test(norm(desc)) ? 'Moderado' : 'Moderado';
    const sevCor = sev === 'Alto' ? '#ec835a' : '#fab219';
    const doc = newDoc('inspecao', 'Relatório de Inspeção de Segurança', { subtitle: (p.local ? p.local + ' — ' : '') + (issues.length || desc ? 'Registro de não conformidade' : 'Inspeção de rotina'), company: p.empresa || ctx.profile.company || '' });
    const photoDate = photos.map((f) => f.analysis && f.analysis.photoDate).find(Boolean);
    doc.blocks.push({ t: 'kv', cols: 3, items: [...baseKV(ctx, ['local']), ['Data da inspeção', p.data ? fmtDate(p.data) : fmtDate(new Date())], ['Inspetor', p.responsavel || ctx.profile.name || ''], ['Data da foto', photoDate ? fmtDateTime(photoDate) : '—'], ['Classificação', sev], ['Status', 'Aberta']] });
    doc.blocks.push({ t: 'h', text: '1. Descrição da situação encontrada' });
    doc.blocks.push({ t: 'p', text: desc ? capFirst(desc.trim()) + (/[.!?]$/.test(desc.trim()) ? '' : '.') : 'Descreva aqui a condição observada (o que, onde, quem está exposto).' });
    if (photos.length) {
      doc.blocks.push({ t: 'h', text: '2. Registro fotográfico' });
      if (photos.length === 1) doc.blocks.push({ t: 'img', src: photos[0].image.dataUrl, caption: `Foto 1 — ${photos[0].name}${photos[0].analysis && photos[0].analysis.photoDate ? ' · ' + fmtDateTime(photos[0].analysis.photoDate) : ''}`, width: 0.75 });
      else doc.blocks.push({ t: 'gallery', cols: 2, items: photos.map((f, i) => ({ src: f.image.dataUrl, caption: `Foto ${i + 1} — ${f.name}` })) });
    }
    doc.blocks.push({ t: 'h', text: `${photos.length ? 3 : 2}. Análise de risco` });
    doc.blocks.push({ t: 'table', head: ['Perigo identificado', 'Possível consequência', 'Classificação'], widths: [0.45, 0.35, 0.2], rows: (found.length ? found : ['Condição insegura descrita']).map((f) => [capFirst(f), consequenceOf(f), { text: sev, fill: sevCor }]) });
    if (nrs.length) {
      doc.blocks.push({ t: 'p', text: '**Normas relacionadas:** ' + nrItems(nrs).join('; ') });
    }
    doc.blocks.push({ t: 'h', text: `${photos.length ? 4 : 3}. Ações corretivas (5W2H)` });
    const acoes = (issues.length ? issues : [desc || 'Condição observada']).slice(0, 8).map((iss) => [actionFor(iss + ' ' + desc), truncate(iss, 90), p.local || '', '', 'Imediato / até 7 dias', '']);
    doc.blocks.push({ t: 'table', head: ['O quê (ação)', 'Por quê (não conformidade)', 'Onde', 'Quem', 'Quando', 'Status'], widths: [0.3, 0.26, 0.12, 0.12, 0.12, 0.08], rows: acoes });
    doc.blocks.push({ t: 'callout', tone: sev === 'Alto' ? 'danger' : 'warn', title: sev === 'Alto' ? 'Risco elevado' : 'Atenção', text: sev === 'Alto' ? 'Isole a área e interrompa a atividade até a correção. Situações de risco grave e iminente exigem ação imediata.' : 'Trate a não conformidade dentro do prazo e verifique a eficácia da ação.' });
    doc.blocks.push({ t: 'sign', items: ['Inspetor', 'Responsável pela área', 'SESMT'] });
    return { doc, resumo: `Relatório de inspeção${photos.length ? ` com ${photos.length} foto(s)` : ''}: descrição, ${found.length || 1} perigo(s) identificado(s) (${sev}), ${acoes.length} ação(ões) 5W2H${nrs.length ? ', normas ' + nrs.map((n) => 'NR-' + n).join(', ') : ''} e assinaturas.` };
  },

  investigacao(ctx) {
    const p = ctx.params || {};
    const desc = ctx.description || '';
    const doc = newDoc('investigacao', 'Relatório de Investigação de Acidente / Incidente', { subtitle: p.local || '', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Tipo de ocorrência', '☐ Acidente c/ afastamento  ☐ s/ afastamento  ☐ Quase acidente', 3], ...baseKV(ctx, ['local']), ['Data e hora da ocorrência', p.data ? fmtDate(p.data) : ''], ['CAT emitida', '☐ Sim  ☐ Não  ☐ N/A'], ['Acidentado / envolvido', ''], ['Função', p.funcao || ''], ['Parte do corpo atingida', '']] });
    doc.blocks.push({ t: 'h', text: '1. Descrição do ocorrido' });
    doc.blocks.push({ t: 'p', text: desc || 'Descreva o que aconteceu, em ordem cronológica: o que a pessoa fazia, o que deu errado, qual foi a lesão/dano.' });
    doc.blocks.push({ t: 'h', text: '2. Análise de causas — 5 porquês' });
    doc.blocks.push({ t: 'table', head: ['Pergunta', 'Resposta'], widths: [0.25, 0.75], rows: ['1º Por quê?', '2º Por quê?', '3º Por quê?', '4º Por quê?', '5º Por quê? (causa raiz)'].map((q) => [q, '']) });
    doc.blocks.push({ t: 'h', text: '3. Diagrama de Ishikawa (6M)' });
    doc.blocks.push({ t: 'table', head: ['Categoria', 'Causas identificadas'], widths: [0.25, 0.75], rows: [['Método (procedimento)', ''], ['Mão de obra (pessoas/treinamento)', ''], ['Máquina (equipamento/ferramenta)', ''], ['Material', ''], ['Meio ambiente (local/condições)', ''], ['Medida (controle/inspeção)', '']] });
    doc.blocks.push({ t: 'h', text: '4. Plano de ação' });
    doc.blocks.push({ t: 'table', head: ['Ação', 'Causa tratada', 'Responsável', 'Prazo', 'Status'], widths: [0.36, 0.26, 0.14, 0.12, 0.12], rows: Array.from({ length: 5 }, () => ['', '', '', '', '']) });
    doc.blocks.push({ t: 'h', text: '5. Lições aprendidas' });
    doc.blocks.push({ t: 'lines', n: 3 });
    doc.blocks.push({ t: 'callout', tone: 'info', title: 'Lembretes', text: 'Emita a CAT até o 1º dia útil seguinte (morte: imediatamente) — evento S-2210 do eSocial. Investigue fatos, não culpados: o objetivo é corrigir as falhas de barreiras e do sistema.' });
    doc.blocks.push({ t: 'sign', items: ['Coordenador da investigação', 'Membro da CIPA', 'SESMT'] });
    return { doc, resumo: 'Relatório de investigação com descrição, 5 porquês, Ishikawa (6M), plano de ação, lições aprendidas e lembretes de CAT/eSocial.' };
  },

  plano_acao(ctx) {
    const p = ctx.params || {};
    let rows = [];
    const src = ctx.fromFile;
    if (src) {
      const issues = uniq([...src.analysis.alerts.map((a) => a.replace(/^[^\wÀ-ÿ]+/, '')), ...extractIssues(src.text)]).slice(0, 12);
      rows = issues.map((iss) => [actionFor(iss), truncate(iss, 100), p.local || '', '', '', '', '']);
    } else if (ctx.actDetected) {
      rows = ctx.act.perigos
        .filter((x) => x[3] * x[4] >= 10)
        .slice(0, 10)
        .map((x) => [x[5][0], `Controlar: ${x[1].toLowerCase()} (${riskLevel(x[3], x[4]).nivel})`, p.local || '', '', '', 'Treinamento / procedimento / inspeção', '']);
    } else {
      const issues = extractIssues(ctx.description || ctx.text);
      rows = issues.map((iss) => [actionFor(iss), iss, p.local || '', '', '', '', '']);
    }
    while (rows.length < 6) rows.push(['', '', '', '', '', '', '']);
    const doc = newDoc('plano_acao', 'Plano de Ação 5W2H', { subtitle: src ? `Com base em: ${src.name}` : ctx.actDetected ? ctx.act.nome : p.tema || '', orientation: 'landscape', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [...baseKV(ctx, ['local', 'data', 'elaborado']), ['Revisão em', '']] });
    doc.blocks.push({ t: 'table', head: ['O quê (What)', 'Por quê (Why)', 'Onde (Where)', 'Quem (Who)', 'Quando (When)', 'Como (How)', 'Quanto (How much)'], widths: [0.22, 0.2, 0.1, 0.11, 0.1, 0.17, 0.1], rows });
    doc.blocks.push({ t: 'p', text: 'Status sugerido: **Não iniciado · Em andamento · Concluído · Verificada a eficácia**. Priorize ações de riscos Alto/Crítico e verifique a eficácia após a implementação.' });
    doc.blocks.push({ t: 'sign', items: ['Elaborado por', 'Aprovado por'] });
    return { doc, resumo: `Plano de ação 5W2H com ${rows.filter((r) => r[0]).length} ação(ões) ${src ? 'extraídas do documento' : ctx.actDetected ? 'para os riscos Alto/Crítico da atividade' : 'a partir da sua descrição'} + linhas em branco para completar.` };
  },

  pop(ctx) {
    const act = ctx.act;
    const p = ctx.params || {};
    const doc = newDoc('pop', 'Procedimento Operacional Padrão (POP)', { subtitle: act.nome, company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [['Código', doc.code], ['Revisão', '00'], ...baseKV(ctx, ['data', 'elaborado'])] });
    doc.blocks.push({ t: 'h', text: '1. Objetivo' });
    doc.blocks.push({ t: 'p', text: `Estabelecer o método seguro e padronizado para ${lowerFirst(act.nome)}, prevenindo acidentes e danos.` });
    doc.blocks.push({ t: 'h', text: '2. Aplicação' });
    doc.blocks.push({ t: 'p', text: `Aplica-se a todos os empregados e contratados que executam ${lowerFirst(act.nome)}${p.local ? ' em ' + p.local : ''}.` });
    doc.blocks.push({ t: 'h', text: '3. Responsabilidades' });
    doc.blocks.push({ t: 'ul', items: ['**Liderança:** garantir recursos, treinamento e o cumprimento deste procedimento.', '**Executantes:** seguir o procedimento, usar os EPIs e comunicar desvios.', '**SESMT:** orientar, inspecionar e manter o procedimento atualizado.'] });
    doc.blocks.push({ t: 'h', text: '4. Requisitos e EPIs' });
    doc.blocks.push({ t: 'ul', items: [...act.requisitos, 'EPIs: ' + act.epis.join('; ') + '.'] });
    doc.blocks.push({ t: 'h', text: '5. Descrição das atividades (passo a passo)' });
    const steps = act.etapas.map((e) => {
      const ctl = act.perigos.filter((x) => x[0] === e).flatMap((x) => x[5]).slice(0, 3);
      return `**${e}.** ${ctl.length ? ctl.join('; ') + '.' : 'Executar conforme treinamento, com atenção aos riscos da etapa.'}`;
    });
    doc.blocks.push({ t: 'ol', items: steps });
    doc.blocks.push({ t: 'h', text: '6. Situações de emergência' });
    doc.blocks.push({ t: 'ul', items: ['Interromper a atividade, isolar a área e acionar a liderança/brigada.', 'Acionar SAMU 192 / Bombeiros 193 quando necessário.', 'Seguir o plano de emergência da unidade.'] });
    doc.blocks.push({ t: 'h', text: '7. Referências' });
    doc.blocks.push({ t: 'ul', items: nrItems(act.nrs) });
    doc.blocks.push({ t: 'h', text: '8. Histórico de revisões' });
    doc.blocks.push({ t: 'table', head: ['Revisão', 'Data', 'Descrição da alteração', 'Responsável'], widths: [0.1, 0.15, 0.5, 0.25], rows: [['00', fmtDate(new Date()), 'Emissão inicial (gerado pelo OPS 360° IA)', ctx.profile.name || ''], ['', '', '', '']] });
    doc.blocks.push({ t: 'sign', items: ['Elaborado por', 'Revisado por', 'Aprovado por'] });
    return { doc, resumo: `POP de **${act.nome}** com objetivo, aplicação, responsabilidades, requisitos/EPIs, ${steps.length} passos com controles, emergência, referências e controle de revisões.` };
  },

  lista_presenca(ctx) {
    const p = ctx.params || {};
    const tema = p.tema || (ctx.actDetected ? `Treinamento — ${ctx.act.nome}` : 'Treinamento de segurança');
    const n = Math.min(Math.max(+p.pessoas || 25, 5), 60);
    const doc = newDoc('lista_presenca', 'Lista de Presença', { subtitle: tema, company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [['Tema', tema, 2], ...baseKV(ctx, ['data']), ['Carga horária', p.duracao || ''], ...baseKV(ctx, ['local']), ['Instrutor', p.responsavel || ''], ['Horário', ''], ['Modalidade', '☐ Presencial  ☐ EAD  ☐ Semipresencial']] });
    doc.blocks.push({ t: 'table', head: ['Nº', 'Nome completo', 'Matrícula', 'Função / setor', 'Assinatura'], widths: [0.05, 0.37, 0.12, 0.2, 0.26], rows: Array.from({ length: n }, (_, i) => [{ text: String(i + 1), align: 'center' }, '', '', '', '']) });
    doc.blocks.push({ t: 'sign', items: ['Instrutor', 'Responsável'] });
    return { doc, resumo: `Lista de presença para **${tema}** com ${n} linhas, dados do treinamento e assinaturas.` };
  },

  comunicado(ctx) {
    const p = ctx.params || {};
    const adv = findAdvice(ctx.text);
    const assunto = p.tema || (ctx.actDetected ? ctx.act.nome : adv ? adv.titulo : 'Segurança em primeiro lugar');
    const doc = newDoc('comunicado', /alerta/i.test(ctx.text) ? 'Alerta de Segurança' : 'Comunicado de Segurança', { subtitle: capFirst(assunto), company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [...baseKV(ctx, ['data']), ['Público', p.publico || 'Todos os colaboradores'], ['Emitido por', p.responsavel || ctx.profile.name || 'SESMT']] });
    doc.blocks.push({ t: 'callout', tone: 'danger', title: 'Mensagem principal', text: ctx.description ? capFirst(ctx.description) : `Atenção redobrada: ${lowerFirst(assunto)}. Siga os procedimentos e use os EPIs obrigatórios.` });
    const pontos = applyItemEdits(ctx.actDetected ? ctx.act.dds : adv ? adv.passos.map((x) => x.replace(/\*\*/g, '')).slice(0, 5) : ['Pare, pense e planeje antes de iniciar a tarefa.', 'Use os EPIs obrigatórios da área.', 'Comunique qualquer condição insegura.'], p);
    doc.blocks.push({ t: 'h', text: 'O que fazer' });
    doc.blocks.push({ t: 'ul', items: pontos });
    if (ctx.actDetected) {
      doc.blocks.push({ t: 'h', text: 'EPIs obrigatórios' });
      doc.blocks.push({ t: 'ul', items: ctx.act.epis.slice(0, 6) });
    }
    doc.blocks.push({ t: 'p', text: 'Dúvidas? Procure sua liderança ou o SESMT. **Segurança é compromisso de todos.**' });
    return { doc, resumo: `Comunicado/alerta sobre **${assunto}** com mensagem principal em destaque, orientações${ctx.actDetected ? ', EPIs' : ''} e contato.` };
  },

  treinamento(ctx) {
    const p = ctx.params || {};
    const nr = (p.nr && NRS[p.nr]) ? p.nr : ctx.actDetected ? ctx.act.nrs[0] : null;
    const conteudo = TRAINING_CONTENT[nr] || (ctx.actDetected ? ['Normas e procedimentos aplicáveis', ...ctx.act.perigos.slice(0, 5).map((x) => `${x[1]} — prevenção e controle`), 'EPIs: seleção, uso, inspeção e conservação', 'Situações de emergência'] : ['Conceitos de SST e responsabilidades', 'Riscos da atividade e medidas de controle', 'EPIs e EPCs', 'Procedimentos de emergência']);
    const ch = TRAINING_HOURS[nr] || p.duracao || '';
    const tema = p.tema || (nr ? `Capacitação NR-${String(nr).padStart(2, '0')} — ${NRS[nr].titulo}` : ctx.actDetected ? `Capacitação — ${ctx.act.nome}` : 'Capacitação em SST');
    const doc = newDoc('treinamento', 'Plano de Treinamento', { subtitle: tema, company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Treinamento', tema, 3], ['Carga horária', ch], ['Modalidade', '☐ Presencial  ☐ EAD  ☐ Semipresencial'], ['Público-alvo', p.publico || (ctx.actDetected ? `Trabalhadores em ${lowerFirst(ctx.act.nome)}` : '')], ['Instrutor', p.responsavel || ''], ['Reciclagem', TRAINING_RECYCLE[nr] || 'Conforme NR aplicável'], ...baseKV(ctx, ['data'])] });
    doc.blocks.push({ t: 'h', text: '1. Objetivo' });
    doc.blocks.push({ t: 'p', text: `Capacitar os participantes para identificar os riscos e aplicar as medidas de prevenção${nr ? ` previstas na NR-${String(nr).padStart(2, '0')}` : ''}, atuando com segurança na rotina e em emergências.` });
    doc.blocks.push({ t: 'h', text: '2. Conteúdo programático' });
    doc.blocks.push({ t: 'ol', items: conteudo });
    doc.blocks.push({ t: 'h', text: '3. Metodologia e avaliação' });
    doc.blocks.push({ t: 'ul', items: ['Aulas expositivas dialogadas com casos reais.', 'Parte prática supervisionada (quando exigida pela NR).', 'Avaliação teórica e/ou prática; aproveitamento mínimo definido pela empresa.', 'Emissão de certificado com conteúdo, carga horária, data, local e assinaturas do instrutor e do responsável técnico.'] });
    if (nr && TRAINING_CONTENT[nr]) doc.blocks.push({ t: 'callout', tone: 'info', title: 'Base normativa', text: `Conteúdo e carga horária de referência da NR-${String(nr).padStart(2, '0')}. Confira sempre o texto vigente da norma e as particularidades da sua atividade.` });
    return { doc, resumo: `Plano de treinamento **${tema}**${ch ? ` (${ch})` : ''}: objetivo, ${conteudo.length} módulos de conteúdo, metodologia, avaliação e certificação.` };
  },

  inventario(ctx) {
    const p = ctx.params || {};
    const acts = ctx.acts && ctx.acts.length ? ctx.acts : [ctx.act];
    const rows = [];
    for (const a of acts) {
      for (const x of a.perigos) {
        const rl = riskLevel(x[3], x[4]);
        rows.push([a.nome, x[1], x[2], classifyHazard(x[1]), { text: String(x[3]), align: 'center' }, { text: String(x[4]), align: 'center' }, { text: rl.nivel, fill: rl.cor }, x[5].slice(0, 2).join('; ')]);
      }
    }
    const doc = newDoc('inventario', 'Inventário de Riscos Ocupacionais', { subtitle: 'Base para o PGR (NR-01) — ' + acts.map((a) => a.nome).join(', '), orientation: 'landscape', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [...baseKV(ctx, ['local', 'data', 'elaborado']), ['Revisão', '00']] });
    doc.blocks.push({ t: 'table', head: ['Atividade / GHE', 'Perigo', 'Possíveis lesões / agravos', 'Tipo', 'P', 'S', 'Nível', 'Medidas de prevenção existentes/propostas'], widths: [0.13, 0.18, 0.15, 0.09, 0.035, 0.035, 0.07, 0.31], rows, small: true });
    doc.blocks.push({ t: 'matrix' });
    doc.blocks.push({ t: 'callout', tone: 'warn', title: 'Importante', text: 'Este inventário é um ponto de partida. O PGR deve considerar as condições reais de cada estabelecimento, avaliações quantitativas quando necessárias (NR-09), fatores ergonômicos e psicossociais (NR-01/NR-17) e a participação dos trabalhadores.' });
    doc.blocks.push({ t: 'sign', items: ['Elaborado por (responsável técnico)', 'Aprovado por'] });
    return { doc, resumo: `Inventário de riscos com ${rows.length} perigos de ${acts.length} atividade(s), classificação por tipo, P×S, nível e medidas — base para o PGR.` };
  },

  pae(ctx) {
    const p = ctx.params || {};
    const doc = newDoc('pae', 'Plano de Atendimento a Emergências (PAE)', { subtitle: p.local || 'Versão simplificada', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [...baseKV(ctx, ['local', 'data', 'elaborado']), ['Ponto de encontro', ''], ['Coordenador de emergência', ''], ['Brigada (turno)', '']] });
    doc.blocks.push({ t: 'h', text: '1. Contatos de emergência' });
    doc.blocks.push({ t: 'table', head: ['Serviço', 'Telefone', 'Observação'], widths: [0.4, 0.2, 0.4], rows: [['SAMU', '192', 'Atendimento médico de urgência'], ['Corpo de Bombeiros', '193', 'Incêndio, resgate, salvamento'], ['Polícia Militar', '190', ''], ['Defesa Civil', '199', ''], ['Brigada / portaria interna', '', ''], ['SESMT / ambulatório', '', ''], ['Hospital de referência', '', '']] });
    doc.blocks.push({ t: 'h', text: '2. Cenários e ações' });
    doc.blocks.push({ t: 'table', head: ['Cenário', 'Ações imediatas', 'Responsável'], widths: [0.2, 0.62, 0.18], rows: [
      ['Princípio de incêndio', 'Acionar alarme; combater só se treinado e com segurança (extintor adequado); desligar energia; evacuar pela rota de fuga; acionar 193.', 'Brigada'],
      ['Acidente com vítima', 'Garantir a segurança da cena; acionar 192; prestar primeiros socorros; não mover vítima com suspeita de trauma; comunicar SESMT.', 'Socorristas'],
      ['Queda / suspensão em altura', 'Acionar o plano de resgate imediatamente (suspensão inerte é crítica); equipe treinada; 193 se necessário.', 'Equipe de resgate'],
      ['Choque elétrico', 'Não tocar na vítima; desligar a fonte de energia; acionar 192; iniciar RCP se treinado.', 'Eletricista / brigada'],
      ['Vazamento de produto químico', 'Isolar a área; consultar a FDS (seções 5 e 6); usar kit de contenção com EPI adequado; ventilar; acionar 193 se grande porte.', 'Brigada'],
      ['Evacuação geral', 'Alarme; abandonar pela rota sinalizada sem correr; não usar elevadores; ir ao ponto de encontro; conferir presença.', 'Coordenador'],
    ] });
    doc.blocks.push({ t: 'h', text: '3. Recursos disponíveis' });
    doc.blocks.push({ t: 'check', items: ['Extintores inspecionados e sinalizados', 'Hidrantes/mangueiras (se houver)', 'Alarme de emergência testado', 'Iluminação de emergência funcionando', 'Rotas de fuga sinalizadas e desobstruídas', 'Kits de primeiros socorros abastecidos', 'Kit de contenção de derramamento', 'Equipamentos de resgate em altura/espaço confinado (se aplicável)'], cols: ['OK', 'NC'] });
    doc.blocks.push({ t: 'h', text: '4. Simulados' });
    doc.blocks.push({ t: 'p', text: 'Realizar simulados periódicos (recomendado ao menos anualmente ou conforme exigência do Corpo de Bombeiros), registrando tempo de abandono, falhas e melhorias.' });
    doc.blocks.push({ t: 'sign', items: ['Elaborado por', 'Coordenador de emergência', 'Aprovado por'] });
    return { doc, resumo: 'PAE simplificado com contatos, 6 cenários com ações e responsáveis, checklist de recursos e orientação para simulados.' };
  },

  resumo_doc(ctx) {
    const f = ctx.fromFile;
    const a = f.analysis;
    const doc = newDoc('resumo_doc', 'Relatório de Análise de Documento', { subtitle: f.name, company: ctx.params.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Arquivo', f.name, 2], ['Formato', KIND_LABEL[f.kind] || f.kind], ['Tipo identificado', a.typeLabel], ['Páginas / abas', f.meta.pageCount || f.meta.sheetCount || f.meta.slideCount || '—'], ['Palavras', fmtNum(a.words || 0)], ['Empresa citada', a.empresa || '—'], ['Responsável citado', a.responsavel || '—'], ['Analisado em', fmtDateTime(new Date())]] });
    doc.blocks.push({ t: 'h', text: '1. Resumo' });
    doc.blocks.push({ t: 'ul', items: a.summary.length ? a.summary : ['Documento sem texto legível.'] });
    if (a.alerts.length) {
      doc.blocks.push({ t: 'h', text: '2. Pontos de atenção' });
      doc.blocks.push({ t: 'ul', items: a.alerts.map((x) => x.replace(/^[^\wÀ-ÿ“"]+/, '')) });
    }
    doc.blocks.push({ t: 'h', text: '3. Elementos identificados' });
    doc.blocks.push({ t: 'table', head: ['Elemento', 'Encontrado'], widths: [0.25, 0.75], rows: [['Normas citadas', a.nrs.length ? a.nrs.map((n) => 'NR-' + String(n).padStart(2, '0')).join(', ') : '—'], ['EPIs', a.epis.join(', ') || '—'], ['Perigos/agentes', a.hazards.join(', ') || '—'], ['CAs de EPI', a.cas.join(', ') || '—'], ['Validades', a.validity.length ? a.validity.map((v) => `${v.raw} (${v.status})`).join('; ') : '—'], ['Palavras-chave', a.keywords.join(', ')]] });
    if (a.tables && a.tables.length) {
      doc.blocks.push({ t: 'h', text: '4. Tabelas/planilhas' });
      doc.blocks.push({ t: 'table', head: ['Tabela', 'Linhas', 'Colunas'], widths: [0.3, 0.1, 0.6], rows: a.tables.map((t) => [t.name, String(t.rows), t.cols.map((c) => `${c.name} (${c.type})`).join(', ')]) });
    }
    const reqs = extractRequirements(f.text, 12);
    if (reqs.length) {
      doc.blocks.push({ t: 'h', text: 'Requisitos e obrigações encontrados' });
      doc.blocks.push({ t: 'ul', items: reqs });
    }
    doc.blocks.push({ t: 'h', text: 'Recomendações' });
    doc.blocks.push({ t: 'ul', items: recommendationsFor(f) });
    return { doc, resumo: `Relatório de análise de **${f.name}**: resumo, ${a.alerts.length} ponto(s) de atenção, normas, EPIs, validades e recomendações.` };
  },
};

const PT_EXTRA = {
  altura: ['Área abaixo isolada e sinalizada', 'Ancoragem definida e inspecionada', 'Condições climáticas favoráveis', 'Equipe de resgate disponível', 'Trabalhadores com NR-35 válida e ASO apto'],
  quente: ['Materiais combustíveis removidos/protegidos (raio ~11 m)', 'Extintor adequado no local', 'Vigia de fogo designado (durante e 30 min após)', 'Cilindros acorrentados e com válvulas corta-chamas', 'Medição de inflamáveis quando houver risco'],
  confinado: ['Espaço identificado e sinalizado', 'Bloqueio e etiquetagem de energias e linhas', 'Ventilação instalada e funcionando', 'Vigia designado (não entra)', 'Equipamentos de resgate posicionados', 'Comunicação testada', 'Trabalhadores com capacitação NR-33 válida'],
  eletrica: ['Circuito identificado no diagrama', 'Seccionamento realizado', 'Bloqueio e etiquetagem por executante', 'Ausência de tensão constatada', 'Aterramento temporário instalado', 'Zona controlada sinalizada', 'Trabalhadores autorizados (NR-10)'],
  geral: ['Área inspecionada e liberada', 'Riscos comunicados à equipe', 'Ferramentas e equipamentos inspecionados', 'EPIs disponíveis'],
};
function ptLabel(t) {
  return { altura: 'Trabalho em altura', quente: 'Trabalho a quente', confinado: 'Espaço confinado (PET)', eletrica: 'Serviços em eletricidade', geral: 'Trabalho geral' }[t] || 'Trabalho';
}
const TRAINING_CONTENT = {
  35: ['Normas e regulamentos aplicáveis ao trabalho em altura', 'Análise de risco e condições impeditivas', 'Riscos potenciais inerentes ao trabalho em altura e medidas de prevenção e controle', 'Sistemas, equipamentos e procedimentos de proteção coletiva', 'EPIs para trabalho em altura: seleção, inspeção, conservação e limitação de uso', 'Acidentes típicos em trabalhos em altura', 'Condutas em situações de emergência, incluindo noções de técnicas de resgate e primeiros socorros'],
  10: ['Introdução à segurança com eletricidade', 'Riscos em instalações e serviços com eletricidade (choque, arco, campos)', 'Técnicas de análise de risco', 'Medidas de controle do risco elétrico (desenergização, aterramento, equipotencialização, bloqueios)', 'Normas técnicas brasileiras e regulamentações do MTE', 'Equipamentos de proteção coletiva e individual', 'Rotinas de trabalho e procedimentos', 'Documentação de instalações elétricas', 'Riscos adicionais (altura, confinamento, áreas classificadas, umidade)', 'Proteção e combate a incêndios', 'Acidentes de origem elétrica', 'Primeiros socorros e técnicas de resgate'],
  33: ['Definições e reconhecimento de espaços confinados', 'Identificação e avaliação dos riscos (atmosferas perigosas, engolfamento, energias)', 'Funcionamento e uso de equipamentos de medição', 'Procedimentos e utilização da PET', 'Controle de energias perigosas e isolamentos', 'Ventilação', 'EPIs e equipamentos de resgate', 'Noções de resgate e primeiros socorros'],
  11: ['Normas aplicáveis (NR-11) e responsabilidades do operador', 'Tipos de empilhadeira, componentes e dispositivos de segurança', 'Inspeção pré-operacional (checklist)', 'Estabilidade, centro de gravidade e capacidade de carga', 'Técnicas de operação: deslocamento, empilhamento, rampas e docas', 'Circulação com pedestres e sinalização', 'Abastecimento/recarga (GLP e baterias)', 'Situações de emergência', 'Prática supervisionada'],
  12: ['Descrição e identificação dos riscos associados à máquina e às proteções', 'Funcionamento das proteções: como e por que devem ser usadas', 'Como e em que circunstâncias uma proteção pode ser removida e por quem', 'Procedimentos de parada, bloqueio e energia zero', 'Métodos de trabalho seguro', 'Permissão de trabalho e procedimentos em emergência', 'Prática na máquina'],
  6: ['Hierarquia de controles: por que o EPI é a última barreira', 'Obrigações do empregador e do empregado (NR-06)', 'Certificado de Aprovação (CA)', 'Seleção, uso correto, higienização e guarda', 'Inspeção e substituição', 'Demonstração prática de colocação e ajuste'],
  5: ['Estudo do ambiente, das condições de trabalho e dos riscos', 'Noções sobre acidentes e doenças relacionadas ao trabalho', 'Metodologia de investigação e análise de acidentes', 'Princípios de higiene do trabalho e medidas de controle', 'Noções sobre legislação trabalhista e previdenciária em SST', 'Noções sobre inclusão de pessoas com deficiência e reabilitados', 'Organização da CIPA e outros assuntos necessários', 'Prevenção e combate ao assédio sexual e a outras formas de violência no trabalho'],
  20: ['Inflamáveis: características, propriedades e perigos', 'Controle de fontes de ignição', 'Proteção contra incêndio com inflamáveis', 'Procedimentos básicos em situações de emergência', 'Estudo da NR-20', 'Análise preliminar de perigos/riscos', 'Permissão de trabalho com inflamáveis'],
  23: ['Prevenção de incêndios e classes de fogo', 'Uso de extintores e hidrantes', 'Procedimentos de abandono de área e rotas de fuga', 'Dispositivos de alarme', 'Primeiros socorros básicos'],
};
const TRAINING_HOURS = { 35: '8 horas (teórico e prático)', 10: '40 horas (básico)', 33: '16 horas (autorizados e vigias) / 40 horas (supervisores)', 5: '8h (GR1), 12h (GR2), 16h (GR3) ou 20h (GR4)' };
const TRAINING_RECYCLE = { 35: 'Bienal (8h) e nos casos eventuais da norma', 10: 'Bienal e nos casos previstos na norma', 33: 'Anual', 11: 'Revalidação anual do cartão do operador (com exame de saúde)', 5: 'A cada mandato' };

function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
function consequenceOf(h) {
  const t = norm(h);
  if (/queda de altura/.test(t)) return 'Fraturas, traumatismos, morte';
  if (/choque|arco/.test(t)) return 'Queimaduras, parada cardiorrespiratória';
  if (/ruido/.test(t)) return 'Perda auditiva (PAIR)';
  if (/quimic|vapor|gases|fumos|poeira/.test(t)) return 'Intoxicação, doenças respiratórias, dermatites';
  if (/incendio|explos/.test(t)) return 'Queimaduras, danos materiais, morte';
  if (/prensamento|esmaga|corte/.test(t)) return 'Lesões nas mãos, amputações';
  if (/atropel|colis/.test(t)) return 'Traumatismos graves, morte';
  if (/ergonom/.test(t)) return 'Lesões musculoesqueléticas';
  if (/mesmo nivel/.test(t)) return 'Entorses, contusões, fraturas';
  return 'Lesões diversas';
}
function classifyHazard(h) {
  const t = norm(h);
  if (/ruido|calor|frio|vibracao|radiacao|pressao/.test(t)) return 'Físico';
  if (/quimic|vapor|gases|fumos|poeira|solvente|toxic|atmosfera/.test(t)) return 'Químico';
  if (/biolog|virus|bacteria|lixo|perfurocort/.test(t)) return 'Biológico';
  if (/postura|repetit|ergonom|carga manual|levantamento|sobrecarga|esforco/.test(t)) return 'Ergonômico';
  if (/estresse|psicossoc|assedio|meta|fadiga/.test(t)) return 'Psicossocial';
  return 'Acidente';
}
function guessNRsFromText(t) {
  const n = norm(t);
  const out = [];
  const add = (re, nr) => re.test(n) && out.push(nr);
  add(/fiacao|eletric|painel|quadro|tomada|energizad/, 10);
  add(/empilhadeira|carga|armazen|palete/, 11);
  add(/maquina|prensa|protecao|correia|polia|serra/, 12);
  add(/altura|telhado|andaime|escada|guarda-corpo|guarda corpo/, 35);
  add(/extintor|incendio|rota de fuga|saida de emergencia/, 23);
  add(/sinaliza|faixa|placa|fds|fispq|rotul/, 26);
  add(/epi|capacete|luva|oculos|protetor|botina/, 6);
  add(/confinado|tanque|silo/, 33);
  add(/banheiro|sanitario|vestiario|refeitorio|agua potavel/, 24);
  add(/ergonom|postura|cadeira|mobiliario/, 17);
  return out;
}
function recommendationsFor(f) {
  const a = f.analysis;
  const r = [];
  if (a.validity.some((v) => v.status === 'vencido')) r.push('Renovar os itens/documentos vencidos e controlar as validades (posso criar uma aba de controle com alertas).');
  if (a.type === 'ppra' || a.alerts.some((x) => /PPRA/.test(x))) r.push('Migrar o conteúdo do PPRA para o PGR (inventário de riscos + plano de ação — NR-01).');
  if (a.type === 'apr' || a.type === 'pt') r.push('Conferir se todas as etapas têm medidas de controle e se os responsáveis assinaram.');
  if (a.type === 'fds') r.push('Garantir que a FDS esteja acessível no local de uso e que os EPIs da seção 8 estejam disponíveis.');
  if (a.type === 'certificado') r.push('Registrar o treinamento no controle de capacitações e programar a reciclagem.');
  if (a.type === 'procedimento') r.push('Transformar os requisitos em checklist de verificação e treinar a equipe no procedimento.');
  if (a.nrs.length) r.push(`Verificar a conformidade com ${a.nrs.map((n) => 'NR-' + String(n).padStart(2, '0')).join(', ')} no texto vigente das normas.`);
  if (!r.length) r.push('Revisar o documento com o responsável técnico e manter versão controlada.');
  return r;
}


/* ===== 15-memory.js ===== */
// ---------------------------------------------------------------------------
// 15 · Memória adaptativa (local): perfil, preferências, fatos ensinados,
//      frases aprendidas, sinônimos de atividades, feedback 👍/👎 e estatísticas.
//      Tudo fica no navegador e pode ser visto/apagado/exportado pelo usuário.
// ---------------------------------------------------------------------------
function defaultMemory() {
  return {
    version: 1,
    enabled: true,
    profile: { name: CFG.userName || null, company: CFG.company || null, role: null, sector: null, location: null },
    prefs: { format: { pdf: 0, docx: 0, xlsx: 0, print: 0 }, detail: { completo: 0, resumido: 0 } },
    counts: { activities: {}, docTypes: {}, intents: {}, topics: {} },
    facts: [],
    learned: [],
    synonyms: {},
    feedback: { up: 0, down: 0, byIntent: {} },
    negatives: [],
    stats: { messages: 0, firstSeen: Date.now(), lastSeen: Date.now() },
  };
}
const memory = {
  data: defaultMemory(),
  async load() {
    const saved = await db.get('kv', 'memory');
    const d = defaultMemory();
    if (saved) {
      for (const k of Object.keys(d)) if (saved[k] !== undefined) d[k] = typeof d[k] === 'object' && !Array.isArray(d[k]) ? { ...d[k], ...saved[k] } : saved[k];
    }
    if (CFG.userName && !d.profile.name) d.profile.name = CFG.userName;
    if (CFG.company && !d.profile.company) d.profile.company = CFG.company;
    // tenta descobrir o nome do usuário pelo app hospedeiro
    if (!d.profile.name) {
      const host = PAGE.OPS360 || PAGE.ops360 || {};
      const n = (host.usuario && (host.usuario.nome || host.usuario.name)) || (host.user && (host.user.nome || host.user.name)) || null;
      if (n) d.profile.name = String(n).split(' ')[0];
    }
    this.data = d;
  },
  _save: debounce(() => db.put('kv', deepClone(memory.data), 'memory'), 400),
  save() {
    this._save();
    bus.emit('memory:changed', this.data);
  },
  get profile() {
    return this.data.profile;
  },
  get enabled() {
    return this.data.enabled !== false;
  },
  setProfile(k, v) {
    this.data.profile[k] = v;
    this.save();
  },
  inc(bucket, key, by = 1) {
    if (!key) return;
    const b = (this.data.counts[bucket] = this.data.counts[bucket] || {});
    b[key] = (b[key] || 0) + by;
  },
  noteTurn(text, res) {
    this.data.stats.messages++;
    this.data.stats.lastSeen = Date.now();
    if (!this.enabled) return this.save();
    this.inc('intents', res.intent);
    for (const a of res.activities || []) this.inc('activities', a);
    if (res.docType) this.inc('docTypes', res.docType);
    if (res.format && this.data.prefs.format[res.format] !== undefined) this.data.prefs.format[res.format]++;
    if (res.detail && this.data.prefs.detail[res.detail] !== undefined) this.data.prefs.detail[res.detail]++;
    for (const k of keywords(text, 3)) this.inc('topics', k);
    this.save();
  },
  top(bucket, n = 3) {
    return Object.entries(this.data.counts[bucket] || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => ({ key: k, count: v }));
  },
  preferredFormat() {
    const f = this.data.prefs.format;
    const best = Object.entries(f).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 2 ? best[0] : null;
  },
  preferredDetail() {
    const d = this.data.prefs.detail;
    return d.resumido >= 3 && d.resumido > d.completo * 1.5 ? 'resumido' : d.completo >= 3 && d.completo > d.resumido * 1.5 ? 'completo' : null;
  },
  addFact(text) {
    const f = { id: uid('fact'), text: capFirst(text.trim().replace(/[.;]+$/, '')), at: Date.now() };
    if (this.data.facts.some((x) => norm(x.text) === norm(f.text))) return null;
    this.data.facts.push(f);
    this.save();
    return f;
  },
  removeFact(id) {
    this.data.facts = this.data.facts.filter((f) => f.id !== id);
    this.save();
  },
  forgetMatching(query) {
    const ix = new BM25();
    this.data.facts.forEach((f) => ix.add(f.id, f.text));
    const hits = ix.search(query, 5).filter((h) => h.coverage >= 0.5);
    this.data.facts = this.data.facts.filter((f) => !hits.some((h) => h.id === f.id));
    this.save();
    return hits.length;
  },
  recallFacts(query, k = 3) {
    if (!this.data.facts.length) return [];
    const ix = new BM25();
    this.data.facts.forEach((f) => ix.add(f.id, f.text, f));
    return ix
      .search(query, k)
      .filter((r) => r.coverage >= 0.34)
      .map((r) => r.meta);
  },
  // aprende "quando eu disser X, quero Y"
  learn(phrase, intent, slots = {}) {
    if (!this.enabled || !phrase) return;
    const toks = tokenize(phrase);
    if (!toks.length) return;
    const ex = this.data.learned.find((l) => jaccard(l.tokens, toks) > 0.85);
    if (ex) {
      ex.intent = intent;
      ex.slots = slots;
      ex.at = Date.now();
    } else this.data.learned.push({ phrase: truncate(phrase, 160), tokens: toks, intent, slots, at: Date.now(), hits: 0 });
    this.data.learned = this.data.learned.slice(-300);
    this.save();
  },
  matchLearned(text) {
    const toks = tokenize(text);
    if (toks.length < 1) return null;
    let best = null, bestS = 0;
    for (const l of this.data.learned) {
      const s = jaccard(l.tokens, toks);
      if (s > bestS) {
        best = l;
        bestS = s;
      }
    }
    if (best && (bestS >= 0.8 || (bestS >= 0.66 && toks.length >= 3))) {
      best.hits++;
      return { ...best, score: bestS };
    }
    return null;
  },
  learnSynonym(word, activityId) {
    const w = norm(word).trim();
    if (!w || w.length < 3 || !ACT_BY_ID[activityId]) return;
    this.data.synonyms[w] = activityId;
    this.save();
  },
  feedback(value, intent, text) {
    if (value > 0) this.data.feedback.up++;
    else this.data.feedback.down++;
    const b = (this.data.feedback.byIntent[intent] = this.data.feedback.byIntent[intent] || { up: 0, down: 0 });
    if (value > 0) b.up++;
    else b.down++;
    if (value < 0 && text) {
      this.data.negatives.push({ tokens: tokenize(text), intent, at: Date.now() });
      this.data.negatives = this.data.negatives.slice(-200);
    }
    this.save();
  },
  isNegative(text, intent) {
    const toks = tokenize(text);
    return this.data.negatives.some((n) => n.intent === intent && jaccard(n.tokens, toks) > 0.8);
  },
  clear() {
    const keepName = this.data.profile.name;
    this.data = defaultMemory();
    this.data.profile.name = keepName;
    this.save();
  },
  export() {
    return JSON.stringify({ tipo: 'ops360-memoria', versao: 1, exportadoEm: new Date().toISOString(), memoria: this.data }, null, 2);
  },
  import(json) {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    if (!o || !o.memoria) throw new Error('Arquivo de memória inválido');
    this.data = { ...defaultMemory(), ...o.memoria };
    this.save();
  },
};


/* ===== 16-nlu.js ===== */
// ---------------------------------------------------------------------------
// 16 · Motor de intenções (NLU) — entende o pedido e extrai parâmetros
// ---------------------------------------------------------------------------
const RE_URL = /\b((?:https?:\/\/|www\.)[^\s<>"')]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|br|gov|org|net|edu|io|info|app|dev)(?:\.br)?(?:\/[^\s<>"')]*)?)/i;
const GEN_VERB = /\b(fa[cz]a?|faz(?:er)?|fazendo|ger[ae]r?|gere|cri[ae]r?|mont[ae]r?|elabor[ae]r?|prepar[ae]r?|escrev[ae]r?|redij[ae]|redigir|quero|queria|preciso|precisava|gostaria|me (?:d[aeê]|manda|envia|passa)|manda|envi[ae]|desenvolv[ae]r?|produz[ai]r?|emit[ae]|emitir|tir[ae]|imprim[ae]|baix[ae]r?)\b/;
const QUESTION_START = /^(o que|oque|qual|quais|como|quando|onde|por que|porque|pq|quem|quanto|quantos|quantas|existe|tem\b|posso|pode|devo|e verdade|sera que|me explica|explica|explique)/;

function normKeep(s) {
  // minúsculas sem acento, mantendo o mesmo tamanho do texto original (NFC)
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function sliceRaw(raw, nk, re) {
  const m = re.exec(nk);
  if (!m) return null;
  const g = m[1] != null ? m[1] : m[0];
  const start = m.index + m[0].indexOf(g);
  return raw.slice(start, start + g.length).trim();
}

function detectRequestDocType(t, raw) {
  const rules = [
    ['pt', /\b(permiss(?:ao|oes) de (?:trabalho|entrada)|\bpet\b|\bpt\b)/],
    ['ficha_epi', /\b(ficha (?:de )?(?:entrega |controle )?(?:de )?epis?|controle de (?:entrega de )?epis?|termo de (?:entrega|responsabilidade)(?: de epi)?|entrega de epis?)\b/],
    ['checklist', /\b(check ?-?list|lista de (?:verificacao|inspecao|checagem)|checagem|auditoria 5s)\b/],
    ['lista_presenca', /\b(lista de (?:presenca|participantes|frequencia))\b/],
    ['apr', /\b(apr|analise preliminar(?: de riscos?)?|analise de riscos?|\bar\b)\b/],
    ['dds', /\b(dds|dialogo diario|dialogo de seguranca|conversa de seguranca|palestra rapida)\b/],
    ['investigacao', /\b(investigacao|analise (?:do|de|dos) acidentes?|relatorio de (?:acidente|incidente)|5 porques|cinco porques|ishikawa|arvore de causas)\b/],
    ['plano_acao', /\b(plano de acoes?|5w2h)\b/],
    ['inspecao', /\b(relatorio (?:de inspecao|fotografico|de nao conformidade)|rnc|nao conformidade|relatorio com (?:a |as )?fotos?|laudo fotografico|registro de (?:inspecao|desvio)|relatorio de desvio)\b/],
    ['os', /\b(ordem de servico|ordens de servico)\b/],
    ['pop', /\b(pop|procedimento operacional(?: padrao)?|instrucao de trabalho|procedimento de seguranca|procedimento)\b/],
    ['comunicado', /\b(comunicado|alerta de seguranca|informativo|cartaz|aviso de seguranca)\b/],
    ['treinamento', /\b(plano de treinamento|conteudo programatico|programa de treinamento|ementa|plano de capacitacao)\b/],
    ['inventario', /\b(inventario de riscos?|pgr|mapa de riscos?|levantamento de riscos)\b/],
    ['pae', /\b(plano de (?:atendimento a )?emergencias?|\bpae\b|plano de abandono|plano de evacuacao)\b/],
    ['resumo_doc', /\b(relatorio (?:de analise|do documento|da analise|sobre (?:o|esse|este) (?:documento|arquivo)))\b/],
  ];
  for (const [id, re] of rules) if (re.test(t)) return id;
  if (/\bOS\b/.test(raw) || /\bo\.s\.\b/.test(t)) return 'os';
  if (/\binspecao\b/.test(t) && /\b(relatorio|registr|document|foto)/.test(t)) return 'inspecao';
  if (/\btreinamento\b/.test(t) && /\b(plano|conteudo|programa|ementa|roteiro)\b/.test(t)) return 'treinamento';
  return null;
}
function detectFormat(t) {
  if (/\b(word|docx|\.doc\b|editavel)\b/.test(t)) return 'docx';
  if (/\b(?:em|no|formato|para|pra|de|uma) (?:excel|planilha|xlsx)\b|\bxlsx\b|\bexcel\b/.test(t)) return 'xlsx';
  if (/\b(imprimir|impressao|imprime)\b/.test(t)) return 'print';
  if (/\bpdf\b/.test(t)) return 'pdf';
  if (/\bhtml\b/.test(t)) return 'html';
  return null;
}
const PLACE_WORDS = 'galpao|setor|area|obra|fabrica|unidade|predio|bloco|linha|doca|almoxarifado|deposito|oficina|expedicao|recebimento|patio|cozinha|refeitorio|escritorio|laboratorio|subestacao|cabine|telhado|mezanino|estoque|producao|manutencao|portaria|planta|filial|loja|centro de distribuicao|cd|armazem|sala|andar|canteiro|campo|garagem|caldeiraria|usinagem|pintura|montagem|embalagem';
function extractParams(raw) {
  raw = String(raw || '').normalize('NFC');
  const nk = normKeep(raw);
  const p = {};
  const loc = sliceRaw(raw, nk, new RegExp(`\\b(?:no|na|nos|nas|em|do|da|dos|das|local[:\\s]+|setor[:\\s]+)\\s*((?:(?:${PLACE_WORDS})\\b)[^,.;:!?\\n]{0,38})`));
  if (loc) p.local = capFirst(loc.replace(/\s+(em|no|na|para|pra|com|de)\s+(pdf|word|excel|docx|planilha).*$/i, '').replace(/\s+(para|pra|com|amanh[aã]|hoje|ontem|dia|no dia|at[eé]|as|às|durante|sobre)\b.*$/i, '').trim());
  const emp = sliceRaw(raw, nk, /\b(?:empresa|cliente|contratante)[:\s]+([a-z0-9][^,;\n]{2,50}?)(?=[,.;\n]| para | em | no | na |$)/);
  if (emp) p.empresa = emp;
  const resp = sliceRaw(raw, nk, /\b(?:responsavel|elaborado por|emitente|instrutor|conduzido por|tecnico responsavel|inspetor)[:\s]+([a-z]+(?:\s+(?:da |de |dos |das |do )?[a-z]+){0,3})/);
  if (resp) p.responsavel = titleCase(resp);
  const colab = sliceRaw(raw, nk, /\b(?:colaborador|funcionario|empregado|trabalhador)[:\s]+([a-z]+(?:\s+(?:da |de |dos |das |do )?[a-z]+){0,3})/);
  if (colab) p.colaborador = titleCase(colab);
  const dm = /\b(hoje|amanha|ontem|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\d{1,2} de (?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?: de \d{4})?)\b/.exec(nk);
  if (dm) {
    const d = parseDateBR(dm[1]);
    if (d) p.data = d;
  }
  const pe = /(\d{1,3})\s*(?:pessoas|participantes|colaboradores|trabalhadores|funcionarios|linhas|executantes|nomes|alunos)/.exec(nk);
  if (pe) p.pessoas = +pe[1];
  const du = /\b(\d{1,3})\s*(min\b|minutos|h\b|horas)/.exec(nk);
  if (du) p.duracao = du[1] + (/^h/.test(du[2]) ? ' horas' : ' minutos');
  const fn = sliceRaw(raw, nk, /\b(?:para|pra|funcao|cargo)[:\s]+(?:o |a |os |as |um |uma )?((?:operador(?:a)?|auxiliar|tecnico|tecnica|ajudante|assistente|analista|encarregado|supervisor)(?: de [a-z]+(?: [a-z]+)?)?|soldador(?:a)?|eletricista|mecanico|pedreiro|servente|pintor(?:a)?|motorista|almoxarife|montador(?:a)?|carpinteiro|armador|encanador|jardineiro|faxineir[oa]|porteiro|vigilante|cozinheir[oa]|enfermeir[oa]|mecanic[oa]|frentista|repositor(?:a)?|estoquista|conferente|motosserrista|operador(?:a)?)\b/);
  if (fn) p.funcao = capFirst(fn);
  const nr = /\bnr[\s-]*0?(\d{1,2})\b/.exec(nk);
  if (nr) p.nr = +nr[1];
  const tema = sliceRaw(raw, nk, /\b(?:sobre|tema[:\s]+|a respeito d[eoa]s?|acerca d[eoa]s?|com o tema)\s+(.{3,90}?)(?:[.!?]|$| em pdf| em word| em excel| para \d| com \d)/);
  if (tema) p.tema = tema.replace(/^(o|a|os|as)\s+/i, '');
  if (/\b(altura|telhado|andaime|nr[\s-]*35)\b/.test(nk)) p.tipoPT = 'altura';
  if (/\b(quente|solda|soldagem|oxicorte|macarico|esmerilh)/.test(nk)) p.tipoPT = 'quente';
  if (/\b(confinado|pet\b|tanque|silo)/.test(nk)) p.tipoPT = 'confinado';
  if (/\b(eletric|nr[\s-]*10|painel|energizad)/.test(nk)) p.tipoPT = p.tipoPT || 'eletrica';
  if (/\b(complet[oa]|detalhad[oa]|mais detalhes|robust[oa])\b/.test(nk)) p.detail = 'completo';
  if (/\b(resumid[oa]|simples|curt[oa]|enxut[oa]|rapid[oa])\b/.test(nk)) p.detail = 'resumido';
  const eq = sliceRaw(raw, nk, /\b(?:equipe|executantes)[:\s]+([^.;\n]{3,80})/);
  if (eq) p.equipe = eq;
  const eqp = sliceRaw(raw, nk, /\b(?:equipamento|maquina|tag|patrimonio|placa)[:\s]+([a-z0-9][^,.;\n]{1,40})/);
  if (eqp) p.equipamento = eqp;
  return p;
}
// Remove o "comando" e fica com a descrição (a descrição pode vir antes ou depois do pedido)
//   "fiação exposta no painel do galpão 2, faça um relatório de não conformidade" → "Fiação exposta no painel do galpão 2"
//   "faça um RNC com essa foto: extintor obstruído na doca 4"                    → "extintor obstruído na doca 4"
function extractDescription(raw) {
  const s = String(raw || '').trim();
  const colon = s.indexOf(':');
  if (colon > 0 && colon < s.length - 8) return s.slice(colon + 1).trim();
  const CMD = /\b(fa[cç]a|faz|fazer|gere|gera|gerar|crie|cria|criar|monte|monta|montar|elabore|elabora|prepare|prepara|quero|queria|preciso|me (?:d[aeê]|manda))\b.*\b(relat[oó]rio|rnc|n[aã]o conformidade|registro|alerta|comunicado|inspe[cç][aã]o|documento|pdf|word|excel|investiga[cç][aã]o|plano|apr|checklist|dds)\b/i;
  const clauses = s.split(/(?<=[.;!?])\s+|,\s+/).map((c) => c.trim()).filter(Boolean);
  let desc = clauses.filter((c) => !CMD.test(c)).join(', ');
  if (!desc) {
    const nk = normKeep(s);
    const m = /(?:com (?:essa|esta|a|as|essas|estas) fotos?|dessa foto|desta foto|nessa foto|nesta foto|na foto|da foto|sobre|referente a|onde|porque|pois|mostrando|que mostra|em que)\s+/.exec(nk);
    desc = m ? s.slice(m.index + m[0].length) : '';
  }
  desc = desc
    .replace(/^(?:ess[ae]|est[ae]|a|na|nessa|nesta)?\s*(?:foto|imagem)\s*(?:mostra|mostrando|tem|aparece|:)?\s*/i, '')
    .replace(/\s+(?:em|no formato)\s+(?:pdf|word|excel)\s*$/i, '')
    .trim();
  return capFirst(desc);
}

// Palavras que indicam pedido sobre abas (Tab Studio)
const TAB_WORD = /\b(abas?|sub[\s-]?abas?|subabas?|guias?|dashboards?|pagina interna|painel de (?:indicadores|graficos|dados|kpis|controle de (?:indicadores|dados)))\b/;
const WIDGET_WORD = /\b(grafico|graficos|kpi|kpis|indicador|indicadores|card|cards|widget|widgets|tabela|contador|checklist|nota|anotacao|formulario|calculadora|links?|cor|icone|layout|colunas?|pizza|barras?|linha do tempo|rosca|donut|meta|progresso)\b/;

function classify(text, ctx = {}) {
  const raw = String(text || '').normalize('NFC').trim();
  const t = norm(raw);
  const res = { intent: 'unknown', raw, t, slots: {}, confidence: 0.5 };
  const set = (intent, conf = 0.8, slots = {}) => Object.assign(res, { intent, confidence: conf, slots: { ...res.slots, ...slots } });
  const params = extractParams(raw);
  const docType = detectRequestDocType(t, raw);
  const format = detectFormat(t);
  const acts = findActivities(raw, memory.data.synonyms);
  const url = (RE_URL.exec(raw) || [])[1];
  const hasFiles = !!(ctx.files && ctx.files.length);
  const hasCtxFiles = hasFiles || !!(ctx.activeFiles && ctx.activeFiles.length);
  const hasImage = hasFiles && ctx.files.some((f) => f.kind === 'image');
  const isQuestion = /\?\s*$/.test(raw) || QUESTION_START.test(t);
  res.slots = { params, docType, format, acts, url };
  res.activities = acts.map((a) => a.id);
  res.docType = docType;
  res.format = format;
  res.detail = params.detail;

  if (!t && hasFiles) return set('file_only', 0.9);
  if (!t) return set('empty', 1);

  // 0) comandos com barra
  const slash = /^\/(\w+)\s*(.*)$/.exec(t);
  if (slash) {
    const map = { apr: 'apr', dds: 'dds', pt: 'pt', pet: 'pt', checklist: 'checklist', os: 'os', epi: 'ficha_epi', inspecao: 'inspecao', rnc: 'inspecao', investigacao: 'investigacao', '5w2h': 'plano_acao', acao: 'plano_acao', pop: 'pop', presenca: 'lista_presenca', comunicado: 'comunicado', alerta: 'comunicado', treinamento: 'treinamento', inventario: 'inventario', pgr: 'inventario', pae: 'pae', emergencia: 'pae' };
    if (map[slash[1]]) {
      res.docType = map[slash[1]];
      return set('doc_generate', 1, { docType: map[slash[1]] });
    }
    if (/^(aba|abas|nova-aba|criar-aba)$/.test(slash[1])) return set(slash[2] ? 'tab_create' : 'tab_list', 1);
    if (/^(memoria|mem)$/.test(slash[1])) return set('recall_profile', 1);
    if (/^(ajuda|help|comandos)$/.test(slash[1])) return set('help', 1);
    if (/^(novo|nova|nova-conversa)$/.test(slash[1])) return set('new_chat', 1);
    if (/^(site|ler|leia)$/.test(slash[1])) return set('site_read', 1, { url: slash[2] });
  }

  // 1) resposta a uma pergunta pendente da IA
  if (ctx.pending && ctx.pending.kind === 'ask_name') {
    if (/^(?:(?:meu nome (?:e|é)|me chamo|sou o|sou a|pode me chamar de|e|é)\s+)?[a-zà-ÿ]{2,}(?:\s+[a-zà-ÿ]{2,}){0,2}[.!]?$/i.test(raw) && !QUESTION_START.test(t) && !/^(oi+|ola|bom dia|boa tarde|boa noite|tudo bem|obrigad)/.test(t)) return set('pending_answer', 0.9);
  } else if (ctx.pending && t.split(' ').length <= 8 && !docType && !TAB_WORD.test(t) && !isQuestion) return set('pending_answer', 0.9);

  // 2) frases aprendidas com o usuário
  const learned = memory.matchLearned(raw);
  if (learned && !docType && !url) {
    res.learned = learned;
    return set(learned.intent, 0.85, learned.slots || {});
  }

  // 3) conversa
  const greetOnly = /^(oi+e?|ola|opa|e ai|eai|hey|hello|salve|bom dia|boa tarde|boa noite|oii+)(,| |!|\.)*(aurora|ia|ops|pessoal|tudo bem|tudo bom|td bem)?[!.,\s?]*(bom dia|boa tarde|boa noite)?[!.\s]*$/;
  if (greetOnly.test(t)) return set('greet', 0.95);
  const greetPrefix = /^(oi+|ola|opa|e ai|bom dia|boa tarde|boa noite)(,?\s+aurora)?[,!.\s]+/;
  const body = t.replace(greetPrefix, '');
  if (body !== t && body.length > 2) {
    const inner = classify(raw.replace(/^[^,!.]*?(?:aurora)?[,!.]\s*|^(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite)\s+/i, ''), ctx);
    if (inner.intent !== 'unknown') {
      inner.greeted = true;
      return inner;
    }
  }
  if (/^(e )?(como (voce )?(esta|vai|anda|ta|tem passado)|tudo (bem|bom|certo|joia|tranquilo|em ordem)|como vc (ta|esta)|como ce ta|beleza|td bem|tudo bem com voce)\b.{0,25}$/.test(t) || /(queria|quero) (so )?saber como (voce )?(esta|vai|ta)/.test(t)) return set('howareyou', 0.9);
  if (/^(estou|to|tou|eu estou|tudo|aqui|por aqui)?\s*(bem|otimo|otima|tranquilo|de boa|joia|beleza|tudo certo|tudo otimo|mais ou menos|cansad[oa]|mal|pessimo|triste|estressad[oa]|exaust[oa]|sobrecarregad[oa]|ansios[oa])\b.{0,30}$/.test(t) && ctx.lastIntent === 'howareyou') return set('user_state', 0.9);
  if (/^(muito )?(obrigad[oa]|valeu|vlw|grato|grata|agradeco|brigad[oa]|obg)\b/.test(t) && t.length < 60) return set('thanks', 0.95);
  if (/^(tchau|ate mais|ate logo|ate amanha|falou|flw|bom descanso|fui)\b/.test(t)) return set('bye', 0.95);
  if (/^(voce e|vc e|tu e)\s+(demais|incrivel|otima|muito boa|top|sensacional|genial|a melhor)|^(adorei|amei|mandou bem|show|perfeito|excelente|otimo trabalho)[!.\s]*$/.test(t)) return set('compliment', 0.9);
  if (/(quem e voce|quem (e|eh) a aurora|o que voce (faz|sabe fazer|consegue fazer|pode fazer)|como (voce funciona|te usar|usar voce|funciona)|^ajuda\b|^help\b|^comandos\b|o que da pra fazer|suas funcoes|para que voce serve)/.test(t)) return set('help', 0.9);

  // 4) memória
  const nkr = normKeep(raw);
  let m = sliceRaw(raw, nkr, /\b(?:meu nome e|me chame de|me chama de|pode me chamar de|eu me chamo|me chamo)\s+([a-z]+(?:\s+[a-z]+)?)/);
  if (m && !/^(o|a|de|um|uma)$/i.test(m)) return set('set_name', 0.95, { name: titleCase(m.split(/\s+/).filter((w) => !/^(e|mas|por|pois)$/i.test(w)).slice(0, 2).join(' ')) });
  m = sliceRaw(raw, nkr, /\b(?:minha empresa (?:e|se chama)|trabalho na empresa|a empresa (?:onde trabalho )?(?:e|se chama))\s+([^.,;!?]{2,60})/);
  if (m && !docType) return set('set_company', 0.9, { company: m.trim() });
  let m2;
  m2 = /^(?:por favor,?\s*)?(?:lembre|lembra|lembrar|anote|anota|guarde|guarda|memorize|registre|salve na memoria)(?:-se)?\s+(?:que|de que|disso:|isso:|:)?\s*(.{4,})$/i.exec(raw);
  if (m2 && !/\b(me|mim)\b.{0,10}\b(amanha|depois|daqui)/.test(t)) return set('remember', 0.95, { fact: m2[1] });
  if (/(o que voce (sabe|lembra|aprendeu) (sobre|de) mim|o que voce aprendeu|minhas preferencias|sua memoria|o que voce guardou|mostre? (a )?memoria)/.test(t)) return set('recall_profile', 0.95);
  if (/^(esqueca|esquece|apague da memoria|apaga da memoria|remova da memoria)\b/.test(t)) return set('forget', 0.9, { what: raw.replace(/^\S+\s+(da memoria\s+)?(que\s+)?/i, '') });
  if (/(o que (a gente |nos |eu |voce e eu )?(conversou|conversamos|falamos|falou|pedi|perguntei|te pedi|te perguntei)\b|do que (a gente )?falamos|ja falamos sobre|voce lembra (quando|da|do|que)|lembra (quando|daquela|daquele)|historico de conversas|procure? nas conversas|pesquis[ae] nas conversas)/.test(t)) return set('recall_chats', 0.9);

  // 5) abas (Tab Studio)
  const tabWord = TAB_WORD.test(t);
  const tabCtx = ctx.workspaceOpen || /^tab_/.test(ctx.lastIntent || '');
  if (tabWord || (tabCtx && WIDGET_WORD.test(t) && /\b(adicion|inclu|coloc|remov|exclu|tir[ae]|mud|troc|alter|renome|mov|aument|diminu|deix|poe|ponha|bot[ae]|cri[ae]|fa[cz]|mostr)/.test(t))) {
    if (/\b(desfa[cz]|desfazer|voltar atras|volte atras)\b/.test(t)) return set('tab_undo', 0.9);
    if (url && /\b(cri|faz|fac|mont|ger|nova|novo|transform|leia|ler|le |use|usando|a partir)/.test(t)) return set('tab_from_site', 0.95);
    if (hasCtxFiles && /\b(esses dados|essa planilha|esta planilha|desse arquivo|deste arquivo|desse documento|com (os )?dados|a partir d[ao] (arquivo|planilha|documento)|com base n[ao]|usando (a|o) (planilha|arquivo))/.test(t)) return set('tab_from_file', 0.95);
    if (/^(quais|liste|listar|lista|mostr[ae]|ver|veja|exib[ae])( (as|todas as|minhas))? (minhas )?(abas|guias|paineis)\b|minhas abas|abas (criadas|que (voce|vc) criou)/.test(t)) return set('tab_list', 0.9);
    if (/\b(export|baix|salv|ger)[a-z]* (o |a )?(blueprint|pacote|script|padrao|codigo|implementacao|arquivos?)\b|como (voce |vc )?(fez|criou|montou) (a|essa|esta) aba|documenta[cç][aã]o da aba/.test(t)) return set('tab_export', 0.9);
    if (/\b(exclu|remov|apag|delet)[a-z]*\s+(a |essa |esta )?(aba|guia|painel)\b(?! de)/.test(t) && !/sub[\s-]?aba|grafico|widget|kpi|card|tabela|item/.test(t)) return set('tab_delete', 0.9);
    if (/\b(abr[aei]r?|abre|mostr[ae]r?|ir para|va para|vai para|entr[ae]r? na|acess[ae]r?)\s+(a )?(aba|guia|painel)\b/.test(t) && !/\b(cri|nova|novo)/.test(t)) return set('tab_open', 0.9);
    if (/\b(cri|faz|fac|mont|ger|desenvolv|constru|quero|preciso|gostaria)[a-z]*\b.{0,40}\b(uma |um )?(nova |novo )?(aba|guia|painel|dashboard|pagina)\b/.test(t) && !/\bsub[\s-]?aba/.test(t.replace(/(com|e) (as |os )?sub[\s-]?abas?.*/, ''))) return set('tab_create', 0.92);
    if (/\b(nova|novo) (aba|guia|painel)\b/.test(t)) return set('tab_create', 0.9);
    return set('tab_edit', 0.8);
  }

  // 6) leitura de sites
  if (url) return set('site_read', 0.9, { url });

  // 7) cálculos de SST
  if (/(taxa de frequencia|taxa de gravidade|\btf\b|\btg\b|dose de ruido|tempo (maximo|permitido|de exposicao).{0,30}(db|decibe)|(\d{2,3}(?:[.,]\d)?)\s*(db|decibeis)|dias sem acidente|calcul)/.test(t) && /\d/.test(t)) return set('calc', 0.85);

  // 8) documento anexado/ativo
  const refersDoc = /\b(esse|este|nesse|neste|desse|deste|do|no|o|a|essa|esta|nessa|nesta|dessa|desta)\s+(documento|arquivo|pdf|anexo|planilha|procedimento|relatorio|texto|laudo|certificado|aso|fds|fispq|apr|pt|foto|imagem|contrato|manual)\b|\b(anexo|anexei|enviei|mandei|documento|arquivo)\b/.test(t);
  if (hasCtxFiles) {
    if (hasImage && /(o que (tem|aparece|voce ve|esta escrito)|leia (o texto|a imagem|a foto)|transcrev|ocr|extrai[ar]? o texto|ler o texto)/.test(t)) return set('image_ocr', 0.9);
    if (docType && (hasFiles || refersDoc || /\b(transform|convert|com base|a partir|baseado|usando|use|conforme)\b/.test(t))) return set('doc_generate', 0.95, { fromFile: true });
    if (/(resum|sintetiz|do que se trata|sobre o que (e|fala)|principais pontos|pontos principais|o que (tem|diz|fala) (nesse|neste|no|esse|este|o|a|essa|esta)\b|analis[ae]|avali[ae]|revis[ae]|o que achou|verifique|confira)/.test(t) && (hasFiles || refersDoc)) return set(/relatorio|laudo|parecer|analise completa/.test(t) && GEN_VERB.test(t) ? 'doc_report' : 'doc_summary', 0.9);
    if (/(validade|vencid|vence|venciment|expira|prazo)/.test(t)) return set('doc_validity', 0.9);
    if (/(quais|que|lista|liste).{0,15}\bepis?\b/.test(t)) return set('doc_epis', 0.9);
    if (/(quais|que|lista|liste).{0,15}\b(normas|nrs?)\b|normas (citadas|aplicaveis|mencionadas)/.test(t)) return set('doc_nrs', 0.9);
    if (/(quais|que|lista|liste|identifi|extrai).{0,20}\b(riscos|perigos)\b/.test(t) && (hasFiles || refersDoc)) return set('doc_risks', 0.9);
    if (hasImage && !docType && (t.split(' ').length >= 3 || /(foto|imagem)/.test(t))) return set('photo_report', 0.85);
    if (hasFiles && !docType && !isQuestion && !GEN_VERB.test(t) && t.split(' ').length <= 6) return set('doc_summary', 0.7);
    if ((isQuestion || refersDoc) && !docType && !/\bnr[\s-]*\d/.test(t)) return set('doc_qa', 0.75);
  }

  // 9) continuação do último documento
  if (ctx.lastDoc && !docType) {
    if (format && t.split(' ').length <= 7) return set('doc_reformat', 0.9);
    if (/\b(adicion|inclu|acrescent|coloc|insir)[a-z]*\b.{0,30}\b(risco|perigo|item|itens|epi|etapa|medida|controle|pergunta|ponto)/.test(t)) return set('doc_modify', 0.85, { op: 'add' });
    if (/\b(remov|tir|exclu|apag)[a-z]*\b.{0,30}\b(risco|perigo|item|epi|etapa)/.test(t)) return set('doc_modify', 0.85, { op: 'remove' });
    if (/\b(mud|troc|alter|corrig|atualiz)[a-z]*\b.{0,20}\b(local|data|empresa|responsavel|setor|titulo|nome|funcao|tema)\b/.test(t)) return set('doc_modify', 0.85, { op: 'param' });
    if (/\b(mais (detalhad|complet)|mais completo|detalh[ae]|mais curt|resum[ae] (mais|ele)|mais simples|enxug)/.test(t)) return set('doc_modify', 0.85, { op: 'detail' });
    const followShape = /^(e|agora|tambem|faz|faca|gera|gere|outr[ao]|o mesmo|a mesma|mais uma?|repete|repita)\b/.test(t) || /^(para|pra|de|do|da|com)\b/.test(t);
    if (acts.length && followShape && t.split(' ').length <= 9 && !/^(e )?(o que|qual|quais|como|quando|por que)\b/.test(t)) return set('doc_generate', 0.85, { docType: ctx.lastDoc.type, followUp: true });
  }

  // 10) geração de documentos
  const isDefinitionQ = /^(o que (e|eh|sao|significa|seria|quer dizer)|oque e|que (e|eh)|qual (e )?(o )?(significado|conceito)|defin[ae]|definicao|explique|explica|me explica)\b/.test(t);
  if (docType && !isDefinitionQ && !(isQuestion && /^(como|quando|quem|por que|porque|qual a diferenca|quais as diferencas|precisa|preciso de|e obrigatorio|e necessario|devo)\b/.test(t) && !GEN_VERB.test(t))) {
    return set('doc_generate', 0.92);
  }

  // 11) normas
  const nrm = /\bnr[\s-]*0?(\d{1,2})\b/.exec(t);
  if (nrm && +nrm[1] >= 1 && +nrm[1] <= 38) return set('nr_info', 0.9, { nr: +nrm[1] });
  if (/(qual|quais|que) (a |as )?(nr|norma|normas|nrs)\b.{0,25}\b(fala|falam|trata|tratam|regulamenta|aborda|cobre|se aplica|aplica|sobre|de|para)\b/.test(t)) return set('nr_search', 0.9);

  // 12) definições
  if (isDefinitionQ) {
    const g = findGlossary(t.replace(/^(o que (e|eh|sao|significa|seria|quer dizer)|oque e|que (e|eh)|qual (e )?(o )?(significado|conceito) de|defin[ae]|definicao de|explique|explica|me explica)\s+(o |a |um |uma |os |as )?/, ''));
    if (g) return set('define', 0.9, { glossary: g });
    if (acts.length) return set('activity_info', 0.75);
    return set('kb_search', 0.6);
  }

  // 13) orientações práticas (situações do dia a dia)
  const adv = findAdvice(t);
  if (adv) return set('advice', 0.88, { advice: adv });

  // 14) perguntas sobre uma atividade (riscos, EPIs, requisitos)
  if (acts.length && (isQuestion || /\b(riscos?|perigos?|epis?|cuidados?|requisitos?|treinamentos?|normas?)\b/.test(t))) return set('activity_info', 0.8);

  // 15) pedido de documento sem tipo definido
  if (acts.length && GEN_VERB.test(t)) return set('ask_doctype', 0.7);

  // 16) glossário direto (termo solto)
  const g2 = t.split(' ').length <= 5 ? findGlossary(t) : null;
  if (g2) return set('define', 0.7, { glossary: g2 });
  if (acts.length && t.split(' ').length <= 4) return set('activity_info', 0.65);

  if (isQuestion) return set('kb_search', 0.55);
  if (t.split(' ').length <= 2) return set('short', 0.4);
  return set('unknown', 0.3);
}


/* ===== 17-web.js ===== */
// ---------------------------------------------------------------------------
// 17 · Leitura de sites (sem precisar abrir a guia): busca + extração de
//      conteúdo, tabelas, números, links, RSS, JSON e CSV.
//      Ordem de busca: leitor do próprio app → GM_xmlhttpRequest (userscript)
//      → fetch direto (CORS) → leitores públicos configuráveis (CFG.proxies).
// ---------------------------------------------------------------------------
function normalizeUrl(u) {
  u = String(u || '').trim().replace(/[)\].,;!?]+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  try {
    return new URL(u).href;
  } catch (e) {
    return null;
  }
}
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), ms))]);
}
async function fetchText(url, { timeout = 16000 } = {}) {
  const errors = [];
  const hostFn = CFG.fetcher || (PAGE.OPS360 && (PAGE.OPS360.lerSite || PAGE.OPS360.fetchSite || PAGE.OPS360.fetchUrl));
  if (typeof hostFn === 'function') {
    try {
      const r = await withTimeout(Promise.resolve(hostFn(url)), timeout);
      if (r) return typeof r === 'string' ? { text: r, contentType: '', via: 'leitor do OPS 360°' } : { text: r.text || r.html || '', contentType: r.contentType || '', via: 'leitor do OPS 360°' };
    } catch (e) {
      errors.push('app: ' + e.message);
    }
  }
  if (typeof GM_xmlhttpRequest === 'function') {
    try {
      const r = await new Promise((res, rej) =>
        GM_xmlhttpRequest({
          method: 'GET', url, timeout,
          onload: (x) => (x.status >= 200 && x.status < 400 ? res({ text: x.responseText, contentType: (/content-type:\s*([^\n;]+)/i.exec(x.responseHeaders || '') || [])[1] || '', via: 'userscript' }) : rej(new Error('HTTP ' + x.status))),
          onerror: () => rej(new Error('falha de rede')),
          ontimeout: () => rej(new Error('tempo esgotado')),
        })
      );
      return r;
    } catch (e) {
      errors.push('userscript: ' + e.message);
    }
  }
  if (CFG.strictOffline) throw new Error('Modo estritamente offline ativo — leitura de sites desativada.');
  const attempt = async (u, via) => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), timeout);
    try {
      const r = await fetch(u, { signal: ctl ? ctl.signal : undefined, redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      if (!text || text.length < 20) throw new Error('resposta vazia');
      return { text, contentType: r.headers.get('content-type') || '', via };
    } finally {
      clearTimeout(t);
    }
  };
  try {
    return await attempt(url, 'acesso direto');
  } catch (e) {
    errors.push('direto: ' + e.message);
  }
  for (const tpl of CFG.proxies || []) {
    const u = tpl.replace('{url}', encodeURIComponent(url)).replace('{rawurl}', url);
    let host = 'leitor público';
    try {
      host = new URL(u).hostname;
    } catch (e) {}
    try {
      const r = await attempt(u, host);
      if (/r\.jina\.ai/.test(u)) r.markdown = true;
      return r;
    } catch (e) {
      errors.push(host + ': ' + e.message);
    }
  }
  const err = new Error('Não consegui acessar o site. ' + errors.slice(-3).join(' · '));
  err.details = errors;
  throw err;
}

const JUNK_SEL = 'script,style,noscript,template,svg,iframe,canvas,nav,footer,aside,form,button,select,[role=navigation],[aria-hidden=true],[hidden],.cookie,.cookies,#cookie,.cookie-banner,.menu,.navbar,.nav,.footer,.sidebar,.advert,.ads,.ad,.share,.social,.breadcrumb,.pagination';
function nodeText(el) {
  let out = '';
  const BLOCK = /^(P|DIV|LI|H[1-6]|TR|BR|SECTION|ARTICLE|UL|OL|TABLE|BLOCKQUOTE|PRE|DD|DT|FIGCAPTION|HEADER|MAIN)$/;
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeType === 1) {
        if (c.tagName === 'BR') out += '\n';
        else {
          if (BLOCK.test(c.tagName)) out += '\n';
          walk(c);
          if (BLOCK.test(c.tagName)) out += '\n';
          else if (c.tagName === 'TD' || c.tagName === 'TH') out += ' | ';
        }
      }
    }
  };
  walk(el);
  return out.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function tableRows(tb) {
  const rows = [];
  for (const tr of tb.querySelectorAll('tr')) {
    if (tr.closest('table') !== tb) continue;
    const r = [];
    for (const cell of tr.children) {
      if (!/^(TD|TH)$/.test(cell.tagName)) continue;
      const txt = cell.textContent.replace(/\s+/g, ' ').trim();
      const span = Math.min(+cell.getAttribute('colspan') || 1, 12);
      for (let k = 0; k < span; k++) r.push(txt);
    }
    if (r.some((c) => c)) rows.push(r);
    if (rows.length > 400) break;
  }
  return rows;
}
function parseSiteDoc(d, baseUrl) {
  const abs = (h) => {
    try {
      return new URL(h, baseUrl || undefined).href;
    } catch (e) {
      return null;
    }
  };
  const title = ((d.querySelector('meta[property="og:title"]') || {}).content || (d.querySelector('title') || {}).textContent || (d.querySelector('h1') || {}).textContent || '').replace(/\s+/g, ' ').trim();
  const description = ((d.querySelector('meta[name="description"]') || d.querySelector('meta[property="og:description"]') || {}).content || '').trim();
  const lang = (d.documentElement && d.documentElement.getAttribute('lang')) || '';
  const body = d.body || d.documentElement;
  // tabelas antes de limpar (algumas ficam dentro de "sidebar")
  const tables = [];
  for (const tb of body.querySelectorAll('table')) {
    const rows = tableRows(tb);
    if (rows.length < 2 || Math.max(...rows.map((r) => r.length)) < 2) continue;
    const cap = ((tb.querySelector('caption') || {}).textContent || '').trim();
    let heading = cap;
    if (!heading) {
      let prev = tb.previousElementSibling, k = 0;
      while (prev && k++ < 4 && !heading) {
        if (/^H[1-6]$/.test(prev.tagName) || (prev.tagName === 'P' && prev.textContent.length < 120)) heading = prev.textContent.trim();
        prev = prev.previousElementSibling;
      }
    }
    const hasHead = tb.querySelector('thead th') || [...(tb.querySelector('tr') || { children: [] }).children].every((c) => c.tagName === 'TH');
    tables.push({ caption: truncate(heading || `Tabela ${tables.length + 1}`, 80), head: hasHead ? rows[0] : null, rows: hasHead ? rows.slice(1) : rows });
    if (tables.length >= 30) break;
  }
  const clone = body.cloneNode(true);
  clone.querySelectorAll(JUNK_SEL).forEach((n) => n.remove());
  let main = clone.querySelector('article, main, [role=main], #content, #conteudo, .content, .conteudo, .post, .entry-content, .article-body, .materia');
  if (!main || main.textContent.trim().length < 400) {
    let best = null, bestScore = 0;
    for (const el of clone.querySelectorAll('div, section')) {
      const ps = [...el.children].filter((c) => c.tagName === 'P');
      const len = ps.reduce((a, p) => a + p.textContent.trim().length, 0);
      if (len < 200) continue;
      const linkLen = [...el.querySelectorAll('a')].reduce((a, x) => a + x.textContent.length, 0);
      const sc = len * (1 - Math.min(0.9, linkLen / Math.max(1, el.textContent.length)));
      if (sc > bestScore) {
        best = el;
        bestScore = sc;
      }
    }
    main = best || clone;
  }
  const headings = [...clone.querySelectorAll('h1, h2, h3')]
    .map((h) => ({ level: +h.tagName[1], text: h.textContent.replace(/\s+/g, ' ').trim() }))
    .filter((h) => h.text.length > 1 && h.text.length < 160)
    .slice(0, 40);
  const paragraphs = [...main.querySelectorAll('p, li')]
    .map((p) => p.textContent.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 40)
    .slice(0, 200);
  const links = [];
  const seen = new Set();
  for (const a of main.querySelectorAll('a[href]')) {
    const txt = a.textContent.replace(/\s+/g, ' ').trim();
    const href = abs(a.getAttribute('href'));
    if (!href || !/^https?:/.test(href) || txt.length < 3 || seen.has(href)) continue;
    seen.add(href);
    links.push({ text: truncate(txt, 90), url: href });
    if (links.length >= 50) break;
  }
  const text = nodeText(main);
  return { title, description, lang, headings, paragraphs, tables, links, text };
}
function parseMarkdownSite(md) {
  const title = (/^Title:\s*(.+)$/m.exec(md) || [])[1] || (/^#\s+(.+)$/m.exec(md) || [])[1] || '';
  const body = md.split(/^Markdown Content:\s*$/m)[1] || md;
  const headings = [...body.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].replace(/[*_`]/g, '').trim() })).slice(0, 40);
  const links = [];
  for (const m of body.matchAll(/\[([^\]]{3,120})\]\((https?:[^)\s]+)\)/g)) if (links.length < 50) links.push({ text: m[1].replace(/[*_`]/g, ''), url: m[2] });
  const tables = [];
  const blocks = body.split(/\n(?!\|)/).join('\n').match(/(?:^\|.*\|\s*$\n?){2,}/gm) || [];
  for (const b of blocks) {
    const rows = b
      .trim()
      .split('\n')
      .filter((l) => !/^\|\s*:?-{2,}/.test(l))
      .map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.replace(/[*_`]/g, '').trim()));
    if (rows.length >= 2) tables.push({ caption: `Tabela ${tables.length + 1}`, head: rows[0], rows: rows.slice(1) });
  }
  const text = body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const paragraphs = text.split('\n').map((s) => s.trim()).filter((s) => s.length > 40);
  return { title, description: '', lang: '', headings, paragraphs, tables, links, text };
}
function parseFeed(xml) {
  const d = parseXML(xml);
  const items = [...tags(d, 'item'), ...tags(d, 'entry')].slice(0, 50).map((it) => {
    const g = (n) => (tags(it, n)[0] || {}).textContent || '';
    const linkEl = tags(it, 'link')[0];
    const link = linkEl ? linkEl.getAttribute('href') || linkEl.textContent : '';
    const date = g('pubDate') || g('updated') || g('published') || g('date');
    return { title: g('title').trim(), url: (link || '').trim(), date: date ? new Date(date) : null, text: g('description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || g('summary').replace(/<[^>]+>/g, ' ').trim() };
  });
  const title = ((tags(d, 'title')[0] || {}).textContent || 'Feed').trim();
  return { title, items };
}

const _siteCache = new Map();
async function readSite(inputUrl, { fresh = false } = {}) {
  const url = normalizeUrl(inputUrl);
  if (!url) throw new Error('Endereço inválido: ' + inputUrl);
  const c = _siteCache.get(url);
  if (!fresh && c && Date.now() - c.fetchedAt < 10 * 60000) return c;
  const r = await fetchText(url);
  const ct = (r.contentType || '').toLowerCase();
  const head = r.text.slice(0, 400).trim();
  let rep;
  if (/json/.test(ct) || /^[[{]/.test(head)) {
    let data = null;
    try {
      data = JSON.parse(r.text);
    } catch (e) {}
    const table = data ? jsonToTable(data) : null;
    rep = { kind: 'json', title: new URL(url).hostname, description: '', headings: [], paragraphs: [], tables: table ? [{ caption: 'Dados', head: table[0], rows: table.slice(1) }] : [], links: [], text: truncate(r.text, 5000) };
  } else if (/(rss|atom|xml)/.test(ct) || /^<\?xml|<rss|<feed/.test(head)) {
    const f = parseFeed(r.text);
    rep = { kind: 'rss', title: f.title, description: '', headings: [], paragraphs: f.items.map((i) => i.title + '. ' + i.text), tables: [{ caption: 'Itens do feed', head: ['Data', 'Título', 'Link'], rows: f.items.map((i) => [i.date && !isNaN(i.date) ? fmtDate(i.date) : '', i.title, i.url]) }], links: f.items.map((i) => ({ text: i.title, url: i.url })), text: f.items.map((i) => `${i.title}. ${i.text}`).join('\n'), feed: f.items };
  } else if (/csv|text\/plain/.test(ct) && /[;,\t]/.test(head.split('\n')[0] || '') && !/<html/i.test(head)) {
    const rows = parseCSV(r.text);
    rep = { kind: 'csv', title: new URL(url).pathname.split('/').pop() || 'Dados', description: '', headings: [], paragraphs: [], tables: [{ caption: 'Dados', head: rows[0], rows: rows.slice(1) }], links: [], text: truncate(r.text, 5000) };
  } else if (r.markdown || (!/<html|<body|<div|<p[ >]/i.test(r.text.slice(0, 3000)) && /^(Title:|#)/m.test(r.text.slice(0, 500)))) {
    rep = { kind: 'html', ...parseMarkdownSite(r.text) };
  } else {
    const d = new DOMParser().parseFromString(r.text, 'text/html');
    rep = { kind: 'html', ...parseSiteDoc(d, url) };
  }
  rep.url = url;
  rep.via = r.via;
  rep.fetchedAt = Date.now();
  rep.host = new URL(url).hostname.replace(/^www\./, '');
  rep.summary = rep.text && rep.text.length > 200 ? summarize(rep.text, 5) : rep.paragraphs.slice(0, 3);
  rep.numbers = extractKeyNumbers(rep.text || '', 8);
  rep.tables = rep.tables.filter((t) => t.rows && t.rows.length).map((t) => ({ ...t, profile: profileTable([t.head || t.rows[0].map((_, i) => `Coluna ${i + 1}`), ...t.rows]) }));
  _siteCache.set(url, rep);
  return rep;
}


/* ===== 18-tabs.js ===== */
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


/* ===== 19-tab-commands.js ===== */
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


/* ===== 20-brain.js ===== */
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


/* ===== 21-charts.js ===== */
// ---------------------------------------------------------------------------
// 21 · Gráficos SVG (sem bibliotecas) — paleta categórica validada para
//      daltonismo (claro/escuro), barras finas com ponta arredondada, linhas
//      de 2px, rosca com total, legenda, rótulos seletivos, tooltip e crosshair.
// ---------------------------------------------------------------------------
const VIZ = {
  light: { series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'], surface: '#ffffff', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7' },
  dark: { series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'], surface: '#141b2b', ink: '#ffffff', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835' },
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
  statusIcon: { good: '✅', warning: '⏳', serious: '⚠️', critical: '⛔' },
};
function niceScale(max, ticks = 4, integer = false) {
  if (!(max > 0)) return integer ? { max: 1, step: 1, ticks: [0, 1] } : { max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  if (integer && max <= ticks) return { max: Math.ceil(max), step: 1, ticks: Array.from({ length: Math.ceil(max) + 1 }, (_, i) => i) };
  const raw = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(+v.toFixed(10));
  return { max: top, step, ticks: out };
}
const measure = (s, px = 11) => String(s).length * px * 0.56;
function chartTooltip(host) {
  let tip = host.querySelector(':scope > .o3-tip');
  if (!tip) {
    tip = h('div', { class: 'o3-tip', role: 'tooltip' });
    host.appendChild(tip);
  }
  return {
    show(x, y, title, rows) {
      tip.textContent = '';
      if (title) tip.appendChild(h('div', { class: 'o3-tip-t', text: title }));
      for (const r of rows) {
        const row = h('div', { class: 'o3-tip-r' });
        row.appendChild(h('span', { class: 'o3-tip-k', style: { background: r.color, height: r.line ? '2px' : '8px' } }));
        row.appendChild(h('b', { text: r.value }));
        if (r.label) row.appendChild(h('span', { class: 'o3-tip-l', text: r.label }));
        tip.appendChild(row);
      }
      tip.style.display = 'block';
      const hw = host.clientWidth, tw = tip.offsetWidth;
      tip.style.left = clamp(x + 12, 4, Math.max(4, hw - tw - 4)) + 'px';
      tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
    },
    hide() {
      tip.style.display = 'none';
    },
  };
}
// data: { labels, series:[{name, values}], status? } · opts: { kind, theme, unit, height, pct }
function renderChart(host, data, opts = {}) {
  const th = VIZ[opts.theme === 'dark' ? 'dark' : 'light'];
  host.classList.add('o3-chart');
  host.querySelectorAll(':scope > svg, :scope > .o3-legend, :scope > .o3-empty').forEach((n) => n.remove());
  const tip = chartTooltip(host);
  tip.hide();
  const labels = (data.labels || []).map((l) => String(l));
  const series = (data.series || []).filter((s) => s && s.values && s.values.length);
  const unit = opts.unit ? ' ' + opts.unit : opts.pct ? '%' : '';
  const fmtV = (v) => (v == null || isNaN(v) ? '—' : fmtNum(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : 0) + unit);
  if (!labels.length || !series.length || series.every((s) => s.values.every((v) => !v))) {
    host.appendChild(h('div', { class: 'o3-empty', text: data.placeholder ? 'Sem dados ainda — registre informações para ver o gráfico.' : 'Sem dados para exibir ainda.' }));
    return;
  }
  let kind = opts.kind || 'bar';
  if (kind === 'pie') kind = 'donut';
  if (kind === 'bar' && labels.length > 8 && labels.some((l) => l.length > 10)) kind = 'hbar';
  const W = Math.max(220, host.clientWidth || 360);
  const colorOf = (i) => (data.status ? VIZ.status[data.status[i]] || th.series[i % 8] : th.series[i % 8]);
  const sColor = (k) => th.series[k % 8];
  const legendItems = [];
  const svg = svgEl('svg', { width: W, role: 'img', 'aria-label': `${opts.title || 'Gráfico'}: ${labels.length} categorias` });
  const add = (tag, a) => {
    const e = svgEl(tag, a);
    svg.appendChild(e);
    return e;
  };
  const txt = (x, y, s, a = {}) => {
    const e = add('text', { x, y, fill: a.fill || th.muted, 'font-size': a.size || 10.5, 'text-anchor': a.anchor || 'start', 'font-weight': a.weight || 400, 'dominant-baseline': a.base || 'auto' });
    e.textContent = s;
    return e;
  };
  if (kind === 'donut') {
    let items = labels.map((l, i) => ({ label: l, value: series[0].values[i] || 0, color: colorOf(i), status: data.status && data.status[i] })).filter((x) => x.value > 0);
    if (!data.status && items.length > 6) {
      items.sort((a, b) => b.value - a.value);
      const rest = items.slice(5);
      items = items.slice(0, 5).concat([{ label: 'Outros', value: rest.reduce((a, b) => a + b.value, 0), color: th.muted }]);
      items.forEach((it, i) => i < 5 && (it.color = sColor(i)));
    }
    const total = items.reduce((a, b) => a + b.value, 0);
    const Hh = opts.height || 200;
    const narrow = W < 380;
    const size = Math.min(Hh, narrow ? W : W * 0.5);
    const R = size / 2 - 6, r = R * 0.62, cx = narrow ? W / 2 : size / 2 + 4, cy = size / 2;
    svg.setAttribute('height', size);
    let a0 = -Math.PI / 2;
    items.forEach((it) => {
      const a1 = a0 + (it.value / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
      const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
      const d = items.length === 1 ? `M ${cx - R} ${cy} A ${R} ${R} 0 1 1 ${cx + R} ${cy} A ${R} ${R} 0 1 1 ${cx - R} ${cy} M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy}` : `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
      const seg = add('path', { d, fill: it.color, stroke: th.surface, 'stroke-width': 2, 'fill-rule': 'evenodd', tabindex: 0, class: 'o3-mark' });
      const pct = ((it.value / total) * 100).toFixed(0);
      const show = (e) => {
        const bb = host.getBoundingClientRect();
        tip.show((e.clientX || bb.left + cx) - bb.left, (e.clientY || bb.top + cy) - bb.top, it.label, [{ color: it.color, value: `${fmtV(it.value)} (${pct}%)` }]);
      };
      seg.addEventListener('pointermove', show);
      seg.addEventListener('focus', show);
      seg.addEventListener('pointerleave', () => tip.hide());
      seg.addEventListener('blur', () => tip.hide());
      legendItems.push({ color: it.color, label: it.label, value: `${fmtV(it.value)} · ${pct}%`, icon: it.status ? VIZ.statusIcon[it.status] : null });
      a0 = a1;
    });
    txt(cx, cy - 2, fmtCompact(total), { fill: th.ink, size: Math.max(16, R * 0.34), anchor: 'middle', weight: 600, base: 'middle' });
    txt(cx, cy + R * 0.26, 'total', { anchor: 'middle', size: 10.5 });
    host.insertBefore(svg, host.firstChild);
    const lg = h('div', { class: 'o3-legend' + (narrow ? '' : ' o3-legend-side'), style: narrow ? {} : { left: size + 18 + 'px' } });
    legendItems.forEach((li) => lg.appendChild(h('div', { class: 'o3-lg' }, h('span', { class: 'o3-sw', style: { background: li.color } }), li.icon ? h('span', { class: 'o3-lg-ic', text: li.icon }) : null, h('span', { class: 'o3-lg-l', text: li.label }), h('b', { text: li.value }))));
    host.appendChild(lg);
    if (!narrow) host.style.minHeight = size + 'px';
    return;
  }
  host.style.minHeight = '';
  const maxV = Math.max(0, ...(kind === 'stacked' ? labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0)) : series.flatMap((s) => s.values.filter((v) => !isNaN(v)))));
  const allInt = series.every((s) => s.values.every((v) => v == null || isNaN(v) || Number.isInteger(v)));
  const sc = niceScale(maxV, 4, allInt);
  const tickW = Math.max(...sc.ticks.map((t) => measure(fmtCompact(t), 10.5))) + 8;
  if (kind === 'hbar') {
    const n = labels.length;
    const lblW = Math.min(W * 0.4, Math.max(...labels.map((l) => measure(truncate(l, 28), 11))) + 10);
    const rowH = series.length > 1 ? 14 * series.length + 12 : 26;
    const top = 6, bottom = 20;
    const Hh = top + n * rowH + bottom;
    svg.setAttribute('height', Hh);
    const x0 = lblW, x1 = W - 44;
    const xs = (v) => x0 + (v / sc.max) * (x1 - x0);
    sc.ticks.forEach((t) => {
      add('line', { x1: xs(t), x2: xs(t), y1: top, y2: Hh - bottom, stroke: th.grid, 'stroke-width': 1 });
      txt(xs(t), Hh - 5, fmtCompact(t), { anchor: 'middle' });
    });
    add('line', { x1: x0, x2: x0, y1: top, y2: Hh - bottom, stroke: th.axis, 'stroke-width': 1 });
    labels.forEach((l, i) => {
      const y = top + i * rowH;
      txt(x0 - 8, y + rowH / 2, truncate(l, 28), { anchor: 'end', base: 'middle', fill: th.ink2, size: 11 });
      const bh = Math.min(16, (rowH - 8 - (series.length - 1) * 2) / series.length);
      series.forEach((s, k) => {
        const v = s.values[i] || 0;
        const by = y + (rowH - (bh * series.length + (series.length - 1) * 2)) / 2 + k * (bh + 2);
        const w = Math.max(0, xs(v) - x0);
        const rr = Math.min(4, w);
        add('path', { d: `M ${x0} ${by} H ${x0 + w - rr} Q ${x0 + w} ${by} ${x0 + w} ${by + rr} V ${by + bh - rr} Q ${x0 + w} ${by + bh} ${x0 + w - rr} ${by + bh} H ${x0} Z`, fill: data.status ? colorOf(i) : sColor(k), class: 'o3-mark' });
        if (series.length === 1) txt(x0 + w + 6, by + bh / 2, fmtV(v), { base: 'middle', fill: th.ink2, size: 10.5 });
      });
      const hit = add('rect', { x: 0, y, width: W, height: rowH, fill: 'transparent', tabindex: 0 });
      const show = (e) => {
        const bb = host.getBoundingClientRect();
        tip.show((e.clientX || bb.left + x1) - bb.left, y + 4, l, series.map((s, k) => ({ color: sColor(k), value: fmtV(s.values[i]), label: series.length > 1 ? s.name : '' })));
      };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('pointerleave', () => tip.hide());
      hit.addEventListener('blur', () => tip.hide());
    });
  } else {
    const Hh = opts.height || 210;
    const top = 12, bottom = 26, left = tickW, right = kind === 'line' || kind === 'area' ? 44 : 10;
    svg.setAttribute('height', Hh);
    const n = labels.length;
    const pw = W - left - right, ph = Hh - top - bottom;
    const ys = (v) => top + ph - (v / sc.max) * ph;
    sc.ticks.forEach((t) => {
      add('line', { x1: left, x2: W - right, y1: ys(t), y2: ys(t), stroke: t === 0 ? th.axis : th.grid, 'stroke-width': 1 });
      txt(left - 6, ys(t), fmtCompact(t), { anchor: 'end', base: 'middle' });
    });
    const band = pw / n;
    const every = Math.ceil((n * 46) / pw);
    labels.forEach((l, i) => {
      if (i % every === 0) txt(left + band * i + band / 2, Hh - 8, truncate(l, Math.max(4, Math.floor(band * every / 6.5))), { anchor: 'middle' });
    });
    if (kind === 'line' || kind === 'area') {
      const xs = (i) => left + band * i + band / 2;
      series.forEach((s, k) => {
        const pts = s.values.map((v, i) => [xs(i), ys(v || 0)]);
        const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        if (kind === 'area' || series.length === 1) add('path', { d: `${d} L ${pts[pts.length - 1][0]} ${ys(0)} L ${pts[0][0]} ${ys(0)} Z`, fill: sColor(k), opacity: 0.1 });
        add('path', { d, fill: 'none', stroke: sColor(k), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
        const last = pts[pts.length - 1];
        add('circle', { cx: last[0], cy: last[1], r: 4, fill: sColor(k), stroke: th.surface, 'stroke-width': 2 });
        if (series.length <= 4) txt(last[0] + 7, last[1], fmtV(s.values[s.values.length - 1]), { base: 'middle', fill: th.ink2, size: 10.5 });
      });
      const cross = add('line', { y1: top, y2: top + ph, stroke: th.axis, 'stroke-width': 1, opacity: 0 });
      const dots = series.map((s, k) => add('circle', { r: 4, fill: sColor(k), stroke: th.surface, 'stroke-width': 2, opacity: 0 }));
      const hit = add('rect', { x: left, y: top, width: pw, height: ph, fill: 'transparent', tabindex: 0 });
      let fi = n - 1;
      const at = (i) => {
        i = clamp(i, 0, n - 1);
        fi = i;
        cross.setAttribute('x1', xs(i));
        cross.setAttribute('x2', xs(i));
        cross.setAttribute('opacity', 1);
        dots.forEach((d, k) => {
          d.setAttribute('cx', xs(i));
          d.setAttribute('cy', ys(series[k].values[i] || 0));
          d.setAttribute('opacity', 1);
        });
        tip.show(xs(i), Math.min(...series.map((s) => ys(s.values[i] || 0))), labels[i], series.map((s, k) => ({ color: sColor(k), line: true, value: fmtV(s.values[i]), label: series.length > 1 ? s.name : '' })));
      };
      hit.addEventListener('pointermove', (e) => {
        const bb = svg.getBoundingClientRect();
        at(Math.round((e.clientX - bb.left - left - band / 2) / band));
      });
      hit.addEventListener('focus', () => at(fi));
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') at(fi - 1);
        if (e.key === 'ArrowRight') at(fi + 1);
      });
      const off = () => {
        cross.setAttribute('opacity', 0);
        dots.forEach((d) => d.setAttribute('opacity', 0));
        tip.hide();
      };
      hit.addEventListener('pointerleave', off);
      hit.addEventListener('blur', off);
    } else {
      const s = series.length;
      const stacked = kind === 'stacked';
      const groupW = band * 0.72;
      const bw = stacked ? Math.min(24, groupW) : Math.min(24, (groupW - (s - 1) * 2) / s);
      const labelAll = s === 1 && n <= 12;
      labels.forEach((l, i) => {
        const gx = left + band * i + (band - (stacked ? bw : bw * s + (s - 1) * 2)) / 2;
        let acc = 0;
        series.forEach((ser, k) => {
          const v = ser.values[i] || 0;
          const x = stacked ? gx : gx + k * (bw + 2);
          const yTop = ys(acc + v), yBase = ys(acc);
          const hgt = Math.max(0, yBase - yTop - (stacked && k > 0 ? 2 : 0));
          const rr = !stacked || k === s - 1 ? Math.min(4, hgt, bw / 2) : 0;
          if (hgt > 0) add('path', { d: `M ${x} ${yTop + hgt} V ${yTop + rr} Q ${x} ${yTop} ${x + rr} ${yTop} H ${x + bw - rr} Q ${x + bw} ${yTop} ${x + bw} ${yTop + rr} V ${yTop + hgt} Z`, fill: data.status ? colorOf(i) : sColor(k), class: 'o3-mark' });
          if (labelAll) txt(x + bw / 2, yTop - 5, fmtV(v), { anchor: 'middle', fill: th.ink2, size: 10.5 });
          if (stacked) acc += v;
        });
        const hit = add('rect', { x: left + band * i, y: top, width: band, height: ph, fill: 'transparent', tabindex: 0 });
        const show = () => tip.show(left + band * i + band / 2, top + 10, l, series.map((ser, k) => ({ color: data.status ? colorOf(i) : sColor(k), value: fmtV(ser.values[i]), label: s > 1 ? ser.name : '' })));
        hit.addEventListener('pointermove', show);
        hit.addEventListener('focus', show);
        hit.addEventListener('pointerleave', () => tip.hide());
        hit.addEventListener('blur', () => tip.hide());
      });
    }
  }
  host.insertBefore(svg, host.firstChild);
  if (series.length > 1) {
    const lg = h('div', { class: 'o3-legend' });
    series.forEach((ser, k) => lg.appendChild(h('div', { class: 'o3-lg' }, h('span', { class: 'o3-sw' + (kind === 'line' ? ' o3-sw-line' : ''), style: { background: sColor(k) } }), h('span', { class: 'o3-lg-l', text: ser.name }))));
    host.appendChild(lg);
  } else if (data.status) {
    const lg = h('div', { class: 'o3-legend' });
    labels.forEach((l, i) => lg.appendChild(h('div', { class: 'o3-lg' }, h('span', { class: 'o3-sw', style: { background: colorOf(i) } }), h('span', { class: 'o3-lg-ic', text: VIZ.statusIcon[data.status[i]] || '' }), h('span', { class: 'o3-lg-l', text: l }))));
    host.appendChild(lg);
  }
}
function sparkline(values, theme = 'light', w = 96, hgt = 26) {
  const th = VIZ[theme === 'dark' ? 'dark' : 'light'];
  const vals = values.filter((v) => !isNaN(v));
  const svg = svgEl('svg', { width: w, height: hgt, 'aria-hidden': 'true' });
  if (vals.length < 2) return svg;
  const mx = Math.max(...vals), mn = Math.min(...vals);
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * (w - 6) + 3, hgt - 4 - ((v - mn) / (mx - mn || 1)) * (hgt - 8)]);
  svg.appendChild(svgEl('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '), fill: 'none', stroke: th.muted, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
  const l = pts[pts.length - 1];
  svg.appendChild(svgEl('circle', { cx: l[0], cy: l[1], r: 3, fill: th.series[0] }));
  return svg;
}


/* ===== 22-styles.js ===== */
// ---------------------------------------------------------------------------
// 22 · Estilos (isolados em Shadow DOM — o CSS do app não interfere)
// ---------------------------------------------------------------------------
const CSS = `
:host{all:initial;display:block}
*,*::before,*::after{box-sizing:border-box}
.o3-root,.o3-ov{font-family:"Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;font-size:14.5px;line-height:1.5;color:#e6edf5;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
input,textarea,select{font:inherit;color:inherit}
a{color:#5eead4}
.o3-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:2px solid #5eead4;outline-offset:2px}

/* ===== Painel da IA ===== */
.o3-panel{--o3-h:clamp(620px,82vh,1100px);position:relative;display:flex;flex-direction:column;height:var(--o3-h);min-height:460px;border-radius:22px;background:#0b1322;border:1px solid rgba(45,212,191,.16);box-shadow:0 18px 50px rgba(2,8,23,.35);overflow:hidden;isolation:isolate}
.o3-panel::before{content:"";position:absolute;inset:0;z-index:-1;background-image:linear-gradient(rgba(148,163,184,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.045) 1px,transparent 1px);background-size:34px 34px;mask-image:linear-gradient(180deg,#000,transparent 70%)}
.o3-panel.o3-expanded{--o3-h:94vh}
.o3-panel.o3-fullscreen{--o3-h:100vh;height:100vh;border-radius:0;border:0}
.o3-head{display:flex;align-items:center;gap:14px;padding:16px 22px 12px}
.o3-logo{width:52px;height:52px;flex:none;filter:drop-shadow(0 0 10px rgba(45,212,191,.35))}
.o3-brand{display:flex;align-items:center;gap:10px;min-width:0}
.o3-brand h1{margin:0;font-size:26px;font-weight:800;letter-spacing:.3px;color:#fff;white-space:nowrap}
.o3-brand h1 span{font-weight:300;color:#cbd5e1}
.o3-badge{font-size:12.5px;font-weight:800;letter-spacing:1px;color:#052e2b;background:linear-gradient(135deg,#5eead4,#2dd4bf);padding:3px 9px;border-radius:7px}
.o3-sub{font-size:12px;color:#8aa0b6;margin-top:-2px}
.o3-head-r{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.o3-pill{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:700;padding:7px 14px;border-radius:999px;background:rgba(20,184,166,.1);border:1px solid rgba(45,212,191,.35);color:#99f6e4;white-space:nowrap}
.o3-pill i{width:9px;height:9px;border-radius:50%;background:#34d399;box-shadow:0 0 8px #34d399}
.o3-pill.o3-online i{background:#fbbf24;box-shadow:0 0 8px #fbbf24}
.o3-btn{display:inline-flex;align-items:center;gap:7px;font-size:13.5px;font-weight:700;padding:8px 15px;border-radius:999px;background:#131d30;border:1px solid rgba(148,163,184,.22);color:#e2e8f0;transition:background .15s,border-color .15s,transform .1s;white-space:nowrap}
.o3-btn:hover{background:#1a2740;border-color:rgba(45,212,191,.45)}
.o3-btn:active{transform:translateY(1px)}
.o3-btn.o3-primary{background:linear-gradient(135deg,#2dd4bf,#14b8a6);color:#042f2c;border-color:transparent}
.o3-btn.o3-primary:hover{filter:brightness(1.06)}
.o3-btn.o3-sm{font-size:12.5px;padding:6px 11px}
.o3-btn.o3-danger:hover{border-color:#f87171;color:#fecaca}
.o3-ib{width:36px;height:36px;display:inline-grid;place-items:center;border-radius:11px;background:#131d30;border:1px solid rgba(148,163,184,.2);color:#cbd5e1;font-size:16px;transition:background .15s,border-color .15s}
.o3-ib:hover{background:#1a2740;border-color:rgba(45,212,191,.45);color:#fff}
.o3-ib.o3-on{border-color:#2dd4bf;color:#5eead4}
.o3-body{flex:1;display:flex;min-height:0;padding:0 18px 12px;gap:12px}
/* barra lateral de conversas */
.o3-side{width:262px;flex:none;display:flex;flex-direction:column;background:rgba(9,15,28,.72);border:1px solid rgba(148,163,184,.1);border-radius:18px;min-height:0;overflow:hidden;transition:width .2s,opacity .2s}
.o3-side.o3-hidden{width:0;opacity:0;border:0;margin-right:-12px}
.o3-side-top{padding:12px;display:flex;flex-direction:column;gap:9px;border-bottom:1px solid rgba(148,163,184,.08)}
.o3-search{width:100%;background:#0b1424;border:1px solid rgba(148,163,184,.18);border-radius:11px;padding:8px 11px;font-size:13px;outline:none}
.o3-search:focus{border-color:rgba(45,212,191,.55)}
.o3-chats{flex:1;overflow:auto;padding:6px 8px 10px;scrollbar-width:thin;scrollbar-color:#223149 transparent}
.o3-grp{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#6b7f95;margin:12px 8px 4px;font-weight:700}
.o3-chat{display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:11px;color:#cbd5e1;font-size:13.2px;width:100%;text-align:left;position:relative}
.o3-chat:hover{background:#111b2d}
.o3-chat.o3-active{background:linear-gradient(90deg,rgba(45,212,191,.16),rgba(45,212,191,.04));color:#fff;box-shadow:inset 3px 0 0 #2dd4bf}
.o3-chat .o3-ct{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-chat .o3-cm{opacity:0;font-size:15px;padding:0 4px;border-radius:6px;color:#94a3b8}
.o3-chat:hover .o3-cm,.o3-chat.o3-active .o3-cm{opacity:1}
.o3-chat .o3-cm:hover{background:#1e2a40;color:#fff}
.o3-chat .o3-pin{font-size:11px}
.o3-side-foot{display:flex;gap:6px;padding:10px;border-top:1px solid rgba(148,163,184,.08)}
.o3-side-foot .o3-btn{flex:1;justify-content:center;padding:7px 6px;font-size:12.5px}
/* área principal */
.o3-main{flex:1;min-width:0;display:flex;flex-direction:column;background:#0a111f;border:1px solid rgba(148,163,184,.1);border-radius:18px;overflow:hidden;position:relative}
.o3-chatbar{display:flex;align-items:center;gap:8px;padding:9px 12px 9px 14px;border-bottom:1px solid rgba(148,163,184,.08);min-height:48px}
.o3-ctitle{flex:1;min-width:0;font-weight:700;font-size:14px;color:#e2e8f0;background:none;border:1px solid transparent;border-radius:8px;padding:4px 8px;outline:none;text-overflow:ellipsis}
.o3-ctitle:hover{border-color:rgba(148,163,184,.2)}
.o3-ctitle:focus{border-color:rgba(45,212,191,.5);background:#0b1424}
.o3-ctx{display:flex;gap:6px;flex-wrap:wrap;padding:8px 14px 0}
.o3-ctx:empty{display:none}
.o3-ctxc{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 6px 3px 9px;border-radius:999px;background:#0f2427;border:1px solid rgba(45,212,191,.28);color:#99f6e4;max-width:260px}
.o3-ctxc span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-ctxc button{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:11px;color:#7dd3c0}
.o3-ctxc button:hover{background:rgba(45,212,191,.2);color:#fff}
.o3-msgs{flex:1;overflow:auto;padding:22px 22px 12px;display:flex;flex-direction:column;gap:18px;scroll-behavior:smooth;scrollbar-width:thin;scrollbar-color:#223149 transparent}
.o3-msg{display:flex;gap:12px;max-width:100%}
.o3-msg.o3-user{justify-content:flex-end}
.o3-av{width:44px;height:44px;flex:none;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 35% 30%,#99f6e4,#2dd4bf 55%,#0f766e);box-shadow:0 0 0 3px rgba(45,212,191,.18),0 0 18px rgba(45,212,191,.35)}
.o3-bub{position:relative;max-width:min(78%,880px);padding:13px 17px;border-radius:16px;font-size:15px;overflow-wrap:break-word;word-break:normal}
.o3-user>div{max-width:min(78%,880px);display:flex;flex-direction:column;align-items:flex-end;min-width:0}
.o3-user>div>.o3-bub{max-width:100%}
.o3-user .o3-bub{background:linear-gradient(135deg,#115e59,#0f4f4b);border:1px solid rgba(45,212,191,.38);color:#f0fdfa;white-space:pre-wrap}
.o3-ai .o3-bub{background:#131c2e;border:1px solid rgba(148,163,184,.12);padding-left:24px;min-width:120px}
.o3-ai .o3-bub::before{content:"";position:absolute;left:11px;top:14px;bottom:14px;width:3px;border-radius:3px;background:linear-gradient(#2dd4bf,#14b8a6)}
.o3-ai-col{display:flex;flex-direction:column;gap:8px;min-width:0;max-width:min(82%,900px)}
.o3-ai-col .o3-bub{max-width:100%}
.o3-md p{margin:0 0 8px}.o3-md p:last-child{margin:0}
.o3-md ul,.o3-md ol{margin:4px 0 8px;padding-left:20px}.o3-md li{margin:3px 0}
.o3-md blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid #2dd4bf;background:rgba(45,212,191,.06);border-radius:0 10px 10px 0;color:#d6e2ee}
.o3-md code{background:#0b1424;border:1px solid rgba(148,163,184,.18);padding:1px 6px;border-radius:6px;font-size:.92em}
.o3-md pre{background:#0b1424;border:1px solid rgba(148,163,184,.18);padding:10px 12px;border-radius:10px;white-space:pre-wrap;font-size:13px;max-height:340px;overflow:auto}
.o3-md b,.o3-md strong{color:#fff}
.o3-md em{color:#b8c7d8}
.o3-meta{font-size:11.5px;color:#6b7f95;margin-top:4px;text-align:right}
.o3-acts{display:flex;gap:4px;opacity:0;transition:opacity .15s;margin-left:2px}
.o3-msg:hover .o3-acts,.o3-acts:focus-within{opacity:1}
.o3-acts button{font-size:13px;padding:4px 8px;border-radius:8px;color:#8aa0b6}
.o3-acts button:hover{background:#131d30;color:#fff}
.o3-acts button.o3-on{color:#5eead4}
.o3-chips{display:flex;flex-wrap:wrap;gap:8px}
.o3-chip{font-size:13.5px;font-weight:650;padding:7px 14px;border-radius:999px;background:#0f2427;border:1px solid rgba(45,212,191,.35);color:#ccfbf1;text-align:left;transition:background .15s,border-color .15s}
.o3-chip:hover{background:#133236;border-color:#2dd4bf}
.o3-card{display:flex;gap:12px;align-items:flex-start;background:#0e1728;border:1px solid rgba(148,163,184,.16);border-radius:14px;padding:12px 14px}
.o3-card .o3-ci{width:42px;height:42px;flex:none;border-radius:11px;display:grid;place-items:center;font-size:22px;background:#132238;border:1px solid rgba(148,163,184,.14);overflow:hidden}
.o3-card .o3-ci img{width:100%;height:100%;object-fit:cover}
.o3-card .o3-cb{flex:1;min-width:0}
.o3-card .o3-ct1{font-weight:750;color:#fff;font-size:14.5px}
.o3-card .o3-ct2{font-size:12.5px;color:#8aa0b6;margin-top:1px}
.o3-card .o3-cbtns{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.o3-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.o3-kpi{background:#0e1728;border:1px solid rgba(148,163,184,.14);border-radius:12px;padding:10px 12px}
.o3-kpi b{display:block;font-size:20px;color:#fff;font-weight:650}
.o3-kpi span{font-size:12px;color:#8aa0b6}
.o3-srcs{display:flex;flex-direction:column;gap:4px;font-size:12.5px}
.o3-srcs a{color:#7dd3fc;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-srcs a:hover{text-decoration:underline}
.o3-typing{display:inline-flex;gap:5px;padding:4px 2px}
.o3-typing i{width:7px;height:7px;border-radius:50%;background:#5eead4;animation:o3b 1.1s infinite ease-in-out}
.o3-typing i:nth-child(2){animation-delay:.15s}.o3-typing i:nth-child(3){animation-delay:.3s}
@keyframes o3b{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-4px)}}
.o3-status{font-size:12px;color:#8aa0b6;padding:0 22px 6px;min-height:0}
/* compositor */
.o3-comp-wrap{padding:10px 14px 12px;border-top:1px solid rgba(148,163,184,.06)}
.o3-tray{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.o3-tray:empty{display:none}
.o3-att{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 6px;border-radius:12px;background:#0f1a2d;border:1px solid rgba(148,163,184,.2);max-width:280px;font-size:12.5px;position:relative}
.o3-att .o3-ati{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;background:#15233a;font-size:17px;flex:none;overflow:hidden}
.o3-att .o3-ati img{width:100%;height:100%;object-fit:cover}
.o3-att .o3-atn{min-width:0}
.o3-att .o3-atn b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0;font-weight:650}
.o3-att .o3-atn span{color:#8aa0b6;font-size:11.5px}
.o3-att .o3-atx{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:#94a3b8;flex:none}
.o3-att .o3-atx:hover{background:#1e2a40;color:#fff}
.o3-att.o3-busy .o3-atn span::after{content:"";display:inline-block;width:10px;height:10px;margin-left:6px;border:2px solid #5eead4;border-right-color:transparent;border-radius:50%;animation:o3spin .8s linear infinite;vertical-align:-1px}
@keyframes o3spin{to{transform:rotate(360deg)}}
.o3-comp{display:flex;align-items:flex-end;gap:8px;background:#0b1322;border-radius:30px;padding:9px 9px 9px 22px;box-shadow:0 0 0 1.5px rgba(45,212,191,.55),0 0 22px rgba(45,212,191,.2);transition:box-shadow .2s}
.o3-comp:focus-within{box-shadow:0 0 0 2px rgba(45,212,191,.85),0 0 28px rgba(45,212,191,.3)}
.o3-ta{flex:1;resize:none;border:0;outline:none;background:transparent;font-size:15.5px;line-height:1.45;max-height:210px;min-height:24px;padding:12px 0;color:#f1f5f9}
.o3-ta::placeholder{color:#7c8ea3}
.o3-attach{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(148,163,184,.25);color:#cbd5e1;font-size:19px;flex:none}
.o3-attach:hover{border-color:#2dd4bf;color:#fff}
.o3-send{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#5eead4,#14b8a6);color:#042f2c;flex:none;box-shadow:0 6px 18px rgba(20,184,166,.35)}
.o3-send:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
.o3-hint{font-size:11.5px;color:#5f7389;margin:6px 6px 0;display:flex;gap:12px;flex-wrap:wrap}
.o3-drop{position:absolute;inset:8px;border-radius:16px;border:2px dashed #2dd4bf;background:rgba(10,17,31,.9);display:none;place-items:center;text-align:center;z-index:20;font-size:16px;color:#ccfbf1;padding:20px}
.o3-drop.o3-show{display:grid}
.o3-slash{position:absolute;left:14px;right:14px;bottom:calc(100% - 6px);background:#101a2c;border:1px solid rgba(148,163,184,.22);border-radius:14px;padding:6px;box-shadow:0 14px 40px rgba(0,0,0,.45);max-height:300px;overflow:auto;z-index:15}
.o3-slash button{display:flex;gap:10px;width:100%;text-align:left;padding:8px 10px;border-radius:9px;font-size:13.5px}
.o3-slash button b{color:#5eead4;min-width:96px}
.o3-slash button.o3-sel,.o3-slash button:hover{background:#17243a}
.o3-resize{position:absolute;left:50%;bottom:3px;transform:translateX(-50%);width:64px;height:8px;border-radius:6px;cursor:ns-resize;background:rgba(148,163,184,.25)}
.o3-resize:hover{background:#2dd4bf}
.o3-panel.o3-fullscreen .o3-resize{display:none}
/* avatar SVG */
.o3-face{width:30px;height:30px}

/* ===== Camada de sobreposição (tela cheia, modais, estúdio, toasts, dock) ===== */
.o3-ov{position:fixed;inset:0;pointer-events:none;z-index:var(--o3-z,2147483000)}
.o3-ov>*{pointer-events:auto}
.o3-fs{position:fixed;inset:0;z-index:5;background:#060b16}
.o3-modal-bg{position:fixed;inset:0;background:rgba(2,6,16,.62);backdrop-filter:blur(3px);display:grid;place-items:center;z-index:30;padding:18px}
.o3-modal{width:min(980px,100%);max-height:min(92vh,1000px);display:flex;flex-direction:column;background:#0d1627;border:1px solid rgba(148,163,184,.2);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.5);overflow:hidden;color:#e6edf5}
.o3-modal.o3-sm{width:min(560px,100%)}
.o3-mh{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(148,163,184,.12)}
.o3-mh h2{margin:0;font-size:17px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-mb{padding:16px 18px;overflow:auto;flex:1}
.o3-mf{display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid rgba(148,163,184,.12);flex-wrap:wrap}
.o3-frame{width:100%;height:min(70vh,820px);border:0;border-radius:10px;background:#e9eef0}
.o3-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;font-size:13px;color:#b8c7d8}
.o3-field input,.o3-field textarea,.o3-field select{background:#0b1424;border:1px solid rgba(148,163,184,.22);border-radius:10px;padding:9px 11px;outline:none;color:#f1f5f9;font-size:14px}
.o3-field input:focus,.o3-field textarea:focus,.o3-field select:focus{border-color:#2dd4bf}
.o3-field textarea{min-height:90px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
.o3-row{display:flex;gap:10px;flex-wrap:wrap}.o3-row>*{flex:1;min-width:160px}
.o3-list{display:flex;flex-direction:column;gap:6px}
.o3-li{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:11px;background:#0b1424;border:1px solid rgba(148,163,184,.12);font-size:13.5px}
.o3-li>span{flex:1;min-width:0}
.o3-mut{color:#8aa0b6;font-size:12.5px}
.o3-h3{font-size:13px;text-transform:uppercase;letter-spacing:.7px;color:#7dd3c0;margin:18px 0 8px}
.o3-sw-t{display:flex;align-items:center;gap:10px;font-size:13.5px;margin:8px 0}
.o3-sw-t input{width:40px;height:22px;accent-color:#2dd4bf}
.o3-ws-open .o3-toasts{bottom:96px}
.o3-toasts{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;z-index:40;align-items:center}
.o3-toast{background:#0f1a2d;border:1px solid rgba(45,212,191,.4);color:#e6edf5;padding:10px 16px;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.4);font-size:13.5px;display:flex;gap:12px;align-items:center;animation:o3in .2s ease}
.o3-toast button{color:#5eead4;font-weight:700}
@keyframes o3in{from{opacity:0;transform:translateY(8px)}}
.o3-menu{position:fixed;min-width:190px;background:#101a2c;border:1px solid rgba(148,163,184,.25);border-radius:12px;padding:5px;box-shadow:0 18px 40px rgba(0,0,0,.5);z-index:45;color:#e6edf5}
.o3-menu button{display:flex;gap:9px;width:100%;text-align:left;padding:8px 10px;border-radius:8px;font-size:13.5px}
.o3-menu button:hover{background:#17243a}
.o3-menu hr{border:0;border-top:1px solid rgba(148,163,184,.14);margin:4px 2px}

/* ===== Estúdio de abas (segue o layout claro do OPS 360°) ===== */
.o3-ws{--w-bg:#eef2f7;--w-card:#fff;--w-line:#e3e8ef;--w-text:#0f172a;--w-text2:#5b6b7c;--w-mut:#8a97a6;--w-p:#0d9488;--w-p-soft:rgba(13,148,136,.1);position:fixed;left:0;right:0;bottom:0;top:var(--o3-ws-top,0px);z-index:10;background:var(--w-bg);color:var(--w-text);display:flex;flex-direction:column;font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;font-size:14px;line-height:1.45;animation:o3in .18s ease}
.o3-ws.o3-dark{--w-bg:#0b1220;--w-card:#141b2b;--w-line:#233046;--w-text:#e6edf5;--w-text2:#a9b8c9;--w-mut:#7b8ca0;--w-p-soft:rgba(94,234,212,.12)}
.o3-ws.o3-embed{position:relative;top:auto;inset:auto;z-index:auto;animation:none;min-height:520px;border-radius:16px}
.o3-ws-head{display:flex;align-items:center;gap:14px;padding:14px 22px;background:var(--w-card);border-bottom:1px solid var(--w-line);flex-wrap:wrap}
.o3-ws-ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:22px;background:var(--w-p-soft);border:1px solid color-mix(in srgb,var(--w-p) 30%,transparent)}
.o3-ws-title{min-width:0}
.o3-ws-title h2{margin:0;font-size:19px;font-weight:750;display:flex;align-items:center;gap:8px}
.o3-ws-title p{margin:0;font-size:12.5px;color:var(--w-text2);max-width:640px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-ws-acts{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
.o3-wb{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:10px;border:1px solid var(--w-line);background:var(--w-card);color:var(--w-text);font-weight:650;font-size:13px}
.o3-wb:hover{border-color:var(--w-p);color:var(--w-p)}
.o3-wb.o3-on{background:var(--w-p);border-color:var(--w-p);color:#fff}
.o3-wb.o3-pri{background:var(--w-p);border-color:var(--w-p);color:#fff}
.o3-wb.o3-pri:hover{filter:brightness(1.08);color:#fff}
.o3-ws-tabs{display:flex;gap:6px;padding:10px 22px 0;overflow:auto;scrollbar-width:thin}
.o3-wt{padding:8px 16px;border-radius:999px;font-weight:650;font-size:13.5px;color:var(--w-text2);background:transparent;border:1px solid transparent;white-space:nowrap}
.o3-wt:hover{background:var(--w-card);border-color:var(--w-line)}
.o3-wt.o3-active{background:var(--w-p);color:#fff;box-shadow:0 4px 12px color-mix(in srgb,var(--w-p) 35%,transparent)}
.o3-subs{display:flex;gap:4px;padding:12px 22px 0;border-bottom:1px solid var(--w-line);background:var(--w-bg);overflow:auto;scrollbar-width:thin}
.o3-st{padding:9px 14px;font-weight:650;font-size:13.5px;color:var(--w-text2);border-bottom:2.5px solid transparent;white-space:nowrap;border-radius:8px 8px 0 0}
.o3-st:hover{color:var(--w-text);background:color-mix(in srgb,var(--w-card) 60%,transparent)}
.o3-st.o3-active{color:var(--w-p);border-bottom-color:var(--w-p);background:var(--w-card)}
.o3-st.o3-add{color:var(--w-mut)}
.o3-ws-body{flex:1;overflow:auto;padding:18px 22px 110px}
.o3-grid{display:grid;grid-template-columns:repeat(var(--cols,3),minmax(0,1fr));gap:16px;align-items:start}
.o3-wg{position:relative;background:var(--w-card);border:1px solid var(--w-line);border-radius:16px;padding:14px 16px 16px;box-shadow:0 1px 2px rgba(16,24,40,.05),0 4px 16px rgba(16,24,40,.05);min-width:0}
.o3-wg-h{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.o3-wg-h h3{margin:0;font-size:14px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-wg-h .o3-wg-tb{display:flex;gap:2px}
.o3-wg-tb button{font-size:12px;padding:4px 7px;border-radius:7px;color:var(--w-mut)}
.o3-wg-tb button:hover{background:var(--w-p-soft);color:var(--w-p)}
.o3-editing .o3-wg{outline:2px dashed color-mix(in srgb,var(--w-p) 45%,transparent);outline-offset:2px}
.o3-add-tile{display:grid;place-items:center;min-height:120px;border:2px dashed var(--w-line);border-radius:16px;color:var(--w-mut);font-weight:650;background:transparent}
.o3-add-tile:hover{border-color:var(--w-p);color:var(--w-p)}
.o3-kv{font-size:32px;font-weight:650;color:var(--w-text);line-height:1.1}
.o3-kv small{font-size:14px;font-weight:600;color:var(--w-text2);margin-left:4px}
.o3-kd{font-size:12.5px;margin-top:4px;color:var(--w-text2);display:flex;gap:10px;align-items:center}
.o3-kd.o3-up b{color:#006300}.o3-kd.o3-down b{color:#b42318}
.o3-ws.o3-dark .o3-kd.o3-up b{color:#0ca30c}.o3-ws.o3-dark .o3-kd.o3-down b{color:#f97066}
.o3-tone{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:650;padding:2px 8px;border-radius:999px}
.o3-tone-critical{background:#fdeeee;color:#b42318}.o3-tone-warning{background:#fff6dd;color:#8a5a00}.o3-tone-good{background:#eafaea;color:#0b6b0b}
.o3-ws.o3-dark .o3-tone-critical{background:rgba(208,59,59,.2);color:#fda29b}.o3-ws.o3-dark .o3-tone-warning{background:rgba(250,178,25,.18);color:#fcd34d}.o3-ws.o3-dark .o3-tone-good{background:rgba(12,163,12,.2);color:#86efac}
.o3-counter{display:flex;align-items:baseline;gap:8px}
.o3-counter b{font-size:44px;font-weight:650;line-height:1;color:var(--w-p)}
.o3-bar{height:10px;border-radius:999px;background:var(--w-p-soft);overflow:hidden;margin-top:8px}
.o3-bar i{display:block;height:100%;border-radius:999px;background:var(--w-p)}
.o3-tbl-wrap{overflow:auto;max-height:420px;border:1px solid var(--w-line);border-radius:10px}
.o3-tbl{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.o3-tbl th{position:sticky;top:0;background:color-mix(in srgb,var(--w-card) 92%,var(--w-p));text-align:left;font-weight:700;color:var(--w-text2);padding:8px 10px;border-bottom:1px solid var(--w-line);white-space:nowrap;cursor:pointer}
.o3-tbl td{padding:7px 10px;border-bottom:1px solid var(--w-line);vertical-align:top}
.o3-tbl tr:last-child td{border-bottom:0}
.o3-tbl td.o3-num{text-align:right}
.o3-tbl .o3-rowx{opacity:0;color:var(--w-mut)}
.o3-tbl tr:hover .o3-rowx{opacity:1}
.o3-tbl-tools{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.o3-tbl-tools input{flex:1;min-width:140px;padding:7px 10px;border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);outline:none}
.o3-sample{display:flex;gap:10px;align-items:center;font-size:12.5px;background:#fff8e6;color:#7a5200;border:1px solid #f5d98b;border-radius:10px;padding:6px 10px;margin-bottom:8px}
.o3-ws.o3-dark .o3-sample{background:rgba(250,178,25,.12);color:#fcd34d;border-color:rgba(250,178,25,.3)}
.o3-sample button{font-weight:700;text-decoration:underline}
.o3-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.o3-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--w-text2);font-weight:600}
.o3-form input,.o3-form select{padding:8px 10px;border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);outline:none;font-size:13.5px}
.o3-form input:focus,.o3-form select:focus{border-color:var(--w-p)}
.o3-note{font-size:13.5px;color:var(--w-text);white-space:normal}
.o3-note p{margin:0 0 6px}
.o3-cl label{display:flex;gap:9px;align-items:flex-start;padding:5px 0;font-size:13.5px;cursor:pointer}
.o3-cl input{accent-color:var(--w-p);margin-top:3px;width:16px;height:16px}
.o3-cl .o3-done{text-decoration:line-through;color:var(--w-mut)}
.o3-links a{display:flex;align-items:center;gap:8px;padding:7px 0;color:var(--w-p);text-decoration:none;font-weight:600;font-size:13.5px;border-bottom:1px solid var(--w-line)}
.o3-links a:last-child{border-bottom:0}
.o3-links a:hover{text-decoration:underline}
.o3-tl{display:flex;flex-direction:column;gap:10px;border-left:2px solid var(--w-line);padding-left:14px}
.o3-tl div{position:relative;font-size:13.5px}
.o3-tl div::before{content:"";position:absolute;left:-20px;top:6px;width:10px;height:10px;border-radius:50%;background:var(--w-p);box-shadow:0 0 0 3px var(--w-card)}
.o3-tl small{display:block;color:var(--w-mut);font-size:11.5px}
.o3-calc{display:flex;flex-direction:column;gap:8px}
.o3-calc .o3-res{font-size:26px;font-weight:650;color:var(--w-p)}
.o3-site p{margin:0 0 6px;font-size:13.5px}
.o3-site .o3-src{font-size:12px;color:var(--w-mut);margin-top:8px}
.o3-ws-ask{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:min(760px,calc(100% - 32px));display:flex;gap:8px;align-items:center;background:#0b1322;border-radius:999px;padding:7px 7px 7px 18px;box-shadow:0 0 0 1.5px rgba(45,212,191,.6),0 14px 40px rgba(2,8,23,.35)}
.o3-ws-ask input{flex:1;background:transparent;border:0;outline:none;color:#f1f5f9;font-size:14.5px;padding:8px 0}
.o3-ws-ask input::placeholder{color:#7c8ea3}
.o3-ws-ask button{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#5eead4,#14b8a6);color:#042f2c;display:grid;place-items:center}
.o3-ws-ask .o3-aurora{font-size:12px;font-weight:800;color:#5eead4;letter-spacing:.6px}
.o3-ws-reply{position:absolute;left:50%;bottom:78px;transform:translateX(-50%);width:min(760px,calc(100% - 32px));background:#0f1a2d;color:#e6edf5;border:1px solid rgba(45,212,191,.35);border-radius:14px;padding:10px 14px;font-size:13.5px;box-shadow:0 14px 40px rgba(2,8,23,.35);display:none}
.o3-ws-reply.o3-show{display:block;animation:o3in .2s}
.o3-empty{color:var(--w-mut,#8a97a6);font-size:13px;padding:24px 8px;text-align:center}
/* gráficos */
.o3-chart{position:relative;width:100%}
.o3-chart svg{display:block;overflow:visible}
.o3-chart .o3-mark{transition:opacity .12s}
.o3-chart svg:hover .o3-mark{opacity:.85}
.o3-chart .o3-mark:hover{opacity:1}
.o3-tip{position:absolute;display:none;pointer-events:none;background:#0b1322;color:#f1f5f9;border-radius:10px;padding:7px 10px;font-size:12px;box-shadow:0 8px 24px rgba(2,8,23,.3);z-index:5;white-space:nowrap}
.o3-tip-t{color:#9fb0c3;font-size:11.5px;margin-bottom:3px}
.o3-tip-r{display:flex;align-items:center;gap:7px}
.o3-tip-k{display:inline-block;width:14px;border-radius:2px}
.o3-tip-r b{font-size:13px}
.o3-tip-l{color:#9fb0c3}
.o3-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;font-size:12px;color:var(--w-text2,#52514e)}
.o3-legend-side{position:absolute;top:8px;right:0;flex-direction:column;margin:0}
.o3-lg{display:flex;align-items:center;gap:6px}
.o3-lg b{color:var(--w-text,#0b0b0b);font-weight:650;margin-left:4px}
.o3-lg-ic{font-size:11px}
.o3-sw{width:10px;height:10px;border-radius:3px;flex:none}
.o3-sw-line{height:3px;width:14px;border-radius:2px}
/* dock do Slack */
.o3-dock{position:fixed;right:0;top:var(--dock-y,70vh);z-index:20;display:flex;align-items:center;gap:8px;height:46px;padding:0 12px 0 11px;border-radius:14px 0 0 14px;background:#4a154b;color:#fff;font:700 13.5px/1 "Segoe UI",system-ui,sans-serif;box-shadow:0 8px 24px rgba(74,21,75,.35),inset 0 0 0 1px rgba(255,255,255,.08);transform:translateX(calc(100% - 46px));transition:transform .22s ease,top .25s ease,opacity .2s,box-shadow .2s;cursor:grab;touch-action:none;user-select:none}
.o3-dock.o3-left{right:auto;left:0;border-radius:0 14px 14px 0;flex-direction:row-reverse;padding:0 11px 0 12px;transform:translateX(calc(-100% + 46px))}
.o3-dock:hover,.o3-dock:focus-visible,.o3-dock.o3-peek{transform:translateX(0)}
.o3-dock.o3-tuck{transform:translateX(calc(100% - 7px));opacity:.9;box-shadow:0 0 14px rgba(224,30,90,.55)}
.o3-dock.o3-left.o3-tuck{transform:translateX(calc(-100% + 7px))}
.o3-dock.o3-tuck:hover{transform:translateX(0);opacity:1}
.o3-dock.o3-drag{cursor:grabbing;transition:none}
.o3-dock svg{width:24px;height:24px;flex:none}
.o3-dock .o3-dl{white-space:nowrap}
.o3-dock .o3-db{position:absolute;top:4px;left:6px;min-width:17px;height:17px;border-radius:9px;background:#e01e5a;font-size:10.5px;display:none;place-items:center;padding:0 4px;box-shadow:0 0 0 2px #4a154b}
.o3-dock.o3-left .o3-db{left:auto;right:6px}
.o3-dock .o3-db.o3-show{display:grid}
@media (max-width:900px){.o3-side{position:absolute;z-index:12;left:10px;top:78px;bottom:14px;box-shadow:0 20px 50px rgba(0,0,0,.5)}.o3-bub,.o3-ai-col{max-width:92%}.o3-brand h1{font-size:21px}.o3-grid{grid-template-columns:1fr!important}.o3-wg{grid-column:auto!important}}
@media (max-width:560px){.o3-head-r .o3-btn,.o3-head-r .o3-ib[aria-label=Expandir]{display:none}.o3-brand h1{font-size:19px}.o3-head{padding:12px 12px 8px}.o3-body{padding:0 8px 10px}.o3-msgs{padding:14px 12px}.o3-logo{width:40px;height:40px}.o3-pill{display:none}.o3-hint{display:none}.o3-send{width:46px;height:46px}.o3-attach{width:42px;height:42px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@media print{.o3-ws-ask,.o3-ws-acts{display:none}}
`;
let _sheet = null;
function adoptStyles(root) {
  try {
    if (!_sheet) {
      _sheet = new CSSStyleSheet();
      _sheet.replaceSync(CSS);
    }
    root.adoptedStyleSheets = [...(root.adoptedStyleSheets || []), _sheet];
  } catch (e) {
    root.appendChild(h('style', { text: CSS }));
  }
}


/* ===== 23-ui-chat.js ===== */
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


/* ===== 24-ui-workspace.js ===== */
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


/* ===== 25-dock.js ===== */
// ---------------------------------------------------------------------------
// 25 · Dock inteligente do Slack
//      O botão flutuante original continua existindo (e funcionando), mas fica
//      invisível; no lugar dele entra uma "aba magnética" compacta presa à
//      borda da tela que: desliza ao passar o mouse, pode ser arrastada ao
//      longo da borda (ou trocada de lado), desvia sozinha do campo de digitação
//      e dos botões da IA, recolhe para uma faixa de 7px enquanto você digita
//      ou usa tela cheia, espelha o contador de notificações e abre com
//      Alt+Shift+S.
// ---------------------------------------------------------------------------
const SLACK_SVG = '<svg viewBox="0 0 54 54" aria-hidden="true"><g fill="#fff"><path d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.387h14.336a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386"/><path d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.387h5.376a5.381 5.381 0 0 0 5.376-5.387m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387"/><path d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.387H34.048a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386"/><path d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.387H5.376A5.381 5.381 0 0 0 0 34.25m14.336-.001v14.364A5.381 5.381 0 0 0 19.712 54a5.381 5.381 0 0 0 5.376-5.387V34.25a5.381 5.381 0 0 0-5.376-5.387 5.381 5.381 0 0 0-5.376 5.387"/></g></svg>';

const dock = {
  el: null, orig: null, target: null, side: 'right', y: null, userY: null, timer: null, mo: null, badgeMo: null, hover: false, dragging: false,
  available() {
    return !!(this.target && this.target.isConnected);
  },
  find() {
    if (CFG.slackSelector) {
      const el = document.querySelector(CFG.slackSelector);
      return el ? { orig: el, target: el } : null;
    }
    const cands = document.querySelectorAll('button,a,[role=button],[id*="slack" i],[class*="slack" i],[aria-label*="slack" i],[title*="slack" i]');
    for (const el of cands) {
      if (el.closest('#ops360-ia-v3,#ops360-ia-v3-overlay') || el.hasAttribute('data-o3-tab')) continue;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const lbl = `${el.getAttribute('aria-label') || ''} ${el.title || ''} ${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
      const isSlack = /^slack(\s*\d+)?$/i.test(txt) || /slack/i.test(lbl) || (el.tagName === 'A' && /slack\.com/i.test(el.getAttribute('href') || ''));
      if (!isSlack || txt.length > 40) continue;
      let n = el, fixed = null;
      for (let k = 0; k < 5 && n && n !== document.body; k++, n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') {
          fixed = n;
          break;
        }
      }
      if (!fixed) continue;
      const clickable = el.matches('button,a,[role=button]') ? el : el.querySelector('button,a,[role=button]') || el;
      return { orig: fixed.querySelectorAll('button,a,[role=button]').length <= 2 ? fixed : el, target: clickable };
    }
    return null;
  },
  init(force = false) {
    if (!force && (kv.get('dock.enabled', CFG.slackDock) === false || CFG.slackDock === false)) return;
    if (this.el) return;
    const f = this.find();
    if (!f) {
      // o botão pode aparecer depois (app carregando): observa o DOM
      if (!this.mo) {
        this.mo = new MutationObserver(throttle(() => {
          if (this.el) return;
          const g = this.find();
          if (g) {
            this.mo.disconnect();
            this.mo = null;
            this.adopt(g);
          }
        }, 600));
        this.mo.observe(document.body, { childList: true, subtree: true });
      }
      return;
    }
    this.adopt(f);
  },
  adopt({ orig, target }) {
    this.orig = orig;
    this.target = target;
    this._origStyle = orig.getAttribute('style') || '';
    orig.style.setProperty('visibility', 'hidden', 'important');
    orig.style.setProperty('pointer-events', 'none', 'important');
    orig.setAttribute('aria-hidden', 'true');
    orig.setAttribute('data-o3-docked', '1');
    this.side = kv.get('dock.side', 'right');
    this.userY = kv.get('dock.y', null);
    const badge = h('span', { class: 'o3-db', 'aria-hidden': 'true' });
    const el = h('button', { class: 'o3-dock o3-peek', type: 'button', 'aria-label': 'Abrir Slack (Alt+Shift+S)', title: 'Slack — arraste para mover · clique para abrir · botão direito para opções' });
    el.innerHTML = SLACK_SVG;
    el.append(h('span', { class: 'o3-dl', text: 'Slack' }), badge);
    this.badge = badge;
    this.el = el;
    ui.layer.appendChild(el);
    el.classList.toggle('o3-left', this.side === 'left');
    setTimeout(() => el.classList.remove('o3-peek'), 1600); // mostra o rótulo na primeira vez e recolhe
    this.wire();
    this.place(this.userY != null ? this.userY : Math.round(innerHeight * 0.72));
    this.timer = setInterval(() => this.tick(), 450);
    addEventListener('resize', (this._rs = throttle(() => this.tick(true), 120)));
    addEventListener('scroll', (this._sc = throttle(() => this.tick(true), 120)), true);
    document.addEventListener('keydown', (this._kd = (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        this.openSlack();
      }
    }));
    this.badgeMo = new MutationObserver(() => this.syncBadge());
    this.badgeMo.observe(orig, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-count', 'data-badge', 'aria-label'] });
    this.syncBadge();
    log('dock do Slack ativo');
  },
  wire() {
    const el = this.el;
    let startY = 0, startX = 0, y0 = 0, moved = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      startY = e.clientY;
      startX = e.clientX;
      y0 = this.y;
      moved = false;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientY - startY) + Math.abs(ev.clientX - startX) < 6) return;
        moved = true;
        this.dragging = true;
        el.classList.add('o3-drag');
        this.place(y0 + ev.clientY - startY, true);
        const left = ev.clientX < innerWidth / 2;
        if ((left ? 'left' : 'right') !== this.side) {
          this.side = left ? 'left' : 'right';
          el.classList.toggle('o3-left', left);
        }
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.classList.remove('o3-drag');
        if (moved) {
          this.userY = this.y;
          kv.set('dock.y', this.y);
          kv.set('dock.side', this.side);
          setTimeout(() => (this.dragging = false), 50);
        }
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    el.addEventListener('click', (e) => {
      if (this.dragging || moved) {
        e.preventDefault();
        return;
      }
      this.openSlack();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.place(this.y + (e.key === 'ArrowUp' ? -24 : 24), true);
        this.userY = this.y;
        kv.set('dock.y', this.y);
      }
    });
    el.addEventListener('pointerenter', () => (this.hover = true));
    el.addEventListener('pointerleave', () => (this.hover = false));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, [
        { icon: '💬', label: 'Abrir Slack', run: () => this.openSlack() },
        { icon: '↔️', label: `Mover para a ${this.side === 'right' ? 'esquerda' : 'direita'}`, run: () => {
          this.side = this.side === 'right' ? 'left' : 'right';
          el.classList.toggle('o3-left', this.side === 'left');
          kv.set('dock.side', this.side);
        } },
        { icon: '⏸️', label: 'Esconder por 1 hora', run: () => {
          el.style.display = 'none';
          setTimeout(() => (el.style.display = ''), 3600000);
          toast('Slack escondido por 1 hora (Alt+Shift+S ainda abre).');
        } },
        { icon: '↩️', label: 'Voltar ao botão original', run: () => {
          kv.set('dock.enabled', false);
          this.destroy();
          toast('Botão original do Slack restaurado. Reative em ⚙ Configurações.');
        } },
      ]);
    });
  },
  place(y, user = false) {
    const min = 70, max = innerHeight - 70;
    this.y = Math.round(clamp(y, min, max));
    this.el.style.setProperty('--dock-y', this.y - 23 + 'px');
  },
  openSlack() {
    if (!this.available()) return toast('Botão do Slack não encontrado nesta página.');
    const t = this.target;
    const prev = this.orig.style.getPropertyValue('pointer-events');
    this.orig.style.setProperty('pointer-events', 'auto', 'important');
    try {
      t.click();
    } finally {
      setTimeout(() => this.orig && this.orig.style.setProperty('pointer-events', prev || 'none', 'important'), 0);
    }
  },
  protectedRects() {
    const rects = [];
    const add = (el, pad = 10) => {
      if (!el || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) rects.push({ l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad });
    };
    if (ui.els.comp) add(ui.els.comp, 14);
    if (ui.els.tray) add(ui.els.tray);
    if (ui.panel) ui.panel.querySelectorAll('.o3-head-r button,.o3-chatbar button').forEach((b) => add(b, 6));
    if (ws.el) ws.el.querySelectorAll('.o3-ws-ask,.o3-ws-acts button,.o3-ws-reply.o3-show').forEach((b) => add(b, 8));
    ui.layer.querySelectorAll('.o3-modal,.o3-toast,.o3-menu').forEach((b) => add(b, 6));
    document.querySelectorAll('[data-o3-protect]').forEach((b) => b.id !== 'ops360-ia-v3' && add(b, 8));
    const ae = document.activeElement;
    if (ae && ae !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) add(ae, 12);
    return rects;
  },
  hits(y, rects) {
    const w = 52;
    const box = this.side === 'right' ? { l: innerWidth - w, r: innerWidth, t: y - 30, b: y + 30 } : { l: 0, r: w, t: y - 30, b: y + 30 };
    return rects.some((r) => !(r.r < box.l || r.l > box.r || r.b < box.t || r.t > box.b));
  },
  tick(immediate) {
    if (!this.el || this.dragging) return;
    if (!this.available()) {
      // o app removeu o botão: some com o dock e volta a procurar
      this.destroy(false);
      this.init();
      return;
    }
    const focused = ui.root && ui.els.ta && (ui.root.activeElement === ui.els.ta || (ui.ov && ui.ov.activeElement === ui.els.ta));
    const typing = focused && (ui.els.ta.value.length > 0 || Date.now() - (ui.lastKey || 0) < 4000);
    const focusMode = typing || ui.size === 'fullscreen' || !!ws.el;
    const rects = this.protectedRects();
    const want = this.userY != null ? this.userY : Math.round(innerHeight * 0.72);
    let y = want, found = !this.hits(want, rects);
    if (!found) {
      for (let d = 24; d < innerHeight; d += 24) {
        if (want - d > 70 && !this.hits(want - d, rects)) {
          y = want - d;
          found = true;
          break;
        }
        if (want + d < innerHeight - 70 && !this.hits(want + d, rects)) {
          y = want + d;
          found = true;
          break;
        }
      }
    }
    if (y !== this.y) this.place(y);
    this.el.classList.toggle('o3-tuck', !this.hover && (focusMode || !found));
  },
  syncBadge() {
    if (!this.orig || !this.badge) return;
    const txt = (this.orig.textContent || '').replace(/slack/gi, '');
    const attr = this.orig.getAttribute('data-count') || this.orig.getAttribute('data-badge') || '';
    const n = (attr.match(/\d+/) || txt.match(/\d+/) || [])[0];
    this.badge.textContent = n ? (+n > 99 ? '99+' : n) : '';
    this.badge.classList.toggle('o3-show', !!n && +n > 0);
    if (this.el) this.el.setAttribute('aria-label', `Abrir Slack${n && +n > 0 ? ` (${n} novas)` : ''} (Alt+Shift+S)`);
  },
  destroy(restore = true) {
    clearInterval(this.timer);
    if (this._rs) removeEventListener('resize', this._rs);
    if (this._sc) removeEventListener('scroll', this._sc, true);
    if (this._kd) document.removeEventListener('keydown', this._kd);
    if (this.badgeMo) this.badgeMo.disconnect();
    if (this.el) this.el.remove();
    if (this.orig && restore) {
      this.orig.setAttribute('style', this._origStyle || '');
      this.orig.removeAttribute('aria-hidden');
      this.orig.removeAttribute('data-o3-docked');
    }
    this.el = this.orig = this.target = null;
  },
};


/* ===== 99-boot.js ===== */
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

})();
