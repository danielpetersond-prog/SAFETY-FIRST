// Testes unitários (Node, sem navegador): texto, NLU, base de conhecimento,
// leitor de PDF nativo, geradores de PDF/Word/Excel e memória.
//   node tests/unit.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModules } from './node-harness.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const T = loadModules('25', [
  'stem', 'tokenize', 'findActivities', 'parseNumBR', 'parseDateBR', 'extractNRs', 'extractCAs', 'extractValidity', 'findGlossary', 'findAdvice', 'nrSearch',
  'classify', 'extractParams', 'extractDescription', 'pdfExtractNative', 'newDoc', 'docToPDF', 'docToDOCX', 'docToXLSX', 'GENERATORS', 'mergeActivities', 'ACT_BY_ID',
  'evalFormula', 'zipRead', 'zipWrite', 'profileTable', 'ruidoTempo', 'aiRespond', 'chatStore', 'memory', 'tabs',
]);
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : fail++, console.log(`${c ? '✔' : '✘'} ${m}`));
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} → ${JSON.stringify(a)}`);

// texto e números
eq(T.parseNumBR('1.234,56'), 1234.56, 'número pt-BR');
eq(T.parseNumBR('3,5 mil'), 3500, 'número com sufixo');
eq(T.parseDateBR('15 de março de 2027').getMonth(), 2, 'data por extenso');
eq(T.extractNRs('Conforme NR-35, NR 10 e nr-06'), [6, 10, 35], 'NRs citadas');
eq(T.extractCAs('Luva CA 12345 e capacete C.A. nº 98765'), ['12345', '98765'], 'CAs de EPI');
eq(T.extractValidity('Treinamento com validade até 10/01/2026.', new Date(2026, 8, 28)).map((v) => v.status), ['vencido'], 'validade vencida');
eq(T.ruidoTempo(95), 120, 'NR-15: 95 dB(A) → 120 min');
ok(Math.abs(T.evalFormula('A * 1000000 / H', { A: 3, H: 450000 }) - 6.6667) < 0.001, 'fórmula segura (sem eval)');
eq(T.evalFormula('2 ^ 3 + max(1, 4)', {}), 12, 'fórmula com potência e função');

// base de conhecimento
eq(T.findActivities('APR para troca de lâmpada no galpão').map((a) => a.id), ['eletrica', 'escada'], 'atividades compostas');
eq(T.findActivities('apr de empilhadera').map((a) => a.id), ['empilhadeira'], 'tolerância a erro de digitação');
eq(T.findActivities('troca de telhado').map((a) => a.id), ['telhado'], 'telhado já inclui altura');
eq((T.findGlossary('o que é sinalização vertical?') || {}).termo, 'sinalização vertical', 'glossário');
eq((T.findAdvice('Meu time não usa protetor auricular, o que faço?') || {}).id, 'epi_recusa', 'orientação prática');
eq(T.nrSearch('qual nr fala de espaço confinado', 1), [33], 'busca de NR por assunto');

// NLU
const intent = (q, ctx = {}) => T.classify(q, ctx).intent;
eq(intent('Oi Aurora! Bom dia!'), 'greet', 'saudação');
eq(intent('Queria só saber como você está'), 'howareyou', 'como está');
eq(intent('Faz uma APR de empilhadeira'), 'doc_generate', 'gerar APR');
eq(intent('o que diz a NR-12?'), 'nr_info', 'NR específica');
eq(intent('meu nome é Daniel'), 'set_name', 'nome com acento');
eq(intent('agora em word', { lastDoc: { type: 'apr' } }), 'doc_reformat', 'continuação: formato');
eq(intent('e para andaime?', { lastDoc: { type: 'apr' } }), 'doc_generate', 'continuação: outra atividade');
eq(intent('essa foto mostra fiação exposta no painel do galpão 2, faz um relatório de não conformidade', { files: [{ kind: 'image' }] }), 'doc_generate', 'foto + pedido de relatório');
eq(intent('crie uma aba de indicadores com sub abas Acidentes e Treinamentos'), 'tab_create', 'criar aba');
eq(intent('adicione um gráfico de pizza por setor', { lastIntent: 'tab_create' }), 'tab_edit', 'editar aba');
eq(intent('crie uma aba a partir do site www.exemplo.com.br/dados'), 'tab_from_site', 'aba a partir de site');
eq(intent('quanto tempo posso ficar exposto a 95 dB?'), 'calc', 'cálculo de ruído');
eq(T.extractParams('PT de trabalho a quente no galpão 3 para amanhã').local, 'Galpão 3', 'parâmetro local');
eq(T.extractDescription('fiação exposta no painel elétrico do galpão 2, faça um relatório de não conformidade em PDF'), 'Fiação exposta no painel elétrico do galpão 2', 'descrição antes do comando');

// leitor de PDF nativo
for (const f of ['apr-reportlab.pdf', 'procedimento-chromium.pdf', 'procedimento-objstm.pdf']) {
  const r = await T.pdfExtractNative(new Uint8Array(readFileSync(join(FIX, f))));
  const txt = r.pages.join('\n');
  ok(/Trabalho em Altura|PRELIMINAR DE RISCO/.test(txt) && !/T rabalho/.test(txt), `PDF nativo: ${f} (${r.pageCount} pág.)`);
}

// geradores → arquivos
const act = T.mergeActivities([T.ACT_BY_ID.empilhadeira]);
const { doc } = T.GENERATORS.apr({ text: 'APR', act, acts: [act], actDetected: true, params: {}, profile: { name: 'Teste' }, photos: [] });
const pdf = new Uint8Array(await (await T.docToPDF(doc)).arrayBuffer());
ok(String.fromCharCode(...pdf.slice(0, 5)) === '%PDF-' && pdf.length > 5000, `PDF gerado (${pdf.length} bytes)`);
const docx = new Uint8Array(await (await T.docToDOCX(doc)).arrayBuffer());
const z = await T.zipRead(docx);
ok(z.has('word/document.xml') && (await z.text('word/document.xml')).includes('empilhadeira'), 'DOCX gerado e legível pelo leitor ZIP');
const xlsx = new Uint8Array(await (await T.docToXLSX(doc)).arrayBuffer());
ok((await T.zipRead(xlsx)).has('xl/worksheets/sheet2.xml'), 'XLSX gerado com várias planilhas');
for (const type of Object.keys(T.GENERATORS).filter((k) => k !== 'resumo_doc')) {
  const r = T.GENERATORS[type]({ text: 'teste', act, acts: [act], actDetected: true, params: {}, profile: {}, photos: [], description: 'teste' });
  ok(r.doc.blocks.length > 2 && r.resumo, `gerador ${type}`);
}

// cérebro + memória (sem interface)
const chat = T.chatStore.create();
const say = async (t) => (await T.aiRespond(chat, { text: t, files: [] }, {})).intent;
eq(await say('Faz uma APR de xyzabc'), 'doc_generate', 'pede a atividade quando não reconhece');
eq(await say('solda'), 'pending_answer', 'responde a pergunta pendente');
ok(T.memory.data.synonyms.xyzabc === 'quente', 'aprende o termo novo (xyzabc → trabalho a quente)');
eq(await say('crie uma aba para controlar extintores com campos: local, tipo, validade'), 'tab_create', 'aba de controle com campos');
ok(T.tabs.list.some((t) => t.subtabs[0].widgets.some((w) => w.type === 'form')), 'aba com formulário, tabela e gráficos');

console.log(`\n${pass}/${pass + fail} testes unitários OK`);
if (fail) process.exit(1);
