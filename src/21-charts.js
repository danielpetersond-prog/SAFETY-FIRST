// ---------------------------------------------------------------------------
// 21 · Gráficos SVG (sem bibliotecas) — paleta categórica validada para
//      daltonismo (claro/escuro), barras finas com ponta arredondada, linhas
//      de 2px, rosca com total, legenda, rótulos seletivos, tooltip e crosshair.
// ---------------------------------------------------------------------------
const VIZ = {
  light: { series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'], surface: '#ffffff', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7' },
  dark: { series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'], surface: '#141b2b', ink: '#ffffff', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835' },
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
  statusIcon: { good: '✅', warning: '⏳', serious: '⚠️', critical: '⛔' },
};
function niceScale(max, ticks = 4, integer = false) {
  if (!(max > 0)) return integer ? { max: 1, step: 1, ticks: [0, 1] } : { max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  if (integer && max <= ticks) return { max: Math.ceil(max), step: 1, ticks: Array.from({ length: Math.ceil(max) + 1 }, (_, i) => i) };
  const raw = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(+v.toFixed(10));
  return { max: top, step, ticks: out };
}
const measure = (s, px = 11) => String(s).length * px * 0.56;
function chartTooltip(host) {
  let tip = host.querySelector(':scope > .o3-tip');
  if (!tip) {
    tip = h('div', { class: 'o3-tip', role: 'tooltip' });
    host.appendChild(tip);
  }
  return {
    show(x, y, title, rows) {
      tip.textContent = '';
      if (title) tip.appendChild(h('div', { class: 'o3-tip-t', text: title }));
      for (const r of rows) {
        const row = h('div', { class: 'o3-tip-r' });
        row.appendChild(h('span', { class: 'o3-tip-k', style: { background: r.color, height: r.line ? '2px' : '8px' } }));
        row.appendChild(h('b', { text: r.value }));
        if (r.label) row.appendChild(h('span', { class: 'o3-tip-l', text: r.label }));
        tip.appendChild(row);
      }
      tip.style.display = 'block';
      const hw = host.clientWidth, tw = tip.offsetWidth;
      tip.style.left = clamp(x + 12, 4, Math.max(4, hw - tw - 4)) + 'px';
      tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
    },
    hide() {
      tip.style.display = 'none';
    },
  };
}
// data: { labels, series:[{name, values}], status? } · opts: { kind, theme, unit, height, pct }
function renderChart(host, data, opts = {}) {
  const th = VIZ[opts.theme === 'dark' ? 'dark' : 'light'];
  host.classList.add('o3-chart');
  host.querySelectorAll(':scope > svg, :scope > .o3-legend, :scope > .o3-empty').forEach((n) => n.remove());
  const tip = chartTooltip(host);
  tip.hide();
  const labels = (data.labels || []).map((l) => String(l));
  const series = (data.series || []).filter((s) => s && s.values && s.values.length);
  const unit = opts.unit ? ' ' + opts.unit : opts.pct ? '%' : '';
  const fmtV = (v) => (v == null || isNaN(v) ? '—' : fmtNum(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : 0) + unit);
  if (!labels.length || !series.length || series.every((s) => s.values.every((v) => !v))) {
    host.appendChild(h('div', { class: 'o3-empty', text: data.placeholder ? 'Sem dados ainda — registre informações para ver o gráfico.' : 'Sem dados para exibir ainda.' }));
    return;
  }
  let kind = opts.kind || 'bar';
  if (kind === 'pie') kind = 'donut';
  if (kind === 'bar' && labels.length > 8 && labels.some((l) => l.length > 10)) kind = 'hbar';
  const W = Math.max(220, host.clientWidth || 360);
  const colorOf = (i) => (data.status ? VIZ.status[data.status[i]] || th.series[i % 8] : th.series[i % 8]);
  const sColor = (k) => th.series[k % 8];
  const legendItems = [];
  const svg = svgEl('svg', { width: W, role: 'img', 'aria-label': `${opts.title || 'Gráfico'}: ${labels.length} categorias` });
  const add = (tag, a) => {
    const e = svgEl(tag, a);
    svg.appendChild(e);
    return e;
  };
  const txt = (x, y, s, a = {}) => {
    const e = add('text', { x, y, fill: a.fill || th.muted, 'font-size': a.size || 10.5, 'text-anchor': a.anchor || 'start', 'font-weight': a.weight || 400, 'dominant-baseline': a.base || 'auto' });
    e.textContent = s;
    return e;
  };
  if (kind === 'donut') {
    let items = labels.map((l, i) => ({ label: l, value: series[0].values[i] || 0, color: colorOf(i), status: data.status && data.status[i] })).filter((x) => x.value > 0);
    if (!data.status && items.length > 6) {
      items.sort((a, b) => b.value - a.value);
      const rest = items.slice(5);
      items = items.slice(0, 5).concat([{ label: 'Outros', value: rest.reduce((a, b) => a + b.value, 0), color: th.muted }]);
      items.forEach((it, i) => i < 5 && (it.color = sColor(i)));
    }
    const total = items.reduce((a, b) => a + b.value, 0);
    const Hh = opts.height || 200;
    const narrow = W < 380;
    const size = Math.min(Hh, narrow ? W : W * 0.5);
    const R = size / 2 - 6, r = R * 0.62, cx = narrow ? W / 2 : size / 2 + 4, cy = size / 2;
    svg.setAttribute('height', size);
    let a0 = -Math.PI / 2;
    items.forEach((it) => {
      const a1 = a0 + (it.value / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
      const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
      const d = items.length === 1 ? `M ${cx - R} ${cy} A ${R} ${R} 0 1 1 ${cx + R} ${cy} A ${R} ${R} 0 1 1 ${cx - R} ${cy} M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy}` : `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
      const seg = add('path', { d, fill: it.color, stroke: th.surface, 'stroke-width': 2, 'fill-rule': 'evenodd', tabindex: 0, class: 'o3-mark' });
      const pct = ((it.value / total) * 100).toFixed(0);
      const show = (e) => {
        const bb = host.getBoundingClientRect();
        tip.show((e.clientX || bb.left + cx) - bb.left, (e.clientY || bb.top + cy) - bb.top, it.label, [{ color: it.color, value: `${fmtV(it.value)} (${pct}%)` }]);
      };
      seg.addEventListener('pointermove', show);
      seg.addEventListener('focus', show);
      seg.addEventListener('pointerleave', () => tip.hide());
      seg.addEventListener('blur', () => tip.hide());
      legendItems.push({ color: it.color, label: it.label, value: `${fmtV(it.value)} · ${pct}%`, icon: it.status ? VIZ.statusIcon[it.status] : null });
      a0 = a1;
    });
    txt(cx, cy - 2, fmtCompact(total), { fill: th.ink, size: Math.max(16, R * 0.34), anchor: 'middle', weight: 600, base: 'middle' });
    txt(cx, cy + R * 0.26, 'total', { anchor: 'middle', size: 10.5 });
    host.insertBefore(svg, host.firstChild);
    const lg = h('div', { class: 'o3-legend' + (narrow ? '' : ' o3-legend-side'), style: narrow ? {} : { left: size + 18 + 'px' } });
    legendItems.forEach((li) => lg.appendChild(h('div', { class: 'o3-lg' }, h('span', { class: 'o3-sw', style: { background: li.color } }), li.icon ? h('span', { class: 'o3-lg-ic', text: li.icon }) : null, h('span', { class: 'o3-lg-l', text: li.label }), h('b', { text: li.value }))));
    host.appendChild(lg);
    if (!narrow) host.style.minHeight = size + 'px';
    return;
  }
  host.style.minHeight = '';
  const maxV = Math.max(0, ...(kind === 'stacked' ? labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0)) : series.flatMap((s) => s.values.filter((v) => !isNaN(v)))));
  const allInt = series.every((s) => s.values.every((v) => v == null || isNaN(v) || Number.isInteger(v)));
  const sc = niceScale(maxV, 4, allInt);
  const tickW = Math.max(...sc.ticks.map((t) => measure(fmtCompact(t), 10.5))) + 8;
  if (kind === 'hbar') {
    const n = labels.length;
    const lblW = Math.min(W * 0.4, Math.max(...labels.map((l) => measure(truncate(l, 28), 11))) + 10);
    const rowH = series.length > 1 ? 14 * series.length + 12 : 26;
    const top = 6, bottom = 20;
    const Hh = top + n * rowH + bottom;
    svg.setAttribute('height', Hh);
    const x0 = lblW, x1 = W - 44;
    const xs = (v) => x0 + (v / sc.max) * (x1 - x0);
    sc.ticks.forEach((t) => {
      add('line', { x1: xs(t), x2: xs(t), y1: top, y2: Hh - bottom, stroke: th.grid, 'stroke-width': 1 });
      txt(xs(t), Hh - 5, fmtCompact(t), { anchor: 'middle' });
    });
    add('line', { x1: x0, x2: x0, y1: top, y2: Hh - bottom, stroke: th.axis, 'stroke-width': 1 });
    labels.forEach((l, i) => {
      const y = top + i * rowH;
      txt(x0 - 8, y + rowH / 2, truncate(l, 28), { anchor: 'end', base: 'middle', fill: th.ink2, size: 11 });
      const bh = Math.min(16, (rowH - 8 - (series.length - 1) * 2) / series.length);
      series.forEach((s, k) => {
        const v = s.values[i] || 0;
        const by = y + (rowH - (bh * series.length + (series.length - 1) * 2)) / 2 + k * (bh + 2);
        const w = Math.max(0, xs(v) - x0);
        const rr = Math.min(4, w);
        add('path', { d: `M ${x0} ${by} H ${x0 + w - rr} Q ${x0 + w} ${by} ${x0 + w} ${by + rr} V ${by + bh - rr} Q ${x0 + w} ${by + bh} ${x0 + w - rr} ${by + bh} H ${x0} Z`, fill: data.status ? colorOf(i) : sColor(k), class: 'o3-mark' });
        if (series.length === 1) txt(x0 + w + 6, by + bh / 2, fmtV(v), { base: 'middle', fill: th.ink2, size: 10.5 });
      });
      const hit = add('rect', { x: 0, y, width: W, height: rowH, fill: 'transparent', tabindex: 0 });
      const show = (e) => {
        const bb = host.getBoundingClientRect();
        tip.show((e.clientX || bb.left + x1) - bb.left, y + 4, l, series.map((s, k) => ({ color: sColor(k), value: fmtV(s.values[i]), label: series.length > 1 ? s.name : '' })));
      };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('pointerleave', () => tip.hide());
      hit.addEventListener('blur', () => tip.hide());
    });
  } else {
    const Hh = opts.height || 210;
    const top = 12, bottom = 26, left = tickW, right = kind === 'line' || kind === 'area' ? 44 : 10;
    svg.setAttribute('height', Hh);
    const n = labels.length;
    const pw = W - left - right, ph = Hh - top - bottom;
    const ys = (v) => top + ph - (v / sc.max) * ph;
    sc.ticks.forEach((t) => {
      add('line', { x1: left, x2: W - right, y1: ys(t), y2: ys(t), stroke: t === 0 ? th.axis : th.grid, 'stroke-width': 1 });
      txt(left - 6, ys(t), fmtCompact(t), { anchor: 'end', base: 'middle' });
    });
    const band = pw / n;
    const every = Math.ceil((n * 46) / pw);
    labels.forEach((l, i) => {
      if (i % every === 0) txt(left + band * i + band / 2, Hh - 8, truncate(l, Math.max(4, Math.floor(band * every / 6.5))), { anchor: 'middle' });
    });
    if (kind === 'line' || kind === 'area') {
      const xs = (i) => left + band * i + band / 2;
      series.forEach((s, k) => {
        const pts = s.values.map((v, i) => [xs(i), ys(v || 0)]);
        const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        if (kind === 'area' || series.length === 1) add('path', { d: `${d} L ${pts[pts.length - 1][0]} ${ys(0)} L ${pts[0][0]} ${ys(0)} Z`, fill: sColor(k), opacity: 0.1 });
        add('path', { d, fill: 'none', stroke: sColor(k), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
        const last = pts[pts.length - 1];
        add('circle', { cx: last[0], cy: last[1], r: 4, fill: sColor(k), stroke: th.surface, 'stroke-width': 2 });
        if (series.length <= 4) txt(last[0] + 7, last[1], fmtV(s.values[s.values.length - 1]), { base: 'middle', fill: th.ink2, size: 10.5 });
      });
      const cross = add('line', { y1: top, y2: top + ph, stroke: th.axis, 'stroke-width': 1, opacity: 0 });
      const dots = series.map((s, k) => add('circle', { r: 4, fill: sColor(k), stroke: th.surface, 'stroke-width': 2, opacity: 0 }));
      const hit = add('rect', { x: left, y: top, width: pw, height: ph, fill: 'transparent', tabindex: 0 });
      let fi = n - 1;
      const at = (i) => {
        i = clamp(i, 0, n - 1);
        fi = i;
        cross.setAttribute('x1', xs(i));
        cross.setAttribute('x2', xs(i));
        cross.setAttribute('opacity', 1);
        dots.forEach((d, k) => {
          d.setAttribute('cx', xs(i));
          d.setAttribute('cy', ys(series[k].values[i] || 0));
          d.setAttribute('opacity', 1);
        });
        tip.show(xs(i), Math.min(...series.map((s) => ys(s.values[i] || 0))), labels[i], series.map((s, k) => ({ color: sColor(k), line: true, value: fmtV(s.values[i]), label: series.length > 1 ? s.name : '' })));
      };
      hit.addEventListener('pointermove', (e) => {
        const bb = svg.getBoundingClientRect();
        at(Math.round((e.clientX - bb.left - left - band / 2) / band));
      });
      hit.addEventListener('focus', () => at(fi));
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') at(fi - 1);
        if (e.key === 'ArrowRight') at(fi + 1);
      });
      const off = () => {
        cross.setAttribute('opacity', 0);
        dots.forEach((d) => d.setAttribute('opacity', 0));
        tip.hide();
      };
      hit.addEventListener('pointerleave', off);
      hit.addEventListener('blur', off);
    } else {
      const s = series.length;
      const stacked = kind === 'stacked';
      const groupW = band * 0.72;
      const bw = stacked ? Math.min(24, groupW) : Math.min(24, (groupW - (s - 1) * 2) / s);
      const labelAll = s === 1 && n <= 12;
      labels.forEach((l, i) => {
        const gx = left + band * i + (band - (stacked ? bw : bw * s + (s - 1) * 2)) / 2;
        let acc = 0;
        series.forEach((ser, k) => {
          const v = ser.values[i] || 0;
          const x = stacked ? gx : gx + k * (bw + 2);
          const yTop = ys(acc + v), yBase = ys(acc);
          const hgt = Math.max(0, yBase - yTop - (stacked && k > 0 ? 2 : 0));
          const rr = !stacked || k === s - 1 ? Math.min(4, hgt, bw / 2) : 0;
          if (hgt > 0) add('path', { d: `M ${x} ${yTop + hgt} V ${yTop + rr} Q ${x} ${yTop} ${x + rr} ${yTop} H ${x + bw - rr} Q ${x + bw} ${yTop} ${x + bw} ${yTop + rr} V ${yTop + hgt} Z`, fill: data.status ? colorOf(i) : sColor(k), class: 'o3-mark' });
          if (labelAll) txt(x + bw / 2, yTop - 5, fmtV(v), { anchor: 'middle', fill: th.ink2, size: 10.5 });
          if (stacked) acc += v;
        });
        const hit = add('rect', { x: left + band * i, y: top, width: band, height: ph, fill: 'transparent', tabindex: 0 });
        const show = () => tip.show(left + band * i + band / 2, top + 10, l, series.map((ser, k) => ({ color: data.status ? colorOf(i) : sColor(k), value: fmtV(ser.values[i]), label: s > 1 ? ser.name : '' })));
        hit.addEventListener('pointermove', show);
        hit.addEventListener('focus', show);
        hit.addEventListener('pointerleave', () => tip.hide());
        hit.addEventListener('blur', () => tip.hide());
      });
    }
  }
  host.insertBefore(svg, host.firstChild);
  if (series.length > 1) {
    const lg = h('div', { class: 'o3-legend' });
    series.forEach((ser, k) => lg.appendChild(h('div', { class: 'o3-lg' }, h('span', { class: 'o3-sw' + (kind === 'line' ? ' o3-sw-line' : ''), style: { background: sColor(k) } }), h('span', { class: 'o3-lg-l', text: ser.name }))));
    host.appendChild(lg);
  } else if (data.status) {
    const lg = h('div', { class: 'o3-legend' });
    labels.forEach((l, i) => lg.appendChild(h('div', { class: 'o3-lg' }, h('span', { class: 'o3-sw', style: { background: colorOf(i) } }), h('span', { class: 'o3-lg-ic', text: VIZ.statusIcon[data.status[i]] || '' }), h('span', { class: 'o3-lg-l', text: l }))));
    host.appendChild(lg);
  }
}
function sparkline(values, theme = 'light', w = 96, hgt = 26) {
  const th = VIZ[theme === 'dark' ? 'dark' : 'light'];
  const vals = values.filter((v) => !isNaN(v));
  const svg = svgEl('svg', { width: w, height: hgt, 'aria-hidden': 'true' });
  if (vals.length < 2) return svg;
  const mx = Math.max(...vals), mn = Math.min(...vals);
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * (w - 6) + 3, hgt - 4 - ((v - mn) / (mx - mn || 1)) * (hgt - 8)]);
  svg.appendChild(svgEl('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '), fill: 'none', stroke: th.muted, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
  const l = pts[pts.length - 1];
  svg.appendChild(svgEl('circle', { cx: l[0], cy: l[1], r: 3, fill: th.series[0] }));
  return svg;
}
