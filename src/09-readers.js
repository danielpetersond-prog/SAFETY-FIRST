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
