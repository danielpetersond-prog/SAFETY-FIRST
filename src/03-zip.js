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
