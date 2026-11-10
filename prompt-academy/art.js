/* art.js — Prompt Academy v2 "Catch the Prompt" visual kit (Moonwick Apps).
 *
 * Pure Canvas 2D drawing: no game state, no timers, no DOM besides offscreen
 * canvases used as sprite caches. Everything is drawn in CSS pixels; the engine
 * scales the context for DPR (sprites read the current transform so they stay crisp).
 *
 * Coordinate conventions (see API notes at the bottom of this file):
 *   drawWick        (x, y) = bottom-centre of the candle (where it stands)
 *   drawBlock       (x, y) = top-left of the tile (w, h from measureBlock)
 *   drawPowerup     (x, y) = centre of the orb
 *   drawSocket / drawRequestCard / drawPromptBar   (x, y) = top-left
 *   drawBubble      (x, y) = top-left of the bubble box (tail hangs below it)
 */
(function () {
  'use strict';

  /* ───────────────────────── basics ───────────────────────── */
  var FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  function font(weight, px, style) { return (style ? style + ' ' : '') + weight + ' ' + px + 'px ' + FONT_STACK; }
  var TAU = Math.PI * 2;
  var NAVY = '#15142b';
  var INK = '#f3f2ff';
  var GOLD = '#F2C94C';
  var ACCENT = '#8B88F5';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hexRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  var _mixMemo = new Map();
  function mix(a, b, t) {
    var k = a + b + t;
    var v = _mixMemo.get(k);
    if (v) return v;
    var A = hexRgb(a), B = hexRgb(b);
    v = '#' + A.map(function (x, i) { return Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0'); }).join('');
    _mixMemo.set(k, v);
    return v;
  }
  var _rgbaMemo = new Map();
  function rgba(h, a) {
    a = Math.round(a * 1000) / 1000;
    var k = h + a;
    var v = _rgbaMemo.get(k);
    if (v) return v;
    var c = hexRgb(h);
    v = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    if (_rgbaMemo.size > 2000) _rgbaMemo.clear();
    _rgbaMemo.set(k, v);
    return v;
  }
  function hashStr(s) {
    s = String(s);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  /* Device scale of the current transform, bucketed so sprite caches stay small. */
  function rawScale(ctx) {
    try { var m = ctx.getTransform(); return Math.hypot(m.a, m.b) || 1; } catch (e) { return 1; }
  }
  function scaleOf(ctx) {
    var s = rawScale(ctx);
    return s <= 1.01 ? 1 : s <= 1.51 ? 1.5 : s <= 2.01 ? 2 : 3;
  }
  function cssWidth(ctx) { return ctx.canvas.width / rawScale(ctx); }

  function LRU(n) { this.n = n; this.m = new Map(); }
  LRU.prototype.get = function (k) {
    var v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); }
    return v;
  };
  LRU.prototype.set = function (k, v) {
    this.m.set(k, v);
    if (this.m.size > this.n) this.m.delete(this.m.keys().next().value);
  };

  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* Measuring context, so we never disturb the engine's ctx state. */
  var MC = makeCanvas(8, 8).getContext('2d');
  function measure(text, f) { MC.font = f; return MC.measureText(text).width; }
  function wrap(text, maxW, f, maxLines) {
    MC.font = f;
    var out = [];
    var paras = String(text == null ? '' : text).split('\n');
    for (var p = 0; p < paras.length; p++) {
      var words = paras[p].split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var test = line ? line + ' ' + words[i] : words[i];
        if (!line || MC.measureText(test).width <= maxW) line = test;
        else { out.push(line); line = words[i]; }
      }
      out.push(line);
    }
    if (maxLines && out.length > maxLines) {
      out.length = maxLines;
      var last = out[maxLines - 1];
      while (last.length > 1 && MC.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      out[maxLines - 1] = last.replace(/\s+$/, '') + '…';
    }
    return out;
  }
  function ellipsize(text, maxW, f) {
    MC.font = f;
    if (MC.measureText(text).width <= maxW) return text;
    var s = text;
    while (s.length > 1 && MC.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  /* Soft radial glow sprite per colour (drawn with 'lighter'). */
  var glowCache = new Map();
  function glowSprite(color) {
    var c = glowCache.get(color);
    if (c) return c;
    c = makeCanvas(128, 128);
    var g = c.getContext('2d');
    var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(color, 0.9));
    gr.addColorStop(0.25, rgba(color, 0.45));
    gr.addColorStop(0.6, rgba(color, 0.12));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    glowCache.set(color, c);
    return c;
  }
  function drawGlow(ctx, color, cx, cy, rx, ry, alpha) {
    if (alpha <= 0.003) return;
    var pa = ctx.globalAlpha, pc = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pa * alpha;
    ctx.drawImage(glowSprite(color), cx - rx, cy - (ry || rx), rx * 2, (ry || rx) * 2);
    ctx.globalAlpha = pa;
    ctx.globalCompositeOperation = pc;
  }

  /* ───────────────────────── vector glyphs (24×24 grid) ───────────────────────── */
  var GLYPHS = {};
  function glyph(name, fill, stroke) {
    GLYPHS[name] = { f: fill ? new Path2D(fill) : null, s: stroke ? new Path2D(stroke) : null };
  }
  function circ(cx, cy, r) { return 'M' + (cx + r) + ' ' + cy + 'a' + r + ' ' + r + ' 0 1 1 ' + (-2 * r) + ' 0a' + r + ' ' + r + ' 0 1 1 ' + (2 * r) + ' 0Z'; }

  // ROLE — theatre mask (face with eye + smile holes)
  glyph('role',
    'M3.6 4.6c3.6 1.7 13.2 1.7 16.8 0 .8 7.4-1.4 15-8.4 16C5 19.6 2.8 12 3.6 4.6Z' +
    'M6.6 10.6c1-1.5 3.7-1.5 4.7 0-1 1.2-3.7 1.2-4.7 0Z' +
    'M12.7 10.6c1-1.5 3.7-1.5 4.7 0-1 1.2-3.7 1.2-4.7 0Z' +
    'M8.6 14.2c2.1 1.8 4.7 1.8 6.8 0-.6 2.6-6.2 2.6-6.8 0Z');
  // TASK — target
  glyph('task', circ(12, 12, 1.9), circ(12, 12, 8.4) + circ(12, 12, 4.6));
  // CONTEXT — map pin
  glyph('context',
    'M12 2.2c-4.3 0-7.5 3.2-7.5 7.4 0 5.4 7.5 12.4 7.5 12.4s7.5-7 7.5-12.4c0-4.2-3.2-7.4-7.5-7.4Z' + circ(12, 9.6, 2.8));
  // FORMAT — bulleted list
  glyph('format', circ(5, 6, 1.9) + circ(5, 12, 1.9) + circ(5, 18, 1.9), 'M10 6h10.5M10 12h10.5M10 18h7');
  // LIMITS — bounded range
  glyph('constraints', null, 'M3.8 4.5v15M20.2 4.5v15M7.6 12h8.8M10.6 8.8 7.4 12l3.2 3.2M13.4 8.8l3.2 3.2-3.2 3.2');
  // EXAMPLE — quote marks
  glyph('example',
    'M3.6 12.2c0-3.9 2.1-6.6 5.4-7.7l1 1.9c-2 .9-3.1 2.3-3.4 4.1h3.6v7.1H3.6Z' +
    'M13.4 12.2c0-3.9 2.1-6.6 5.4-7.7l1 1.9c-2 .9-3.1 2.3-3.4 4.1h3.6v7.1h-6.6Z');
  // STEPS — staircase with arrow
  glyph('steps', null, 'M3 20.5h5v-5h5v-5h5v-5h3M15.5 3.5h5v5');
  // misc
  glyph('junk', circ(12, 18.7, 1.5), 'M8.4 8.6a3.7 3.7 0 1 1 5.3 3.4c-1.2.5-1.7 1.4-1.7 2.6v.6');
  glyph('check', null, 'M5.2 12.6l4.3 4.3 9.3-9.6');
  glyph('bulb', 'M12 2.6a6.4 6.4 0 0 0-3.9 11.5c.8.6 1.2 1.4 1.2 2.4h5.4c0-1 .4-1.8 1.2-2.4A6.4 6.4 0 0 0 12 2.6Z', 'M9.6 19.2h4.8M10.4 21.8h3.2');
  glyph('drop', 'M12 2.4c3.7 5 6.5 8.8 6.5 12a6.5 6.5 0 0 1-13 0c0-3.2 2.8-7 6.5-12Z');
  glyph('hourglass', 'M8 4.6h8c0 3.5-2.3 5.4-3.7 7.4 1.4 2 3.7 3.9 3.7 7.4H8c0-3.5 2.3-5.4 3.7-7.4C10.3 10 8 8.1 8 4.6Z', 'M6.2 3.4h11.6M6.2 20.6h11.6');
  glyph('flame', 'M12 2c3.5 4.2 6.4 7.5 6.4 11.8a6.4 6.4 0 0 1-12.8 0c0-2.6 1.1-4.6 2.8-6.5.2 1.8 1 2.9 2.2 3.5-.4-3.4.2-6.1 1.4-8.8Z');
  glyph('star', (function () {
    var d = '';
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4.6 : 10.4;
      d += (i ? 'L' : 'M') + (12 + Math.cos(a) * r).toFixed(2) + ' ' + (12.6 + Math.sin(a) * r).toFixed(2);
    }
    return d + 'Z';
  })());
  glyph('sparkle', 'M12 1.5C12.9 8 16 11.1 22.5 12 16 12.9 12.9 16 12 22.5 11.1 16 8 12.9 1.5 12 8 11.1 11.1 8 12 1.5Z');
  glyph('x', null, 'M6.5 6.5l11 11M17.5 6.5l-11 11');

  function drawIcon(ctx, name, cx, cy, size, color, lw) {
    var g = GLYPHS[name] || GLYPHS.junk;
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    var k = size / 24;
    ctx.scale(k, k);
    if (g.f) { ctx.fillStyle = color; ctx.fill(g.f, 'evenodd'); }
    if (g.s) {
      ctx.strokeStyle = color; ctx.lineWidth = lw || 2.4;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.stroke(g.s);
    }
    ctx.restore();
  }

  /* ───────────────────────── block types ───────────────────────── */
  var DEFAULT_META = {
    role: { label: 'Role', color: '#B07CF2' },
    task: { label: 'Task', color: '#8B88F5' },
    context: { label: 'Context', color: '#4FC3B8' },
    format: { label: 'Format', color: '#F2B84B' },
    constraints: { label: 'Limits', color: '#F27BA5' },
    example: { label: 'Example', color: '#7BD389' },
    steps: { label: 'Steps', color: '#6CB4F5' }
  };
  var TYPES = {};
  (function () {
    var meta = window.SLOT_META || {};
    Object.keys(DEFAULT_META).forEach(function (k) {
      var m = meta[k] || DEFAULT_META[k];
      var color = m.color || DEFAULT_META[k].color;
      TYPES[k] = {
        key: k,
        label: m.label || DEFAULT_META[k].label,
        color: color,
        glyph: k,                                   // name for Art.drawIcon
        icon: GLYPHS[k].f || GLYPHS[k].s,           // Path2D on a 24×24 grid
        light: mix(color, '#ffffff', 0.35),
        top: mix(color, '#1b1946', 0.18),
        bottom: mix(color, '#1b1946', 0.5),
        lip: mix(color, '#100f24', 0.68)
      };
    });
  })();
  function typeOf(k) { return TYPES[k] || TYPES.task; }

  /* ───────────────────────── blocks ───────────────────────── */
  var BLOCK = { minW: 150, maxW: 190, h1: 46, h2: 64, r: 15, chip: 30, padL: 8, gap: 9, padR: 12, lip: 4 };
  var TEXT_X = BLOCK.padL + BLOCK.chip + BLOCK.gap;
  var layoutCache = new LRU(300);
  function blockLayout(text, forcedW) {
    var key = text + '|' + (forcedW || 0);
    var L = layoutCache.get(key);
    if (L) return L;
    var maxW = forcedW || BLOCK.maxW;
    var avail = maxW - TEXT_X - BLOCK.padR;
    var sizes = [15, 14, 13], i, f, lines, w;
    L = null;
    for (i = 0; i < sizes.length && !L; i++) {         // one line, as big as possible
      f = font(800, sizes[i]);
      if (sizes[i] === 15 || i === 0) {
        w = measure(text, f);
        if (w <= avail) L = { lines: [text], px: sizes[i], f: f, tw: w };
      }
    }
    for (i = 0; i < sizes.length && !L; i++) {         // two lines
      f = font(800, sizes[i]);
      lines = wrap(text, avail, f);
      if (lines.length <= 2) {
        var mw = 0;
        lines.forEach(function (l) { mw = Math.max(mw, measure(l, f)); });
        if (mw <= avail + 0.5) L = { lines: lines, px: sizes[i], f: f, tw: mw };
      }
    }
    if (!L) {
      f = font(800, 13);
      lines = wrap(text, avail, f, 2);
      L = { lines: lines, px: 13, f: f, tw: avail };
    }
    L.w = forcedW || Math.round(clamp(L.tw + TEXT_X + BLOCK.padR, BLOCK.minW, BLOCK.maxW));
    L.h = L.lines.length > 1 ? BLOCK.h2 : BLOCK.h1;
    layoutCache.set(key, L);
    return L;
  }

  function measureBlock(ctx, text) {
    var L = blockLayout(String(text || ''));
    return { w: L.w, h: L.h };
  }

  var blockCache = new LRU(90);
  var BPAD = 14;

  function paintCandyBlock(g, w, h, T, L) {
    var face = h - BLOCK.lip, r = BLOCK.r;
    // base + drop shadow (one-time blur, baked into the sprite)
    g.save();
    g.shadowColor = 'rgba(6,5,22,.55)'; g.shadowBlur = 12; g.shadowOffsetY = 6;
    g.fillStyle = T.lip; rr(g, 0, 0, w, h, r); g.fill();
    g.restore();
    // face
    var gr = g.createLinearGradient(0, 0, 0, face);
    gr.addColorStop(0, T.top); gr.addColorStop(1, T.bottom);
    g.fillStyle = gr; rr(g, 0, 0, w, face, r); g.fill();
    // gloss
    g.save(); rr(g, 0, 0, w, face, r); g.clip();
    var gl = g.createLinearGradient(0, 0, 0, face * 0.55);
    gl.addColorStop(0, 'rgba(255,255,255,.30)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; rr(g, 2, 2, w - 4, face * 0.5, r - 2); g.fill();
    // inner bottom shade
    var sh = g.createLinearGradient(0, face * 0.6, 0, face);
    sh.addColorStop(0, 'rgba(10,8,40,0)'); sh.addColorStop(1, 'rgba(10,8,40,.22)');
    g.fillStyle = sh; g.fillRect(0, face * 0.6, w, face * 0.4);
    g.restore();
    // rim
    g.strokeStyle = rgba(T.light, 0.75); g.lineWidth = 1.5;
    rr(g, 0.75, 0.75, w - 1.5, face - 1.5, r - 0.75); g.stroke();
    // chip
    var cx = BLOCK.padL + BLOCK.chip / 2, cy = face / 2, cr = BLOCK.chip / 2;
    g.fillStyle = 'rgba(8,6,30,.28)';
    g.beginPath(); g.arc(cx, cy + 1.5, cr, 0, TAU); g.fill();
    var cg = g.createRadialGradient(cx - cr * 0.35, cy - cr * 0.45, 1, cx, cy, cr);
    cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.25, T.light); cg.addColorStop(1, T.color);
    g.fillStyle = cg;
    g.beginPath(); g.arc(cx, cy, cr, 0, TAU); g.fill();
    drawIcon(g, T.glyph, cx, cy, 18, NAVY, 2.6);
    // text
    drawBlockText(g, L, face, false);
  }

  function drawBlockText(g, L, face, junk) {
    var lh = Math.min(Math.round(L.px * 1.2), Math.floor((face - 4) / L.lines.length));
    var total = lh * L.lines.length;
    var y0 = face / 2 - total / 2 + lh / 2 + 0.5;
    g.font = junk ? font(700, L.px, 'italic') : L.f;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    for (var i = 0; i < L.lines.length; i++) {
      var y = y0 + i * lh;
      if (junk) {
        g.fillStyle = 'rgba(255,255,255,.28)';
        g.fillText(L.lines[i], TEXT_X + 1.8, y - 0.8);   // ghost: double vision = "vague"
        g.fillStyle = 'rgba(30,28,48,.35)';
        g.fillText(L.lines[i], TEXT_X, y + 1.2);
        g.fillStyle = '#ecebf4';
        g.fillText(L.lines[i], TEXT_X, y);
      } else {
        g.fillStyle = 'rgba(8,6,32,.45)';
        g.fillText(L.lines[i], TEXT_X, y + 1.4);
        g.fillStyle = '#ffffff';
        g.fillText(L.lines[i], TEXT_X, y);
      }
    }
  }

  function paintJunkBlock(g, w, h, L, seed) {
    var face = h - BLOCK.lip, r = BLOCK.r;
    var R = rng(seed);
    g.save();
    g.shadowColor = 'rgba(6,5,22,.45)'; g.shadowBlur = 14; g.shadowOffsetY = 5;
    g.fillStyle = '#4a475c'; rr(g, 0, 0, w, h, r); g.fill();
    g.restore();
    var gr = g.createLinearGradient(0, 0, w * 0.3, face);
    gr.addColorStop(0, '#a7a4b8'); gr.addColorStop(1, '#6e6b82');
    g.fillStyle = gr; rr(g, 0, 0, w, face, r); g.fill();
    // smudges + fog inside
    g.save(); rr(g, 0, 0, w, face, r); g.clip();
    for (var i = 0; i < 7; i++) {
      var x = R() * w, y = R() * face, rad = 10 + R() * 22;
      var dark = i % 3 !== 0;
      var sg = g.createRadialGradient(x, y, 0, x, y, rad);
      sg.addColorStop(0, dark ? 'rgba(52,48,72,.32)' : 'rgba(255,255,255,.30)');
      sg.addColorStop(1, dark ? 'rgba(52,48,72,0)' : 'rgba(255,255,255,0)');
      g.fillStyle = sg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // a thumb-print smear
    g.strokeStyle = 'rgba(60,56,80,.18)'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath();
    var sx = w * (0.45 + R() * 0.3), sy = face * 0.25;
    g.moveTo(sx, sy); g.bezierCurveTo(sx + 14, sy + 6, sx - 6, sy + 14, sx + 18, face * 0.85);
    g.stroke();
    g.restore();
    // dashed, faded border
    g.save();
    g.setLineDash([5, 4]);
    g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1.5;
    rr(g, 1, 1, w - 2, face - 2, r - 1); g.stroke();
    g.restore();
    // "?" chip
    var cx = BLOCK.padL + BLOCK.chip / 2, cy = face / 2, cr = BLOCK.chip / 2;
    g.fillStyle = 'rgba(40,38,58,.25)';
    g.beginPath(); g.arc(cx, cy + 1.5, cr, 0, TAU); g.fill();
    g.fillStyle = '#cfccdc';
    g.beginPath(); g.arc(cx, cy, cr, 0, TAU); g.fill();
    drawIcon(g, 'junk', cx, cy, 19, '#55526a', 2.6);
    drawBlockText(g, L, face, true);
  }

  function blockSprite(b, w, h, s) {
    var junk = b.kind === 'junk';
    var text = String(b.text || '');
    var key = (junk ? '~' : (b.type || 'task')) + '|' + text + '|' + w + '|' + h + '|' + s;
    var sp = blockCache.get(key);
    if (sp) return sp;
    var L = blockLayout(text, w === blockLayout(text).w ? 0 : w);
    if (L.lines.length > 1 && h < BLOCK.h2 - 4) {      // forced short tile: shrink to fit
      var f13 = font(800, 13);
      L = { lines: wrap(text, w - TEXT_X - BLOCK.padR, f13, 2), px: 13, f: f13 };
    }
    var c = makeCanvas((w + BPAD * 2) * s, (h + BPAD * 2) * s);
    var g = c.getContext('2d');
    g.scale(s, s); g.translate(BPAD, BPAD);
    if (junk) paintJunkBlock(g, w, h, L, hashStr(text));
    else paintCandyBlock(g, w, h, typeOf(b.type), L);
    sp = { c: c, s: s };
    blockCache.set(key, sp);
    return sp;
  }

  function drawBlock(ctx, x, y, w, h, b, t) {
    b = b || {};
    t = t || 0;
    var s = scaleOf(ctx);
    var sp = blockSprite(b, Math.round(w), Math.round(h), s);
    var junk = b.kind === 'junk';
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    var seed = 0;
    if (junk) {
      seed = (hashStr(b.text) % 1000) / 1000 * TAU;
      ctx.rotate(Math.sin(t * 2.7 + seed) * 0.065 + Math.sin(t * 5.3 + seed * 2) * 0.02);
      ctx.scale(1 + Math.sin(t * 3.9 + seed) * 0.03, 1 + Math.cos(t * 3.3 + seed) * 0.03);
    }
    var glow = b.glow || 0;
    if (glow > 0) {
      var col = junk ? '#c9c6dc' : typeOf(b.type).color;
      drawGlow(ctx, col, 0, 0, w / 2 + 34, h / 2 + 30, glow * 0.9);
    }
    ctx.drawImage(sp.c, -w / 2 - BPAD, -h / 2 - BPAD, w + BPAD * 2, h + BPAD * 2);
    if (junk) {
      // drifting fog wisps over the tile
      var pa = ctx.globalAlpha;
      for (var i = 0; i < 3; i++) {
        var ph = t * (0.35 + i * 0.12) + seed + i * 2.1;
        var fx = Math.sin(ph) * w * 0.42;
        var fy = Math.cos(ph * 1.3) * h * 0.3 - 2;
        ctx.globalAlpha = pa * (0.32 + 0.18 * Math.sin(ph * 2.3));
        ctx.drawImage(fogPuff(), fx - 30, fy - 16, 60, 32);
      }
      ctx.globalAlpha = pa;
    }
    ctx.restore();
  }

  var _fogPuff = null;
  function fogPuff() {
    if (_fogPuff) return _fogPuff;
    var c = makeCanvas(64, 64), g = c.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(235,233,250,.75)');
    gr.addColorStop(0.5, 'rgba(235,233,250,.25)');
    gr.addColorStop(1, 'rgba(235,233,250,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (_fogPuff = c);
  }

  /* ───────────────────────── Wick ───────────────────────── */
  // Local space = the v1 SVG viewBox (120×170) shifted so (0,0) is the candle's base centre.
  var W = {
    body: (function () { var p = new Path2D(); p.moveTo(-12, -106); p.lineTo(12, -106); p.arcTo(34, -106, 34, -84, 22); p.lineTo(34, -14); p.arcTo(34, 0, 20, 0, 14); p.lineTo(-20, 0); p.arcTo(-34, 0, -34, -14, 14); p.lineTo(-34, -84); p.arcTo(-34, -106, -12, -106, 22); p.closePath(); return p; })(),
    cap: new Path2D('M-34 -82Q-34 -106-12 -106H12Q34 -106 34 -82V-74Q30 -64 25 -73Q21 -82 15 -75Q11 -56 4 -73Q-1 -83-9 -73Q-15 -62-20 -75Q-26 -83-34 -72Z'),
    capEdge: new Path2D('M34 -74Q30 -64 25 -73Q21 -82 15 -75Q11 -56 4 -73Q-1 -83-9 -73Q-15 -62-20 -75Q-26 -83-34 -72'),
    shine: new Path2D('M-27 -66Q-29 -40-27 -16'),
    arm: (function () { var p = new Path2D(); p.moveTo(-4.5, 0); p.lineTo(4.5, 0); p.lineTo(4.5, 13); p.arc(0, 13, 4.5, 0, Math.PI); p.closePath(); return p; })()
  };
  var wickGrad = null;
  function wickGrads(ctx) {
    if (wickGrad) return wickGrad;
    var body = ctx.createLinearGradient(-34, 0, 34, 0);
    body.addColorStop(0, '#fffefa'); body.addColorStop(0.38, '#f6f4ff'); body.addColorStop(0.82, '#dedaf4'); body.addColorStop(1, '#c9c4e8');
    var bottom = ctx.createLinearGradient(0, -60, 0, 0);
    bottom.addColorStop(0, 'rgba(110,100,180,0)'); bottom.addColorStop(1, 'rgba(110,100,180,.20)');
    var cap = ctx.createLinearGradient(0, -106, 0, -60);
    cap.addColorStop(0, '#ffffff'); cap.addColorStop(1, '#fbf6ff');
    var warm = ctx.createRadialGradient(0, -110, 0, 0, -110, 60);
    warm.addColorStop(0, 'rgba(255,205,110,.45)'); warm.addColorStop(1, 'rgba(255,205,110,0)');
    var flame = ctx.createRadialGradient(0, -9, 0, 0, -12, 32);
    flame.addColorStop(0, '#fffdf2'); flame.addColorStop(0.22, '#fff0a6'); flame.addColorStop(0.5, '#F2C94C');
    flame.addColorStop(0.8, '#F28C38'); flame.addColorStop(1, '#e65a2e');
    var flameHurt = ctx.createRadialGradient(0, -9, 0, 0, -12, 32);
    flameHurt.addColorStop(0, '#f4f6ff'); flameHurt.addColorStop(0.3, '#c9d6ff'); flameHurt.addColorStop(0.65, '#8fa6f5'); flameHurt.addColorStop(1, '#6670d8');
    var arm = ctx.createLinearGradient(-5, 0, 5, 0);
    arm.addColorStop(0, '#ffffff'); arm.addColorStop(1, '#d9d5f1');
    wickGrad = { body: body, bottom: bottom, cap: cap, warm: warm, flame: flame, flameHurt: flameHurt, arm: arm };
    return wickGrad;
  }
  var FACE_INK = '#1d1b38';

  function flamePath(ctx, sway) {
    // base at (0,0), tip at (sway, -38)  — v1 SVG flame
    ctx.beginPath();
    ctx.moveTo(sway, -38);
    ctx.bezierCurveTo(11 + sway * 0.5, -23, 15 + sway * 0.15, -13, 7, -3);
    ctx.bezierCurveTo(3, 2, -3, 2, -7, -3);
    ctx.bezierCurveTo(-15 + sway * 0.15, -13, -9 + sway * 0.5, -25, sway, -38);
    ctx.closePath();
  }

  function drawWick(ctx, x, y, size, s) {
    s = s || {};
    var t = s.t || 0;
    var mood = s.mood || 'idle';
    var k = size / 170;
    var sq = clamp(s.squash || 0, -1, 1);
    var lean = clamp(s.lean || 0, -1, 1);
    var fl = s.flame == null ? 1 : clamp(s.flame, 0, 1);
    var G = wickGrads(ctx);

    var bob = 0, shake = 0, extraSq = 0, flameMul = 1, flameSpeed = 1, armA = 0.22, armWave = 0;
    var blinkP = (t + 0.7) % 4.3;
    switch (mood) {
      case 'happy':
        var hop = Math.abs(Math.sin(t * 6));
        bob = hop * 8; extraSq = (hop < 0.25 ? -0.18 : 0.06);
        flameMul = 1.18; flameSpeed = 1.6; armA = 2.5; armWave = Math.sin(t * 12) * 0.35;
        break;
      case 'hurt':
        shake = Math.sin(t * 58) * 2.6 * (0.5 + 0.5 * Math.cos(t * 3));
        extraSq = -0.14; flameMul = 0.6; flameSpeed = 3.2; armA = 1.3 + Math.sin(t * 30) * 0.5;
        break;
      case 'send':
        bob = 4 + Math.sin(t * 3.4) * 2.5; extraSq = 0.1 + Math.sin(t * 8) * 0.03;
        flameMul = 1.45; flameSpeed = 1.3; armA = 2.85; armWave = Math.sin(t * 7) * 0.12;
        break;
      case 'sad':
        bob = Math.sin(t * 1.3) * 0.8; extraSq = -0.09; flameMul = 0.55; flameSpeed = 0.55; armA = 0.08;
        break;
      default:
        bob = Math.sin(t * 2.3) * 2.2; armA = 0.24 + Math.sin(t * 2.3) * 0.05;
    }
    sq = clamp(sq + extraSq, -1, 1);
    var sy = 1 + sq * 0.2, sx = 1 - sq * 0.14;
    var fpow = (0.5 + 0.5 * fl) * flameMul;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);

    // ground: warm light pool + contact shadow
    drawGlow(ctx, '#F2A94C', 0, -2, 78 * fpow, 16, 0.32 * fpow);
    ctx.fillStyle = 'rgba(6,5,20,.45)';
    ctx.beginPath(); ctx.ellipse(lean * 4, 1, 34 * sx + Math.max(0, -bob) , 6.5, 0, 0, TAU); ctx.fill();

    ctx.translate(shake, 0);
    ctx.rotate(lean * 0.14);
    ctx.scale(sx, sy);
    ctx.translate(0, -bob);

    // flicker
    var sp = flameSpeed;
    var f1 = Math.sin(t * 9.1 * sp) * 0.5 + Math.sin(t * 13.7 * sp + 1.3) * 0.3 + Math.sin(t * 23.3 * sp + 0.7) * 0.2;
    var sway = Math.sin(t * 4.1 * sp) * 2.2 + Math.sin(t * 7.3 * sp + 2) * 1.1 - lean * 10 + (mood === 'hurt' ? Math.sin(t * 40) * 3 : 0);
    var fh = (1 + f1 * 0.08) * fpow, fw = (1 - f1 * 0.04) * Math.min(1.25, fpow * 1.02);
    var FB = -112; // flame base

    // big glow behind the head
    var hurtCol = mood === 'hurt';
    drawGlow(ctx, hurtCol ? '#8fa6f5' : GOLD, sway * 0.4, FB - 14 * fh, 74 * fpow * (1 + f1 * 0.05), 74 * fpow * (1 + f1 * 0.05), 0.55 + (mood === 'send' ? 0.3 : 0));

    if (mood === 'send') {
      // rotating light rays
      ctx.save();
      ctx.translate(sway * 0.4, FB - 16);
      ctx.rotate(t * 0.6);
      ctx.globalCompositeOperation = 'lighter';
      if (!G.rays) {
        G.rays = ctx.createRadialGradient(0, 0, 8, 0, 0, 100);
        G.rays.addColorStop(0, 'rgba(255,226,140,.38)'); G.rays.addColorStop(0.6, 'rgba(242,201,76,.12)'); G.rays.addColorStop(1, 'rgba(242,201,76,0)');
      }
      ctx.fillStyle = G.rays;
      ctx.beginPath();
      for (var i = 0; i < 12; i++) {
        var a0 = i * TAU / 12, wd = i % 2 ? 0.07 : 0.12;
        ctx.moveTo(0, 0); ctx.arc(0, 0, i % 2 ? 80 : 100, a0 - wd, a0 + wd); ctx.closePath();
      }
      ctx.fill();
      ctx.restore();
    }

    // arms (behind body)
    var armL = armA + armWave, armR = armA - armWave;
    ctx.fillStyle = G.arm;
    ctx.strokeStyle = 'rgba(70,60,140,.22)'; ctx.lineWidth = 1.5;
    ctx.save(); ctx.translate(-30, -50); ctx.rotate(armL); ctx.fill(W.arm); ctx.stroke(W.arm); ctx.restore();
    ctx.save(); ctx.translate(30, -50); ctx.rotate(-armR); ctx.fill(W.arm); ctx.stroke(W.arm); ctx.restore();

    // body
    ctx.fillStyle = G.body; ctx.fill(W.body);
    ctx.fillStyle = G.bottom; ctx.fill(W.body);
    ctx.fillStyle = G.cap; ctx.fill(W.cap);
    ctx.strokeStyle = 'rgba(150,140,210,.45)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.stroke(W.capEdge);
    ctx.fillStyle = G.warm; ctx.globalAlpha = Math.min(1, fpow); ctx.fill(W.body); ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 4; ctx.stroke(W.shine);
    ctx.strokeStyle = 'rgba(60,50,130,.18)'; ctx.lineWidth = 1.5; ctx.stroke(W.body);

    // face
    drawFace(ctx, mood, t, lean, blinkP);

    // wick string
    ctx.strokeStyle = '#2e2b5c'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -104); ctx.quadraticCurveTo(sway * 0.08, -109, sway * 0.12, FB - 1); ctx.stroke();

    // flame
    if (fl > 0.01) {
      ctx.save();
      ctx.translate(sway * 0.1, FB);
      ctx.scale(fw, fh);
      flamePath(ctx, sway);
      ctx.fillStyle = hurtCol ? G.flameHurt : G.flame;
      ctx.fill();
      // inner core
      ctx.save(); ctx.translate(0, -1); ctx.scale(0.48, 0.5);
      flamePath(ctx, sway * 0.6);
      ctx.fillStyle = 'rgba(255,255,248,.88)'; ctx.fill();
      ctx.restore();
      // blue root
      ctx.fillStyle = 'rgba(108,180,245,.55)';
      ctx.beginPath(); ctx.ellipse(0, -2, 3.6, 2.2, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // smoke when hurt / sad
    if (mood === 'hurt' || mood === 'sad') {
      for (var j = 0; j < 3; j++) {
        var p = ((t * (mood === 'hurt' ? 0.9 : 0.4)) + j / 3) % 1;
        var px = sway * 0.3 + Math.sin(p * 6 + j) * 6 * p;
        var py = FB - 30 * fh - p * 46;
        ctx.globalAlpha = (1 - p) * 0.35;
        ctx.fillStyle = '#b9b6cf';
        ctx.beginPath(); ctx.arc(px, py, 3 + p * 7, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function eyeOpen(ctx, ex, ey, rx, ry, lookX, lookY, sparkle) {
    ctx.fillStyle = FACE_INK;
    ctx.beginPath(); ctx.ellipse(ex + lookX, ey + lookY, rx, ry, 0, 0, TAU); ctx.fill();
    if (ry > 2) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(ex + lookX + rx * 0.35, ey + lookY - ry * 0.4, rx * 0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + lookX - rx * 0.3, ey + lookY + ry * 0.35, rx * 0.2, 0, TAU); ctx.fill();
      if (sparkle) {
        ctx.fillStyle = 'rgba(255,240,170,.95)';
        ctx.beginPath(); ctx.arc(ex + lookX - rx * 0.25, ey + lookY - ry * 0.05, rx * 0.22, 0, TAU); ctx.fill();
      }
    }
  }

  function drawFace(ctx, mood, t, lean, blinkP) {
    var lx = lean * 2.2;
    var cheekA = mood === 'happy' || mood === 'send' ? 0.55 : mood === 'sad' ? 0.18 : 0.36;
    ctx.fillStyle = 'rgba(242,123,165,' + cheekA + ')';
    ctx.beginPath(); ctx.ellipse(-22 + lx * 0.5, -44, 7, 5, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(22 + lx * 0.5, -44, 7, 5, 0, 0, TAU); ctx.fill();

    ctx.strokeStyle = FACE_INK; ctx.fillStyle = FACE_INK;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 3.6;

    switch (mood) {
      case 'happy':
        ctx.beginPath();
        ctx.moveTo(-20 + lx, -54); ctx.quadraticCurveTo(-13 + lx, -64, -6 + lx, -54);
        ctx.moveTo(6 + lx, -54); ctx.quadraticCurveTo(13 + lx, -64, 20 + lx, -54);
        ctx.stroke();
        mouthOpen(ctx, lx, -42, 11, 13);
        break;
      case 'send':
        eyeOpen(ctx, -13, -58, 6, 8.5, lx, -1.5, true);
        eyeOpen(ctx, 13, -58, 6, 8.5, lx, -1.5, true);
        mouthOpen(ctx, lx, -40, 8, 11);
        break;
      case 'hurt':
        ctx.beginPath();
        ctx.moveTo(-19, -62); ctx.lineTo(-9, -56.5); ctx.lineTo(-19, -51);
        ctx.moveTo(19, -62); ctx.lineTo(9, -56.5); ctx.lineTo(19, -51);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-10, -38);
        ctx.quadraticCurveTo(-7.5, -42, -5, -38); ctx.quadraticCurveTo(-2.5, -34, 0, -38);
        ctx.quadraticCurveTo(2.5, -42, 5, -38); ctx.quadraticCurveTo(7.5, -34, 10, -38);
        ctx.stroke();
        // sweat drop
        ctx.fillStyle = 'rgba(140,200,255,.9)';
        ctx.beginPath(); ctx.moveTo(28, -84); ctx.quadraticCurveTo(33, -76, 28, -73); ctx.quadraticCurveTo(23, -76, 28, -84); ctx.fill();
        break;
      case 'sad':
        eyeOpen(ctx, -13, -54, 5, 6, lx * 0.5, 2, false);
        eyeOpen(ctx, 13, -54, 5, 6, lx * 0.5, 2, false);
        // heavy lids
        ctx.fillStyle = '#efecfb';
        ctx.beginPath(); ctx.moveTo(-22, -66); ctx.lineTo(-4, -66); ctx.lineTo(-4, -59); ctx.lineTo(-22, -53); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(22, -66); ctx.lineTo(4, -66); ctx.lineTo(4, -59); ctx.lineTo(22, -53); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = FACE_INK; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(-20, -53.8); ctx.lineTo(-6, -58.6); ctx.moveTo(20, -53.8); ctx.lineTo(6, -58.6); ctx.stroke();
        // worried brows
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-20, -66); ctx.quadraticCurveTo(-13, -67, -7, -71); ctx.moveTo(20, -66); ctx.quadraticCurveTo(13, -67, 7, -71); ctx.stroke();
        ctx.lineWidth = 3.2;
        ctx.beginPath(); ctx.moveTo(-8, -35); ctx.quadraticCurveTo(0, -42, 8, -35); ctx.stroke();
        // tear
        var tp = (t * 0.45) % 1;
        ctx.fillStyle = 'rgba(140,200,255,' + (0.9 * (1 - tp)) + ')';
        ctx.beginPath(); ctx.ellipse(-17, -47 + tp * 22, 2.2, 3, 0, 0, TAU); ctx.fill();
        break;
      default: // idle
        var closed = blinkP < 0.13;
        if (closed) {
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(-18 + lx, -55); ctx.quadraticCurveTo(-13 + lx, -52, -8 + lx, -55);
          ctx.moveTo(8 + lx, -55); ctx.quadraticCurveTo(13 + lx, -52, 18 + lx, -55);
          ctx.stroke();
        } else {
          eyeOpen(ctx, -13, -56, 5.2, 7.2, lx, 0, false);
          eyeOpen(ctx, 13, -56, 5.2, 7.2, lx, 0, false);
        }
        ctx.lineWidth = 3.2;
        ctx.beginPath(); ctx.moveTo(-8 + lx, -39); ctx.quadraticCurveTo(lx, -33, 8 + lx, -39); ctx.stroke();
    }
  }

  function mouthOpen(ctx, lx, y, hw, h) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-hw + lx, y);
    ctx.quadraticCurveTo(lx, y + h * 1.25, hw + lx, y);
    ctx.quadraticCurveTo(lx, y + 1.5, -hw + lx, y);
    ctx.closePath();
    ctx.fillStyle = FACE_INK; ctx.fill();
    ctx.clip();
    ctx.fillStyle = '#F27BA5';
    ctx.beginPath(); ctx.ellipse(lx, y + h * 0.85, hw * 0.6, h * 0.35, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* ───────────────────────── background ───────────────────────── */
  var BG = { key: '', w: 0, h: 0 };
  /* Star layers are plain lists drawn as tiny rects, bucketed by alpha (few state changes,
   * no large transparent blits — cheap on both GPU and software rasterisers). */
  function starLayer(seed, n, w, h, rMin, rMax, aMin, aMax) {
    var R = rng(seed), buckets = [[], [], [], []];
    for (var i = 0; i < n; i++) {
      var a = R();
      buckets[Math.min(3, (a * 4) | 0)].push(R() * w, R() * h, rMin + R() * (rMax - rMin));
    }
    return { b: buckets, a: [aMin, aMin + (aMax - aMin) * 0.33, aMin + (aMax - aMin) * 0.66, aMax] };
  }
  function buildBG(ctx, w, h, s) {
    BG.key = w + 'x' + h + '@' + s; BG.w = w; BG.h = h;
    // Static layers (sky gradient, nebula, moon, hills) are baked once at device scale, so each
    // frame is a single 1:1 blit instead of full-screen gradient fills (big win on low-end devices).
    var base = makeCanvas(w * s, h * s), bg = base.getContext('2d');
    bg.scale(s, s);
    var sky = bg.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2e2b5c'); sky.addColorStop(0.42, '#1f1d40'); sky.addColorStop(1, '#121126');
    bg.fillStyle = sky; bg.fillRect(0, 0, w, h);
    var neb = bg.createRadialGradient(w * 0.2, h * 0.36, 0, w * 0.2, h * 0.36, Math.max(w, h) * 0.55);
    neb.addColorStop(0, 'rgba(74,68,198,.22)'); neb.addColorStop(1, 'rgba(74,68,198,0)');
    bg.fillStyle = neb; bg.fillRect(0, 0, w, h);
    BG.base = base;
    var area = w * h;
    BG.stars = [starLayer(11, Math.round(area / 1500), w, h, 0.5, 1.0, 0.25, 0.6), starLayer(29, Math.round(area / 6000), w, h, 1.0, 1.7, 0.55, 0.95)];
    // moon sprite
    var mr = clamp(Math.min(w, h) * 0.075, 22, 44);
    BG.mr = mr; BG.mx = w * 0.82; BG.my = Math.max(mr * 2.2, h * 0.36);
    var ms = mr * 4.2;
    var mc = makeCanvas(ms * 2 * s, ms * 2 * s), g = mc.getContext('2d');
    g.scale(s, s); g.translate(ms, ms);
    var halo = g.createRadialGradient(0, 0, mr * 0.8, 0, 0, ms);
    halo.addColorStop(0, 'rgba(220,218,255,.22)'); halo.addColorStop(0.35, 'rgba(180,176,255,.08)'); halo.addColorStop(1, 'rgba(180,176,255,0)');
    g.fillStyle = halo; g.fillRect(-ms, -ms, ms * 2, ms * 2);
    var disc = g.createRadialGradient(-mr * 0.35, -mr * 0.4, mr * 0.1, 0, 0, mr);
    disc.addColorStop(0, '#fffdf3'); disc.addColorStop(0.7, '#ece8f8'); disc.addColorStop(1, '#cfc9ee');
    g.fillStyle = disc; g.beginPath(); g.arc(0, 0, mr, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.arc(0, 0, mr, 0, TAU); g.clip();
    g.fillStyle = 'rgba(150,140,200,.22)';
    [[-0.3, 0.2, 0.22], [0.25, -0.25, 0.15], [0.35, 0.35, 0.12], [-0.05, -0.5, 0.08]].forEach(function (c) {
      g.beginPath(); g.arc(c[0] * mr, c[1] * mr, c[2] * mr, 0, TAU); g.fill();
    });
    var term = g.createRadialGradient(mr * 0.9, mr * 0.3, mr * 0.2, mr * 0.9, mr * 0.3, mr * 1.6);
    term.addColorStop(0, 'rgba(60,55,120,.40)'); term.addColorStop(0.55, 'rgba(60,55,120,.18)'); term.addColorStop(1, 'rgba(60,55,120,0)');
    g.fillStyle = term; g.fillRect(-mr, -mr, mr * 2, mr * 2);
    g.restore();
    BG.moon = mc; BG.ms = ms;
    // hills
    var R = rng(7);
    function hill(base, amp, n) {
      var p = new Path2D();
      p.moveTo(0, h);
      p.lineTo(0, h - base);
      var ph = R() * TAU;
      for (var x = 0; x <= w + 8; x += 8) {
        var yy = h - base - Math.sin(x / w * TAU * n + ph) * amp - Math.sin(x / w * TAU * n * 2.3 + ph * 2) * amp * 0.35;
        p.lineTo(x, yy);
      }
      p.lineTo(w, h); p.closePath();
      return p;
    }
    BG.hillBack = hill(Math.min(110, h * 0.13), Math.min(22, h * 0.03), 1.3);
    BG.hillFront = hill(Math.min(56, h * 0.065), Math.min(12, h * 0.016), 2.1);
    var hg = bg.createLinearGradient(0, h - h * 0.18, 0, h);
    hg.addColorStop(0, '#24214d'); hg.addColorStop(1, '#1a1838');
    BG.hillBackFill = hg;
    // fog band sprite (soft; low res is fine)
    if (!BG.fog) {
      var fc = makeCanvas(512, 120), fg = fc.getContext('2d');
      var RF = rng(3);
      for (var i = 0; i < 26; i++) {
        var fx = RF() * 512, fy = 40 + RF() * 40, fr = 30 + RF() * 50;
        for (var dx = -512; dx <= 512; dx += 512) {   // tileable
          var gr = fg.createRadialGradient(fx + dx, fy, 0, fx + dx, fy, fr);
          gr.addColorStop(0, 'rgba(200,196,255,.16)'); gr.addColorStop(1, 'rgba(200,196,255,0)');
          fg.fillStyle = gr; fg.fillRect(fx + dx - fr, fy - fr, fr * 2, fr * 2);
        }
      }
      fg.globalCompositeOperation = 'destination-in';
      var vm = fg.createLinearGradient(0, 0, 0, 120);
      vm.addColorStop(0, 'rgba(0,0,0,0)'); vm.addColorStop(0.35, 'rgba(0,0,0,1)'); vm.addColorStop(0.65, 'rgba(0,0,0,1)'); vm.addColorStop(1, 'rgba(0,0,0,0)');
      fg.fillStyle = vm; fg.fillRect(0, 0, 512, 120);
      BG.fog = fc;
    }
    bg.drawImage(BG.moon, BG.mx - BG.ms, BG.my - BG.ms, BG.ms * 2, BG.ms * 2);
    bg.fillStyle = BG.hillBackFill; bg.fill(BG.hillBack);
    bg.fillStyle = '#151330'; bg.fill(BG.hillFront);
    var Rt = rng(41);
    BG.twinkles = [];
    for (var j = 0; j < 9; j++) BG.twinkles.push({ x: Rt(), y: Rt() * 0.72, r: 3 + Rt() * 3.5, p: Rt() * TAU, sp: 0.6 + Rt() * 1.2 });
  }

  function drawBackground(ctx, w, h, t) {
    t = t || 0;
    var s = scaleOf(ctx);
    if (BG.key !== w + 'x' + h + '@' + s) buildBG(ctx, w, h, s);
    ctx.save();
    ctx.drawImage(BG.base, 0, 0, w, h);
    // parallax stars (drifting down slowly — Wick is "rising")
    ctx.fillStyle = '#ffffff';
    for (var L = 0; L < 2; L++) {
      var layer = BG.stars[L], oy = (t * (L ? 7 : 2.5)) % h;
      for (var k = 0; k < 4; k++) {
        var arr = layer.b[k];
        ctx.globalAlpha = layer.a[k];
        for (var q = 0; q < arr.length; q += 3) {
          var sy = arr[q + 1] + oy; if (sy > h) sy -= h;
          var d = arr[q + 2] * 1.6;
          ctx.fillRect(arr[q] - d / 2, sy - d / 2, d, d);
        }
      }
    }
    ctx.globalAlpha = 1;
    // twinkling sparkles
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < BG.twinkles.length; i++) {
      var tw = BG.twinkles[i];
      var a = Math.sin(t * tw.sp + tw.p); a = a * a;
      if (a < 0.05) continue;
      ctx.globalAlpha = a * 0.85;
      var r = tw.r * (0.6 + 0.4 * a);
      drawIcon(ctx, 'sparkle', tw.x * w, tw.y * h, r * 2, '#ffffff');
    }
    ctx.globalAlpha = 1;
    // fog layers
    var fw = Math.max(512, w);
    var fogY = [h * 0.5, h * 0.78];
    for (var f = 0; f < 2; f++) {
      var off = ((t * (f ? -9 : 6)) % fw + fw) % fw;
      ctx.globalAlpha = f ? 0.55 : 0.4;
      ctx.drawImage(BG.fog, off - fw, fogY[f] - 60, fw, 120);
      ctx.drawImage(BG.fog, off, fogY[f] - 60, fw, 120);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ───────────────────────── sockets & prompt bar ───────────────────────── */
  function drawSocket(ctx, x, y, w, h, type, filled, pop, t) {
    var T = typeOf(type);
    t = t || 0; pop = clamp(pop || 0, 0, 1);
    var r = Math.min(12, h / 2);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    var sc = filled ? 1 + Math.sin(pop * Math.PI) * 0.16 + pop * 0.04 : 1;
    ctx.scale(sc, sc);
    var x0 = -w / 2, y0 = -h / 2;
    var C = socketContent(w, h, T.label.toUpperCase());

    if (!filled) {
      var breathe = 0.5 + 0.5 * Math.sin(t * 3 + T.key.length);
      ctx.fillStyle = rgba(T.color, 0.08 + breathe * 0.06);
      rr(ctx, x0, y0, w, h, r); ctx.fill();
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -t * 6;
      ctx.strokeStyle = rgba(T.color, 0.55 + breathe * 0.3);
      ctx.lineWidth = 1.6;
      rr(ctx, x0 + 0.8, y0 + 0.8, w - 1.6, h - 1.6, r); ctx.stroke();
      ctx.setLineDash([]);
      drawSocketContent(ctx, C, T.glyph, rgba(T.color, 0.9), rgba(T.light, 0.95), 2.4);
    } else {
      if (pop > 0) drawGlow(ctx, T.color, 0, 0, w * 0.75 + 20, h * 0.9 + 16, pop * 0.9);
      ctx.fillStyle = T.lip; rr(ctx, x0, y0 + 2, w, h, r); ctx.fill();
      var gr = ctx.createLinearGradient(0, y0, 0, y0 + h);
      gr.addColorStop(0, T.light); gr.addColorStop(0.5, T.color); gr.addColorStop(1, mix(T.color, '#1b1946', 0.25));
      ctx.fillStyle = gr; rr(ctx, x0, y0, w, h, r); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.22)'; rr(ctx, x0 + 2, y0 + 2, w - 4, h * 0.42, r - 2); ctx.fill();
      drawSocketContent(ctx, C, T.glyph, NAVY, NAVY, 2.6);
      // check badge
      var bx = w / 2 - 3, by = -h / 2 + 3, br = 8.5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(bx, by, br + 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3fb15a';
      ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
      drawIcon(ctx, 'check', bx, by, 13, '#ffffff', 3.4);
      if (pop > 0) {   // burst ring
        ctx.strokeStyle = rgba(T.light, pop);
        ctx.lineWidth = 3 * pop;
        var grow = (1 - pop) * 14;
        rr(ctx, x0 - grow, y0 - grow, w + grow * 2, h + grow * 2, r + grow); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* Socket icon + type name. Wide sockets: icon and name side by side. Narrow sockets
   * (5–6 per bar, or a phone): name stacked under a smaller icon, shrunk to fit, so the
   * learner always sees the type name. Only a socket too small for 8.5 px text drops it. */
  var socketLayoutCache = new Map();
  function socketContent(w, h, label) {
    var key = label + '|' + Math.round(w) + '|' + Math.round(h);
    var C = socketLayoutCache.get(key);
    if (C) return C;
    var icon = Math.min(20, h * 0.5), lf = font(800, 11), lw = measure(label, lf);
    // decide by the longest type name, so every socket in a bar uses the same layout
    var widest = 0;
    Object.keys(TYPES).forEach(function (k) { widest = Math.max(widest, measure(TYPES[k].label.toUpperCase(), lf)); });
    if (icon + 6 + widest + 14 <= w) {
      C = { mode: 'row', icon: icon, f: lf, ix: -(icon + 6 + lw) / 2 + icon / 2, iy: 0, lx: 0, ly: 0.5 };
      C.lx = C.ix + icon / 2 + 6;
    } else {
      var px = 10.5;
      while (px > 8.5 && measure(label, font(800, px)) > w - 8) px -= 0.5;
      var f = font(800, px), fits = measure(label, f) <= w - 6 && h >= 30;
      if (fits) {
        var si = Math.min(17, h * 0.42), gap = 2, total = si + gap + px;
        C = { mode: 'stack', icon: si, f: f, ix: 0, iy: -total / 2 + si / 2, lx: 0, ly: total / 2 - px / 2 + 0.5 };
      } else C = { mode: 'icon', icon: icon, ix: 0, iy: 0 };
    }
    C.label = label;
    socketLayoutCache.set(key, C);
    return C;
  }
  function drawSocketContent(ctx, C, glyphName, iconColor, textColor, lw) {
    drawIcon(ctx, glyphName, C.ix, C.iy, C.icon, iconColor, lw);
    if (C.mode === 'icon') return;
    ctx.font = C.f; ctx.fillStyle = textColor; ctx.textBaseline = 'middle';
    ctx.textAlign = C.mode === 'row' ? 'left' : 'center';
    ctx.fillText(C.label, C.lx, C.ly);
  }

  /* Convenience: tray + evenly spaced sockets. Returns the socket rects (for particles). */
  function drawPromptBar(ctx, x, y, w, h, types, filled, pops, t) {
    filled = filled || {}; pops = pops || {};
    var pad = 6, gap = 6, n = types.length || 1;
    ctx.save();
    ctx.fillStyle = 'rgba(10,9,28,.55)';
    rr(ctx, x, y, w, h, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 15.5); ctx.stroke();
    ctx.restore();
    var sw = (w - pad * 2 - gap * (n - 1)) / n, rects = [];
    for (var i = 0; i < types.length; i++) {
      var sx = x + pad + i * (sw + gap);
      drawSocket(ctx, sx, y + pad, sw, h - pad * 2, types[i], !!filled[types[i]], pops[types[i]] || 0, t);
      rects.push({ type: types[i], x: sx, y: y + pad, w: sw, h: h - pad * 2, cx: sx + sw / 2, cy: y + h / 2 });
    }
    return rects;
  }

  /* ───────────────────────── request card ───────────────────────── */
  var AVATAR_COLORS = ['#8B88F5', '#4FC3B8', '#F27BA5', '#F2B84B', '#6CB4F5', '#B07CF2', '#7BD389'];
  /* Fits any height ≥ 52: picks padding / font size so `need` wraps into the space. */
  function reqLayout(w, h, need) {
    var big = h >= 74;
    var pad = h >= 66 ? 10 : 7;
    var av = h >= 66 ? 38 : 32;
    var whoPx = big ? 14 : 12.5, whoH = big ? 19 : 16;
    var tx = 12 + av + 11;
    var avail = w - tx - 12;
    var region = h - pad * 2 - whoH;
    var tries = big ? [16, 15, 14, 13] : [15, 14, 13];
    for (var i = 0; i < tries.length; i++) {
      var px = tries[i], lh = Math.round(px * 1.24);
      var maxL = Math.max(1, Math.floor((region + 1) / lh));
      var lines = wrap(need, avail, font(650, px));
      if (lines.length <= maxL) return { lines: lines, px: px, lh: lh, pad: pad, av: av, whoPx: whoPx, whoH: whoH, tx: tx, region: region };
    }
    var lh13 = 16, ml = Math.max(1, Math.floor((region + 1) / lh13));
    return { lines: wrap(need, avail, font(650, 13), ml), px: 13, lh: lh13, pad: pad, av: av, whoPx: whoPx, whoH: whoH, tx: tx, region: region };
  }
  /* Height that shows `need` comfortably at 15–16 px (optional helper). */
  function requestCardHeight(w, need) {
    var f = font(650, 15), lines = wrap(String(need || ''), w - 73, f).length;
    return Math.max(74, 10 * 2 + 19 + lines * 19 + 2);
  }
  var cardCache = new LRU(8);
  function drawRequestCard(ctx, x, y, w, h, who, need, t) {
    var s = scaleOf(ctx);
    w = Math.round(w); h = Math.round(h);
    who = String(who || ''); need = String(need || '');
    var key = who + '|' + need + '|' + w + '|' + h + '|' + s;
    var sp = cardCache.get(key), P = 16;
    if (!sp) {
      var L = reqLayout(w, h, need);
      var c = makeCanvas((w + P * 2) * s, (h + P * 2) * s), g = c.getContext('2d');
      g.scale(s, s); g.translate(P, P);
      var R = Math.min(18, h / 3);
      g.save();
      g.shadowColor = 'rgba(4,3,18,.55)'; g.shadowBlur = 16; g.shadowOffsetY = 6;
      var bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, 'rgba(50,47,102,.97)'); bg.addColorStop(1, 'rgba(30,28,64,.97)');
      g.fillStyle = bg; rr(g, 0, 0, w, h, R); g.fill();
      g.restore();
      g.save(); rr(g, 0, 0, w, h, R); g.clip();
      var sh = g.createLinearGradient(0, 0, 0, h * 0.5);
      sh.addColorStop(0, 'rgba(255,255,255,.08)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh; g.fillRect(0, 0, w, h * 0.5);
      g.globalAlpha = 0.06;
      drawIcon(g, 'example', w - 26, h / 2, Math.min(44, h * 0.7), '#ffffff');
      g.restore();
      var bd = g.createLinearGradient(0, 0, w, h);
      bd.addColorStop(0, 'rgba(139,136,245,.7)'); bd.addColorStop(0.5, 'rgba(139,136,245,.2)'); bd.addColorStop(1, 'rgba(242,201,76,.4)');
      g.strokeStyle = bd; g.lineWidth = 1.5; rr(g, 0.75, 0.75, w - 1.5, h - 1.5, R - 0.75); g.stroke();
      // avatar
      var ac = AVATAR_COLORS[hashStr(who) % AVATAR_COLORS.length];
      var ax = 12 + L.av / 2, ay = h / 2;
      var ag = g.createRadialGradient(ax - L.av * 0.18, ay - L.av * 0.22, 1, ax, ay, L.av / 2);
      ag.addColorStop(0, mix(ac, '#ffffff', 0.5)); ag.addColorStop(1, ac);
      g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.arc(ax, ay + 2, L.av / 2, 0, TAU); g.fill();
      g.fillStyle = ag; g.beginPath(); g.arc(ax, ay, L.av / 2, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.5; g.stroke();
      g.font = font(900, Math.round(L.av * 0.45)); g.fillStyle = NAVY; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText((who[0] || '?').toUpperCase(), ax, ay + 1);
      // text block, vertically centred
      var blockH = L.whoH + L.lines.length * L.lh;
      var ty = Math.round((h - blockH) / 2);
      g.textAlign = 'left'; g.textBaseline = 'middle';
      var wf = font(800, L.whoPx);
      // the name always wins: " needs help" is only added when it fits (narrow landscape card)
      var nameW = w - L.tx - 12, sf = font(600, L.whoPx - 1), suffix = ' needs help';
      var whoTxt = ellipsize(who, nameW, wf);
      var showSuffix = measure(whoTxt, wf) + measure(suffix, sf) <= nameW;
      g.font = wf; g.fillStyle = GOLD;
      g.fillText(whoTxt, L.tx, ty + L.whoH / 2 - 1);
      if (showSuffix) {
        g.font = sf; g.fillStyle = '#a9a7c8';
        g.fillText(suffix, L.tx + measure(whoTxt, wf), ty + L.whoH / 2 - 1);
      }
      g.font = font(650, L.px); g.fillStyle = INK;
      for (var i = 0; i < L.lines.length; i++) g.fillText(L.lines[i], L.tx, ty + L.whoH + L.lh * i + L.lh / 2);
      sp = { c: c };
      cardCache.set(key, sp);
    }
    ctx.drawImage(sp.c, x - P, y - P, w + P * 2, h + P * 2);
  }

  /* ───────────────────────── HUD ───────────────────────── */
  var HUD_H = 52;
  function drawFlameIcon(ctx, cx, cy, size, lit, t) {
    t = t || 0;
    if (lit) {
      var f = Math.sin(t * 9 + cx) * 0.5 + Math.sin(t * 14 + cx * 0.3) * 0.5;
      drawGlow(ctx, GOLD, cx, cy, size * 1.15, size * 1.15, 0.5);
      ctx.save();
      ctx.translate(cx, cy + size / 2);
      ctx.scale(1 - f * 0.03, 1 + f * 0.06);
      ctx.translate(-cx, -(cy + size / 2));
      var gr = ctx.createLinearGradient(0, 2, 0, 22);   // glyph space (drawIcon's 24-grid)
      gr.addColorStop(0, '#ffe58a'); gr.addColorStop(0.55, '#F2B84B'); gr.addColorStop(1, '#F2763A');
      drawIcon(ctx, 'flame', cx, cy, size, gr);
      ctx.globalAlpha *= 0.9;
      drawIcon(ctx, 'flame', cx, cy + size * 0.18, size * 0.48, '#fff8dc');
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha *= 0.45;
      ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(size / 24, size / 24);
      ctx.strokeStyle = '#a9a7c8'; ctx.lineWidth = 1.8; ctx.stroke(GLYPHS.flame.f);
      ctx.restore();
    }
  }

  var COMBO_COLORS = { 2: ['#5fd6cb', '#2b8f87'], 3: ['#c39bff', '#6d43c4'], 4: ['#ffe07a', '#F2763A'] };

  /* One row, `hud.height` (default 52) tall at `hud.top` (default 0).
   * Left `hud.left` px (default 56) are left free for the DOM exit button. */
  function drawHUD(ctx, w, h, hud, t) {
    hud = hud || {}; t = t || 0;
    var top = hud.top || 0, H = hud.height || HUD_H;
    var left = hud.left == null ? 56 : hud.left;
    var right = w - 10;
    var cy = top + H / 2;
    var compact = w < 360;
    ctx.save();
    ctx.textBaseline = 'middle';

    var slow = hud.slowmo === true ? 1 : clamp(+hud.slowmo || 0, 0, 1);
    if (slow > 0) drawSlowmo(ctx, w, h, slow, t);

    // soft scrim behind the bar (extends sideways past the playfield edges)
    if (!drawHUD.scr || drawHUD.scrH !== top + H) {
      var scr = ctx.createLinearGradient(0, 0, 0, top + H + 10);
      scr.addColorStop(0, 'rgba(10,9,26,.5)'); scr.addColorStop(1, 'rgba(10,9,26,0)');
      drawHUD.scr = scr; drawHUD.scrH = top + H;
    }
    ctx.fillStyle = drawHUD.scr; ctx.fillRect(-w, 0, w * 3, top + H + 10);

    // flames
    var maxF = hud.maxFlames || 3, fl = clamp(hud.flames == null ? maxF : hud.flames, 0, maxF);
    var fs = compact ? 18 : 21, fstep = fs + 3;
    for (var i = 0; i < maxF; i++) drawFlameIcon(ctx, left + fs / 2 + i * fstep, cy, fs, i < fl, t + i * 0.7);
    var leftEnd = left + maxF * fstep + 4;

    // score pill
    var scoreTxt = String(Math.max(0, Math.floor(hud.score || 0)));
    var sf = font(900, compact ? 17 : 19);
    var sw = measure(scoreTxt, sf);
    var ph = Math.min(36, H - 12), pw = Math.max(compact ? 64 : 76, sw + 42), px = right - pw;
    ctx.fillStyle = 'rgba(12,11,32,.78)'; rr(ctx, px, cy - ph / 2, pw, ph, ph / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(242,201,76,.5)'; ctx.lineWidth = 1.5; rr(ctx, px + 0.75, cy - ph / 2 + 0.75, pw - 1.5, ph - 1.5, ph / 2); ctx.stroke();
    drawIcon(ctx, 'star', px + 17, cy, 18, GOLD);
    ctx.font = sf; ctx.fillStyle = '#fff6d6'; ctx.textAlign = 'right';
    ctx.fillText(scoreTxt, right - 13, cy + 1);
    var rightStart = px - 6;

    // combo badge (left of the score)
    var combo = Math.floor(hud.combo || 1);
    if (combo > 1) {
      var cp = clamp(hud.comboPop || 0, 0, 1);
      var cols = COMBO_COLORS[Math.min(4, combo)] || COMBO_COLORS[4];
      var cTxt = '×' + combo, cf = font(900, 16);
      var cw = Math.max(40, measure(cTxt, cf) + 18), ch = 28;
      var bx = rightStart - cw / 2;
      ctx.save();
      ctx.translate(bx, cy);
      var pulse = 1 + cp * 0.35 + (combo >= 4 ? Math.sin(t * 8) * 0.04 : 0);
      ctx.scale(pulse, pulse);
      ctx.rotate(-0.07);
      drawGlow(ctx, cols[0], 0, 0, cw * 0.85, ch * 1.2, 0.45 + cp * 0.45);
      var cg = ctx.createLinearGradient(0, -ch / 2, 0, ch / 2);
      cg.addColorStop(0, cols[0]); cg.addColorStop(1, cols[1]);
      ctx.fillStyle = 'rgba(8,6,30,.35)'; rr(ctx, -cw / 2, -ch / 2 + 2.5, cw, ch, 9); ctx.fill();
      ctx.fillStyle = cg; rr(ctx, -cw / 2, -ch / 2, cw, ch, 9); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 1.5; rr(ctx, -cw / 2 + 0.75, -ch / 2 + 0.75, cw - 1.5, ch - 1.5, 8.5); ctx.stroke();
      ctx.font = cf; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(21,20,43,.35)'; ctx.fillText(cTxt, 0, 2.2);
      ctx.fillStyle = '#ffffff'; ctx.fillText(cTxt, 0, 1);
      ctx.restore();
      rightStart -= cw + 8;
    }

    // centre: stage title over request progress
    var cAvail = rightStart - leftEnd;
    var mid = (leftEnd + rightStart) / 2;
    var title = String(hud.stageTitle || '');
    var total = hud.reqTotal || 0;
    if (cAvail > 36) {
      ctx.textAlign = 'center';
      var tf = font(800, compact ? 13 : 14.5);
      ctx.font = tf; ctx.fillStyle = INK;
      ctx.fillText(ellipsize(title, cAvail, tf), mid, cy - 8);
      if (total > 0) {
        var idx = clamp(hud.reqIndex || 0, 0, total - 1);     // 0-based current request
        var pipW = Math.min(16, (cAvail - 8) / total - 5), pipG = 5;
        var pipsW = total * pipW + (total - 1) * pipG, x0 = mid - pipsW / 2;
        for (var p = 0; p < total; p++) {
          ctx.fillStyle = p < idx ? GOLD : p === idx ? 'rgba(242,201,76,' + (0.5 + 0.3 * Math.sin(t * 4)).toFixed(3) + ')' : 'rgba(255,255,255,.18)';
          rr(ctx, x0 + p * (pipW + pipG), cy + 8, pipW, 5, 2.5); ctx.fill();
        }
      } else {
        var lf = font(800, 11);
        ctx.font = lf; ctx.fillStyle = '#c9c7ea';
        ctx.fillText('SERVED ' + Math.max(0, hud.reqIndex || 0), mid, cy + 10);
      }
    }
    ctx.restore();
  }

  /* Cool-blue tint + vignette over the WHOLE canvas (ignores the current transform). */
  var slowCache = { key: '' };
  function drawSlowmo(ctx, w, h, a, t) {
    var cw = ctx.canvas.width, ch = ctx.canvas.height, key = cw + 'x' + ch;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (slowCache.key !== key) {
      var g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
      g.addColorStop(0, 'rgba(108,180,245,0)'); g.addColorStop(1, 'rgba(108,180,245,.40)');
      slowCache = { key: key, g: g };
    }
    ctx.globalAlpha = clamp(a, 0, 1) * (0.9 + 0.1 * Math.sin((t || 0) * 5));
    ctx.fillStyle = 'rgba(70,110,220,.10)'; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = slowCache.g; ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  /* ───────────────────────── speech bubble ───────────────────────── */
  var BUB = { pad: 13, px: 15, lh: 20, tail: 11, r: 16 };
  function bubbleLayout(w, text) {
    var f = font(600, BUB.px);
    var lines = wrap(text, w - BUB.pad * 2, f);
    var mw = 0;
    for (var i = 0; i < lines.length; i++) mw = Math.max(mw, measure(lines[i], f));
    return { lines: lines, f: f, w: Math.ceil(Math.min(w, Math.max(64, mw + BUB.pad * 2))), h: lines.length * BUB.lh + BUB.pad * 2 - 4 };
  }
  /* Size the bubble box will have (tail excluded; the tail adds 11 px below). */
  function bubbleSize(w, text) { var L = bubbleLayout(w, String(text || '')); return { w: L.w, h: L.h, tail: BUB.tail }; }

  /* (x, y) = top-left of the box; a narrower text shrinks the box, centred inside w.
   * tailX (optional) = absolute x the tail points at; default = box centre. Returns the box rect. */
  function drawBubble(ctx, x, y, w, text, t, tailX) {
    t = t || 0;
    var L = bubbleLayout(w, String(text || ''));
    var bw = L.w, bh = L.h;
    var fy = Math.sin(t * 2.2) * 1.5;
    var bx = x + (w - bw) / 2, by = y + fy;
    var tipX = tailX == null ? bx + bw / 2 : tailX;
    var tx = clamp(tipX, bx + BUB.r + 8, bx + bw - BUB.r - 8);
    var tipY = by + bh + BUB.tail;
    ctx.save();
    function shape(oy) {
      var r = BUB.r, y0 = by + oy;
      ctx.beginPath();
      ctx.moveTo(bx + r, y0);
      ctx.arcTo(bx + bw, y0, bx + bw, y0 + bh, r);
      ctx.arcTo(bx + bw, y0 + bh, bx, y0 + bh, r);
      ctx.lineTo(tx + 9, y0 + bh);
      ctx.quadraticCurveTo(tx + 2, y0 + bh + 4, tipX, tipY + oy);
      ctx.quadraticCurveTo(tx - 3, y0 + bh + 3, tx - 8, y0 + bh);
      ctx.arcTo(bx, y0 + bh, bx, y0, r);
      ctx.arcTo(bx, y0, bx + bw, y0, r);
      ctx.closePath();
    }
    shape(4); ctx.fillStyle = 'rgba(5,4,20,.35)'; ctx.fill();
    shape(0);
    var g = ctx.createLinearGradient(0, by, 0, by + bh);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ecebfb');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(139,136,245,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = L.f; ctx.fillStyle = '#1d1b38'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (var i = 0; i < L.lines.length; i++) ctx.fillText(L.lines[i], bx + BUB.pad, by + BUB.pad + BUB.lh * i + BUB.lh / 2 - 2);
    ctx.restore();
    return { x: bx, y: by, w: bw, h: bh };
  }

  /* ───────────────────────── power-ups ───────────────────────── */
  var PU = {
    clarity: { color: '#F2C94C', icon: 'bulb', label: 'Clarity' },
    wax: { color: '#FF8F6B', icon: 'drop', label: '+1 Flame' },
    slow: { color: '#6CB4F5', icon: 'hourglass', label: 'Slow-mo' }
  };
  var puGrad = {};
  function drawPowerup(ctx, x, y, r, kind, t) {
    var P = PU[kind] || PU.clarity;
    t = t || 0;
    ctx.save();
    ctx.translate(x, y + Math.sin(t * 3 + x) * 2);
    var pulse = 0.5 + 0.5 * Math.sin(t * 4);
    drawGlow(ctx, P.color, 0, 0, r * 2.1, r * 2.1, 0.55 + pulse * 0.3);
    // orbit ring
    ctx.save();
    ctx.rotate(t * 1.8);
    ctx.strokeStyle = rgba(P.color, 0.85); ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(0, 0, r * 1.3, i * TAU / 3, i * TAU / 3 + 0.9); ctx.stroke();
    }
    ctx.restore();
    // orb
    if (!puGrad[kind]) {
      var g = ctx.createRadialGradient(-0.35, -0.45, 0.05, 0, 0, 1.05);
      g.addColorStop(0, mix(P.color, '#ffffff', 0.7)); g.addColorStop(0.45, P.color); g.addColorStop(1, mix(P.color, '#1b1946', 0.45));
      puGrad[kind] = g;
    }
    ctx.save(); ctx.scale(r, r);
    ctx.fillStyle = puGrad[kind];
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, r - 0.8, 0, TAU); ctx.stroke();
    // icon
    ctx.save();
    ctx.rotate(Math.sin(t * 3) * 0.12);
    drawIcon(ctx, P.icon, 0, 1, r * 1.12, 'rgba(21,20,43,.9)', 2.6);
    if (kind === 'clarity') drawIcon(ctx, 'bulb', 0, 0, r * 1.12, '#fffdf0', 2.2);
    else if (kind === 'wax') {
      drawIcon(ctx, 'drop', 0, 0, r * 1.12, '#fff6ea');
      ctx.strokeStyle = P.color; ctx.lineWidth = Math.max(2, r * 0.13); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-r * 0.2, r * 0.12); ctx.lineTo(r * 0.2, r * 0.12); ctx.moveTo(0, -r * 0.08); ctx.lineTo(0, r * 0.32); ctx.stroke();
    } else drawIcon(ctx, 'hourglass', 0, 0, r * 1.12, '#f2f8ff', 2.2);
    ctx.restore();
    // gloss
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.ellipse(-r * 0.36, -r * 0.5, r * 0.34, r * 0.16, -0.6, 0, TAU); ctx.fill();
    // orbiting sparkles
    for (var j = 0; j < 2; j++) {
      var a = t * 2.4 + j * Math.PI;
      var tw = 0.5 + 0.5 * Math.sin(t * 7 + j * 2);
      drawIcon(ctx, 'sparkle', Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3, 7 + tw * 6, '#ffffff');
    }
    ctx.restore();
  }

  /* ───────────────────────── particles & juice helpers ───────────────────────── */
  function particle(kind, color) {
    color = color || GOLD;
    return {
      kind: kind, color: color,
      draw: function (ctx, p) {
        var a = clamp(p.life == null ? 1 : p.life, 0, 1);
        if (a <= 0) return;
        var sz = p.size || 6;
        ctx.save();
        ctx.globalAlpha *= a;
        switch (kind) {
          case 'spark':
            ctx.globalCompositeOperation = 'lighter';
            ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
            drawIcon(ctx, 'sparkle', 0, 0, sz * 2 * (0.4 + 0.6 * a), color);
            break;
          case 'smoke':
            ctx.globalAlpha *= 0.4;
            ctx.fillStyle = '#b9b6cf';
            ctx.beginPath(); ctx.arc(p.x, p.y, sz * (1 + (1 - a) * 1.6), 0, TAU); ctx.fill();
            break;
          case 'ring':
            ctx.strokeStyle = color; ctx.lineWidth = 3 * a;
            ctx.beginPath(); ctx.arc(p.x, p.y, sz * (0.4 + (1 - a) * 2.2), 0, TAU); ctx.stroke();
            break;
          case 'confetti':
            ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
            ctx.fillStyle = color; ctx.fillRect(-sz / 2, -sz / 4, sz, sz / 2);
            break;
          default: // 'dot'
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(p.x, p.y, sz * (0.5 + 0.5 * a), 0, TAU); ctx.fill();
        }
        ctx.restore();
      }
    };
  }

  /* Floating "+120", "x3!" etc. alpha 0..1, scale ~1. */
  function drawPopText(ctx, x, y, text, color, alpha, scale, px) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= clamp(alpha, 0, 1);
    ctx.translate(x, y); ctx.scale(scale || 1, scale || 1);
    ctx.font = font(900, px || 22); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(15,13,38,.85)';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color || '#ffffff'; ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /* Toast pill (e.g. "Vague! Be specific."). kind: 'bad' | 'good' | 'info'. (cx, y) = centre. */
  var TOAST = { bad: ['#F27B7B', '#7a2b3a', 'x'], good: ['#7BD389', '#245e34', 'check'], info: ['#8B88F5', '#3a3590', 'sparkle'] };
  function drawToast(ctx, cx, y, text, kind, alpha, maxW) {
    if (alpha <= 0) return;
    var K = TOAST[kind] || TOAST.info;
    var f = font(800, 15);
    var cwid = cssWidth(ctx);
    var tw = Math.min(measure(text, f), (maxW || cwid - 32) - 56);
    var w = tw + 56, h = 40;
    ctx.save();
    ctx.globalAlpha *= clamp(alpha, 0, 1);
    var x0 = clamp(cx - w / 2, 8, Math.max(8, cwid - w - 8));
    ctx.fillStyle = 'rgba(5,4,20,.35)'; rr(ctx, x0, y - h / 2 + 3, w, h, h / 2); ctx.fill();
    var g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, mix(K[1], '#000000', 0.1)); g.addColorStop(1, mix(K[1], '#000000', 0.4));
    ctx.fillStyle = g; rr(ctx, x0, y - h / 2, w, h, h / 2); ctx.fill();
    ctx.strokeStyle = K[0]; ctx.lineWidth = 1.5; rr(ctx, x0 + 0.75, y - h / 2 + 0.75, w - 1.5, h - 1.5, h / 2); ctx.stroke();
    ctx.fillStyle = K[0]; ctx.beginPath(); ctx.arc(x0 + 21, y, 12, 0, TAU); ctx.fill();
    drawIcon(ctx, K[2], x0 + 21, y, 15, NAVY, 3.2);
    ctx.font = f; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(ellipsize(text, tw + 1, f), x0 + 40, y + 1);
    ctx.restore();
  }

  /* Full-screen flash for SEND (a 0..1). */
  function drawFlash(ctx, w, h, a, color) {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1) * 0.85;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = color || 'rgba(255,236,170,1)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /* Big star (stage-clear in canvas, optional). */
  function drawStar(ctx, cx, cy, size, on) {
    if (on) {
      drawGlow(ctx, GOLD, cx, cy, size * 0.9, size * 0.9, 0.5);
      var g = ctx.createLinearGradient(0, 2, 0, 22);    // glyph space
      g.addColorStop(0, '#fff1a8'); g.addColorStop(0.5, GOLD); g.addColorStop(1, '#e09a2a');
      drawIcon(ctx, 'star', cx, cy, size, g);
    } else drawIcon(ctx, 'star', cx, cy, size, 'rgba(255,255,255,.14)');
  }

  window.Art = {
    TYPES: TYPES,
    POWERUPS: PU,
    // recommended metrics (CSS px)
    METRICS: {
      blockMinW: BLOCK.minW, blockMaxW: BLOCK.maxW, blockH1: BLOCK.h1, blockH2: BLOCK.h2,
      hudHeight: HUD_H, socketH: 40, promptBarH: 52, requestCardH: 66, requestCardMinH: 52,
      wickSize: 110, powerupR: 22, bubbleW: 290
    },
    drawBackground: drawBackground,
    drawWick: drawWick,
    drawBlock: drawBlock,
    measureBlock: measureBlock,
    drawPowerup: drawPowerup,
    drawSocket: drawSocket,
    drawPromptBar: drawPromptBar,
    drawRequestCard: drawRequestCard,
    requestCardHeight: requestCardHeight,
    drawHUD: drawHUD,
    drawSlowmo: drawSlowmo,
    drawBubble: drawBubble,
    bubbleSize: bubbleSize,
    particle: particle,
    drawPopText: drawPopText,
    drawToast: drawToast,
    drawFlash: drawFlash,
    drawStar: drawStar,
    drawFlameIcon: drawFlameIcon,
    drawIcon: drawIcon,
    drawGlow: drawGlow,
    mix: mix,
    rgba: rgba,
    font: font
  };
})();
