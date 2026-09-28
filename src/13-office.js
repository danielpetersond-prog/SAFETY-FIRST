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
