// Testes ponta a ponta do OPS 360° IA v3 no Chromium (Playwright)
//   node tests/e2e.mjs            (usa o Chromium pré-instalado)
// Valida os arquivos gerados com Python (pypdf, python-docx, openpyxl).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures');
const OUT = process.env.E2E_OUT || join(here, '..', '.e2e-out');
mkdirSync(OUT, { recursive: true });
const results = [];
let current = '';
const ok = (cond, msg) => {
  results.push({ test: current, ok: !!cond, msg });
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
};
const py = (code) => execFileSync('python3', ['-c', code], { encoding: 'utf8' }).trim();

let pw;
try {
  pw = await import('playwright');
} catch (e) {
  pw = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
}
const { chromium } = pw;
const { srv, url } = await serve();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const I = (fn, arg) => page.evaluate(fn, arg);
// Espera o elemento aparecer/sumir (salvamentos no IndexedDB são assíncronos)
const seen = (loc, timeout = 6000) => loc.first().waitFor({ state: 'attached', timeout }).then(() => true, () => false);
const gone = (loc, timeout = 6000) => loc.first().waitFor({ state: 'detached', timeout }).then(() => true, () => false);
const until = (fn, arg, timeout = 6000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const msgCount = () => I(() => OPS360IA._internals.ui.chat.messages.length);
const ta = () => page.locator('textarea.o3-ta');
async function ask(text, { wait = true } = {}) {
  const before = await msgCount();
  await ta().fill(text);
  await ta().press('Enter');
  if (wait) await page.waitForFunction((n) => OPS360IA._internals.ui.chat.messages.length >= n + 2 && !OPS360IA._internals.ui.busy, before, { timeout: 30000 });
  await page.waitForTimeout(250);
  return lastAi();
}
const lastAi = () => I(() => {
  const m = [...OPS360IA._internals.ui.chat.messages].reverse().find((x) => x.role === 'assistant');
  return { intent: m.intent, text: (m.parts || []).filter((p) => p.type === 'md').map((p) => p.text).join('\n'), parts: m.parts.map((p) => p.type) };
});
async function download(action, name) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), action()]);
  const p = join(OUT, name || dl.suggestedFilename());
  await dl.saveAs(p);
  return p;
}
async function test(name, fn) {
  current = name;
  console.log(`\n▶ ${name}`);
  try {
    await fn();
  } catch (e) {
    ok(false, 'exceção: ' + e.message.split('\n')[0]);
  }
}

await page.goto(url + '/demo/index.html');
await page.waitForFunction(() => window.OPS360IA && document.querySelector('#ops360-ia-v3') && OPS360IA._internals.ui.els.ta, null, { timeout: 20000 });
await page.waitForTimeout(800);

await test('0. Montagem no lugar do painel antigo', async () => {
  ok((await I(() => getComputedStyle(document.querySelector('.legacy')).display)) === 'none', 'painel antigo escondido');
  ok(await I(() => !!document.querySelector('#ops360-ia-v3').shadowRoot.querySelector('.o3-panel')), 'painel v3 montado (Shadow DOM)');
  const r = await ask('Daniel');
  ok(/Daniel/.test(r.text), 'aprende o nome na primeira conversa');
});

await test('1. Janela maior, expandir, tela cheia e redimensionar', async () => {
  const h0 = await I(() => OPS360IA._internals.ui.panel.getBoundingClientRect().height);
  ok(h0 >= 700, `altura padrão ${Math.round(h0)}px (antes ~600px)`);
  await page.locator('button[aria-label="Expandir"]').click();
  const h1 = await I(() => OPS360IA._internals.ui.panel.getBoundingClientRect().height);
  ok(h1 >= 0.9 * 900, `modo expandido ${Math.round(h1)}px`);
  await page.locator('button[aria-label="Expandir"]').click();
  await page.locator('button[aria-label="Tela cheia"]').click();
  const r = await I(() => OPS360IA._internals.ui.panel.getBoundingClientRect());
  ok(r.width >= 1430 && r.height >= 895, 'tela cheia ocupa a janela toda');
  await page.screenshot({ path: join(OUT, '1-tela-cheia.png') });
  await page.keyboard.press('Escape');
  ok((await I(() => OPS360IA._internals.ui.size)) === 'normal', 'Esc sai da tela cheia');
  const handle = page.locator('.o3-resize');
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 3);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 83, { steps: 6 });
  await page.mouse.up();
  const h2 = await I(() => OPS360IA._internals.ui.panel.getBoundingClientRect().height);
  ok(h2 > h0 + 60, `alça de redimensionar: ${Math.round(h0)} → ${Math.round(h2)}px`);
});

await test('2. Anexo fica na bandeja até eu escrever e enviar', async () => {
  const before = await msgCount();
  await page.locator('input[type=file]').first().setInputFiles(join(FIX, 'apr-reportlab.pdf'));
  await page.waitForTimeout(1500);
  ok((await msgCount()) === before, 'anexar NÃO envia automaticamente');
  ok((await page.locator('.o3-att').count()) === 1, 'arquivo aparece na bandeja');
  await page.screenshot({ path: join(OUT, '2-bandeja.png') });
  const r = await ask('Resuma esse documento e diga as validades');
  ok(/Resumo|resumo/.test(r.text) && /apr-reportlab/.test(r.text), `resposta usa o arquivo (${r.intent})`);
  ok((await page.locator('.o3-ctxc').count()) >= 1, 'documento fica no contexto da conversa');
  const r2 = await ask('quais normas são citadas nesse documento?');
  ok(/NR-11|NR-06|NR-12/.test(r2.text), 'pergunta de acompanhamento usa o contexto');
});

await test('3. Leitura de Word/Excel e documentos derivados', async () => {
  await page.locator('input[type=file]').first().setInputFiles(join(FIX, 'procedimento-altura.docx'));
  await page.waitForTimeout(1200);
  let r = await ask('transforme este documento em checklist');
  ok(r.intent === 'doc_generate' && r.parts.includes('doc'), 'procedimento .docx → checklist gerado');
  const pdf = await download(() => page.locator('.o3-card button:has-text("PDF")').last().click(), 'checklist-do-procedimento.pdf');
  const txt = py(`import pypdf;r=pypdf.PdfReader(${JSON.stringify(pdf)});print(' '.join(p.extract_text() for p in r.pages))`);
  ok(/cinto paraquedista|talabarte/i.test(txt), 'itens do checklist vieram do documento anexado');
  await page.locator('input[type=file]').first().setInputFiles(join(FIX, 'controle-treinamentos.xlsx'));
  await page.waitForTimeout(1200);
  r = await ask('verifique as validades desta planilha');
  ok(/vencido/i.test(r.text), 'planilha .xlsx: validades detectadas (datas de Excel convertidas)');
});

await test('3b. Geração de documentos (PDF, Word, Excel, foto)', async () => {
  const pdf = await download(() => ask('APR de trabalho em altura em PDF', { wait: false }), 'apr-altura.pdf');
  await page.waitForFunction(() => !OPS360IA._internals.ui.busy);
  const info = JSON.parse(py(`import pypdf,json;r=pypdf.PdfReader(${JSON.stringify(pdf)});t=' '.join(p.extract_text() for p in r.pages);print(json.dumps({'n':len(r.pages),'alt':'Trabalho em altura' in t,'pag':'Página 1 de' in t,'nr':'NR-35' in t}))`));
  ok(info.n >= 2 && info.alt && info.pag && info.nr, `PDF da APR válido (${info.n} páginas, NR-35, paginação)`);
  const docx = await download(() => ask('agora em word', { wait: false }), 'apr-altura.docx');
  await page.waitForFunction(() => !OPS360IA._internals.ui.busy);
  const dt = py(`import docx;d=docx.Document(${JSON.stringify(docx)});print(sum(len(t.rows) for t in d.tables), any('Trabalho em altura' in c.text for t in d.tables for r in t.rows for c in r.cells))`);
  ok(/True$/.test(dt), `Word válido (${dt.split(' ')[0]} linhas de tabela)`);
  const xlsx = await download(() => ask('checklist de extintores do almoxarifado em excel', { wait: false }), 'checklist-extintores.xlsx');
  await page.waitForFunction(() => !OPS360IA._internals.ui.busy);
  const xs = py(`import openpyxl;wb=openpyxl.load_workbook(${JSON.stringify(xlsx)});print('|'.join(wb.sheetnames), wb[wb.sheetnames[1]].max_row)`);
  ok(/Documento/.test(xs) && /extintor/i.test(py(`import openpyxl;wb=openpyxl.load_workbook(${JSON.stringify(xlsx)});print(' '.join(str(c.value) for ws in wb for r in ws.iter_rows() for c in r))`)), `Excel válido (${xs})`);
  await page.locator('input[type=file]').first().setInputFiles(join(FIX, 'foto-painel.jpg'));
  await page.waitForTimeout(1200);
  const rnc = await download(() => ask('fiação exposta no painel elétrico do galpão 2, faça um relatório de não conformidade em PDF', { wait: false }), 'rnc-foto.pdf');
  await page.waitForFunction(() => !OPS360IA._internals.ui.busy);
  const ri = JSON.parse(py(`import pypdf,json;r=pypdf.PdfReader(${JSON.stringify(rnc)});t=' '.join(p.extract_text() for p in r.pages);print(json.dumps({'img':sum(len(p.images) for p in r.pages),'desc':'fiação exposta' in t.lower() or 'fiacao exposta' in t.lower(),'data':'20/09/2026' in t,'nr10':'NR-10' in t}))`));
  ok(ri.img >= 1 && ri.desc && ri.data && ri.nr10, `relatório com foto embutida, descrição, data EXIF e NR-10 (${JSON.stringify(ri)})`);
});

await test('4. Dock inteligente do Slack', async () => {
  ok((await I(() => getComputedStyle(document.querySelector('#slackFab')).visibility)) === 'hidden', 'botão grande original escondido (continua funcional)');
  await ta().fill('');
  await page.locator('.o3-msgs').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(700);
  const d = await I(() => {
    const r = OPS360IA._internals.dock.el.getBoundingClientRect();
    return { x: r.x, w: r.width, h: r.height, cls: OPS360IA._internals.dock.el.className };
  });
  ok(d.h <= 48 && 1440 - d.x <= 50, `dock compacto na borda (${Math.round(1440 - d.x)}×${Math.round(d.h)}px visíveis)`);
  await page.locator('.o3-dock').click({ position: { x: 20, y: 20 } });
  ok(await I(() => document.querySelector('#slackPanel').classList.contains('open')), 'clique no dock abre o Slack do app');
  await page.keyboard.press('Alt+Shift+S');
  ok(!(await I(() => document.querySelector('#slackPanel').classList.contains('open'))), 'atalho Alt+Shift+S alterna o Slack');
  const overlap = await I(() => {
    const d = OPS360IA._internals.dock.el.getBoundingClientRect();
    return [OPS360IA._internals.ui.els.comp, OPS360IA._internals.ui.els.send].map((e) => e.getBoundingClientRect()).some((r) => !(r.right < d.left || r.left > d.right || r.bottom < d.top || r.top > d.bottom));
  });
  ok(!overlap, 'não cobre o campo de digitação nem o botão enviar');
  const mv = await I(() => {
    const d = OPS360IA._internals.dock;
    const y0 = d.y;
    const blk = document.createElement('div');
    blk.id = 'blk';
    blk.setAttribute('data-o3-protect', 'teste');
    blk.style.cssText = `position:fixed;right:0;top:${y0 - 40}px;width:140px;height:80px`;
    document.body.appendChild(blk);
    d.userY = y0;
    d.tick(true);
    const y1 = d.y;
    blk.remove();
    d.userY = null;
    d.tick(true);
    return { y0, y1 };
  });
  ok(Math.abs(mv.y1 - mv.y0) >= 60, `desvia sozinho de áreas protegidas (y ${mv.y0} → ${mv.y1})`);
  await page.mouse.move(700, 420);
  await ta().focus();
  await ta().type('digitando…');
  ok(await until(() => OPS360IA._internals.dock.el.classList.contains('o3-tuck')), 'recolhe para uma faixa de 7px enquanto você digita');
  await ta().fill('');
});

await test('5. Abas e sub-abas criadas pela IA', async () => {
  let r = await ask('crie uma aba de indicadores de segurança com sub abas Acidentes e Treinamentos');
  await page.waitForTimeout(600);
  ok(r.intent === 'tab_create', 'pedido entendido');
  ok(await page.locator('.o3-ws').isVisible(), 'aba aberta no estúdio');
  const navs = await I(() => [...document.querySelectorAll('[data-o3-tab]')].map((e) => e.textContent));
  ok(navs.some((t) => /Indicadores/.test(t)), 'aba aparece na barra de abas do app: ' + navs.join(' | '));
  ok((await page.locator('.o3-ws svg').count()) >= 3, 'gráficos renderizados');
  await page.screenshot({ path: join(OUT, '5-aba-indicadores.png') });
  const rowsBefore = await I(() => Object.values(OPS360IA._internals.tabs.list[0].datasets)[0].rows.length);
  const form = page.locator('.o3-ws .o3-form').first();
  await form.locator('input[type=date]').first().fill('2026-09-25');
  await form.locator('select').first().selectOption({ index: 3 });
  await form.locator('input[type=text]').first().fill('Expedição');
  await page.locator('.o3-ws button:has-text("Salvar registro")').first().click();
  ok(await until((n) => Object.values(OPS360IA._internals.tabs.list[0].datasets)[0].rows.length === n + 1, rowsBefore), 'formulário grava registro e atualiza a aba');
  const wBefore = await page.locator('.o3-ws .o3-wg').count();
  await page.locator('.o3-ws-ask input').fill('adicione um gráfico de pizza por setor');
  await page.locator('.o3-ws-ask input').press('Enter');
  await page.waitForFunction((n) => document.querySelector('#ops360-ia-v3-overlay').shadowRoot.querySelectorAll('.o3-ws .o3-wg').length > n, wBefore, { timeout: 15000 });
  ok(true, 'pedido feito dentro da aba adicionou o gráfico');
  await page.locator('.o3-ws button:has-text("Editar")').click();
  await page.locator('.o3-ws .o3-add-tile').click();
  await page.locator('.o3-modal button:has-text("Nota")').click();
  await page.locator('.o3-modal textarea').first().fill('Meta do mês: **zero acidentes**.');
  await page.locator('.o3-modal button:has-text("Salvar")').click();
  ok(await seen(page.locator('.o3-ws .o3-note:has-text("zero acidentes")')), 'edição visual: bloco de nota criado');
  const zip = await download(() => page.locator('.o3-ws button:has-text("Exportar")').click(), 'pacote-aba.zip');
  const names = py(`import zipfile,json;z=zipfile.ZipFile(${JSON.stringify(zip)});bp=[n for n in z.namelist() if n.endswith('blueprint.json')][0];d=json.loads(z.read(bp));print('|'.join(sorted(n.split('/',1)[1] for n in z.namelist())), d['schema'], len(d['history']))`);
  ok(/blueprint\.json/.test(names) && /historico-ops\.json/.test(names) && /COMO-FOI-FEITO\.md/.test(names) && /preview\.html/.test(names) && /\.js/.test(names) && /dados\//.test(names) && /ops360\.tab\/1/.test(names), 'pacote exportado: ' + names.split(' ')[0]);
  await page.locator('.o3-ws button:has-text("Fechar")').click();
  r = await ask(`crie uma aba a partir do site ${url}/tests/fixtures/site.html`);
  await page.waitForTimeout(700);
  ok(r.intent === 'tab_from_site' && /Anuário/.test(r.text), 'leu o site e criou a aba');
  const subs = await I(() => [...document.querySelector('#ops360-ia-v3-overlay').shadowRoot.querySelectorAll('.o3-ws .o3-st')].map((e) => e.textContent));
  ok(subs.includes('Resumo') && subs.some((s) => /Acidentes por mês/.test(s)), 'sub-abas geradas do site: ' + subs.join(', '));
  await page.locator('.o3-ws .o3-st:has-text("Acidentes por mês")').click();
  ok(await until(() => document.querySelector('#ops360-ia-v3-overlay').shadowRoot.querySelectorAll('.o3-ws svg path').length > 3), 'tabela do site virou gráfico');
  await page.screenshot({ path: join(OUT, '5-aba-site.png') });
  await page.locator('nav.tabs .tab:has-text("Dashboard")').click();
  await page.waitForTimeout(300);
  ok(await gone(page.locator('.o3-ws')), 'clicar numa aba nativa do app fecha a aba da IA');
  await page.locator('nav.tabs .tab:has-text("Início")').click();
});

await test('6. Vários chats + memória que persiste', async () => {
  await ask('lembre que o extintor do galpão 2 vence em outubro');
  await page.locator('.o3-side button:has-text("Nova conversa")').click();
  await page.waitForTimeout(300);
  const r = await ask('o que conversamos sobre empilhadeira?');
  ok(/empilhadeira/i.test(r.text) && r.intent === 'recall_chats', 'busca nas conversas anteriores');
  const n = await I(() => OPS360IA._internals.chatStore.list.length);
  ok(n >= 2, `${n} conversas na lateral`);
  await page.reload();
  await page.waitForFunction(() => window.OPS360IA && OPS360IA._internals.ui.els.ta, null, { timeout: 20000 });
  ok(await until((k) => OPS360IA._internals.chatStore.list.length === k, n), 'conversas continuam após recarregar');
  const h = await I(() => OPS360IA._internals.ui.panel.getBoundingClientRect().height);
  ok(h > 740, `tamanho da janela lembrado (${Math.round(h)}px)`);
  const m = await ask('o que você sabe sobre mim?');
  ok(/extintor/i.test(m.text) && /Daniel/.test(m.text) && /APR/.test(m.text), 'memória: nome, anotações e preferências');
  ok((await I(() => OPS360IA._internals.tabs.list.length)) >= 2, 'abas continuam após recarregar');
});

await test('6b. Modais, atalhos e gestão de conversas', async () => {
  await ta().fill('/ap');
  ok(await page.locator('.o3-slash button:has-text("/apr")').waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false), 'menu de atalhos "/" aparece');
  await page.keyboard.press('Escape');
  await ta().fill('');
  await page.locator('.o3-side-foot button:has-text("Memória")').click();
  ok(await seen(page.locator('.o3-modal:has-text("Memória da Aurora") >> text=extintor do galpão 2')), 'modal de memória mostra as anotações');
  await page.locator('.o3-modal button[aria-label="Fechar"]').click();
  await page.locator('button[aria-label="Configurações"]').click();
  ok(await seen(page.locator('.o3-modal:has-text("Configurações") >> text=Dock inteligente do Slack')), 'modal de configurações');
  await page.locator('.o3-modal button[aria-label="Fechar"]').click();
  await page.locator('.o3-head-r button:has-text("Abas")').click();
  ok((await page.locator('.o3-modal .o3-li').count()) >= 2, 'gerenciador de abas lista as abas criadas');
  await page.locator('.o3-modal button[aria-label="Fechar"]').click();
  const r = await ask('faz um DDS sobre uso de celular');
  ok(r.parts.includes('doc'), 'DDS gerado');
  await page.locator('.o3-card button:has-text("Visualizar")').last().click();
  ok((await seen(page.locator('.o3-modal iframe.o3-frame'))) && (await page.locator('.o3-modal iframe.o3-frame').count()) === 1, 'pré-visualização do documento abre');
  await page.locator('.o3-modal button[aria-label="Fechar"]').click();
  await page.locator('.o3-chatbar button[aria-label="Opções da conversa"]').click();
  await page.locator('.o3-menu button:has-text("Renomear")').click();
  await page.locator('.o3-modal input').fill('Conversa renomeada');
  await page.locator('.o3-modal button:has-text("Salvar")').click();
  ok(await seen(page.locator('.o3-chat:has-text("Conversa renomeada")')), 'conversa renomeada');
  const n0 = await I(() => OPS360IA._internals.chatStore.list.length);
  await page.locator('.o3-chatbar button[aria-label="Opções da conversa"]').click();
  await page.locator('.o3-menu button:has-text("Excluir")').click();
  ok(await until((k) => OPS360IA._internals.chatStore.list.length === k - 1, n0), 'conversa excluída');
  await page.locator('.o3-toast button:has-text("Desfazer")').click();
  ok(await until((k) => OPS360IA._internals.chatStore.list.length === k, n0), 'desfazer restaura a conversa');
});

await test('7. Tela de celular', async () => {
  const mp = await ctx.newPage();
  await mp.setViewportSize({ width: 390, height: 844 });
  await mp.goto(url + '/demo/index.html');
  await mp.waitForFunction(() => window.OPS360IA && OPS360IA._internals.ui.els.ta, null, { timeout: 20000 });
  await mp.waitForTimeout(600);
  const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 392, `sem rolagem horizontal (${sw}px)`);
  await mp.screenshot({ path: join(OUT, '7-celular.png') });
  await mp.close();
});

ok(!errors.length, 'sem erros de JavaScript no console' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
srv.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
if (failed.length) {
  console.log('Falhas:\n' + failed.map((f) => `- [${f.test}] ${f.msg}`).join('\n'));
  process.exit(1);
}
