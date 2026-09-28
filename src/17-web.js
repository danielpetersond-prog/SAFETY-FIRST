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
