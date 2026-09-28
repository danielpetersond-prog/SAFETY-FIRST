// ---------------------------------------------------------------------------
// 16 · Motor de intenções (NLU) — entende o pedido e extrai parâmetros
// ---------------------------------------------------------------------------
const RE_URL = /\b((?:https?:\/\/|www\.)[^\s<>"')]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|br|gov|org|net|edu|io|info|app|dev)(?:\.br)?(?:\/[^\s<>"')]*)?)/i;
const GEN_VERB = /\b(fa[cz]a?|faz(?:er)?|fazendo|ger[ae]r?|gere|cri[ae]r?|mont[ae]r?|elabor[ae]r?|prepar[ae]r?|escrev[ae]r?|redij[ae]|redigir|quero|queria|preciso|precisava|gostaria|me (?:d[aeê]|manda|envia|passa)|manda|envi[ae]|desenvolv[ae]r?|produz[ai]r?|emit[ae]|emitir|tir[ae]|imprim[ae]|baix[ae]r?)\b/;
const QUESTION_START = /^(o que|oque|qual|quais|como|quando|onde|por que|porque|pq|quem|quanto|quantos|quantas|existe|tem\b|posso|pode|devo|e verdade|sera que|me explica|explica|explique)/;

function normKeep(s) {
  // minúsculas sem acento, mantendo o mesmo tamanho do texto original (NFC)
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function sliceRaw(raw, nk, re) {
  const m = re.exec(nk);
  if (!m) return null;
  const g = m[1] != null ? m[1] : m[0];
  const start = m.index + m[0].indexOf(g);
  return raw.slice(start, start + g.length).trim();
}

function detectRequestDocType(t, raw) {
  const rules = [
    ['pt', /\b(permiss(?:ao|oes) de (?:trabalho|entrada)|\bpet\b|\bpt\b)/],
    ['ficha_epi', /\b(ficha (?:de )?(?:entrega |controle )?(?:de )?epis?|controle de (?:entrega de )?epis?|termo de (?:entrega|responsabilidade)(?: de epi)?|entrega de epis?)\b/],
    ['checklist', /\b(check ?-?list|lista de (?:verificacao|inspecao|checagem)|checagem|auditoria 5s)\b/],
    ['lista_presenca', /\b(lista de (?:presenca|participantes|frequencia))\b/],
    ['apr', /\b(apr|analise preliminar(?: de riscos?)?|analise de riscos?|\bar\b)\b/],
    ['dds', /\b(dds|dialogo diario|dialogo de seguranca|conversa de seguranca|palestra rapida)\b/],
    ['investigacao', /\b(investigacao|analise (?:do|de|dos) acidentes?|relatorio de (?:acidente|incidente)|5 porques|cinco porques|ishikawa|arvore de causas)\b/],
    ['plano_acao', /\b(plano de acoes?|5w2h)\b/],
    ['inspecao', /\b(relatorio (?:de inspecao|fotografico|de nao conformidade)|rnc|nao conformidade|relatorio com (?:a |as )?fotos?|laudo fotografico|registro de (?:inspecao|desvio)|relatorio de desvio)\b/],
    ['os', /\b(ordem de servico|ordens de servico)\b/],
    ['pop', /\b(pop|procedimento operacional(?: padrao)?|instrucao de trabalho|procedimento de seguranca|procedimento)\b/],
    ['comunicado', /\b(comunicado|alerta de seguranca|informativo|cartaz|aviso de seguranca)\b/],
    ['treinamento', /\b(plano de treinamento|conteudo programatico|programa de treinamento|ementa|plano de capacitacao)\b/],
    ['inventario', /\b(inventario de riscos?|pgr|mapa de riscos?|levantamento de riscos)\b/],
    ['pae', /\b(plano de (?:atendimento a )?emergencias?|\bpae\b|plano de abandono|plano de evacuacao)\b/],
    ['resumo_doc', /\b(relatorio (?:de analise|do documento|da analise|sobre (?:o|esse|este) (?:documento|arquivo)))\b/],
  ];
  for (const [id, re] of rules) if (re.test(t)) return id;
  if (/\bOS\b/.test(raw) || /\bo\.s\.\b/.test(t)) return 'os';
  if (/\binspecao\b/.test(t) && /\b(relatorio|registr|document|foto)/.test(t)) return 'inspecao';
  if (/\btreinamento\b/.test(t) && /\b(plano|conteudo|programa|ementa|roteiro)\b/.test(t)) return 'treinamento';
  return null;
}
function detectFormat(t) {
  if (/\b(word|docx|\.doc\b|editavel)\b/.test(t)) return 'docx';
  if (/\b(?:em|no|formato|para|pra|de|uma) (?:excel|planilha|xlsx)\b|\bxlsx\b|\bexcel\b/.test(t)) return 'xlsx';
  if (/\b(imprimir|impressao|imprime)\b/.test(t)) return 'print';
  if (/\bpdf\b/.test(t)) return 'pdf';
  if (/\bhtml\b/.test(t)) return 'html';
  return null;
}
const PLACE_WORDS = 'galpao|setor|area|obra|fabrica|unidade|predio|bloco|linha|doca|almoxarifado|deposito|oficina|expedicao|recebimento|patio|cozinha|refeitorio|escritorio|laboratorio|subestacao|cabine|telhado|mezanino|estoque|producao|manutencao|portaria|planta|filial|loja|centro de distribuicao|cd|armazem|sala|andar|canteiro|campo|garagem|caldeiraria|usinagem|pintura|montagem|embalagem';
function extractParams(raw) {
  raw = String(raw || '').normalize('NFC');
  const nk = normKeep(raw);
  const p = {};
  const loc = sliceRaw(raw, nk, new RegExp(`\\b(?:no|na|nos|nas|em|do|da|dos|das|local[:\\s]+|setor[:\\s]+)\\s*((?:(?:${PLACE_WORDS})\\b)[^,.;:!?\\n]{0,38})`));
  if (loc) p.local = capFirst(loc.replace(/\s+(em|no|na|para|pra|com|de)\s+(pdf|word|excel|docx|planilha).*$/i, '').replace(/\s+(para|pra|com|amanh[aã]|hoje|ontem|dia|no dia|at[eé]|as|às|durante|sobre)\b.*$/i, '').trim());
  const emp = sliceRaw(raw, nk, /\b(?:empresa|cliente|contratante)[:\s]+([a-z0-9][^,;\n]{2,50}?)(?=[,.;\n]| para | em | no | na |$)/);
  if (emp) p.empresa = emp;
  const resp = sliceRaw(raw, nk, /\b(?:responsavel|elaborado por|emitente|instrutor|conduzido por|tecnico responsavel|inspetor)[:\s]+([a-z]+(?:\s+(?:da |de |dos |das |do )?[a-z]+){0,3})/);
  if (resp) p.responsavel = titleCase(resp);
  const colab = sliceRaw(raw, nk, /\b(?:colaborador|funcionario|empregado|trabalhador)[:\s]+([a-z]+(?:\s+(?:da |de |dos |das |do )?[a-z]+){0,3})/);
  if (colab) p.colaborador = titleCase(colab);
  const dm = /\b(hoje|amanha|ontem|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\d{1,2} de (?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?: de \d{4})?)\b/.exec(nk);
  if (dm) {
    const d = parseDateBR(dm[1]);
    if (d) p.data = d;
  }
  const pe = /(\d{1,3})\s*(?:pessoas|participantes|colaboradores|trabalhadores|funcionarios|linhas|executantes|nomes|alunos)/.exec(nk);
  if (pe) p.pessoas = +pe[1];
  const du = /\b(\d{1,3})\s*(min\b|minutos|h\b|horas)/.exec(nk);
  if (du) p.duracao = du[1] + (/^h/.test(du[2]) ? ' horas' : ' minutos');
  const fn = sliceRaw(raw, nk, /\b(?:para|pra|funcao|cargo)[:\s]+(?:o |a |os |as |um |uma )?((?:operador(?:a)?|auxiliar|tecnico|tecnica|ajudante|assistente|analista|encarregado|supervisor)(?: de [a-z]+(?: [a-z]+)?)?|soldador(?:a)?|eletricista|mecanico|pedreiro|servente|pintor(?:a)?|motorista|almoxarife|montador(?:a)?|carpinteiro|armador|encanador|jardineiro|faxineir[oa]|porteiro|vigilante|cozinheir[oa]|enfermeir[oa]|mecanic[oa]|frentista|repositor(?:a)?|estoquista|conferente|motosserrista|operador(?:a)?)\b/);
  if (fn) p.funcao = capFirst(fn);
  const nr = /\bnr[\s-]*0?(\d{1,2})\b/.exec(nk);
  if (nr) p.nr = +nr[1];
  const tema = sliceRaw(raw, nk, /\b(?:sobre|tema[:\s]+|a respeito d[eoa]s?|acerca d[eoa]s?|com o tema)\s+(.{3,90}?)(?:[.!?]|$| em pdf| em word| em excel| para \d| com \d)/);
  if (tema) p.tema = tema.replace(/^(o|a|os|as)\s+/i, '');
  if (/\b(altura|telhado|andaime|nr[\s-]*35)\b/.test(nk)) p.tipoPT = 'altura';
  if (/\b(quente|solda|soldagem|oxicorte|macarico|esmerilh)/.test(nk)) p.tipoPT = 'quente';
  if (/\b(confinado|pet\b|tanque|silo)/.test(nk)) p.tipoPT = 'confinado';
  if (/\b(eletric|nr[\s-]*10|painel|energizad)/.test(nk)) p.tipoPT = p.tipoPT || 'eletrica';
  if (/\b(complet[oa]|detalhad[oa]|mais detalhes|robust[oa])\b/.test(nk)) p.detail = 'completo';
  if (/\b(resumid[oa]|simples|curt[oa]|enxut[oa]|rapid[oa])\b/.test(nk)) p.detail = 'resumido';
  const eq = sliceRaw(raw, nk, /\b(?:equipe|executantes)[:\s]+([^.;\n]{3,80})/);
  if (eq) p.equipe = eq;
  const eqp = sliceRaw(raw, nk, /\b(?:equipamento|maquina|tag|patrimonio|placa)[:\s]+([a-z0-9][^,.;\n]{1,40})/);
  if (eqp) p.equipamento = eqp;
  return p;
}
// Remove o "comando" e fica com a descrição (a descrição pode vir antes ou depois do pedido)
//   "fiação exposta no painel do galpão 2, faça um relatório de não conformidade" → "Fiação exposta no painel do galpão 2"
//   "faça um RNC com essa foto: extintor obstruído na doca 4"                    → "extintor obstruído na doca 4"
function extractDescription(raw) {
  const s = String(raw || '').trim();
  const colon = s.indexOf(':');
  if (colon > 0 && colon < s.length - 8) return s.slice(colon + 1).trim();
  const CMD = /\b(fa[cç]a|faz|fazer|gere|gera|gerar|crie|cria|criar|monte|monta|montar|elabore|elabora|prepare|prepara|quero|queria|preciso|me (?:d[aeê]|manda))\b.*\b(relat[oó]rio|rnc|n[aã]o conformidade|registro|alerta|comunicado|inspe[cç][aã]o|documento|pdf|word|excel|investiga[cç][aã]o|plano|apr|checklist|dds)\b/i;
  const clauses = s.split(/(?<=[.;!?])\s+|,\s+/).map((c) => c.trim()).filter(Boolean);
  let desc = clauses.filter((c) => !CMD.test(c)).join(', ');
  if (!desc) {
    const nk = normKeep(s);
    const m = /(?:com (?:essa|esta|a|as|essas|estas) fotos?|dessa foto|desta foto|nessa foto|nesta foto|na foto|da foto|sobre|referente a|onde|porque|pois|mostrando|que mostra|em que)\s+/.exec(nk);
    desc = m ? s.slice(m.index + m[0].length) : '';
  }
  desc = desc
    .replace(/^(?:ess[ae]|est[ae]|a|na|nessa|nesta)?\s*(?:foto|imagem)\s*(?:mostra|mostrando|tem|aparece|:)?\s*/i, '')
    .replace(/\s+(?:em|no formato)\s+(?:pdf|word|excel)\s*$/i, '')
    .trim();
  return capFirst(desc);
}

// Palavras que indicam pedido sobre abas (Tab Studio)
const TAB_WORD = /\b(abas?|sub[\s-]?abas?|subabas?|guias?|dashboards?|pagina interna|painel de (?:indicadores|graficos|dados|kpis|controle de (?:indicadores|dados)))\b/;
const WIDGET_WORD = /\b(grafico|graficos|kpi|kpis|indicador|indicadores|card|cards|widget|widgets|tabela|contador|checklist|nota|anotacao|formulario|calculadora|links?|cor|icone|layout|colunas?|pizza|barras?|linha do tempo|rosca|donut|meta|progresso)\b/;

function classify(text, ctx = {}) {
  const raw = String(text || '').normalize('NFC').trim();
  const t = norm(raw);
  const res = { intent: 'unknown', raw, t, slots: {}, confidence: 0.5 };
  const set = (intent, conf = 0.8, slots = {}) => Object.assign(res, { intent, confidence: conf, slots: { ...res.slots, ...slots } });
  const params = extractParams(raw);
  const docType = detectRequestDocType(t, raw);
  const format = detectFormat(t);
  const acts = findActivities(raw, memory.data.synonyms);
  const url = (RE_URL.exec(raw) || [])[1];
  const hasFiles = !!(ctx.files && ctx.files.length);
  const hasCtxFiles = hasFiles || !!(ctx.activeFiles && ctx.activeFiles.length);
  const hasImage = hasFiles && ctx.files.some((f) => f.kind === 'image');
  const isQuestion = /\?\s*$/.test(raw) || QUESTION_START.test(t);
  res.slots = { params, docType, format, acts, url };
  res.activities = acts.map((a) => a.id);
  res.docType = docType;
  res.format = format;
  res.detail = params.detail;

  if (!t && hasFiles) return set('file_only', 0.9);
  if (!t) return set('empty', 1);

  // 0) comandos com barra
  const slash = /^\/(\w+)\s*(.*)$/.exec(t);
  if (slash) {
    const map = { apr: 'apr', dds: 'dds', pt: 'pt', pet: 'pt', checklist: 'checklist', os: 'os', epi: 'ficha_epi', inspecao: 'inspecao', rnc: 'inspecao', investigacao: 'investigacao', '5w2h': 'plano_acao', acao: 'plano_acao', pop: 'pop', presenca: 'lista_presenca', comunicado: 'comunicado', alerta: 'comunicado', treinamento: 'treinamento', inventario: 'inventario', pgr: 'inventario', pae: 'pae', emergencia: 'pae' };
    if (map[slash[1]]) {
      res.docType = map[slash[1]];
      return set('doc_generate', 1, { docType: map[slash[1]] });
    }
    if (/^(aba|abas|nova-aba|criar-aba)$/.test(slash[1])) return set(slash[2] ? 'tab_create' : 'tab_list', 1);
    if (/^(memoria|mem)$/.test(slash[1])) return set('recall_profile', 1);
    if (/^(ajuda|help|comandos)$/.test(slash[1])) return set('help', 1);
    if (/^(novo|nova|nova-conversa)$/.test(slash[1])) return set('new_chat', 1);
    if (/^(site|ler|leia)$/.test(slash[1])) return set('site_read', 1, { url: slash[2] });
  }

  // 1) resposta a uma pergunta pendente da IA
  if (ctx.pending && ctx.pending.kind === 'ask_name') {
    if (/^(?:(?:meu nome (?:e|é)|me chamo|sou o|sou a|pode me chamar de|e|é)\s+)?[a-zà-ÿ]{2,}(?:\s+[a-zà-ÿ]{2,}){0,2}[.!]?$/i.test(raw) && !QUESTION_START.test(t) && !/^(oi+|ola|bom dia|boa tarde|boa noite|tudo bem|obrigad)/.test(t)) return set('pending_answer', 0.9);
  } else if (ctx.pending && t.split(' ').length <= 8 && !docType && !TAB_WORD.test(t) && !isQuestion) return set('pending_answer', 0.9);

  // 2) frases aprendidas com o usuário
  const learned = memory.matchLearned(raw);
  if (learned && !docType && !url) {
    res.learned = learned;
    return set(learned.intent, 0.85, learned.slots || {});
  }

  // 3) conversa
  const greetOnly = /^(oi+e?|ola|opa|e ai|eai|hey|hello|salve|bom dia|boa tarde|boa noite|oii+)(,| |!|\.)*(aurora|ia|ops|pessoal|tudo bem|tudo bom|td bem)?[!.,\s?]*(bom dia|boa tarde|boa noite)?[!.\s]*$/;
  if (greetOnly.test(t)) return set('greet', 0.95);
  const greetPrefix = /^(oi+|ola|opa|e ai|bom dia|boa tarde|boa noite)(,?\s+aurora)?[,!.\s]+/;
  const body = t.replace(greetPrefix, '');
  if (body !== t && body.length > 2) {
    const inner = classify(raw.replace(/^[^,!.]*?(?:aurora)?[,!.]\s*|^(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite)\s+/i, ''), ctx);
    if (inner.intent !== 'unknown') {
      inner.greeted = true;
      return inner;
    }
  }
  if (/^(e )?(como (voce )?(esta|vai|anda|ta|tem passado)|tudo (bem|bom|certo|joia|tranquilo|em ordem)|como vc (ta|esta)|como ce ta|beleza|td bem|tudo bem com voce)\b.{0,25}$/.test(t) || /(queria|quero) (so )?saber como (voce )?(esta|vai|ta)/.test(t)) return set('howareyou', 0.9);
  if (/^(estou|to|tou|eu estou|tudo|aqui|por aqui)?\s*(bem|otimo|otima|tranquilo|de boa|joia|beleza|tudo certo|tudo otimo|mais ou menos|cansad[oa]|mal|pessimo|triste|estressad[oa]|exaust[oa]|sobrecarregad[oa]|ansios[oa])\b.{0,30}$/.test(t) && ctx.lastIntent === 'howareyou') return set('user_state', 0.9);
  if (/^(muito )?(obrigad[oa]|valeu|vlw|grato|grata|agradeco|brigad[oa]|obg)\b/.test(t) && t.length < 60) return set('thanks', 0.95);
  if (/^(tchau|ate mais|ate logo|ate amanha|falou|flw|bom descanso|fui)\b/.test(t)) return set('bye', 0.95);
  if (/^(voce e|vc e|tu e)\s+(demais|incrivel|otima|muito boa|top|sensacional|genial|a melhor)|^(adorei|amei|mandou bem|show|perfeito|excelente|otimo trabalho)[!.\s]*$/.test(t)) return set('compliment', 0.9);
  if (/(quem e voce|quem (e|eh) a aurora|o que voce (faz|sabe fazer|consegue fazer|pode fazer)|como (voce funciona|te usar|usar voce|funciona)|^ajuda\b|^help\b|^comandos\b|o que da pra fazer|suas funcoes|para que voce serve)/.test(t)) return set('help', 0.9);

  // 4) memória
  const nkr = normKeep(raw);
  let m = sliceRaw(raw, nkr, /\b(?:meu nome e|me chame de|me chama de|pode me chamar de|eu me chamo|me chamo)\s+([a-z]+(?:\s+[a-z]+)?)/);
  if (m && !/^(o|a|de|um|uma)$/i.test(m)) return set('set_name', 0.95, { name: titleCase(m.split(/\s+/).filter((w) => !/^(e|mas|por|pois)$/i.test(w)).slice(0, 2).join(' ')) });
  m = sliceRaw(raw, nkr, /\b(?:minha empresa (?:e|se chama)|trabalho na empresa|a empresa (?:onde trabalho )?(?:e|se chama))\s+([^.,;!?]{2,60})/);
  if (m && !docType) return set('set_company', 0.9, { company: m.trim() });
  let m2;
  m2 = /^(?:por favor,?\s*)?(?:lembre|lembra|lembrar|anote|anota|guarde|guarda|memorize|registre|salve na memoria)(?:-se)?\s+(?:que|de que|disso:|isso:|:)?\s*(.{4,})$/i.exec(raw);
  if (m2 && !/\b(me|mim)\b.{0,10}\b(amanha|depois|daqui)/.test(t)) return set('remember', 0.95, { fact: m2[1] });
  if (/(o que voce (sabe|lembra|aprendeu) (sobre|de) mim|o que voce aprendeu|minhas preferencias|sua memoria|o que voce guardou|mostre? (a )?memoria)/.test(t)) return set('recall_profile', 0.95);
  if (/^(esqueca|esquece|apague da memoria|apaga da memoria|remova da memoria)\b/.test(t)) return set('forget', 0.9, { what: raw.replace(/^\S+\s+(da memoria\s+)?(que\s+)?/i, '') });
  if (/(o que (a gente |nos |eu |voce e eu )?(conversou|conversamos|falamos|falou|pedi|perguntei|te pedi|te perguntei)\b|do que (a gente )?falamos|ja falamos sobre|voce lembra (quando|da|do|que)|lembra (quando|daquela|daquele)|historico de conversas|procure? nas conversas|pesquis[ae] nas conversas)/.test(t)) return set('recall_chats', 0.9);

  // 5) abas (Tab Studio)
  const tabWord = TAB_WORD.test(t);
  const tabCtx = ctx.workspaceOpen || /^tab_/.test(ctx.lastIntent || '');
  if (tabWord || (tabCtx && WIDGET_WORD.test(t) && /\b(adicion|inclu|coloc|remov|exclu|tir[ae]|mud|troc|alter|renome|mov|aument|diminu|deix|poe|ponha|bot[ae]|cri[ae]|fa[cz]|mostr)/.test(t))) {
    if (/\b(desfa[cz]|desfazer|voltar atras|volte atras)\b/.test(t)) return set('tab_undo', 0.9);
    if (url && /\b(cri|faz|fac|mont|ger|nova|novo|transform|leia|ler|le |use|usando|a partir)/.test(t)) return set('tab_from_site', 0.95);
    if (hasCtxFiles && /\b(esses dados|essa planilha|esta planilha|desse arquivo|deste arquivo|desse documento|com (os )?dados|a partir d[ao] (arquivo|planilha|documento)|com base n[ao]|usando (a|o) (planilha|arquivo))/.test(t)) return set('tab_from_file', 0.95);
    if (/^(quais|liste|listar|lista|mostr[ae]|ver|veja|exib[ae])( (as|todas as|minhas))? (minhas )?(abas|guias|paineis)\b|minhas abas|abas (criadas|que (voce|vc) criou)/.test(t)) return set('tab_list', 0.9);
    if (/\b(export|baix|salv|ger)[a-z]* (o |a )?(blueprint|pacote|script|padrao|codigo|implementacao|arquivos?)\b|como (voce |vc )?(fez|criou|montou) (a|essa|esta) aba|documenta[cç][aã]o da aba/.test(t)) return set('tab_export', 0.9);
    if (/\b(exclu|remov|apag|delet)[a-z]*\s+(a |essa |esta )?(aba|guia|painel)\b(?! de)/.test(t) && !/sub[\s-]?aba|grafico|widget|kpi|card|tabela|item/.test(t)) return set('tab_delete', 0.9);
    if (/\b(abr[aei]r?|abre|mostr[ae]r?|ir para|va para|vai para|entr[ae]r? na|acess[ae]r?)\s+(a )?(aba|guia|painel)\b/.test(t) && !/\b(cri|nova|novo)/.test(t)) return set('tab_open', 0.9);
    if (/\b(cri|faz|fac|mont|ger|desenvolv|constru|quero|preciso|gostaria)[a-z]*\b.{0,40}\b(uma |um )?(nova |novo )?(aba|guia|painel|dashboard|pagina)\b/.test(t) && !/\bsub[\s-]?aba/.test(t.replace(/(com|e) (as |os )?sub[\s-]?abas?.*/, ''))) return set('tab_create', 0.92);
    if (/\b(nova|novo) (aba|guia|painel)\b/.test(t)) return set('tab_create', 0.9);
    return set('tab_edit', 0.8);
  }

  // 6) leitura de sites
  if (url) return set('site_read', 0.9, { url });

  // 7) cálculos de SST
  if (/(taxa de frequencia|taxa de gravidade|\btf\b|\btg\b|dose de ruido|tempo (maximo|permitido|de exposicao).{0,30}(db|decibe)|(\d{2,3}(?:[.,]\d)?)\s*(db|decibeis)|dias sem acidente|calcul)/.test(t) && /\d/.test(t)) return set('calc', 0.85);

  // 8) documento anexado/ativo
  const refersDoc = /\b(esse|este|nesse|neste|desse|deste|do|no|o|a|essa|esta|nessa|nesta|dessa|desta)\s+(documento|arquivo|pdf|anexo|planilha|procedimento|relatorio|texto|laudo|certificado|aso|fds|fispq|apr|pt|foto|imagem|contrato|manual)\b|\b(anexo|anexei|enviei|mandei|documento|arquivo)\b/.test(t);
  if (hasCtxFiles) {
    if (hasImage && /(o que (tem|aparece|voce ve|esta escrito)|leia (o texto|a imagem|a foto)|transcrev|ocr|extrai[ar]? o texto|ler o texto)/.test(t)) return set('image_ocr', 0.9);
    if (docType && (hasFiles || refersDoc || /\b(transform|convert|com base|a partir|baseado|usando|use|conforme)\b/.test(t))) return set('doc_generate', 0.95, { fromFile: true });
    if (/(resum|sintetiz|do que se trata|sobre o que (e|fala)|principais pontos|pontos principais|o que (tem|diz|fala) (nesse|neste|no|esse|este|o|a|essa|esta)\b|analis[ae]|avali[ae]|revis[ae]|o que achou|verifique|confira)/.test(t) && (hasFiles || refersDoc)) return set(/relatorio|laudo|parecer|analise completa/.test(t) && GEN_VERB.test(t) ? 'doc_report' : 'doc_summary', 0.9);
    if (/(validade|vencid|vence|venciment|expira|prazo)/.test(t)) return set('doc_validity', 0.9);
    if (/(quais|que|lista|liste).{0,15}\bepis?\b/.test(t)) return set('doc_epis', 0.9);
    if (/(quais|que|lista|liste).{0,15}\b(normas|nrs?)\b|normas (citadas|aplicaveis|mencionadas)/.test(t)) return set('doc_nrs', 0.9);
    if (/(quais|que|lista|liste|identifi|extrai).{0,20}\b(riscos|perigos)\b/.test(t) && (hasFiles || refersDoc)) return set('doc_risks', 0.9);
    if (hasImage && !docType && (t.split(' ').length >= 3 || /(foto|imagem)/.test(t))) return set('photo_report', 0.85);
    if (hasFiles && !docType && !isQuestion && !GEN_VERB.test(t) && t.split(' ').length <= 6) return set('doc_summary', 0.7);
    if ((isQuestion || refersDoc) && !docType && !/\bnr[\s-]*\d/.test(t)) return set('doc_qa', 0.75);
  }

  // 9) continuação do último documento
  if (ctx.lastDoc && !docType) {
    if (format && t.split(' ').length <= 7) return set('doc_reformat', 0.9);
    if (/\b(adicion|inclu|acrescent|coloc|insir)[a-z]*\b.{0,30}\b(risco|perigo|item|itens|epi|etapa|medida|controle|pergunta|ponto)/.test(t)) return set('doc_modify', 0.85, { op: 'add' });
    if (/\b(remov|tir|exclu|apag)[a-z]*\b.{0,30}\b(risco|perigo|item|epi|etapa)/.test(t)) return set('doc_modify', 0.85, { op: 'remove' });
    if (/\b(mud|troc|alter|corrig|atualiz)[a-z]*\b.{0,20}\b(local|data|empresa|responsavel|setor|titulo|nome|funcao|tema)\b/.test(t)) return set('doc_modify', 0.85, { op: 'param' });
    if (/\b(mais (detalhad|complet)|mais completo|detalh[ae]|mais curt|resum[ae] (mais|ele)|mais simples|enxug)/.test(t)) return set('doc_modify', 0.85, { op: 'detail' });
    const followShape = /^(e|agora|tambem|faz|faca|gera|gere|outr[ao]|o mesmo|a mesma|mais uma?|repete|repita)\b/.test(t) || /^(para|pra|de|do|da|com)\b/.test(t);
    if (acts.length && followShape && t.split(' ').length <= 9 && !/^(e )?(o que|qual|quais|como|quando|por que)\b/.test(t)) return set('doc_generate', 0.85, { docType: ctx.lastDoc.type, followUp: true });
  }

  // 10) geração de documentos
  const isDefinitionQ = /^(o que (e|eh|sao|significa|seria|quer dizer)|oque e|que (e|eh)|qual (e )?(o )?(significado|conceito)|defin[ae]|definicao|explique|explica|me explica)\b/.test(t);
  if (docType && !isDefinitionQ && !(isQuestion && /^(como|quando|quem|por que|porque|qual a diferenca|quais as diferencas|precisa|preciso de|e obrigatorio|e necessario|devo)\b/.test(t) && !GEN_VERB.test(t))) {
    return set('doc_generate', 0.92);
  }

  // 11) normas
  const nrm = /\bnr[\s-]*0?(\d{1,2})\b/.exec(t);
  if (nrm && +nrm[1] >= 1 && +nrm[1] <= 38) return set('nr_info', 0.9, { nr: +nrm[1] });
  if (/(qual|quais|que) (a |as )?(nr|norma|normas|nrs)\b.{0,25}\b(fala|falam|trata|tratam|regulamenta|aborda|cobre|se aplica|aplica|sobre|de|para)\b/.test(t)) return set('nr_search', 0.9);

  // 12) definições
  if (isDefinitionQ) {
    const g = findGlossary(t.replace(/^(o que (e|eh|sao|significa|seria|quer dizer)|oque e|que (e|eh)|qual (e )?(o )?(significado|conceito) de|defin[ae]|definicao de|explique|explica|me explica)\s+(o |a |um |uma |os |as )?/, ''));
    if (g) return set('define', 0.9, { glossary: g });
    if (acts.length) return set('activity_info', 0.75);
    return set('kb_search', 0.6);
  }

  // 13) orientações práticas (situações do dia a dia)
  const adv = findAdvice(t);
  if (adv) return set('advice', 0.88, { advice: adv });

  // 14) perguntas sobre uma atividade (riscos, EPIs, requisitos)
  if (acts.length && (isQuestion || /\b(riscos?|perigos?|epis?|cuidados?|requisitos?|treinamentos?|normas?)\b/.test(t))) return set('activity_info', 0.8);

  // 15) pedido de documento sem tipo definido
  if (acts.length && GEN_VERB.test(t)) return set('ask_doctype', 0.7);

  // 16) glossário direto (termo solto)
  const g2 = t.split(' ').length <= 5 ? findGlossary(t) : null;
  if (g2) return set('define', 0.7, { glossary: g2 });
  if (acts.length && t.split(' ').length <= 4) return set('activity_info', 0.65);

  if (isQuestion) return set('kb_search', 0.55);
  if (t.split(' ').length <= 2) return set('short', 0.4);
  return set('unknown', 0.3);
}
