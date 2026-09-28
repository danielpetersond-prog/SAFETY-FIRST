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
