// ---------------------------------------------------------------------------
// 14 · Geradores de documentos por tipo de solicitação
//      Cada gerador recebe um contexto (atividade, parâmetros, perfil, anexos)
//      e devolve { doc, resumo } — o doc é renderizado em PDF/Word/Excel/HTML.
// ---------------------------------------------------------------------------
const DOC_TYPES_GEN = {
  apr: { label: 'APR — Análise Preliminar de Risco', icon: '⚠️' },
  pt: { label: 'Permissão de Trabalho', icon: '🪪' },
  dds: { label: 'DDS — Diálogo Diário de Segurança', icon: '🗣️' },
  checklist: { label: 'Checklist de inspeção', icon: '✅' },
  os: { label: 'Ordem de Serviço de SST (NR-01)', icon: '📋' },
  ficha_epi: { label: 'Ficha de entrega de EPI (NR-06)', icon: '🦺' },
  inspecao: { label: 'Relatório de inspeção / não conformidade', icon: '🔎' },
  investigacao: { label: 'Relatório de investigação de acidente', icon: '🧭' },
  plano_acao: { label: 'Plano de ação 5W2H', icon: '🎯' },
  pop: { label: 'Procedimento Operacional Padrão (POP)', icon: '📘' },
  lista_presenca: { label: 'Lista de presença de treinamento', icon: '🖊️' },
  comunicado: { label: 'Alerta / comunicado de segurança', icon: '📣' },
  treinamento: { label: 'Plano de treinamento', icon: '🎓' },
  inventario: { label: 'Inventário de riscos (base do PGR)', icon: '🗂️' },
  pae: { label: 'Plano de atendimento a emergências', icon: '🚨' },
  resumo_doc: { label: 'Relatório de análise de documento', icon: '🧾' },
};

// Temas de DDS que não são uma atividade específica
const DDS_TOPICS = [
  ['quase acidente', 'quase acidente|near miss|reportar|relatar incidente', 'Reportar quase acidentes salva vidas', ['Todo acidente grave costuma ser precedido por vários quase acidentes e desvios.', 'Reportar não é dedurar: é dar chance de corrigir antes que alguém se machuque.', 'O que reportar: condições inseguras, falhas de equipamento, "quase" atropelamentos, quedas de objetos.', 'Como reportar: formulário/QR code, líder imediato ou SESMT — leva 1 minuto.', 'Todo reporte recebe retorno e, quando possível, uma ação visível.'], 'Qual foi o último "quase" que você viu e não comentou?'],
  ['saúde mental', 'saude mental|estresse|ansiedade|burnout|psicossocial|emocional', 'Saúde mental também é segurança', ['Cansaço, estresse e preocupação reduzem a atenção e aumentam o risco de acidentes.', 'Sinais de alerta: irritação, isolamento, insônia, falta de concentração.', 'Converse: pedir ajuda é sinal de força. Procure a liderança, o RH ou o SESMT.', 'Respeito e zero tolerância ao assédio — use os canais de denúncia (a CIPA também atua).', 'Apoio emocional gratuito 24h: CVV 188.'], 'O que mais pesa no seu dia de trabalho e poderia ser melhorado?'],
  ['calor', 'calor|temperatura|hidrata|insolacao', 'Calor: hidratação e pausas', ['Beba água várias vezes, mesmo sem sede.', 'Sinais de alerta: tontura, dor de cabeça, náusea, câimbras e confusão.', 'Faça pausas em local fresco e respeite o revezamento.', 'Use roupas leves e protetor solar a céu aberto.', 'Viu um colega passando mal? Leve-o à sombra, ofereça água e acione ajuda.'], 'Onde há água fresca disponível na sua área?'],
  ['5S e organização', '5s|organizacao|housekeeping|limpeza da area|arrumacao', 'Organização e limpeza (5S)', ['Área desorganizada causa tropeços, cortes e incêndios.', 'Cada coisa no seu lugar — e um lugar para cada coisa.', 'Rotas de fuga, extintores e painéis sempre desobstruídos.', 'Limpar é também inspecionar: vazamentos e danos aparecem na limpeza.', 'Termine o turno deixando o posto como gostaria de encontrá-lo.'], 'O que dá para eliminar ou organizar hoje na sua área?'],
  ['percepção de risco', 'percepcao de risco|atencao|distracao|excesso de confianca|rotina', 'Percepção de risco e excesso de confiança', ['A rotina faz o risco "desaparecer" da nossa vista.', 'Antes de começar: pare, observe, pense no que pode dar errado.', 'Atalhos economizam segundos e custam vidas.', 'Pressa, cansaço, frustração e distração são estados que levam a erros.', 'Se não for seguro, não faça — use o direito de recusa.'], 'Qual atividade você faz "no automático" e merece mais atenção?'],
  ['uso de celular', 'celular|telefone|smartphone', 'Celular e distração', ['O celular tira a atenção de onde ela precisa estar.', 'Em áreas operacionais, atenda somente parado e em local seguro.', 'Nunca use celular dirigindo veículos ou operando máquinas.', 'Fones de ouvido podem impedir de ouvir alarmes e buzinas.'], 'Em quais situações da sua área o celular é mais perigoso?'],
  ['álcool e drogas', 'alcool|drogas|bebida|embriaguez|ressaca', 'Álcool, drogas e trabalho não combinam', ['Álcool e drogas reduzem reflexos, atenção e percepção de risco.', 'Os efeitos (e a ressaca) duram muito mais do que parece.', 'Medicamentos também podem causar sonolência — informe o médico do trabalho.', 'Procure ajuda: a empresa e o SUS oferecem apoio (CAPS AD).'], 'Como podemos apoiar um colega que está com dificuldades?'],
  ['prevenção de lesões nas mãos', 'maos|mao|dedos|luvas|corte nas maos', 'Proteja suas mãos', ['As mãos são as partes do corpo mais atingidas em acidentes.', 'Pontos de prensamento: nunca coloque a mão onde não consegue ver.', 'Use a luva certa para cada risco — e nunca perto de partes girantes.', 'Ferramentas adequadas e em bom estado evitam cortes.', 'Bloqueie a energia antes de desobstruir ou ajustar máquinas.'], 'Onde, na sua atividade, suas mãos ficam mais expostas?'],
  ['prevenção de incêndios', 'incendio|extintor|fogo|brigada', 'Prevenção e combate a princípios de incêndio', ['Mantenha extintores, hidrantes e rotas de fuga desobstruídos.', 'Classes de fogo: A (sólidos), B (líquidos), C (elétricos), D (metais), K (cozinha).', 'Use o extintor certo: água nunca em equipamentos energizados.', 'Técnica PASS: puxe o pino, aponte para a base, aperte o gatilho, varra.', 'Em caso de fogo que foge do controle: evacue e acione os bombeiros (193).'], 'Você sabe onde fica o extintor e o ponto de encontro mais próximos?'],
  ['primeiros socorros', 'primeiros socorros|socorro|emergencia medica|desmaio', 'Primeiros socorros: o que fazer (e o que não fazer)', ['Garanta sua segurança antes de ajudar.', 'Acione ajuda: SAMU 192 / Bombeiros 193.', 'Não mova vítimas com suspeita de lesão na coluna.', 'Sangramento: pressão direta com pano limpo.', 'Queimadura: água corrente por 10–20 min; não use pomadas caseiras.'], 'Quem são os socorristas/brigadistas do seu turno?'],
  ['coluna e ergonomia', 'coluna|lombar|postura|ergonomia|levantar peso', 'Cuide da sua coluna', ['Dobre os joelhos e mantenha a carga perto do corpo.', 'Evite torcer o tronco com carga — gire com os pés.', 'Peça ajuda ou use meios mecânicos para cargas pesadas.', 'Faça pausas e alongamentos.'], 'Qual tarefa hoje exige mais da sua coluna?'],
  ['sinalização de segurança', 'sinalizacao|placas|cores de seguranca|faixas', 'Entenda a sinalização de segurança', ['Vermelho: proibição, parada e equipamentos de combate a incêndio.', 'Amarelo: atenção/alerta. Azul: ação obrigatória (ex.: uso de EPI). Verde: emergência, rotas de fuga e primeiros socorros.', 'Sinalização vertical (placas) e horizontal (faixas no piso) trabalham juntas.', 'Respeite as faixas de pedestres e as áreas de empilhadeiras.'], 'Há alguma placa ou faixa apagada ou faltando na sua área?'],
  ['direção defensiva', 'direcao defensiva|transito|dirigir|motorista', 'Direção defensiva', ['Mantenha distância segura do veículo da frente.', 'Cinto para todos, sempre.', 'Celular guardado — nenhuma mensagem vale uma vida.', 'Cansado? Pare e descanse.'], 'Qual situação no trajeto até a empresa é mais perigosa?'],
];

const CHECKLIST_TOPICS = [
  ['extintores', 'extintor|extintores', 'Inspeção de extintores', ['Extintor no local indicado e sinalizado (placa e piso)', 'Acesso desobstruído', 'Lacre e pino de segurança intactos', 'Ponteiro do manômetro na faixa verde (quando houver)', 'Mangueira e difusor sem rachaduras ou entupimentos', 'Cilindro sem amassados, corrosão ou vazamentos', 'Etiqueta de recarga dentro da validade', 'Teste hidrostático dentro da validade', 'Quadro de instruções legível', 'Tipo adequado à classe de fogo da área', 'Fixação/altura adequadas']],
  ['EPI', 'epi|equipamentos de protecao', 'Inspeção de uso e conservação de EPIs', ['EPIs com CA válido', 'EPIs adequados aos riscos da atividade (conforme PGR)', 'Estado de conservação adequado', 'Uso correto pelos trabalhadores', 'Guarda e higienização adequadas', 'Fichas de entrega assinadas e atualizadas', 'Trabalhadores treinados para uso', 'Estoque suficiente para reposição']],
  ['5S', '5s|housekeeping|organizacao e limpeza', 'Auditoria 5S', ['Somente materiais necessários no posto (Seiri)', 'Itens identificados e em locais demarcados (Seiton)', 'Piso, máquinas e bancadas limpos (Seiso)', 'Padrões visuais afixados e seguidos (Seiketsu)', 'Rotina de 5S cumprida e registrada (Shitsuke)', 'Rotas de fuga e extintores desobstruídos', 'Resíduos segregados corretamente', 'Sem vazamentos ou derramamentos']],
  ['documentação SST (fiscalização)', 'fiscalizacao|auditoria|documentacao|documentos', 'Checklist documental para fiscalização', ['PGR com inventário de riscos e plano de ação atualizados', 'PCMSO e relatório analítico', 'ASOs de todos os empregados em dia', 'Certificados dos treinamentos obrigatórios válidos', 'Fichas de entrega de EPI assinadas com CAs válidos', 'Documentação da CIPA (eleição, posse, atas) ou nomeado', 'Ordens de serviço/procedimentos entregues aos trabalhadores', 'Prontuário das instalações elétricas (se carga > 75 kW)', 'Documentação de caldeiras e vasos de pressão (se houver)', 'Laudos (LTCAT, insalubridade/periculosidade)', 'Eventos SST do eSocial enviados (S-2210, S-2220, S-2240)', 'Registros de inspeções, PTs e APRs arquivados']],
  ['caixa de primeiros socorros', 'caixa de primeiros socorros|kit de primeiros socorros', 'Inspeção do kit de primeiros socorros', ['Kit identificado e em local de fácil acesso', 'Gazes, ataduras e esparadrapo/fita', 'Luvas descartáveis', 'Soro fisiológico', 'Tesoura sem ponta', 'Materiais dentro da validade', 'Responsável pelo kit definido', 'Lista de telefones de emergência afixada']],
  ['veículo', 'veiculo|carro|caminhao|frota', 'Checklist de veículo', ['Pneus calibrados e sem desgaste excessivo', 'Freios funcionando', 'Faróis, lanternas e setas', 'Nível de óleo e água', 'Cintos de segurança em bom estado', 'Retrovisores ajustados', 'Limpador de para-brisa', 'Triângulo, macaco e estepe', 'Documentação em dia', 'Extintor (quando exigido)']],
  ['terceiros/contratadas', 'terceiros|contratada|prestador|empreiteira', 'Checklist de documentação de contratadas', ['Contrato com cláusulas de SST', 'PGR/APR da atividade', 'ASOs dos trabalhadores', 'Certificados de treinamento (NRs aplicáveis)', 'Fichas de EPI', 'Integração de segurança realizada', 'Responsável técnico definido', 'Seguro de vida em grupo (quando exigido)']],
];

function applyItemEdits(items, p = {}) {
  let out = [...items, ...(p.extraItems || [])];
  if (p.removeItems && p.removeItems.length) out = out.filter((i) => !p.removeItems.some((k) => norm(i).includes(k)));
  return uniq(out);
}
function pickTopic(list, text) {
  const t = norm(text);
  return list.find((x) => new RegExp('(' + x[1] + ')').test(t)) || null;
}
function signLabels(ctx, extra = []) {
  return uniq([...extra, 'Elaborado por', 'Aprovado por (SESMT / responsável)']).slice(0, 3);
}
function baseKV(ctx, fields) {
  const p = ctx.params || {};
  const map = {
    empresa: ['Empresa', p.empresa || ctx.profile.company || ''],
    local: ['Local / setor', p.local || ''],
    data: ['Data', p.data ? fmtDate(p.data) : fmtDate(new Date())],
    responsavel: ['Responsável', p.responsavel || ''],
    elaborado: ['Elaborado por', p.responsavel || ctx.profile.name || ''],
    equipe: ['Equipe / executantes', p.equipe || ''],
    atividade: ['Atividade', ctx.act ? ctx.act.nome : p.tema || ''],
    funcao: ['Função / cargo', p.funcao || ''],
    horario: ['Horário', p.horario || ''],
    duracao: ['Duração', p.duracao || ''],
  };
  return fields.map((f) => (Array.isArray(f) ? f : map[f])).filter(Boolean);
}
function nrItems(nrs) {
  return uniq(nrs)
    .filter((n) => NRS[n] && !NRS[n].revogada)
    .sort((a, b) => a - b)
    .map((n) => nrLabel(n));
}
function aprRows(act, full = true) {
  const rows = act.perigos.map((p) => {
    const rl = riskLevel(p[3], p[4]);
    const rr = riskLevel(Math.max(1, p[3] - (p[4] >= 5 ? 2 : 1)), p[4] >= 5 && p[3] >= 3 ? p[4] : Math.max(1, p[4]));
    return [p[0] === 'Todas' ? 'Todas as etapas' : p[0], p[1], p[2], { text: String(p[3]), align: 'center' }, { text: String(p[4]), align: 'center' }, { text: `${rl.nivel} (${rl.r})`, fill: rl.cor }, p[5].map((c) => '• ' + c).join('\n'), { text: rr.nivel, fill: rr.cor }];
  });
  return full ? rows : rows.filter((r) => /Alto|Crítico/.test(r[5].text));
}
// requisitos/verificações extraídos de um documento (procedimentos, normas)
function extractRequirements(text, max = 25) {
  const out = [];
  for (const s0 of sentences(text)) {
    const s = s0.replace(/^[\s•\-–*]+/, '');
    if (s.length < 18 || s.length > 260) continue;
    if (/^(objetivo|escopo|finalidade|aplica[cç][aã]o|campo de aplica[cç][aã]o|refer[eê]ncias?|defini[cç][oõ]es|carga hor[aá]ria|data|revis[aã]o|elaborad[oa])\s*:/i.test(s)) continue;
    const roleVerb = /^[A-ZÀ-Ú][\wÀ-ú /()-]{2,40}:\s*(?:n[aã]o\s+)?[a-zà-ú]{3,}(?:ar|er|ir)\b/.test(s) || /^(?:[•\-–*]\s*)?(?:n[aã]o\s+)?[A-ZÀ-Úa-zà-ú][a-zà-ú]{2,}(?:ar|er|ir)\s/.test(s.trim());
    if (roleVerb || /\b(deve|devem|dever[aá]|devera|obrigat[oó]ri|proibid|[eé] necess[aá]ri|verificar|inspecionar|garantir|manter|utilizar|usar|certificar|assegurar|n[aã]o (?:se )?deve)/i.test(s)) {
      out.push(capFirst(s.replace(/^[\s•\-–\d.)]+/, '').replace(/\s+/g, ' ').replace(/[.;:]+$/, '')));
    }
    if (out.length >= max) break;
  }
  if (out.length < 5) {
    for (const l of String(text).split('\n')) {
      const m = /^\s*(?:[•\-–*]|\d+[.)])\s+(.{12,200})$/.exec(l);
      if (m && !out.includes(m[1])) out.push(capFirst(m[1].replace(/[.;:]+$/, '')));
      if (out.length >= max) break;
    }
  }
  return uniq(out).slice(0, max);
}
function extractSteps(text, max = 10) {
  const steps = [];
  for (const l of String(text).split('\n')) {
    const m = /^\s*(?:\d+(?:\.\d+)*[.)-]?|[a-z]\))\s+(.{6,120})$/i.exec(l);
    if (m) steps.push(capFirst(m[1].replace(/[.;:]+$/, '')));
    if (steps.length >= max) break;
  }
  return steps;
}
function extractIssues(text, max = 12) {
  const out = [];
  for (const s of sentences(text)) {
    if (s.length < 15 || s.length > 260) continue;
    if (/(n[aã]o conform|irregular|aus[eê]ncia|falta de|\bsem\b|danificad|vencid|obstru|inexistente|inadequad|improvis|desgastad|quebrad|exposta|expostos|vazamento|n[aã]o possui|n[aã]o h[aá])/i.test(s)) out.push(capFirst(s.replace(/^[\s•\-–\d.)]+/, '').replace(/[.;:]+$/, '')));
    if (out.length >= max) break;
  }
  return out;
}
function actionFor(issue) {
  const t = norm(issue);
  const rules = [
    [/extintor/, 'Regularizar o extintor (recarga/sinalização/desobstrução) conforme NR-23 e IT do Corpo de Bombeiros'],
    [/fiacao|fio|cabo|eletric|tomada|painel|quadro/, 'Isolar a área, desenergizar e corrigir a instalação com profissional autorizado (NR-10)'],
    [/guarda-corpo|guarda corpo|altura|queda|abertura/, 'Instalar proteção coletiva contra quedas e sinalizar a área (NR-35/NR-18)'],
    [/epi|capacete|luva|oculos|protetor|botina|cinto/, 'Fornecer/substituir o EPI com CA válido, orientar e registrar na ficha (NR-06)'],
    [/sinaliza|faixa|placa/, 'Refazer a sinalização vertical/horizontal (NR-26)'],
    [/protec|maquina|prensa|correia|polia/, 'Instalar/recolocar proteção de máquina com intertravamento (NR-12)'],
    [/vazamento|quimic|produto/, 'Conter o vazamento, limpar com kit adequado e corrigir a origem (FDS)'],
    [/treinamento|capacita|habilita|cartao/, 'Programar capacitação e retirar da atividade até a regularização'],
    [/organiza|limpeza|obstru|entulho|material/, 'Organizar e desobstruir a área (5S) e definir rotina de verificação'],
    [/vencid|validade/, 'Renovar o item/documento vencido e controlar a validade em planilha/aba'],
  ];
  const r = rules.find(([re]) => re.test(t));
  return r ? r[1] : 'Definir e implementar medida corretiva adequada ao risco';
}

// ---- Geradores ------------------------------------------------------------------------
const GENERATORS = {
  apr(ctx) {
    const act = ctx.act;
    const p = ctx.params || {};
    const doc = newDoc('apr', 'Análise Preliminar de Risco (APR)', { subtitle: act.nome + (p.local ? ' — ' + p.local : ''), orientation: 'landscape', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [['Atividade', act.nome, 2], ...baseKV(ctx, ['local', 'data']), ...baseKV(ctx, ['elaborado', 'equipe']), ['Permissão de Trabalho', act.pt ? 'Necessária (' + ptLabel(act.pt) + ')' : 'Avaliar conforme a atividade'], ['Normas de referência', nrItems(act.nrs).map((l) => l.split(' — ')[0]).join(', ')]] });
    if (act.generic) doc.blocks.push({ t: 'callout', tone: 'warn', title: 'Atividade não encontrada na biblioteca', text: 'Montei uma APR genérica. Revise as etapas e perigos com a equipe que executa a atividade — ou me diga mais detalhes (equipamentos, local, altura, energia) que eu refaço.' });
    if (ctx.fromFile) doc.blocks.push({ t: 'callout', tone: 'info', title: 'Base documental', text: `APR elaborada a partir do documento “${ctx.fromFile.name}” (${ctx.fromFile.analysis.typeLabel}) e da biblioteca de riscos do OPS 360°.` });
    doc.blocks.push({ t: 'h', text: '1. Etapas da atividade' });
    doc.blocks.push({ t: 'ol', items: ctx.steps && ctx.steps.length ? ctx.steps : act.etapas });
    doc.blocks.push({ t: 'h', text: '2. Perigos, riscos e medidas de controle' });
    const rows = aprRows(act, p.detail !== 'resumido');
    doc.blocks.push({ t: 'table', head: ['Etapa', 'Perigo', 'Risco / consequência', 'P', 'S', 'Nível', 'Medidas de controle', 'Residual'], widths: [0.12, 0.17, 0.13, 0.035, 0.035, 0.08, 0.33, 0.08], rows });
    doc.blocks.push({ t: 'matrix' });
    doc.blocks.push({ t: 'h', text: '3. EPIs obrigatórios' });
    doc.blocks.push({ t: 'ul', items: act.epis });
    doc.blocks.push({ t: 'h', text: '4. Requisitos antes do início' });
    doc.blocks.push({ t: 'ul', items: act.requisitos });
    doc.blocks.push({ t: 'h', text: '5. Em caso de emergência' });
    doc.blocks.push({ t: 'ul', items: ['Interromper a atividade e isolar a área.', 'Acionar a brigada/liderança e o atendimento externo (SAMU 192 / Bombeiros 193).', 'Não mover vítimas com suspeita de lesão na coluna; em trabalho em altura, iniciar o plano de resgate imediatamente.', 'Comunicar o SESMT e registrar o ocorrido (CAT quando aplicável).'] });
    doc.blocks.push({ t: 'h', text: '6. Referências normativas' });
    doc.blocks.push({ t: 'ul', items: nrItems(act.nrs) });
    doc.blocks.push({ t: 'callout', tone: 'danger', title: 'Condição para início', text: 'Riscos classificados como **Alto** ou **Crítico** só podem ser executados com todas as medidas de controle implementadas e a APR assinada. Se as condições mudarem, **pare e revise a APR**.' });
    doc.blocks.push({ t: 'sign', items: ['Elaborado por', 'Aprovado por (SESMT)', 'Supervisor da atividade'] });
    doc.blocks.push({ t: 'table', head: ['Nº', 'Executante (nome legível)', 'Função', 'Assinatura (ciente dos riscos)'], widths: [0.05, 0.4, 0.2, 0.35], rows: Array.from({ length: +p.pessoas > 0 ? Math.min(+p.pessoas, 30) : 6 }, (_, i) => [{ text: String(i + 1), align: 'center' }, '', '', '']) });
    const altos = act.perigos.filter((x) => x[3] * x[4] >= 10).length;
    return { doc, resumo: `APR de **${act.nome}** com ${act.perigos.length} perigos avaliados (${altos} de nível Alto/Crítico), matriz de risco P×S, ${act.epis.length} EPIs, requisitos, emergência e assinaturas. Referências: ${act.nrs.map((n) => 'NR-' + String(n).padStart(2, '0')).join(', ')}.` };
  },

  pt(ctx) {
    const act = ctx.act;
    const p = ctx.params || {};
    const tipo = p.tipoPT || act.pt || 'geral';
    const isPET = tipo === 'confinado';
    const title = isPET ? 'Permissão de Entrada e Trabalho (PET)' : `Permissão de Trabalho — ${ptLabel(tipo)}`;
    const doc = newDoc('pt', title, { subtitle: act.nome + (p.local ? ' — ' + p.local : ''), company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Nº da permissão', doc.code], ...baseKV(ctx, ['local', 'data']), ['Início (hora)', ''], ['Término previsto (hora)', ''], ['Validade', 'Somente para este turno/atividade'], ['Descrição do serviço', p.descricao || act.nome, 3], ['Empresa executante', p.empresa || ctx.profile.company || ''], ['Supervisor / emitente', p.responsavel || ''], ['Vigia / observador', '']] });
    doc.blocks.push({ t: 'h', text: '1. Pré-requisitos (marcar antes da liberação)' });
    const pre = uniq([...(act.requisitos || []), ...(PT_EXTRA[tipo] || [])]).slice(0, 14);
    doc.blocks.push({ t: 'check', items: pre, cols: ['Sim', 'Não', 'N/A'] });
    if (tipo === 'confinado' || tipo === 'quente') {
      doc.blocks.push({ t: 'h', text: '2. Monitoramento da atmosfera' });
      doc.blocks.push({ t: 'table', head: ['Parâmetro', 'Limite aceitável', 'Inicial', '1ª leitura', '2ª leitura', '3ª leitura'], widths: [0.22, 0.24, 0.135, 0.135, 0.135, 0.135], rows: [['Oxigênio (O₂)', '19,5% a 23%', '', '', '', ''], ['Inflamáveis (% LIE)', 'Abaixo de 10%', '', '', '', ''], ['Monóxido de carbono (CO)', 'Abaixo do limite de exposição', '', '', '', ''], ['Sulfeto de hidrogênio (H₂S)', 'Abaixo do limite de exposição', '', '', '', ''], ['Hora / responsável', '—', '', '', '', '']] });
      doc.blocks.push({ t: 'p', text: 'Detector nº: __________  Calibrado em: ___/___/_____  Teste de resposta (bump test) realizado: ☐ Sim' });
    }
    doc.blocks.push({ t: 'h', text: `${tipo === 'confinado' || tipo === 'quente' ? 3 : 2}. EPIs e equipamentos exigidos` });
    doc.blocks.push({ t: 'check', items: act.epis, cols: ['OK'] });
    doc.blocks.push({ t: 'h', text: 'Riscos principais e medidas' });
    doc.blocks.push({ t: 'table', head: ['Perigo', 'Medidas obrigatórias'], widths: [0.35, 0.65], rows: act.perigos.filter((x) => x[3] * x[4] >= 8).slice(0, 8).map((x) => [x[1], x[5].join('; ')]) });
    doc.blocks.push({ t: 'h', text: 'Equipe autorizada' });
    doc.blocks.push({ t: 'table', head: ['Nome', 'Função', 'Treinamento válido', 'Assinatura'], widths: [0.35, 0.2, 0.2, 0.25], rows: Array.from({ length: 5 }, () => ['', '', { box: true }, '']) });
    doc.blocks.push({ t: 'callout', tone: 'warn', title: 'Suspensão imediata', text: 'A permissão perde a validade e o trabalho deve ser interrompido se: as condições mudarem, soar alarme, houver leitura fora dos limites, ocorrer emergência ou terminar o turno. Uma nova permissão deve ser emitida.' });
    doc.blocks.push({ t: 'h', text: 'Liberação e encerramento' });
    doc.blocks.push({ t: 'sign', items: ['Emitente (libera)', 'Executante responsável', isPET ? 'Supervisor de entrada' : 'Área / operação'] });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Encerrada em (data/hora)', ''], ['Área limpa e liberada', '☐ Sim  ☐ Não'], ['Responsável pelo encerramento', '']] });
    return { doc, resumo: `${title} para **${act.nome}**: ${pre.length} pré-requisitos, ${tipo === 'confinado' || tipo === 'quente' ? 'monitoramento de gases, ' : ''}checklist de EPIs, riscos principais, equipe autorizada e campos de liberação/encerramento.` };
  },

  dds(ctx) {
    const p = ctx.params || {};
    const topic = pickTopic(DDS_TOPICS, ctx.text);
    let tema, pontos, pergunta;
    if (topic) {
      tema = topic[2];
      pontos = topic[3];
      pergunta = topic[4];
    } else if (ctx.actDetected) {
      tema = p.tema || `Segurança em ${lowerFirst(ctx.act.nome)}`;
      const top = [...ctx.act.perigos].sort((a, b) => b[3] * b[4] - a[3] * a[4]).slice(0, 3);
      pontos = uniq([...ctx.act.dds, ...top.map((x) => `${x[1]}: ${x[5][0].toLowerCase()}.`)]).slice(0, 6);
      pergunta = `Qual situação de ${lowerFirst(ctx.act.nome)} mais preocupa vocês aqui na nossa área?`;
    } else {
      const adv = findAdvice(ctx.text);
      tema = p.tema ? capFirst(p.tema) : adv ? adv.titulo : 'Segurança no dia a dia';
      pontos = adv ? adv.passos.map((x) => x.replace(/\*\*/g, '')).slice(0, 6) : DDS_TOPICS[4][3];
      pergunta = 'O que podemos fazer hoje, na prática, para reduzir esse risco?';
    }
    pontos = applyItemEdits(pontos, p);
    const doc = newDoc('dds', 'Diálogo Diário de Segurança (DDS)', { subtitle: tema, company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [['Tema', tema, 2], ...baseKV(ctx, ['data']), ['Duração', p.duracao || '10 a 15 min'], ...baseKV(ctx, ['local']), ['Conduzido por', p.responsavel || ctx.profile.name || ''], ['Nº de participantes', p.pessoas || '']] });
    doc.blocks.push({ t: 'h', text: '1. Abertura (1 min)' });
    doc.blocks.push({ t: 'p', text: `Bom dia, pessoal! Hoje vamos falar sobre **${tema.toLowerCase()}**. É um assunto rápido, mas que faz diferença para todo mundo voltar para casa bem.` });
    doc.blocks.push({ t: 'h', text: '2. Pontos-chave (5–8 min)' });
    doc.blocks.push({ t: 'ol', items: pontos });
    doc.blocks.push({ t: 'h', text: '3. Pergunta para o grupo (3 min)' });
    doc.blocks.push({ t: 'callout', tone: 'info', title: 'Vamos conversar', text: pergunta });
    doc.blocks.push({ t: 'h', text: '4. Compromisso do dia' });
    doc.blocks.push({ t: 'p', text: 'Cada participante escolhe **uma atitude** para praticar hoje. Exemplo: "Hoje eu vou parar e checar antes de começar qualquer tarefa diferente".' });
    doc.blocks.push({ t: 'lines', n: 3, label: 'Observações e sugestões do grupo' });
    doc.blocks.push({ t: 'h', text: 'Lista de presença' });
    const n = Math.min(Math.max(+p.pessoas || 15, 5), 40);
    doc.blocks.push({ t: 'table', head: ['Nº', 'Nome', 'Matrícula / função', 'Assinatura'], widths: [0.06, 0.42, 0.22, 0.3], rows: Array.from({ length: n }, (_, i) => [{ text: String(i + 1), align: 'center' }, '', '', '']) });
    doc.blocks.push({ t: 'sign', items: ['Responsável pelo DDS'] });
    return { doc, resumo: `DDS sobre **${tema}**: roteiro de 10–15 min (abertura, ${pontos.length} pontos-chave, pergunta para o grupo, compromisso) e lista de presença com ${n} linhas.` };
  },

  checklist(ctx) {
    const p = ctx.params || {};
    const topic = pickTopic(CHECKLIST_TOPICS, ctx.text);
    let titulo, itens;
    let origem = null;
    if (ctx.fromFile) {
      const doDoc = extractRequirements(ctx.fromFile.text, 30);
      titulo = `Checklist — ${ctx.fromFile.analysis.typeLabel.split(' (')[0]}`;
      if (doDoc.length >= 4) {
        itens = doDoc;
        origem = `Itens extraídos automaticamente do documento “${ctx.fromFile.name}”. Revise a redação antes de usar.`;
      } else {
        const lib = topic ? topic[3] : ctx.act.checklist;
        itens = uniq([...doDoc, ...lib]);
        origem = doDoc.length
          ? `${doDoc.length} item(ns) extraído(s) de “${ctx.fromFile.name}” (os primeiros) + ${itens.length - doDoc.length} da biblioteca de ${topic ? topic[2].toLowerCase() : lowerFirst(ctx.act.nome)}. Revise antes de usar.`
          : `Não encontrei requisitos explícitos em “${ctx.fromFile.name}”, então usei a biblioteca de ${topic ? topic[2].toLowerCase() : lowerFirst(ctx.act.nome)} (assunto identificado no documento).`;
        titulo = topic ? topic[2] : `Checklist de inspeção — ${ctx.act.nome}`;
      }
    }
    if (!itens || !itens.length) {
      if (topic) {
        titulo = topic[2];
        itens = topic[3];
      } else {
        titulo = `Checklist de inspeção — ${ctx.act.nome}`;
        itens = ctx.act.checklist;
      }
    }
    itens = applyItemEdits(itens, p);
    const doc = newDoc('checklist', titulo, { subtitle: p.local || '', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [...baseKV(ctx, ['local', 'data']), ['Equipamento / identificação', p.equipamento || ''], ['Inspetor', p.responsavel || ctx.profile.name || '']] });
    if (origem) doc.blocks.push({ t: 'callout', tone: 'info', title: 'Origem dos itens', text: origem });
    doc.blocks.push({ t: 'check', items: itens, legend: 'C = Conforme · NC = Não conforme · NA = Não se aplica. Itens NC devem gerar ação corretiva com prazo e responsável.' });
    doc.blocks.push({ t: 'kv', cols: 2, items: [['Resultado', '☐ Liberado   ☐ Liberado com restrições   ☐ Bloqueado'], ['Total de NC', '']] });
    doc.blocks.push({ t: 'h', text: 'Ações para itens não conformes' });
    doc.blocks.push({ t: 'table', head: ['Item', 'Ação corretiva', 'Responsável', 'Prazo', 'Status'], widths: [0.08, 0.44, 0.2, 0.13, 0.15], rows: Array.from({ length: 4 }, () => ['', '', '', '', '']) });
    doc.blocks.push({ t: 'sign', items: ['Inspetor', 'Responsável pela área'] });
    return { doc, resumo: `${titulo} com ${itens.length} itens (C/NC/NA + observações), resultado da inspeção, tabela de ações corretivas e assinaturas.` };
  },

  os(ctx) {
    const act = ctx.act;
    const p = ctx.params || {};
    const funcao = p.funcao || (act.generic ? 'Colaborador' : `Colaborador em ${lowerFirst(act.nome)}`);
    const doc = newDoc('os', 'Ordem de Serviço de Segurança e Saúde no Trabalho', { subtitle: `Função: ${funcao}`, company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Colaborador', ''], ['Matrícula', ''], ['Função', funcao], ...baseKV(ctx, ['local', 'data']), ['Admissão', '']] });
    doc.blocks.push({ t: 'p', text: 'Em cumprimento à **NR-01 (item 1.4.1)**, esta Ordem de Serviço informa os riscos da função, as medidas de prevenção adotadas e os procedimentos a serem seguidos.' });
    doc.blocks.push({ t: 'h', text: '1. Descrição das atividades' });
    doc.blocks.push({ t: 'ul', items: act.etapas });
    doc.blocks.push({ t: 'h', text: '2. Riscos da função e medidas de prevenção' });
    doc.blocks.push({ t: 'table', head: ['Perigo / fator de risco', 'Possível consequência', 'Medidas de prevenção'], widths: [0.3, 0.22, 0.48], rows: act.perigos.map((x) => [x[1], x[2], x[5].join('; ')]) });
    doc.blocks.push({ t: 'h', text: '3. EPIs de uso obrigatório' });
    doc.blocks.push({ t: 'ul', items: act.epis });
    doc.blocks.push({ t: 'h', text: '4. Obrigações do colaborador' });
    doc.blocks.push({ t: 'ul', items: ['Cumprir as normas e procedimentos de segurança da empresa.', 'Usar corretamente os EPIs fornecidos, responsabilizando-se por sua guarda e conservação (NR-06).', 'Participar dos treinamentos e DDS.', 'Comunicar imediatamente à liderança qualquer condição de risco, incidente ou acidente.', 'Submeter-se aos exames médicos previstos no PCMSO (NR-07).', 'Interromper a atividade diante de risco grave e iminente, comunicando o superior (direito de recusa — NR-01).'] });
    doc.blocks.push({ t: 'h', text: '5. Proibições' });
    doc.blocks.push({ t: 'ul', items: ['Executar atividades para as quais não foi treinado e autorizado.', 'Remover, burlar ou inutilizar proteções e dispositivos de segurança.', 'Trabalhar sob efeito de álcool ou drogas.', 'Improvisar ferramentas, instalações ou acessos.', 'Usar celular em áreas operacionais sem autorização.'] });
    doc.blocks.push({ t: 'h', text: '6. Em caso de acidente' });
    doc.blocks.push({ t: 'ul', items: ['Comunicar imediatamente a liderança e o SESMT.', 'Procurar atendimento no ambulatório/serviço indicado.', 'Colaborar com a investigação para evitar novos acidentes.'] });
    doc.blocks.push({ t: 'callout', tone: 'warn', title: 'Penalidades', text: 'O descumprimento das normas de segurança e a recusa injustificada ao uso de EPI constituem ato faltoso (CLT, art. 158), sujeito às medidas disciplinares cabíveis.' });
    doc.blocks.push({ t: 'p', text: 'Declaro que recebi, li e compreendi esta Ordem de Serviço e as orientações de segurança da minha função, comprometendo-me a cumpri-las.' });
    doc.blocks.push({ t: 'sign', items: ['Colaborador (ciente)', 'Responsável pela orientação', 'SESMT'] });
    return { doc, resumo: `Ordem de Serviço (NR-01) para **${funcao}**: atividades, ${act.perigos.length} riscos com medidas, EPIs, obrigações, proibições, conduta em acidentes, penalidades e termo de ciência.` };
  },

  ficha_epi(ctx) {
    const act = ctx.act;
    const p = ctx.params || {};
    const doc = newDoc('ficha_epi', 'Ficha de Controle de Entrega de EPI', { subtitle: 'NR-06 — Equipamentos de Proteção Individual', orientation: 'landscape', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [['Colaborador', p.colaborador || '', 2], ['Matrícula', ''], ['Admissão', ''], ['Função', p.funcao || (act.generic ? '' : act.nome)], ['Setor', p.local || ''], ['CPF', ''], ['Empresa', p.empresa || ctx.profile.company || '']] });
    doc.blocks.push({ t: 'h', text: 'Termo de responsabilidade' });
    doc.blocks.push({ t: 'p', text: 'Declaro ter recebido gratuitamente os EPIs abaixo, novos e em perfeitas condições, bem como treinamento sobre o uso correto, guarda e conservação. Comprometo-me a: usá-los apenas para a finalidade a que se destinam; responsabilizar-me pela guarda e conservação; comunicar qualquer alteração que os torne impróprios; e cumprir as determinações do empregador sobre o uso adequado (NR-06). Estou ciente de que a recusa injustificada ao uso constitui ato faltoso (CLT, art. 158).', size: 8.4 });
    const epis = act.epis.filter((e) => !/^não há/i.test(e));
    const rows = [...epis.map((e) => ['', e, '', '1', { text: '1ª entrega', align: 'center' }, '', '', '']), ...Array.from({ length: Math.max(4, 12 - epis.length) }, () => ['', '', '', '', '', '', '', ''])];
    doc.blocks.push({ t: 'table', head: ['Data', 'EPI / descrição', 'Nº do CA', 'Qtd.', 'Motivo', 'Assinatura do colaborador', 'Devolução', 'Visto'], widths: [0.08, 0.26, 0.08, 0.05, 0.1, 0.2, 0.1, 0.13], rows, small: true });
    doc.blocks.push({ t: 'p', text: 'Motivos: 1ª entrega · substituição por desgaste · perda/extravio · dano · higienização. Verifique a validade do CA antes de cada entrega.', size: 7.8 });
    doc.blocks.push({ t: 'sign', items: ['Colaborador', 'Responsável pela entrega'] });
    return { doc, resumo: `Ficha de entrega de EPI (NR-06) com termo de responsabilidade e ${epis.length} EPIs pré-preenchidos${act.generic ? '' : ` para ${lowerFirst(act.nome)}`} + linhas extras, campos de CA, motivo, devolução e assinaturas.` };
  },

  inspecao(ctx) {
    const p = ctx.params || {};
    const photos = ctx.photos || [];
    const desc = ctx.description || '';
    const found = HAZARD_TERMS.filter((h) => h[1].split(',').some((k) => norm(desc).includes(norm(k)))).map((h) => h[0]);
    const acts = ctx.actDetected ? [ctx.act] : [];
    const issues = uniq([...extractIssues(desc), ...(ctx.fromFile ? extractIssues(ctx.fromFile.text) : [])]);
    const nrs = uniq([...(ctx.actDetected ? ctx.act.nrs : []), ...extractNRs(desc), ...guessNRsFromText(desc)]);
    const sev = /(grave|iminente|critic|risco de morte|exposta|energizad|sem guarda|altura|queda)/.test(norm(desc)) ? 'Alto' : /(moderad|atencao|improvis|desgast)/.test(norm(desc)) ? 'Moderado' : 'Moderado';
    const sevCor = sev === 'Alto' ? '#ec835a' : '#fab219';
    const doc = newDoc('inspecao', 'Relatório de Inspeção de Segurança', { subtitle: (p.local ? p.local + ' — ' : '') + (issues.length || desc ? 'Registro de não conformidade' : 'Inspeção de rotina'), company: p.empresa || ctx.profile.company || '' });
    const photoDate = photos.map((f) => f.analysis && f.analysis.photoDate).find(Boolean);
    doc.blocks.push({ t: 'kv', cols: 3, items: [...baseKV(ctx, ['local']), ['Data da inspeção', p.data ? fmtDate(p.data) : fmtDate(new Date())], ['Inspetor', p.responsavel || ctx.profile.name || ''], ['Data da foto', photoDate ? fmtDateTime(photoDate) : '—'], ['Classificação', sev], ['Status', 'Aberta']] });
    doc.blocks.push({ t: 'h', text: '1. Descrição da situação encontrada' });
    doc.blocks.push({ t: 'p', text: desc ? capFirst(desc.trim()) + (/[.!?]$/.test(desc.trim()) ? '' : '.') : 'Descreva aqui a condição observada (o que, onde, quem está exposto).' });
    if (photos.length) {
      doc.blocks.push({ t: 'h', text: '2. Registro fotográfico' });
      if (photos.length === 1) doc.blocks.push({ t: 'img', src: photos[0].image.dataUrl, caption: `Foto 1 — ${photos[0].name}${photos[0].analysis && photos[0].analysis.photoDate ? ' · ' + fmtDateTime(photos[0].analysis.photoDate) : ''}`, width: 0.75 });
      else doc.blocks.push({ t: 'gallery', cols: 2, items: photos.map((f, i) => ({ src: f.image.dataUrl, caption: `Foto ${i + 1} — ${f.name}` })) });
    }
    doc.blocks.push({ t: 'h', text: `${photos.length ? 3 : 2}. Análise de risco` });
    doc.blocks.push({ t: 'table', head: ['Perigo identificado', 'Possível consequência', 'Classificação'], widths: [0.45, 0.35, 0.2], rows: (found.length ? found : ['Condição insegura descrita']).map((f) => [capFirst(f), consequenceOf(f), { text: sev, fill: sevCor }]) });
    if (nrs.length) {
      doc.blocks.push({ t: 'p', text: '**Normas relacionadas:** ' + nrItems(nrs).join('; ') });
    }
    doc.blocks.push({ t: 'h', text: `${photos.length ? 4 : 3}. Ações corretivas (5W2H)` });
    const acoes = (issues.length ? issues : [desc || 'Condição observada']).slice(0, 8).map((iss) => [actionFor(iss + ' ' + desc), truncate(iss, 90), p.local || '', '', 'Imediato / até 7 dias', '']);
    doc.blocks.push({ t: 'table', head: ['O quê (ação)', 'Por quê (não conformidade)', 'Onde', 'Quem', 'Quando', 'Status'], widths: [0.3, 0.26, 0.12, 0.12, 0.12, 0.08], rows: acoes });
    doc.blocks.push({ t: 'callout', tone: sev === 'Alto' ? 'danger' : 'warn', title: sev === 'Alto' ? 'Risco elevado' : 'Atenção', text: sev === 'Alto' ? 'Isole a área e interrompa a atividade até a correção. Situações de risco grave e iminente exigem ação imediata.' : 'Trate a não conformidade dentro do prazo e verifique a eficácia da ação.' });
    doc.blocks.push({ t: 'sign', items: ['Inspetor', 'Responsável pela área', 'SESMT'] });
    return { doc, resumo: `Relatório de inspeção${photos.length ? ` com ${photos.length} foto(s)` : ''}: descrição, ${found.length || 1} perigo(s) identificado(s) (${sev}), ${acoes.length} ação(ões) 5W2H${nrs.length ? ', normas ' + nrs.map((n) => 'NR-' + n).join(', ') : ''} e assinaturas.` };
  },

  investigacao(ctx) {
    const p = ctx.params || {};
    const desc = ctx.description || '';
    const doc = newDoc('investigacao', 'Relatório de Investigação de Acidente / Incidente', { subtitle: p.local || '', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Tipo de ocorrência', '☐ Acidente c/ afastamento  ☐ s/ afastamento  ☐ Quase acidente', 3], ...baseKV(ctx, ['local']), ['Data e hora da ocorrência', p.data ? fmtDate(p.data) : ''], ['CAT emitida', '☐ Sim  ☐ Não  ☐ N/A'], ['Acidentado / envolvido', ''], ['Função', p.funcao || ''], ['Parte do corpo atingida', '']] });
    doc.blocks.push({ t: 'h', text: '1. Descrição do ocorrido' });
    doc.blocks.push({ t: 'p', text: desc || 'Descreva o que aconteceu, em ordem cronológica: o que a pessoa fazia, o que deu errado, qual foi a lesão/dano.' });
    doc.blocks.push({ t: 'h', text: '2. Análise de causas — 5 porquês' });
    doc.blocks.push({ t: 'table', head: ['Pergunta', 'Resposta'], widths: [0.25, 0.75], rows: ['1º Por quê?', '2º Por quê?', '3º Por quê?', '4º Por quê?', '5º Por quê? (causa raiz)'].map((q) => [q, '']) });
    doc.blocks.push({ t: 'h', text: '3. Diagrama de Ishikawa (6M)' });
    doc.blocks.push({ t: 'table', head: ['Categoria', 'Causas identificadas'], widths: [0.25, 0.75], rows: [['Método (procedimento)', ''], ['Mão de obra (pessoas/treinamento)', ''], ['Máquina (equipamento/ferramenta)', ''], ['Material', ''], ['Meio ambiente (local/condições)', ''], ['Medida (controle/inspeção)', '']] });
    doc.blocks.push({ t: 'h', text: '4. Plano de ação' });
    doc.blocks.push({ t: 'table', head: ['Ação', 'Causa tratada', 'Responsável', 'Prazo', 'Status'], widths: [0.36, 0.26, 0.14, 0.12, 0.12], rows: Array.from({ length: 5 }, () => ['', '', '', '', '']) });
    doc.blocks.push({ t: 'h', text: '5. Lições aprendidas' });
    doc.blocks.push({ t: 'lines', n: 3 });
    doc.blocks.push({ t: 'callout', tone: 'info', title: 'Lembretes', text: 'Emita a CAT até o 1º dia útil seguinte (morte: imediatamente) — evento S-2210 do eSocial. Investigue fatos, não culpados: o objetivo é corrigir as falhas de barreiras e do sistema.' });
    doc.blocks.push({ t: 'sign', items: ['Coordenador da investigação', 'Membro da CIPA', 'SESMT'] });
    return { doc, resumo: 'Relatório de investigação com descrição, 5 porquês, Ishikawa (6M), plano de ação, lições aprendidas e lembretes de CAT/eSocial.' };
  },

  plano_acao(ctx) {
    const p = ctx.params || {};
    let rows = [];
    const src = ctx.fromFile;
    if (src) {
      const issues = uniq([...src.analysis.alerts.map((a) => a.replace(/^[^\wÀ-ÿ]+/, '')), ...extractIssues(src.text)]).slice(0, 12);
      rows = issues.map((iss) => [actionFor(iss), truncate(iss, 100), p.local || '', '', '', '', '']);
    } else if (ctx.actDetected) {
      rows = ctx.act.perigos
        .filter((x) => x[3] * x[4] >= 10)
        .slice(0, 10)
        .map((x) => [x[5][0], `Controlar: ${x[1].toLowerCase()} (${riskLevel(x[3], x[4]).nivel})`, p.local || '', '', '', 'Treinamento / procedimento / inspeção', '']);
    } else {
      const issues = extractIssues(ctx.description || ctx.text);
      rows = issues.map((iss) => [actionFor(iss), iss, p.local || '', '', '', '', '']);
    }
    while (rows.length < 6) rows.push(['', '', '', '', '', '', '']);
    const doc = newDoc('plano_acao', 'Plano de Ação 5W2H', { subtitle: src ? `Com base em: ${src.name}` : ctx.actDetected ? ctx.act.nome : p.tema || '', orientation: 'landscape', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [...baseKV(ctx, ['local', 'data', 'elaborado']), ['Revisão em', '']] });
    doc.blocks.push({ t: 'table', head: ['O quê (What)', 'Por quê (Why)', 'Onde (Where)', 'Quem (Who)', 'Quando (When)', 'Como (How)', 'Quanto (How much)'], widths: [0.22, 0.2, 0.1, 0.11, 0.1, 0.17, 0.1], rows });
    doc.blocks.push({ t: 'p', text: 'Status sugerido: **Não iniciado · Em andamento · Concluído · Verificada a eficácia**. Priorize ações de riscos Alto/Crítico e verifique a eficácia após a implementação.' });
    doc.blocks.push({ t: 'sign', items: ['Elaborado por', 'Aprovado por'] });
    return { doc, resumo: `Plano de ação 5W2H com ${rows.filter((r) => r[0]).length} ação(ões) ${src ? 'extraídas do documento' : ctx.actDetected ? 'para os riscos Alto/Crítico da atividade' : 'a partir da sua descrição'} + linhas em branco para completar.` };
  },

  pop(ctx) {
    const act = ctx.act;
    const p = ctx.params || {};
    const doc = newDoc('pop', 'Procedimento Operacional Padrão (POP)', { subtitle: act.nome, company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [['Código', doc.code], ['Revisão', '00'], ...baseKV(ctx, ['data', 'elaborado'])] });
    doc.blocks.push({ t: 'h', text: '1. Objetivo' });
    doc.blocks.push({ t: 'p', text: `Estabelecer o método seguro e padronizado para ${lowerFirst(act.nome)}, prevenindo acidentes e danos.` });
    doc.blocks.push({ t: 'h', text: '2. Aplicação' });
    doc.blocks.push({ t: 'p', text: `Aplica-se a todos os empregados e contratados que executam ${lowerFirst(act.nome)}${p.local ? ' em ' + p.local : ''}.` });
    doc.blocks.push({ t: 'h', text: '3. Responsabilidades' });
    doc.blocks.push({ t: 'ul', items: ['**Liderança:** garantir recursos, treinamento e o cumprimento deste procedimento.', '**Executantes:** seguir o procedimento, usar os EPIs e comunicar desvios.', '**SESMT:** orientar, inspecionar e manter o procedimento atualizado.'] });
    doc.blocks.push({ t: 'h', text: '4. Requisitos e EPIs' });
    doc.blocks.push({ t: 'ul', items: [...act.requisitos, 'EPIs: ' + act.epis.join('; ') + '.'] });
    doc.blocks.push({ t: 'h', text: '5. Descrição das atividades (passo a passo)' });
    const steps = act.etapas.map((e) => {
      const ctl = act.perigos.filter((x) => x[0] === e).flatMap((x) => x[5]).slice(0, 3);
      return `**${e}.** ${ctl.length ? ctl.join('; ') + '.' : 'Executar conforme treinamento, com atenção aos riscos da etapa.'}`;
    });
    doc.blocks.push({ t: 'ol', items: steps });
    doc.blocks.push({ t: 'h', text: '6. Situações de emergência' });
    doc.blocks.push({ t: 'ul', items: ['Interromper a atividade, isolar a área e acionar a liderança/brigada.', 'Acionar SAMU 192 / Bombeiros 193 quando necessário.', 'Seguir o plano de emergência da unidade.'] });
    doc.blocks.push({ t: 'h', text: '7. Referências' });
    doc.blocks.push({ t: 'ul', items: nrItems(act.nrs) });
    doc.blocks.push({ t: 'h', text: '8. Histórico de revisões' });
    doc.blocks.push({ t: 'table', head: ['Revisão', 'Data', 'Descrição da alteração', 'Responsável'], widths: [0.1, 0.15, 0.5, 0.25], rows: [['00', fmtDate(new Date()), 'Emissão inicial (gerado pelo OPS 360° IA)', ctx.profile.name || ''], ['', '', '', '']] });
    doc.blocks.push({ t: 'sign', items: ['Elaborado por', 'Revisado por', 'Aprovado por'] });
    return { doc, resumo: `POP de **${act.nome}** com objetivo, aplicação, responsabilidades, requisitos/EPIs, ${steps.length} passos com controles, emergência, referências e controle de revisões.` };
  },

  lista_presenca(ctx) {
    const p = ctx.params || {};
    const tema = p.tema || (ctx.actDetected ? `Treinamento — ${ctx.act.nome}` : 'Treinamento de segurança');
    const n = Math.min(Math.max(+p.pessoas || 25, 5), 60);
    const doc = newDoc('lista_presenca', 'Lista de Presença', { subtitle: tema, company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [['Tema', tema, 2], ...baseKV(ctx, ['data']), ['Carga horária', p.duracao || ''], ...baseKV(ctx, ['local']), ['Instrutor', p.responsavel || ''], ['Horário', ''], ['Modalidade', '☐ Presencial  ☐ EAD  ☐ Semipresencial']] });
    doc.blocks.push({ t: 'table', head: ['Nº', 'Nome completo', 'Matrícula', 'Função / setor', 'Assinatura'], widths: [0.05, 0.37, 0.12, 0.2, 0.26], rows: Array.from({ length: n }, (_, i) => [{ text: String(i + 1), align: 'center' }, '', '', '', '']) });
    doc.blocks.push({ t: 'sign', items: ['Instrutor', 'Responsável'] });
    return { doc, resumo: `Lista de presença para **${tema}** com ${n} linhas, dados do treinamento e assinaturas.` };
  },

  comunicado(ctx) {
    const p = ctx.params || {};
    const adv = findAdvice(ctx.text);
    const assunto = p.tema || (ctx.actDetected ? ctx.act.nome : adv ? adv.titulo : 'Segurança em primeiro lugar');
    const doc = newDoc('comunicado', /alerta/i.test(ctx.text) ? 'Alerta de Segurança' : 'Comunicado de Segurança', { subtitle: capFirst(assunto), company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [...baseKV(ctx, ['data']), ['Público', p.publico || 'Todos os colaboradores'], ['Emitido por', p.responsavel || ctx.profile.name || 'SESMT']] });
    doc.blocks.push({ t: 'callout', tone: 'danger', title: 'Mensagem principal', text: ctx.description ? capFirst(ctx.description) : `Atenção redobrada: ${lowerFirst(assunto)}. Siga os procedimentos e use os EPIs obrigatórios.` });
    const pontos = applyItemEdits(ctx.actDetected ? ctx.act.dds : adv ? adv.passos.map((x) => x.replace(/\*\*/g, '')).slice(0, 5) : ['Pare, pense e planeje antes de iniciar a tarefa.', 'Use os EPIs obrigatórios da área.', 'Comunique qualquer condição insegura.'], p);
    doc.blocks.push({ t: 'h', text: 'O que fazer' });
    doc.blocks.push({ t: 'ul', items: pontos });
    if (ctx.actDetected) {
      doc.blocks.push({ t: 'h', text: 'EPIs obrigatórios' });
      doc.blocks.push({ t: 'ul', items: ctx.act.epis.slice(0, 6) });
    }
    doc.blocks.push({ t: 'p', text: 'Dúvidas? Procure sua liderança ou o SESMT. **Segurança é compromisso de todos.**' });
    return { doc, resumo: `Comunicado/alerta sobre **${assunto}** com mensagem principal em destaque, orientações${ctx.actDetected ? ', EPIs' : ''} e contato.` };
  },

  treinamento(ctx) {
    const p = ctx.params || {};
    const nr = (p.nr && NRS[p.nr]) ? p.nr : ctx.actDetected ? ctx.act.nrs[0] : null;
    const conteudo = TRAINING_CONTENT[nr] || (ctx.actDetected ? ['Normas e procedimentos aplicáveis', ...ctx.act.perigos.slice(0, 5).map((x) => `${x[1]} — prevenção e controle`), 'EPIs: seleção, uso, inspeção e conservação', 'Situações de emergência'] : ['Conceitos de SST e responsabilidades', 'Riscos da atividade e medidas de controle', 'EPIs e EPCs', 'Procedimentos de emergência']);
    const ch = TRAINING_HOURS[nr] || p.duracao || '';
    const tema = p.tema || (nr ? `Capacitação NR-${String(nr).padStart(2, '0')} — ${NRS[nr].titulo}` : ctx.actDetected ? `Capacitação — ${ctx.act.nome}` : 'Capacitação em SST');
    const doc = newDoc('treinamento', 'Plano de Treinamento', { subtitle: tema, company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Treinamento', tema, 3], ['Carga horária', ch], ['Modalidade', '☐ Presencial  ☐ EAD  ☐ Semipresencial'], ['Público-alvo', p.publico || (ctx.actDetected ? `Trabalhadores em ${lowerFirst(ctx.act.nome)}` : '')], ['Instrutor', p.responsavel || ''], ['Reciclagem', TRAINING_RECYCLE[nr] || 'Conforme NR aplicável'], ...baseKV(ctx, ['data'])] });
    doc.blocks.push({ t: 'h', text: '1. Objetivo' });
    doc.blocks.push({ t: 'p', text: `Capacitar os participantes para identificar os riscos e aplicar as medidas de prevenção${nr ? ` previstas na NR-${String(nr).padStart(2, '0')}` : ''}, atuando com segurança na rotina e em emergências.` });
    doc.blocks.push({ t: 'h', text: '2. Conteúdo programático' });
    doc.blocks.push({ t: 'ol', items: conteudo });
    doc.blocks.push({ t: 'h', text: '3. Metodologia e avaliação' });
    doc.blocks.push({ t: 'ul', items: ['Aulas expositivas dialogadas com casos reais.', 'Parte prática supervisionada (quando exigida pela NR).', 'Avaliação teórica e/ou prática; aproveitamento mínimo definido pela empresa.', 'Emissão de certificado com conteúdo, carga horária, data, local e assinaturas do instrutor e do responsável técnico.'] });
    if (nr && TRAINING_CONTENT[nr]) doc.blocks.push({ t: 'callout', tone: 'info', title: 'Base normativa', text: `Conteúdo e carga horária de referência da NR-${String(nr).padStart(2, '0')}. Confira sempre o texto vigente da norma e as particularidades da sua atividade.` });
    return { doc, resumo: `Plano de treinamento **${tema}**${ch ? ` (${ch})` : ''}: objetivo, ${conteudo.length} módulos de conteúdo, metodologia, avaliação e certificação.` };
  },

  inventario(ctx) {
    const p = ctx.params || {};
    const acts = ctx.acts && ctx.acts.length ? ctx.acts : [ctx.act];
    const rows = [];
    for (const a of acts) {
      for (const x of a.perigos) {
        const rl = riskLevel(x[3], x[4]);
        rows.push([a.nome, x[1], x[2], classifyHazard(x[1]), { text: String(x[3]), align: 'center' }, { text: String(x[4]), align: 'center' }, { text: rl.nivel, fill: rl.cor }, x[5].slice(0, 2).join('; ')]);
      }
    }
    const doc = newDoc('inventario', 'Inventário de Riscos Ocupacionais', { subtitle: 'Base para o PGR (NR-01) — ' + acts.map((a) => a.nome).join(', '), orientation: 'landscape', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 4, items: [...baseKV(ctx, ['local', 'data', 'elaborado']), ['Revisão', '00']] });
    doc.blocks.push({ t: 'table', head: ['Atividade / GHE', 'Perigo', 'Possíveis lesões / agravos', 'Tipo', 'P', 'S', 'Nível', 'Medidas de prevenção existentes/propostas'], widths: [0.13, 0.18, 0.15, 0.09, 0.035, 0.035, 0.07, 0.31], rows, small: true });
    doc.blocks.push({ t: 'matrix' });
    doc.blocks.push({ t: 'callout', tone: 'warn', title: 'Importante', text: 'Este inventário é um ponto de partida. O PGR deve considerar as condições reais de cada estabelecimento, avaliações quantitativas quando necessárias (NR-09), fatores ergonômicos e psicossociais (NR-01/NR-17) e a participação dos trabalhadores.' });
    doc.blocks.push({ t: 'sign', items: ['Elaborado por (responsável técnico)', 'Aprovado por'] });
    return { doc, resumo: `Inventário de riscos com ${rows.length} perigos de ${acts.length} atividade(s), classificação por tipo, P×S, nível e medidas — base para o PGR.` };
  },

  pae(ctx) {
    const p = ctx.params || {};
    const doc = newDoc('pae', 'Plano de Atendimento a Emergências (PAE)', { subtitle: p.local || 'Versão simplificada', company: p.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [...baseKV(ctx, ['local', 'data', 'elaborado']), ['Ponto de encontro', ''], ['Coordenador de emergência', ''], ['Brigada (turno)', '']] });
    doc.blocks.push({ t: 'h', text: '1. Contatos de emergência' });
    doc.blocks.push({ t: 'table', head: ['Serviço', 'Telefone', 'Observação'], widths: [0.4, 0.2, 0.4], rows: [['SAMU', '192', 'Atendimento médico de urgência'], ['Corpo de Bombeiros', '193', 'Incêndio, resgate, salvamento'], ['Polícia Militar', '190', ''], ['Defesa Civil', '199', ''], ['Brigada / portaria interna', '', ''], ['SESMT / ambulatório', '', ''], ['Hospital de referência', '', '']] });
    doc.blocks.push({ t: 'h', text: '2. Cenários e ações' });
    doc.blocks.push({ t: 'table', head: ['Cenário', 'Ações imediatas', 'Responsável'], widths: [0.2, 0.62, 0.18], rows: [
      ['Princípio de incêndio', 'Acionar alarme; combater só se treinado e com segurança (extintor adequado); desligar energia; evacuar pela rota de fuga; acionar 193.', 'Brigada'],
      ['Acidente com vítima', 'Garantir a segurança da cena; acionar 192; prestar primeiros socorros; não mover vítima com suspeita de trauma; comunicar SESMT.', 'Socorristas'],
      ['Queda / suspensão em altura', 'Acionar o plano de resgate imediatamente (suspensão inerte é crítica); equipe treinada; 193 se necessário.', 'Equipe de resgate'],
      ['Choque elétrico', 'Não tocar na vítima; desligar a fonte de energia; acionar 192; iniciar RCP se treinado.', 'Eletricista / brigada'],
      ['Vazamento de produto químico', 'Isolar a área; consultar a FDS (seções 5 e 6); usar kit de contenção com EPI adequado; ventilar; acionar 193 se grande porte.', 'Brigada'],
      ['Evacuação geral', 'Alarme; abandonar pela rota sinalizada sem correr; não usar elevadores; ir ao ponto de encontro; conferir presença.', 'Coordenador'],
    ] });
    doc.blocks.push({ t: 'h', text: '3. Recursos disponíveis' });
    doc.blocks.push({ t: 'check', items: ['Extintores inspecionados e sinalizados', 'Hidrantes/mangueiras (se houver)', 'Alarme de emergência testado', 'Iluminação de emergência funcionando', 'Rotas de fuga sinalizadas e desobstruídas', 'Kits de primeiros socorros abastecidos', 'Kit de contenção de derramamento', 'Equipamentos de resgate em altura/espaço confinado (se aplicável)'], cols: ['OK', 'NC'] });
    doc.blocks.push({ t: 'h', text: '4. Simulados' });
    doc.blocks.push({ t: 'p', text: 'Realizar simulados periódicos (recomendado ao menos anualmente ou conforme exigência do Corpo de Bombeiros), registrando tempo de abandono, falhas e melhorias.' });
    doc.blocks.push({ t: 'sign', items: ['Elaborado por', 'Coordenador de emergência', 'Aprovado por'] });
    return { doc, resumo: 'PAE simplificado com contatos, 6 cenários com ações e responsáveis, checklist de recursos e orientação para simulados.' };
  },

  resumo_doc(ctx) {
    const f = ctx.fromFile;
    const a = f.analysis;
    const doc = newDoc('resumo_doc', 'Relatório de Análise de Documento', { subtitle: f.name, company: ctx.params.empresa || ctx.profile.company || '' });
    doc.blocks.push({ t: 'kv', cols: 3, items: [['Arquivo', f.name, 2], ['Formato', KIND_LABEL[f.kind] || f.kind], ['Tipo identificado', a.typeLabel], ['Páginas / abas', f.meta.pageCount || f.meta.sheetCount || f.meta.slideCount || '—'], ['Palavras', fmtNum(a.words || 0)], ['Empresa citada', a.empresa || '—'], ['Responsável citado', a.responsavel || '—'], ['Analisado em', fmtDateTime(new Date())]] });
    doc.blocks.push({ t: 'h', text: '1. Resumo' });
    doc.blocks.push({ t: 'ul', items: a.summary.length ? a.summary : ['Documento sem texto legível.'] });
    if (a.alerts.length) {
      doc.blocks.push({ t: 'h', text: '2. Pontos de atenção' });
      doc.blocks.push({ t: 'ul', items: a.alerts.map((x) => x.replace(/^[^\wÀ-ÿ“"]+/, '')) });
    }
    doc.blocks.push({ t: 'h', text: '3. Elementos identificados' });
    doc.blocks.push({ t: 'table', head: ['Elemento', 'Encontrado'], widths: [0.25, 0.75], rows: [['Normas citadas', a.nrs.length ? a.nrs.map((n) => 'NR-' + String(n).padStart(2, '0')).join(', ') : '—'], ['EPIs', a.epis.join(', ') || '—'], ['Perigos/agentes', a.hazards.join(', ') || '—'], ['CAs de EPI', a.cas.join(', ') || '—'], ['Validades', a.validity.length ? a.validity.map((v) => `${v.raw} (${v.status})`).join('; ') : '—'], ['Palavras-chave', a.keywords.join(', ')]] });
    if (a.tables && a.tables.length) {
      doc.blocks.push({ t: 'h', text: '4. Tabelas/planilhas' });
      doc.blocks.push({ t: 'table', head: ['Tabela', 'Linhas', 'Colunas'], widths: [0.3, 0.1, 0.6], rows: a.tables.map((t) => [t.name, String(t.rows), t.cols.map((c) => `${c.name} (${c.type})`).join(', ')]) });
    }
    const reqs = extractRequirements(f.text, 12);
    if (reqs.length) {
      doc.blocks.push({ t: 'h', text: 'Requisitos e obrigações encontrados' });
      doc.blocks.push({ t: 'ul', items: reqs });
    }
    doc.blocks.push({ t: 'h', text: 'Recomendações' });
    doc.blocks.push({ t: 'ul', items: recommendationsFor(f) });
    return { doc, resumo: `Relatório de análise de **${f.name}**: resumo, ${a.alerts.length} ponto(s) de atenção, normas, EPIs, validades e recomendações.` };
  },
};

const PT_EXTRA = {
  altura: ['Área abaixo isolada e sinalizada', 'Ancoragem definida e inspecionada', 'Condições climáticas favoráveis', 'Equipe de resgate disponível', 'Trabalhadores com NR-35 válida e ASO apto'],
  quente: ['Materiais combustíveis removidos/protegidos (raio ~11 m)', 'Extintor adequado no local', 'Vigia de fogo designado (durante e 30 min após)', 'Cilindros acorrentados e com válvulas corta-chamas', 'Medição de inflamáveis quando houver risco'],
  confinado: ['Espaço identificado e sinalizado', 'Bloqueio e etiquetagem de energias e linhas', 'Ventilação instalada e funcionando', 'Vigia designado (não entra)', 'Equipamentos de resgate posicionados', 'Comunicação testada', 'Trabalhadores com capacitação NR-33 válida'],
  eletrica: ['Circuito identificado no diagrama', 'Seccionamento realizado', 'Bloqueio e etiquetagem por executante', 'Ausência de tensão constatada', 'Aterramento temporário instalado', 'Zona controlada sinalizada', 'Trabalhadores autorizados (NR-10)'],
  geral: ['Área inspecionada e liberada', 'Riscos comunicados à equipe', 'Ferramentas e equipamentos inspecionados', 'EPIs disponíveis'],
};
function ptLabel(t) {
  return { altura: 'Trabalho em altura', quente: 'Trabalho a quente', confinado: 'Espaço confinado (PET)', eletrica: 'Serviços em eletricidade', geral: 'Trabalho geral' }[t] || 'Trabalho';
}
const TRAINING_CONTENT = {
  35: ['Normas e regulamentos aplicáveis ao trabalho em altura', 'Análise de risco e condições impeditivas', 'Riscos potenciais inerentes ao trabalho em altura e medidas de prevenção e controle', 'Sistemas, equipamentos e procedimentos de proteção coletiva', 'EPIs para trabalho em altura: seleção, inspeção, conservação e limitação de uso', 'Acidentes típicos em trabalhos em altura', 'Condutas em situações de emergência, incluindo noções de técnicas de resgate e primeiros socorros'],
  10: ['Introdução à segurança com eletricidade', 'Riscos em instalações e serviços com eletricidade (choque, arco, campos)', 'Técnicas de análise de risco', 'Medidas de controle do risco elétrico (desenergização, aterramento, equipotencialização, bloqueios)', 'Normas técnicas brasileiras e regulamentações do MTE', 'Equipamentos de proteção coletiva e individual', 'Rotinas de trabalho e procedimentos', 'Documentação de instalações elétricas', 'Riscos adicionais (altura, confinamento, áreas classificadas, umidade)', 'Proteção e combate a incêndios', 'Acidentes de origem elétrica', 'Primeiros socorros e técnicas de resgate'],
  33: ['Definições e reconhecimento de espaços confinados', 'Identificação e avaliação dos riscos (atmosferas perigosas, engolfamento, energias)', 'Funcionamento e uso de equipamentos de medição', 'Procedimentos e utilização da PET', 'Controle de energias perigosas e isolamentos', 'Ventilação', 'EPIs e equipamentos de resgate', 'Noções de resgate e primeiros socorros'],
  11: ['Normas aplicáveis (NR-11) e responsabilidades do operador', 'Tipos de empilhadeira, componentes e dispositivos de segurança', 'Inspeção pré-operacional (checklist)', 'Estabilidade, centro de gravidade e capacidade de carga', 'Técnicas de operação: deslocamento, empilhamento, rampas e docas', 'Circulação com pedestres e sinalização', 'Abastecimento/recarga (GLP e baterias)', 'Situações de emergência', 'Prática supervisionada'],
  12: ['Descrição e identificação dos riscos associados à máquina e às proteções', 'Funcionamento das proteções: como e por que devem ser usadas', 'Como e em que circunstâncias uma proteção pode ser removida e por quem', 'Procedimentos de parada, bloqueio e energia zero', 'Métodos de trabalho seguro', 'Permissão de trabalho e procedimentos em emergência', 'Prática na máquina'],
  6: ['Hierarquia de controles: por que o EPI é a última barreira', 'Obrigações do empregador e do empregado (NR-06)', 'Certificado de Aprovação (CA)', 'Seleção, uso correto, higienização e guarda', 'Inspeção e substituição', 'Demonstração prática de colocação e ajuste'],
  5: ['Estudo do ambiente, das condições de trabalho e dos riscos', 'Noções sobre acidentes e doenças relacionadas ao trabalho', 'Metodologia de investigação e análise de acidentes', 'Princípios de higiene do trabalho e medidas de controle', 'Noções sobre legislação trabalhista e previdenciária em SST', 'Noções sobre inclusão de pessoas com deficiência e reabilitados', 'Organização da CIPA e outros assuntos necessários', 'Prevenção e combate ao assédio sexual e a outras formas de violência no trabalho'],
  20: ['Inflamáveis: características, propriedades e perigos', 'Controle de fontes de ignição', 'Proteção contra incêndio com inflamáveis', 'Procedimentos básicos em situações de emergência', 'Estudo da NR-20', 'Análise preliminar de perigos/riscos', 'Permissão de trabalho com inflamáveis'],
  23: ['Prevenção de incêndios e classes de fogo', 'Uso de extintores e hidrantes', 'Procedimentos de abandono de área e rotas de fuga', 'Dispositivos de alarme', 'Primeiros socorros básicos'],
};
const TRAINING_HOURS = { 35: '8 horas (teórico e prático)', 10: '40 horas (básico)', 33: '16 horas (autorizados e vigias) / 40 horas (supervisores)', 5: '8h (GR1), 12h (GR2), 16h (GR3) ou 20h (GR4)' };
const TRAINING_RECYCLE = { 35: 'Bienal (8h) e nos casos eventuais da norma', 10: 'Bienal e nos casos previstos na norma', 33: 'Anual', 11: 'Revalidação anual do cartão do operador (com exame de saúde)', 5: 'A cada mandato' };

function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
function consequenceOf(h) {
  const t = norm(h);
  if (/queda de altura/.test(t)) return 'Fraturas, traumatismos, morte';
  if (/choque|arco/.test(t)) return 'Queimaduras, parada cardiorrespiratória';
  if (/ruido/.test(t)) return 'Perda auditiva (PAIR)';
  if (/quimic|vapor|gases|fumos|poeira/.test(t)) return 'Intoxicação, doenças respiratórias, dermatites';
  if (/incendio|explos/.test(t)) return 'Queimaduras, danos materiais, morte';
  if (/prensamento|esmaga|corte/.test(t)) return 'Lesões nas mãos, amputações';
  if (/atropel|colis/.test(t)) return 'Traumatismos graves, morte';
  if (/ergonom/.test(t)) return 'Lesões musculoesqueléticas';
  if (/mesmo nivel/.test(t)) return 'Entorses, contusões, fraturas';
  return 'Lesões diversas';
}
function classifyHazard(h) {
  const t = norm(h);
  if (/ruido|calor|frio|vibracao|radiacao|pressao/.test(t)) return 'Físico';
  if (/quimic|vapor|gases|fumos|poeira|solvente|toxic|atmosfera/.test(t)) return 'Químico';
  if (/biolog|virus|bacteria|lixo|perfurocort/.test(t)) return 'Biológico';
  if (/postura|repetit|ergonom|carga manual|levantamento|sobrecarga|esforco/.test(t)) return 'Ergonômico';
  if (/estresse|psicossoc|assedio|meta|fadiga/.test(t)) return 'Psicossocial';
  return 'Acidente';
}
function guessNRsFromText(t) {
  const n = norm(t);
  const out = [];
  const add = (re, nr) => re.test(n) && out.push(nr);
  add(/fiacao|eletric|painel|quadro|tomada|energizad/, 10);
  add(/empilhadeira|carga|armazen|palete/, 11);
  add(/maquina|prensa|protecao|correia|polia|serra/, 12);
  add(/altura|telhado|andaime|escada|guarda-corpo|guarda corpo/, 35);
  add(/extintor|incendio|rota de fuga|saida de emergencia/, 23);
  add(/sinaliza|faixa|placa|fds|fispq|rotul/, 26);
  add(/epi|capacete|luva|oculos|protetor|botina/, 6);
  add(/confinado|tanque|silo/, 33);
  add(/banheiro|sanitario|vestiario|refeitorio|agua potavel/, 24);
  add(/ergonom|postura|cadeira|mobiliario/, 17);
  return out;
}
function recommendationsFor(f) {
  const a = f.analysis;
  const r = [];
  if (a.validity.some((v) => v.status === 'vencido')) r.push('Renovar os itens/documentos vencidos e controlar as validades (posso criar uma aba de controle com alertas).');
  if (a.type === 'ppra' || a.alerts.some((x) => /PPRA/.test(x))) r.push('Migrar o conteúdo do PPRA para o PGR (inventário de riscos + plano de ação — NR-01).');
  if (a.type === 'apr' || a.type === 'pt') r.push('Conferir se todas as etapas têm medidas de controle e se os responsáveis assinaram.');
  if (a.type === 'fds') r.push('Garantir que a FDS esteja acessível no local de uso e que os EPIs da seção 8 estejam disponíveis.');
  if (a.type === 'certificado') r.push('Registrar o treinamento no controle de capacitações e programar a reciclagem.');
  if (a.type === 'procedimento') r.push('Transformar os requisitos em checklist de verificação e treinar a equipe no procedimento.');
  if (a.nrs.length) r.push(`Verificar a conformidade com ${a.nrs.map((n) => 'NR-' + String(n).padStart(2, '0')).join(', ')} no texto vigente das normas.`);
  if (!r.length) r.push('Revisar o documento com o responsável técnico e manter versão controlada.');
  return r;
}
