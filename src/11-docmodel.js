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
