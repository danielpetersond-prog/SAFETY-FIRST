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
