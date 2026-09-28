// ---------------------------------------------------------------------------
// 25 · Dock inteligente do Slack
//      O botão flutuante original continua existindo (e funcionando), mas fica
//      invisível; no lugar dele entra uma "aba magnética" compacta presa à
//      borda da tela que: desliza ao passar o mouse, pode ser arrastada ao
//      longo da borda (ou trocada de lado), desvia sozinha do campo de digitação
//      e dos botões da IA, recolhe para uma faixa de 7px enquanto você digita
//      ou usa tela cheia, espelha o contador de notificações e abre com
//      Alt+Shift+S.
// ---------------------------------------------------------------------------
const SLACK_SVG = '<svg viewBox="0 0 54 54" aria-hidden="true"><g fill="#fff"><path d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.387h14.336a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386"/><path d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.387h5.376a5.381 5.381 0 0 0 5.376-5.387m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387"/><path d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.387H34.048a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386"/><path d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.387H5.376A5.381 5.381 0 0 0 0 34.25m14.336-.001v14.364A5.381 5.381 0 0 0 19.712 54a5.381 5.381 0 0 0 5.376-5.387V34.25a5.381 5.381 0 0 0-5.376-5.387 5.381 5.381 0 0 0-5.376 5.387"/></g></svg>';

const dock = {
  el: null, orig: null, target: null, side: 'right', y: null, userY: null, timer: null, mo: null, badgeMo: null, hover: false, dragging: false,
  available() {
    return !!(this.target && this.target.isConnected);
  },
  find() {
    if (CFG.slackSelector) {
      const el = document.querySelector(CFG.slackSelector);
      return el ? { orig: el, target: el } : null;
    }
    const cands = document.querySelectorAll('button,a,[role=button],[id*="slack" i],[class*="slack" i],[aria-label*="slack" i],[title*="slack" i]');
    for (const el of cands) {
      if (el.closest('#ops360-ia-v3,#ops360-ia-v3-overlay') || el.hasAttribute('data-o3-tab')) continue;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const lbl = `${el.getAttribute('aria-label') || ''} ${el.title || ''} ${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
      const isSlack = /^slack(\s*\d+)?$/i.test(txt) || /slack/i.test(lbl) || (el.tagName === 'A' && /slack\.com/i.test(el.getAttribute('href') || ''));
      if (!isSlack || txt.length > 40) continue;
      let n = el, fixed = null;
      for (let k = 0; k < 5 && n && n !== document.body; k++, n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') {
          fixed = n;
          break;
        }
      }
      if (!fixed) continue;
      const clickable = el.matches('button,a,[role=button]') ? el : el.querySelector('button,a,[role=button]') || el;
      return { orig: fixed.querySelectorAll('button,a,[role=button]').length <= 2 ? fixed : el, target: clickable };
    }
    return null;
  },
  init(force = false) {
    if (!force && (kv.get('dock.enabled', CFG.slackDock) === false || CFG.slackDock === false)) return;
    if (this.el) return;
    const f = this.find();
    if (!f) {
      // o botão pode aparecer depois (app carregando): observa o DOM
      if (!this.mo) {
        this.mo = new MutationObserver(throttle(() => {
          if (this.el) return;
          const g = this.find();
          if (g) {
            this.mo.disconnect();
            this.mo = null;
            this.adopt(g);
          }
        }, 600));
        this.mo.observe(document.body, { childList: true, subtree: true });
      }
      return;
    }
    this.adopt(f);
  },
  adopt({ orig, target }) {
    this.orig = orig;
    this.target = target;
    this._origStyle = orig.getAttribute('style') || '';
    orig.style.setProperty('visibility', 'hidden', 'important');
    orig.style.setProperty('pointer-events', 'none', 'important');
    orig.setAttribute('aria-hidden', 'true');
    orig.setAttribute('data-o3-docked', '1');
    this.side = kv.get('dock.side', 'right');
    this.userY = kv.get('dock.y', null);
    const badge = h('span', { class: 'o3-db', 'aria-hidden': 'true' });
    const el = h('button', { class: 'o3-dock o3-peek', type: 'button', 'aria-label': 'Abrir Slack (Alt+Shift+S)', title: 'Slack — arraste para mover · clique para abrir · botão direito para opções' });
    el.innerHTML = SLACK_SVG;
    el.append(h('span', { class: 'o3-dl', text: 'Slack' }), badge);
    this.badge = badge;
    this.el = el;
    ui.layer.appendChild(el);
    el.classList.toggle('o3-left', this.side === 'left');
    setTimeout(() => el.classList.remove('o3-peek'), 1600); // mostra o rótulo na primeira vez e recolhe
    this.wire();
    this.place(this.userY != null ? this.userY : Math.round(innerHeight * 0.72));
    this.timer = setInterval(() => this.tick(), 450);
    addEventListener('resize', (this._rs = throttle(() => this.tick(true), 120)));
    addEventListener('scroll', (this._sc = throttle(() => this.tick(true), 120)), true);
    document.addEventListener('keydown', (this._kd = (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        this.openSlack();
      }
    }));
    this.badgeMo = new MutationObserver(() => this.syncBadge());
    this.badgeMo.observe(orig, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-count', 'data-badge', 'aria-label'] });
    this.syncBadge();
    log('dock do Slack ativo');
  },
  wire() {
    const el = this.el;
    let startY = 0, startX = 0, y0 = 0, moved = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      startY = e.clientY;
      startX = e.clientX;
      y0 = this.y;
      moved = false;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientY - startY) + Math.abs(ev.clientX - startX) < 6) return;
        moved = true;
        this.dragging = true;
        el.classList.add('o3-drag');
        this.place(y0 + ev.clientY - startY, true);
        const left = ev.clientX < innerWidth / 2;
        if ((left ? 'left' : 'right') !== this.side) {
          this.side = left ? 'left' : 'right';
          el.classList.toggle('o3-left', left);
        }
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.classList.remove('o3-drag');
        if (moved) {
          this.userY = this.y;
          kv.set('dock.y', this.y);
          kv.set('dock.side', this.side);
          setTimeout(() => (this.dragging = false), 50);
        }
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    el.addEventListener('click', (e) => {
      if (this.dragging || moved) {
        e.preventDefault();
        return;
      }
      this.openSlack();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.place(this.y + (e.key === 'ArrowUp' ? -24 : 24), true);
        this.userY = this.y;
        kv.set('dock.y', this.y);
      }
    });
    el.addEventListener('pointerenter', () => (this.hover = true));
    el.addEventListener('pointerleave', () => (this.hover = false));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, [
        { icon: '💬', label: 'Abrir Slack', run: () => this.openSlack() },
        { icon: '↔️', label: `Mover para a ${this.side === 'right' ? 'esquerda' : 'direita'}`, run: () => {
          this.side = this.side === 'right' ? 'left' : 'right';
          el.classList.toggle('o3-left', this.side === 'left');
          kv.set('dock.side', this.side);
        } },
        { icon: '⏸️', label: 'Esconder por 1 hora', run: () => {
          el.style.display = 'none';
          setTimeout(() => (el.style.display = ''), 3600000);
          toast('Slack escondido por 1 hora (Alt+Shift+S ainda abre).');
        } },
        { icon: '↩️', label: 'Voltar ao botão original', run: () => {
          kv.set('dock.enabled', false);
          this.destroy();
          toast('Botão original do Slack restaurado. Reative em ⚙ Configurações.');
        } },
      ]);
    });
  },
  place(y, user = false) {
    const min = 70, max = innerHeight - 70;
    this.y = Math.round(clamp(y, min, max));
    this.el.style.setProperty('--dock-y', this.y - 23 + 'px');
  },
  openSlack() {
    if (!this.available()) return toast('Botão do Slack não encontrado nesta página.');
    const t = this.target;
    const prev = this.orig.style.getPropertyValue('pointer-events');
    this.orig.style.setProperty('pointer-events', 'auto', 'important');
    try {
      t.click();
    } finally {
      setTimeout(() => this.orig && this.orig.style.setProperty('pointer-events', prev || 'none', 'important'), 0);
    }
  },
  protectedRects() {
    const rects = [];
    const add = (el, pad = 10) => {
      if (!el || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) rects.push({ l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad });
    };
    if (ui.els.comp) add(ui.els.comp, 14);
    if (ui.els.tray) add(ui.els.tray);
    if (ui.panel) ui.panel.querySelectorAll('.o3-head-r button,.o3-chatbar button').forEach((b) => add(b, 6));
    if (ws.el) ws.el.querySelectorAll('.o3-ws-ask,.o3-ws-acts button,.o3-ws-reply.o3-show').forEach((b) => add(b, 8));
    ui.layer.querySelectorAll('.o3-modal,.o3-toast,.o3-menu').forEach((b) => add(b, 6));
    document.querySelectorAll('[data-o3-protect]').forEach((b) => b.id !== 'ops360-ia-v3' && add(b, 8));
    const ae = document.activeElement;
    if (ae && ae !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) add(ae, 12);
    return rects;
  },
  hits(y, rects) {
    const w = 52;
    const box = this.side === 'right' ? { l: innerWidth - w, r: innerWidth, t: y - 30, b: y + 30 } : { l: 0, r: w, t: y - 30, b: y + 30 };
    return rects.some((r) => !(r.r < box.l || r.l > box.r || r.b < box.t || r.t > box.b));
  },
  tick(immediate) {
    if (!this.el || this.dragging) return;
    if (!this.available()) {
      // o app removeu o botão: some com o dock e volta a procurar
      this.destroy(false);
      this.init();
      return;
    }
    const focused = ui.root && ui.els.ta && (ui.root.activeElement === ui.els.ta || (ui.ov && ui.ov.activeElement === ui.els.ta));
    const typing = focused && (ui.els.ta.value.length > 0 || Date.now() - (ui.lastKey || 0) < 4000);
    const focusMode = typing || ui.size === 'fullscreen' || !!ws.el;
    const rects = this.protectedRects();
    const want = this.userY != null ? this.userY : Math.round(innerHeight * 0.72);
    let y = want, found = !this.hits(want, rects);
    if (!found) {
      for (let d = 24; d < innerHeight; d += 24) {
        if (want - d > 70 && !this.hits(want - d, rects)) {
          y = want - d;
          found = true;
          break;
        }
        if (want + d < innerHeight - 70 && !this.hits(want + d, rects)) {
          y = want + d;
          found = true;
          break;
        }
      }
    }
    if (y !== this.y) this.place(y);
    this.el.classList.toggle('o3-tuck', !this.hover && (focusMode || !found));
  },
  syncBadge() {
    if (!this.orig || !this.badge) return;
    const txt = (this.orig.textContent || '').replace(/slack/gi, '');
    const attr = this.orig.getAttribute('data-count') || this.orig.getAttribute('data-badge') || '';
    const n = (attr.match(/\d+/) || txt.match(/\d+/) || [])[0];
    this.badge.textContent = n ? (+n > 99 ? '99+' : n) : '';
    this.badge.classList.toggle('o3-show', !!n && +n > 0);
    if (this.el) this.el.setAttribute('aria-label', `Abrir Slack${n && +n > 0 ? ` (${n} novas)` : ''} (Alt+Shift+S)`);
  },
  destroy(restore = true) {
    clearInterval(this.timer);
    if (this._rs) removeEventListener('resize', this._rs);
    if (this._sc) removeEventListener('scroll', this._sc, true);
    if (this._kd) document.removeEventListener('keydown', this._kd);
    if (this.badgeMo) this.badgeMo.disconnect();
    if (this.el) this.el.remove();
    if (this.orig && restore) {
      this.orig.setAttribute('style', this._origStyle || '');
      this.orig.removeAttribute('aria-hidden');
      this.orig.removeAttribute('data-o3-docked');
    }
    this.el = this.orig = this.target = null;
  },
};
