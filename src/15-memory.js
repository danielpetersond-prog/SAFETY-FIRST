// ---------------------------------------------------------------------------
// 15 · Memória adaptativa (local): perfil, preferências, fatos ensinados,
//      frases aprendidas, sinônimos de atividades, feedback 👍/👎 e estatísticas.
//      Tudo fica no navegador e pode ser visto/apagado/exportado pelo usuário.
// ---------------------------------------------------------------------------
function defaultMemory() {
  return {
    version: 1,
    enabled: true,
    profile: { name: CFG.userName || null, company: CFG.company || null, role: null, sector: null, location: null },
    prefs: { format: { pdf: 0, docx: 0, xlsx: 0, print: 0 }, detail: { completo: 0, resumido: 0 } },
    counts: { activities: {}, docTypes: {}, intents: {}, topics: {} },
    facts: [],
    learned: [],
    synonyms: {},
    feedback: { up: 0, down: 0, byIntent: {} },
    negatives: [],
    stats: { messages: 0, firstSeen: Date.now(), lastSeen: Date.now() },
  };
}
const memory = {
  data: defaultMemory(),
  async load() {
    const saved = await db.get('kv', 'memory');
    const d = defaultMemory();
    if (saved) {
      for (const k of Object.keys(d)) if (saved[k] !== undefined) d[k] = typeof d[k] === 'object' && !Array.isArray(d[k]) ? { ...d[k], ...saved[k] } : saved[k];
    }
    if (CFG.userName && !d.profile.name) d.profile.name = CFG.userName;
    if (CFG.company && !d.profile.company) d.profile.company = CFG.company;
    // tenta descobrir o nome do usuário pelo app hospedeiro
    if (!d.profile.name) {
      const host = PAGE.OPS360 || PAGE.ops360 || {};
      const n = (host.usuario && (host.usuario.nome || host.usuario.name)) || (host.user && (host.user.nome || host.user.name)) || null;
      if (n) d.profile.name = String(n).split(' ')[0];
    }
    this.data = d;
  },
  _save: debounce(() => db.put('kv', deepClone(memory.data), 'memory'), 400),
  save() {
    this._save();
    bus.emit('memory:changed', this.data);
  },
  get profile() {
    return this.data.profile;
  },
  get enabled() {
    return this.data.enabled !== false;
  },
  setProfile(k, v) {
    this.data.profile[k] = v;
    this.save();
  },
  inc(bucket, key, by = 1) {
    if (!key) return;
    const b = (this.data.counts[bucket] = this.data.counts[bucket] || {});
    b[key] = (b[key] || 0) + by;
  },
  noteTurn(text, res) {
    this.data.stats.messages++;
    this.data.stats.lastSeen = Date.now();
    if (!this.enabled) return this.save();
    this.inc('intents', res.intent);
    for (const a of res.activities || []) this.inc('activities', a);
    if (res.docType) this.inc('docTypes', res.docType);
    if (res.format && this.data.prefs.format[res.format] !== undefined) this.data.prefs.format[res.format]++;
    if (res.detail && this.data.prefs.detail[res.detail] !== undefined) this.data.prefs.detail[res.detail]++;
    for (const k of keywords(text, 3)) this.inc('topics', k);
    this.save();
  },
  top(bucket, n = 3) {
    return Object.entries(this.data.counts[bucket] || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => ({ key: k, count: v }));
  },
  preferredFormat() {
    const f = this.data.prefs.format;
    const best = Object.entries(f).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 2 ? best[0] : null;
  },
  preferredDetail() {
    const d = this.data.prefs.detail;
    return d.resumido >= 3 && d.resumido > d.completo * 1.5 ? 'resumido' : d.completo >= 3 && d.completo > d.resumido * 1.5 ? 'completo' : null;
  },
  addFact(text) {
    const f = { id: uid('fact'), text: capFirst(text.trim().replace(/[.;]+$/, '')), at: Date.now() };
    if (this.data.facts.some((x) => norm(x.text) === norm(f.text))) return null;
    this.data.facts.push(f);
    this.save();
    return f;
  },
  removeFact(id) {
    this.data.facts = this.data.facts.filter((f) => f.id !== id);
    this.save();
  },
  forgetMatching(query) {
    const ix = new BM25();
    this.data.facts.forEach((f) => ix.add(f.id, f.text));
    const hits = ix.search(query, 5).filter((h) => h.coverage >= 0.5);
    this.data.facts = this.data.facts.filter((f) => !hits.some((h) => h.id === f.id));
    this.save();
    return hits.length;
  },
  recallFacts(query, k = 3) {
    if (!this.data.facts.length) return [];
    const ix = new BM25();
    this.data.facts.forEach((f) => ix.add(f.id, f.text, f));
    return ix
      .search(query, k)
      .filter((r) => r.coverage >= 0.34)
      .map((r) => r.meta);
  },
  // aprende "quando eu disser X, quero Y"
  learn(phrase, intent, slots = {}) {
    if (!this.enabled || !phrase) return;
    const toks = tokenize(phrase);
    if (!toks.length) return;
    const ex = this.data.learned.find((l) => jaccard(l.tokens, toks) > 0.85);
    if (ex) {
      ex.intent = intent;
      ex.slots = slots;
      ex.at = Date.now();
    } else this.data.learned.push({ phrase: truncate(phrase, 160), tokens: toks, intent, slots, at: Date.now(), hits: 0 });
    this.data.learned = this.data.learned.slice(-300);
    this.save();
  },
  matchLearned(text) {
    const toks = tokenize(text);
    if (toks.length < 1) return null;
    let best = null, bestS = 0;
    for (const l of this.data.learned) {
      const s = jaccard(l.tokens, toks);
      if (s > bestS) {
        best = l;
        bestS = s;
      }
    }
    if (best && (bestS >= 0.8 || (bestS >= 0.66 && toks.length >= 3))) {
      best.hits++;
      return { ...best, score: bestS };
    }
    return null;
  },
  learnSynonym(word, activityId) {
    const w = norm(word).trim();
    if (!w || w.length < 3 || !ACT_BY_ID[activityId]) return;
    this.data.synonyms[w] = activityId;
    this.save();
  },
  feedback(value, intent, text) {
    if (value > 0) this.data.feedback.up++;
    else this.data.feedback.down++;
    const b = (this.data.feedback.byIntent[intent] = this.data.feedback.byIntent[intent] || { up: 0, down: 0 });
    if (value > 0) b.up++;
    else b.down++;
    if (value < 0 && text) {
      this.data.negatives.push({ tokens: tokenize(text), intent, at: Date.now() });
      this.data.negatives = this.data.negatives.slice(-200);
    }
    this.save();
  },
  isNegative(text, intent) {
    const toks = tokenize(text);
    return this.data.negatives.some((n) => n.intent === intent && jaccard(n.tokens, toks) > 0.8);
  },
  clear() {
    const keepName = this.data.profile.name;
    this.data = defaultMemory();
    this.data.profile.name = keepName;
    this.save();
  },
  export() {
    return JSON.stringify({ tipo: 'ops360-memoria', versao: 1, exportadoEm: new Date().toISOString(), memoria: this.data }, null, 2);
  },
  import(json) {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    if (!o || !o.memoria) throw new Error('Arquivo de memória inválido');
    this.data = { ...defaultMemory(), ...o.memoria };
    this.save();
  },
};
