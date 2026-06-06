/**
 * analytics.js — Canvas-based chart rendering engine
 * PI Retrospective App — SAFe 6.0
 * Zero runtime dependencies.
 */

'use strict';

const ChartRenderer = {

  // ─── Internal helpers ────────────────────────────────────────────
  _dpr: () => Math.min(window.devicePixelRatio || 1, 2),

  _setup(canvasId, w, h) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const dpr = ChartRenderer._dpr();
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  },

  /** Polyfill-safe rounded rectangle path */
  _rr(ctx, x, y, w, h, r) {
    const minR = Math.min(Array.isArray(r) ? r[0] : r, w / 2, h / 2);
    ctx.moveTo(x + minR, y);
    ctx.lineTo(x + w - minR, y);
    ctx.arcTo(x + w, y,     x + w, y + h, minR);
    ctx.lineTo(x + w, y + h - minR);
    ctx.arcTo(x + w, y + h, x,     y + h, minR);
    ctx.lineTo(x + minR, y + h);
    ctx.arcTo(x,     y + h, x,     y,     minR);
    ctx.lineTo(x, y + minR);
    ctx.arcTo(x,     y,     x + w, y,     minR);
    ctx.closePath();
  },

  _noData(ctx, w, h, msg = 'No data yet') {
    ctx.fillStyle = '#97A0AF';
    ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, w / 2, h / 2);
  },

  // ─── Donut Chart ────────────────────────────────────────────────
  /**
   * @param {string} canvasId
   * @param {Array}  segments  [{label, value, color}]
   * @param {Object} opts      {size, centerText, centerLabel}
   */
  drawDonut(canvasId, segments, opts = {}) {
    const size = opts.size || 200;
    const s = this._setup(canvasId, size, size);
    if (!s) return;
    const { ctx, w, h } = s;
    const cx = w / 2, cy = h / 2;
    const outerR = w * 0.41;
    const innerR = w * 0.26;
    const total = segments.reduce((a, seg) => a + (seg.value || 0), 0);

    if (total === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = '#EBECF0';
      ctx.lineWidth = outerR - innerR;
      ctx.stroke();
      this._noData(ctx, w, h);
      return;
    }

    let angle = -Math.PI / 2;
    for (const seg of segments) {
      if (!seg.value) continue;
      const sweep = (seg.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, angle, angle + sweep);
      ctx.arc(cx, cy, innerR, angle + sweep, angle, true);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      angle += sweep;
    }

    if (opts.centerText !== undefined) {
      const fz = Math.round(w * 0.13);
      ctx.fillStyle = '#172B4D';
      ctx.font = `bold ${fz}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(opts.centerText), cx, cy - (opts.centerLabel ? 10 : 0));
      if (opts.centerLabel) {
        ctx.font = `${Math.round(w * 0.07)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.fillStyle = '#5E6C84';
        ctx.fillText(opts.centerLabel, cx, cy + 14);
      }
    }
  },

  // ─── Horizontal Bar Chart ───────────────────────────────────────
  /**
   * @param {string} canvasId
   * @param {Array}  bars      [{label, value, color}]
   * @param {Object} opts      {width, barHeight, gap, labelWidth}
   */
  drawHBar(canvasId, bars, opts = {}) {
    if (!bars.length) return;
    const barH   = opts.barHeight  || 32;
    const gap    = opts.gap        || 12;
    const lw     = opts.labelWidth || 120;
    const width  = opts.width      || 500;
    const height = 20 + bars.length * (barH + gap);
    const s = this._setup(canvasId, width, height);
    if (!s) return;
    const { ctx, w } = s;
    const maxV = Math.max(...bars.map(b => b.value), 1);
    const barAreaW = w - lw - 48;

    bars.forEach((bar, i) => {
      const y = 10 + i * (barH + gap);

      // Label
      ctx.fillStyle = '#5E6C84';
      ctx.font = `500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const lbl = bar.label.length > 14 ? bar.label.slice(0, 13) + '…' : bar.label;
      ctx.fillText(lbl, lw - 8, y + barH / 2);

      // Track
      ctx.fillStyle = '#EBECF0';
      ctx.beginPath();
      this._rr(ctx, lw, y, barAreaW, barH, 5);
      ctx.fill();

      // Bar fill
      const fw = maxV > 0 ? Math.max((bar.value / maxV) * barAreaW, bar.value > 0 ? 6 : 0) : 0;
      if (fw > 0) {
        ctx.fillStyle = bar.color || '#0052CC';
        ctx.beginPath();
        this._rr(ctx, lw, y, fw, barH, 5);
        ctx.fill();
      }

      // Value
      ctx.fillStyle = bar.value > 0 ? '#172B4D' : '#97A0AF';
      ctx.font = `bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(bar.value, lw + fw + 6, y + barH / 2);
    });
  },

  // ─── Grouped Bar Chart ──────────────────────────────────────────
  /**
   * @param {string} canvasId
   * @param {Array}  groups       [{label, values:[v0,v1,v2]}]
   * @param {Array}  seriesColors ['#hex', ...]
   * @param {Array}  seriesLabels ['label', ...]
   * @param {Object} opts         {width, height}
   */
  drawGroupedBar(canvasId, groups, seriesColors, seriesLabels, opts = {}) {
    if (!groups.length) return;
    const w  = opts.width  || 560;
    const h  = opts.height || 260;
    const s = this._setup(canvasId, w, h);
    if (!s) return;
    const { ctx } = s;

    const pad = { top: 24, right: 20, bottom: 58, left: 36 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top  - pad.bottom;
    const maxV = Math.max(...groups.flatMap(g => g.values), 1);
    const gw   = cw / groups.length;
    const ns   = seriesColors.length;
    const bw   = Math.max((gw - 12) / ns, 4);

    // Y-axis grid lines
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + ch - (ch * i / 4);
      ctx.strokeStyle = '#EBECF0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + cw, y);
      ctx.stroke();
      if (i > 0) {
        ctx.fillStyle = '#97A0AF';
        ctx.font = `10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(maxV * i / 4), pad.left - 4, y);
      }
    }

    // Bars + X labels
    groups.forEach((g, gi) => {
      const gx = pad.left + gi * gw;
      g.values.forEach((v, si) => {
        const bx = gx + 6 + si * bw;
        const bh = maxV > 0 ? (v / maxV) * ch : 0;
        const by = pad.top + ch - bh;
        if (bh > 0) {
          ctx.fillStyle = seriesColors[si];
          ctx.beginPath();
          this._rr(ctx, bx, by, bw - 2, bh, [3, 3, 0, 0]);
          ctx.fill();
        }
      });
      ctx.fillStyle = '#5E6C84';
      ctx.font = `11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const lbl = g.label.length > 8 ? g.label.slice(0, 7) + '…' : g.label;
      ctx.fillText(lbl, gx + gw / 2, pad.top + ch + 7);
    });

    // Legend
    if (seriesLabels) {
      let lx = pad.left;
      const ly = pad.top + ch + 30;
      seriesLabels.forEach((lbl, i) => {
        ctx.fillStyle = seriesColors[i];
        ctx.fillRect(lx, ly + 1, 12, 12);
        ctx.fillStyle = '#5E6C84';
        ctx.font = `11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(lbl, lx + 16, ly);
        lx += 16 + ctx.measureText(lbl).width + 18;
      });
    }
  },

  // ─── Line Chart (Historical Trend) ─────────────────────────────
  /**
   * @param {string} canvasId
   * @param {Array}  series    [{label, color, data:[...numbers]}]
   * @param {Array}  xLabels   ['PI 1', 'PI 2', ...]
   * @param {Object} opts      {width, height}
   */
  drawLine(canvasId, series, xLabels, opts = {}) {
    if (!series.length || !xLabels.length) return;
    const w  = opts.width  || 820;
    const h  = opts.height || 220;
    const s = this._setup(canvasId, w, h);
    if (!s) return;
    const { ctx } = s;

    const pad = { top: 20, right: 24, bottom: 52, left: 42 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top  - pad.bottom;
    const n  = xLabels.length;
    const maxV = Math.max(...series.flatMap(sr => sr.data), 1);

    const px = i => pad.left + (n <= 1 ? cw / 2 : (i / (n - 1)) * cw);
    const py = v => pad.top + ch - (v / maxV) * ch;

    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + ch - (ch * i / 4);
      ctx.strokeStyle = '#EBECF0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y);
      ctx.stroke();
      ctx.fillStyle = '#97A0AF';
      ctx.font = `10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(maxV * i / 4), pad.left - 5, y);
    }

    // X-axis labels
    xLabels.forEach((lbl, i) => {
      ctx.fillStyle = '#5E6C84';
      ctx.font = `10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const sl = lbl.length > 10 ? lbl.slice(0, 9) + '…' : lbl;
      ctx.fillText(sl, px(i), pad.top + ch + 6);
    });

    // Series: area → line → dots
    for (const sr of series) {
      if (!sr.data.length) continue;

      // Area fill
      if (n > 1) {
        ctx.beginPath();
        sr.data.forEach((v, i) => i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)));
        ctx.lineTo(px(n - 1), pad.top + ch);
        ctx.lineTo(px(0), pad.top + ch);
        ctx.closePath();
        ctx.fillStyle = sr.color + '1A';
        ctx.fill();
      }

      // Line
      if (n > 1) {
        ctx.beginPath();
        sr.data.forEach((v, i) => i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)));
        ctx.strokeStyle = sr.color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap  = 'round';
        ctx.stroke();
      }

      // Dots + values
      sr.data.forEach((v, i) => {
        ctx.beginPath();
        ctx.arc(px(i), py(v), 5, 0, Math.PI * 2);
        ctx.fillStyle = sr.color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = sr.color;
        ctx.font = `bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(v, px(i), py(v) - 8);
      });
    }

    // Legend
    let lx = pad.left;
    const ly = pad.top + ch + 34;
    series.forEach(sr => {
      ctx.fillStyle = sr.color;
      ctx.fillRect(lx, ly + 5, 18, 3);
      ctx.beginPath();
      ctx.arc(lx + 9, py(0) + ch + ly - (pad.top + ch) + 6.5, 4, 0, Math.PI * 2);
      // simpler: just draw the dot
      ctx.beginPath();
      ctx.arc(lx + 9, ly + 6, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5E6C84';
      ctx.font = `11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(sr.label, lx + 22, ly + 6);
      lx += 22 + ctx.measureText(sr.label).width + 20;
    });
  }
};
