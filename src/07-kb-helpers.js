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
