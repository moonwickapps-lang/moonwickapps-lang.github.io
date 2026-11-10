/* scene.js — Prompt Academy v3 "Picture This" (Moonwick Apps).
 *
 * The procedural picture renderer. Pure Canvas 2D: no image files, no ctx.filter,
 * no DOM besides offscreen canvases. Deterministic for (scene, seed): the same
 * scene + seed always gives the same picture, so a perfect prompt reproduces the
 * target pixel for pixel.
 *
 *   Scene.render(scene, seed, { scale }) -> { canvas, boxes }
 *
 * scene = {
 *   subject: { kind: 'dog'|'cat'|'bunny'|'duck'|'kid'|'robot', count: 1..5,
 *              color: 'golden'|'black'|'white'|'brown'|'spotted'|'gray' },
 *   action:  'playing'|'running'|'sleeping'|'sitting'|'jumping'|'eating'|'kite',
 *   place:   'field'|'beach'|'park'|'forest'|'snowy hill'|'living room'|'city street',
 *   flowers: { color: 'red'|'yellow'|'blue'|'purple'|'white', amount: 'none'|'few'|'lots' },
 *   time:    'day'|'sunset'|'night',
 *   weather: 'sunny'|'cloudy'|'rain'|'snow',
 *   style:   'cartoon'|'watercolor'|'pixel'|'storybook'|'photo',
 *   camera:  'wide'|'close-up',
 *   extras:  subset of ['tree','house','rainbow','balloons','people']
 * }
 * boxes (logical 640×480 px, after the camera): subject, sky, time, weather, place,
 * flowers, ground, frame, and one per drawn extra. Used to circle differences.
 *
 * Layers: sky canvas + world canvas (tinted for time/weather) + weather particles,
 * then a style pass (watercolor / pixel / storybook / photo).
 */
(function () {
  'use strict';

  var W = 640, H = 480, TAU = Math.PI * 2;
  var HORIZON = 255;

  /* ───────────────────────── basics ───────────────────────── */
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
  function hashStr(s) {
    s = String(s);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /** Independent random stream per part of the picture, so changing one field never moves the others. */
  function stream(seed, name) { return rng((seed ^ hashStr(name)) >>> 0); }
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hexRgb(h) {
    h = String(h).replace('#', '');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    var A = hexRgb(a), B = hexRgb(b);
    return '#' + A.map(function (x, i) { return Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0'); }).join('');
  }
  function rgba(h, a) { var c = hexRgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  /* ───────────────────────── path helpers ───────────────────────── */
  function ell(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, TAU); }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0.1, r), 0, TAU); }
  function rrect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function capsule(c, x1, y1, x2, y2, r) {
    var a = Math.atan2(y2 - y1, x2 - x1);
    c.beginPath();
    c.arc(x1, y1, r, a + Math.PI / 2, a + Math.PI * 1.5);
    c.arc(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2);
    c.closePath();
  }
  /** Fill the current path, then (cartoon-ish styles) outline it with the style's ink. */
  function paint(S, fill, k) {
    var c = S.c;
    c.fillStyle = fill;
    c.fill();
    if (S.outline) {
      c.lineWidth = S.lw * (k == null ? 1 : k);
      c.strokeStyle = S.ink;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.stroke();
    }
  }
  /** A thick stroked curve (tails, strings) with an optional ink outline under it. */
  function strokeCurve(S, build, color, width) {
    var c = S.c;
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (S.outline) { build(); c.strokeStyle = S.ink; c.lineWidth = width + S.lw * 2; c.stroke(); }
    build(); c.strokeStyle = color; c.lineWidth = width; c.stroke();
  }
  /** Spots (spotted coats): clip to the path just painted, drop patches, re-stroke the outline. */
  function spots(S, build, color, list) {
    var c = S.c;
    c.save();
    build(); c.clip();
    c.fillStyle = color;
    for (var i = 0; i < list.length; i++) { var s = list[i]; ell(c, s[0], s[1], s[2], s[3] || s[2], s[4] || 0); c.fill(); }
    c.restore();
    if (S.outline) { build(); c.lineWidth = S.lw; c.strokeStyle = S.ink; c.stroke(); }
  }

  /* ───────────────────────── palettes ───────────────────────── */
  var FUR = {
    golden:  { base: '#EDB04E', dark: '#C98630', light: '#FBE6B8', ear: '#C98630' },
    black:   { base: '#3D3A45', dark: '#27242D', light: '#8A8594', ear: '#211E26' },
    white:   { base: '#FAF7F1', dark: '#DCD5C9', light: '#FFFFFF', ear: '#E9DFD0' },
    brown:   { base: '#9C6334', dark: '#714420', light: '#E0B88E', ear: '#6A3E1C' },
    spotted: { base: '#FAF7F1', dark: '#DCD5C9', light: '#FFFFFF', ear: '#3D3A45', spot: '#3D3A45' },
    gray:    { base: '#A9A9B6', dark: '#80808E', light: '#E2E2EA', ear: '#80808E', stripe: '#7A7A88' }
  };
  var FEATHER = {
    golden:  { base: '#FFD94A', dark: '#F2B42C', light: '#FFF2B0' },
    black:   { base: '#3D3A45', dark: '#27242D', light: '#77727F' },
    white:   { base: '#FBFBF7', dark: '#DADCE3', light: '#FFFFFF' },
    brown:   { base: '#A87B50', dark: '#7D5634', light: '#DCBB94' },
    spotted: { base: '#FBFBF7', dark: '#DADCE3', light: '#FFFFFF', spot: '#8A5A34' },
    gray:    { base: '#AEB0BC', dark: '#878A97', light: '#DEE0E8' }
  };
  var HAIR = { golden: '#F3C95A', black: '#2E2833', brown: '#7B4A26', white: '#EFEAE0', gray: '#9C9CA8', spotted: '#C9622F' };
  var METAL = {
    gray:    { base: '#C3CCD6', dark: '#8E99A6', light: '#EEF2F6' },
    golden:  { base: '#E8B84E', dark: '#B9862A', light: '#F8E0A0' },
    white:   { base: '#F6F8FB', dark: '#C5CCD7', light: '#FFFFFF' },
    black:   { base: '#474A54', dark: '#2B2D33', light: '#767A86' },
    brown:   { base: '#B26C3C', dark: '#844C27', light: '#DC9B6C' },
    spotted: { base: '#C3CCD6', dark: '#8E99A6', light: '#EEF2F6', spot: '#EA8A3A' }
  };
  var SKIN = ['#F7D2AE', '#E6AF84', '#B57A50', '#8A5638'];
  var SHIRT = ['#E85D5D', '#3FB6A8', '#8B6CE8', '#F2A53A', '#4C8BE8'];
  var FLOWER = {
    red:    { petal: '#E8333F', hi: '#FF7B86', mid: '#FFD34A' },
    yellow: { petal: '#FFD02E', hi: '#FFF09A', mid: '#E57A1E' },
    blue:   { petal: '#3B82F6', hi: '#93C0FF', mid: '#FFE07A' },
    purple: { petal: '#9B4DE0', hi: '#CDA2FF', mid: '#FFE07A' },
    white:  { petal: '#FFFFFF', hi: '#FFFFFF', mid: '#F7C531' }
  };
  var LOOKS = {
    cartoon:   { outline: true,  ink: '#2B2540', lw: 3 },
    pixel:     { outline: true,  ink: '#1D1830', lw: 4.6 },
    storybook: { outline: true,  ink: '#6B4A36', lw: 2.6 },
    watercolor:{ outline: true,  ink: 'rgba(96,72,84,.42)', lw: 1.7 }, // faint pencil lines under the washes
    photo:     { outline: false, ink: '#2B2540', lw: 0 }
  };

  /* ───────────────────────── scene normalising ───────────────────────── */
  var KINDS = ['dog', 'cat', 'bunny', 'duck', 'kid', 'robot'];
  function pick(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
  function normalize(s) {
    s = s || {};
    var sub = s.subject || {}, fl = s.flowers || {};
    return {
      kind: pick(sub.kind, KINDS, 'dog'),
      count: clamp(Math.round(Number(sub.count) || 1), 0, 5),
      color: pick(sub.color, ['golden', 'black', 'white', 'brown', 'spotted', 'gray'], 'golden'),
      action: pick(s.action, ['playing', 'running', 'sleeping', 'sitting', 'jumping', 'eating', 'kite'], 'sitting'),
      place: pick(s.place, ['field', 'beach', 'park', 'forest', 'snowy hill', 'living room', 'city street'], 'field'),
      flowerColor: pick(fl.color, ['red', 'yellow', 'blue', 'purple', 'white'], 'red'),
      flowerAmount: pick(fl.amount, ['none', 'few', 'lots'], 'none'),
      time: pick(s.time, ['day', 'sunset', 'night'], 'day'),
      weather: pick(s.weather, ['sunny', 'cloudy', 'rain', 'snow'], 'sunny'),
      style: pick(s.style, ['cartoon', 'watercolor', 'pixel', 'storybook', 'photo'], 'cartoon'),
      camera: pick(s.camera, ['wide', 'close-up'], 'wide'),
      extras: (s.extras || []).filter(function (e) { return ['tree', 'house', 'rainbow', 'balloons', 'people'].indexOf(e) >= 0; })
    };
  }
  var INDOOR = { 'living room': true };
  var BASE_Y = { field: 404, park: 408, forest: 414, beach: 414, 'snowy hill': 406, 'living room': 424, 'city street': 452 };

  /* ───────────────────────── boxes (diff circles) ───────────────────────── */
  function mark(S, key, x, y, w, h) {
    var z = S.cam.z;
    var b = { x: x * z + S.cam.tx, y: y * z + S.cam.ty, w: w * z, h: h * z };
    // keep on canvas
    var x0 = clamp(b.x, 0, W), y0 = clamp(b.y, 0, H), x1 = clamp(b.x + b.w, 0, W), y1 = clamp(b.y + b.h, 0, H);
    if (x1 - x0 < 4 || y1 - y0 < 4) return;
    b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    var o = S.boxes[key];
    if (o) {
      var ox1 = Math.max(o.x + o.w, b.x + b.w), oy1 = Math.max(o.y + o.h, b.y + b.h);
      o.x = Math.min(o.x, b.x); o.y = Math.min(o.y, b.y); o.w = ox1 - o.x; o.h = oy1 - o.y;
    } else S.boxes[key] = b;
  }

  /* ───────────────────────── layout + camera ───────────────────────── */
  var SLOTS = {
    1: [[320, 0]], 2: [[228, 0], [412, 4]], 3: [[168, 6], [320, -12], [472, 4]],
    4: [[116, 6], [250, -10], [390, 4], [524, -8]], 5: [[92, 8], [206, -10], [320, 6], [434, -10], [548, 8]]
  };
  function layoutSubjects(sc, seed) {
    var R = stream(seed, 'subjects');
    var n = sc.count, list = [];
    if (!n) return list;
    var close = sc.camera === 'close-up';
    var base = BASE_Y[sc.place];
    var sScale = n === 1 ? 1.32 : n === 2 ? 1.2 : n === 3 ? 1.08 : n === 4 ? 0.94 : 0.82;
    var together = !(sc.action === 'running' || sc.action === 'jumping' || sc.action === 'kite');
    for (var i = 0; i < n; i++) {
      var slot = SLOTS[n][i];
      var x = slot[0] + (R() - 0.5) * 16, dy = slot[1] + (R() - 0.5) * 6;
      if (close) x = 320 + (x - 320) * 0.78;
      var facing = 1;
      if (together && n === 2) facing = i === 0 ? 1 : -1;
      else if (together && n > 2) facing = x > 330 ? -1 : 1;
      if (sc.action === 'kite') facing = x > 420 ? -1 : 1;
      list.push({ i: i, x: x, y: base + dy, s: sScale * (1 + dy * 0.004), facing: facing, var: R });
    }
    list.sort(function (a, b) { return a.y - b.y; });
    return list;
  }
  var KIND_H = { dog: 105, cat: 100, bunny: 110, duck: 90, kid: 140, robot: 150 };
  function cameraFor(sc, subs) {
    if (sc.camera !== 'close-up' || !subs.length) return { z: 1, tx: 0, ty: 0 };
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    subs.forEach(function (p) {
      var h = KIND_H[sc.kind] * p.s + (sc.action === 'jumping' ? 50 : 0);
      x0 = Math.min(x0, p.x - 75 * p.s); x1 = Math.max(x1, p.x + 75 * p.s);
      y0 = Math.min(y0, p.y - h); y1 = Math.max(y1, p.y + 14);
    });
    if (sc.extras.indexOf('balloons') >= 0) y0 -= 70;
    var z = clamp(Math.min(W * 0.9 / (x1 - x0), H * 0.84 / (y1 - y0)), 1.3, 2.2);
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var tx = clamp(W / 2 - cx * z, W - W * z, 0);
    var ty = clamp(H * 0.5 - cy * z, H - H * z, 0);
    return { z: z, tx: tx, ty: ty };
  }
  function setCam(S) { var k = S.scale, z = S.cam.z; S.c.setTransform(z * k, 0, 0, z * k, S.cam.tx * k, S.cam.ty * k); }

  /* ───────────────────────── sky ───────────────────────── */
  function skyGradient(c, sc) {
    var t = sc.time, w = sc.weather, g = c.createLinearGradient(0, -60, 0, HORIZON + 40);
    var stops;
    if (t === 'night') stops = (w === 'sunny' || w === 'snow') ? ['#0B1236', '#1D2A63', '#37488C'] : ['#121734', '#262E57', '#3A4370'];
    else if (t === 'sunset') stops = w === 'sunny' ? ['#4A3C91', '#B65C95', '#F2876B', '#FFC867'] : ['#5A4E80', '#A36A8C', '#D48C7C', '#E8B07E'];
    else stops = w === 'sunny' ? ['#3FA4EE', '#7CC6F7', '#C6EBFF'] : w === 'cloudy' ? ['#8FA6BF', '#B3C3D4', '#DCE4EC'] : w === 'rain' ? ['#6E7D92', '#93A0B2', '#BCC6D2'] : ['#A9B9CC', '#CAD6E3', '#ECF1F7'];
    stops.forEach(function (col, i) { g.addColorStop(i / (stops.length - 1), col); });
    return g;
  }
  function cloud(c, x, y, s, fill, shade) {
    function blob(dy) {
      c.beginPath();
      var parts = [[-34, 6, 20], [-12, -8, 26], [16, -12, 30], [42, 2, 21], [6, 8, 24]];
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        c.moveTo(x + (p[0] + p[2]) * s, y + (p[1] + dy) * s);
        c.arc(x + p[0] * s, y + (p[1] + dy) * s, p[2] * s, 0, TAU);
      }
    }
    blob(6); c.fillStyle = shade; c.fill();
    blob(0); c.fillStyle = fill; c.fill();
  }
  function drawSky(S, sc) {
    var c = S.c, R = stream(S.seed, 'sky');
    var grad = skyGradient(c, sc);
    c.fillStyle = grad;
    c.fillRect(-W, -H, W * 3, H * 3);
    var indoor = INDOOR[sc.place];
    // window position for indoor scenes: sun / moon / rainbow are placed inside it
    var cx = indoor ? 488 : 518, cy = indoor ? 92 : 84;
    // stars
    if (sc.time === 'night' && sc.weather !== 'rain') {
      var n = sc.weather === 'cloudy' ? 18 : 60;
      for (var i = 0; i < n; i++) {
        var sx = R() * W, sy = R() * (HORIZON - 30), r = R() < 0.15 ? 2.2 : 1.3;
        c.fillStyle = 'rgba(255,250,225,' + (0.55 + R() * 0.45).toFixed(2) + ')';
        circle(c, sx, sy, r); c.fill();
      }
      c.fillStyle = '#FFF7D6';
      [[90, 60], [250, 40], [400, 120]].forEach(function (p) { sparkle(c, p[0], p[1], 7); });
    }
    // rainbow (extra) — behind sun and clouds
    if (sc.extras.indexOf('rainbow') >= 0) {
      var rcx = indoor ? 470 : 190, rcy = indoor ? 230 : 330, rr = indoor ? 116 : 210, bw = indoor ? 7 : 11;
      var cols = ['#FF5B5B', '#FFA94D', '#FFE66D', '#7BD389', '#5AA9E6', '#9B7FE0'];
      c.lineCap = 'butt';
      for (var b = 0; b < cols.length; b++) {
        c.beginPath(); c.arc(rcx, rcy, rr - b * bw, Math.PI, TAU);
        c.strokeStyle = rgba(cols[b], 0.85); c.lineWidth = bw + 0.5; c.stroke();
      }
      mark(S, 'rainbow', rcx - rr - 4, rcy - rr - 4, rr * 2 + 8, rr * 0.8);
    }
    // sun / moon
    var glow;
    if (sc.time === 'day' && sc.weather !== 'rain') {
      var sunA = sc.weather === 'sunny' ? 1 : 0.55;
      glow = c.createRadialGradient(cx, cy, 10, cx, cy, 100);
      glow.addColorStop(0, 'rgba(255,240,170,' + 0.75 * sunA + ')'); glow.addColorStop(1, 'rgba(255,240,170,0)');
      c.fillStyle = glow; c.fillRect(cx - 110, cy - 110, 220, 220);
      if (sc.weather === 'sunny') {
        c.strokeStyle = '#FFD84D'; c.lineWidth = 6; c.lineCap = 'round';
        for (var k = 0; k < 12; k++) {
          var a = k * TAU / 12 + 0.13;
          c.beginPath(); c.moveTo(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46); c.lineTo(cx + Math.cos(a) * 60, cy + Math.sin(a) * 60); c.stroke();
        }
      }
      circle(c, cx, cy, 34); c.fillStyle = '#FFD84D'; c.globalAlpha = sunA; c.fill();
      circle(c, cx - 8, cy - 9, 18); c.fillStyle = '#FFF0A0'; c.fill(); c.globalAlpha = 1;
      mark(S, 'time', cx - 62, cy - 62, 124, 124);
    } else if (sc.time === 'sunset') {
      var sx2 = indoor ? 470 : 470, sy2 = indoor ? 175 : 206;
      glow = c.createRadialGradient(sx2, sy2, 20, sx2, sy2, 170);
      glow.addColorStop(0, 'rgba(255,214,120,.85)'); glow.addColorStop(1, 'rgba(255,170,110,0)');
      c.fillStyle = glow; c.fillRect(sx2 - 180, sy2 - 180, 360, 360);
      var sg = c.createLinearGradient(0, sy2 - 54, 0, sy2 + 54);
      sg.addColorStop(0, '#FFE07A'); sg.addColorStop(1, '#FF7A45');
      circle(c, sx2, sy2, 54); c.fillStyle = sg; c.globalAlpha = sc.weather === 'sunny' ? 1 : 0.7; c.fill(); c.globalAlpha = 1;
      // sun stripes
      c.fillStyle = grad;
      for (var st = 0; st < 3; st++) c.fillRect(sx2 - 60, sy2 + 18 + st * 12, 120, 3 + st);
      mark(S, 'time', sx2 - 70, sy2 - 70, 140, 120);
    } else if (sc.time === 'night') {
      glow = c.createRadialGradient(cx, cy, 20, cx, cy, 110);
      glow.addColorStop(0, 'rgba(255,248,210,.35)'); glow.addColorStop(1, 'rgba(255,248,210,0)');
      c.fillStyle = glow; c.fillRect(cx - 120, cy - 120, 240, 240);
      circle(c, cx, cy, 32); c.fillStyle = '#FFF4CC'; c.fill();
      circle(c, cx + 15, cy - 9, 28); c.fillStyle = grad; c.fill();   // crescent bite, same sky gradient
      mark(S, 'time', cx - 50, cy - 50, 100, 100);
    }
    // clouds
    var cl = sc.weather === 'sunny' ? 2 : sc.weather === 'cloudy' ? 6 : sc.weather === 'rain' ? 8 : 5;
    var dark = sc.time === 'night';
    var fill = sc.weather === 'rain' ? (dark ? '#4A5070' : '#8E97A8') : sc.weather === 'cloudy' ? (dark ? '#5A6186' : '#EEF1F6') : (dark ? '#6A6F98' : '#FFFFFF');
    var shade = sc.weather === 'rain' ? (dark ? '#363B58' : '#737D90') : (dark ? '#4A4F78' : sc.time === 'sunset' ? '#E9A9A0' : '#D5DEEA');
    if (sc.time === 'sunset' && sc.weather !== 'rain') fill = '#FFE1D2';
    for (var j = 0; j < cl; j++) {
      var px = (j + 0.5) / cl * W + (R() - 0.5) * 60, py = 40 + R() * (sc.weather === 'sunny' ? 70 : 110);
      if (sc.weather === 'sunny' && Math.abs(px - cx) < 90) px = (px + 220) % W;
      var s = sc.weather === 'sunny' ? 0.9 + R() * 0.3 : 1 + R() * 0.6;
      cloud(c, px, py, s, fill, shade);
    }
    mark(S, 'sky', 0, 0, W, HORIZON - 20);
    mark(S, 'weather', 0, 0, W, HORIZON - 40);
  }
  function sparkle(c, x, y, r) {
    c.beginPath();
    c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r, y); c.quadraticCurveTo(x, y, x, y + r);
    c.quadraticCurveTo(x, y, x - r, y); c.quadraticCurveTo(x, y, x, y - r); c.fill();
  }

  /* ───────────────────────── places ───────────────────────── */
  function hills(c, baseY, amp, freq, phase, color) {
    c.beginPath(); c.moveTo(-W, H * 2);
    for (var x = -W; x <= W * 2; x += 12) c.lineTo(x, baseY - amp * (0.5 + 0.5 * Math.sin(x * freq + phase)));
    c.lineTo(W * 2, H * 2); c.closePath(); c.fillStyle = color; c.fill();
  }
  function groundFill(c, y0, top, bottom) {
    var g = c.createLinearGradient(0, y0, 0, H);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    c.fillStyle = g; c.fillRect(-W, y0, W * 3, H * 2);
  }
  function tufts(S, R, n, y0, color) {
    var c = S.c;
    c.strokeStyle = color; c.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var x = R() * W, y = y0 + Math.sqrt(R()) * (H - y0), s = 0.6 + (y - y0) / (H - y0);
      c.lineWidth = 2 * s;
      c.beginPath();
      c.moveTo(x - 5 * s, y - 7 * s); c.lineTo(x, y); c.lineTo(x + 1 * s, y - 9 * s); c.moveTo(x, y); c.lineTo(x + 6 * s, y - 6 * s);
      c.stroke();
    }
  }
  function roundTree(S, x, y, s, leaf, leafDark) {
    var c = S.c;
    rrect(c, x - 7 * s, y - 50 * s, 14 * s, 50 * s, 4 * s); paint(S, '#8A5A3A', 0.8);
    circle(c, x, y - 70 * s, 34 * s); paint(S, leafDark, 0.8);
    circle(c, x - 6 * s, y - 76 * s, 26 * s); c.fillStyle = leaf; c.fill();
  }
  function pine(S, x, y, s, col, snow) {
    var c = S.c;
    c.fillStyle = '#6B4A30'; c.fillRect(x - 5 * s, y - 16 * s, 10 * s, 16 * s);
    for (var k = 0; k < 3; k++) {
      var ty = y - 14 * s - k * 30 * s, w = (40 - k * 9) * s;
      c.beginPath(); c.moveTo(x - w, ty); c.lineTo(x, ty - 50 * s); c.lineTo(x + w, ty); c.closePath();
      paint(S, col, 0.7);
      if (snow) { c.beginPath(); c.moveTo(x - w * 0.45, ty - 28 * s); c.lineTo(x, ty - 50 * s); c.lineTo(x + w * 0.45, ty - 28 * s); c.quadraticCurveTo(x, ty - 22 * s, x - w * 0.45, ty - 28 * s); c.fillStyle = '#FFFFFF'; c.fill(); }
    }
  }

  var PLACES = {
    field: function (S, R) {
      var c = S.c;
      hills(c, HORIZON - 4, 34, 0.009, 1.3, '#A7DA8A');
      hills(c, HORIZON + 10, 22, 0.014, 4.1, '#8FCF6C');
      groundFill(c, HORIZON + 18, '#86CC5E', '#56A443');
      tufts(S, R, 46, HORIZON + 24, '#4E9A3B');
      mark(S, 'place', 0, HORIZON - 30, W, 90);
      return { y0: HORIZON + 26, y1: H - 6 };
    },
    park: function (S, R) {
      var c = S.c;
      hills(c, HORIZON, 18, 0.01, 0.4, '#A3D68A');
      for (var i = 0; i < 7; i++) roundTree(S, 30 + i * 100 + R() * 30, HORIZON + 8, 0.55 + R() * 0.15, '#7CC46A', '#5DAA52');
      groundFill(c, HORIZON + 8, '#8FD06A', '#5EAD4B');
      // path
      c.beginPath();
      c.moveTo(150, H + 10); c.bezierCurveTo(250, 380, 330, 320, 300, HORIZON + 10);
      c.lineTo(345, HORIZON + 10); c.bezierCurveTo(390, 320, 380, 390, 500, H + 10); c.closePath();
      c.fillStyle = '#E9D2A6'; c.fill();
      tufts(S, R, 30, HORIZON + 20, '#4E9A3B');
      // bench
      var bx = 505, by = 312;
      c.fillStyle = '#6B4A30'; c.fillRect(bx + 8, by + 18, 6, 22); c.fillRect(bx + 92, by + 18, 6, 22);
      rrect(c, bx, by - 8, 106, 10, 3); paint(S, '#B5774A', 0.7);
      rrect(c, bx, by + 6, 106, 10, 3); paint(S, '#C98A55', 0.7);
      rrect(c, bx - 4, by + 18, 114, 8, 3); paint(S, '#A86A3E', 0.7);
      // lamp post
      c.fillStyle = '#3F4A5C'; c.fillRect(86, 230, 7, 112);
      rrect(c, 77, 212, 25, 26, 6); paint(S, '#4A5568', 0.7);
      rrect(c, 81, 217, 17, 15, 4); c.fillStyle = '#FFE9A6'; c.fill();
      S.lamps.push([89, 224, 70]);
      mark(S, 'place', 470, 280, 160, 80);
      return { y0: HORIZON + 22, y1: H - 6 };
    },
    forest: function (S, R) {
      var c = S.c, i;
      hills(c, HORIZON - 30, 20, 0.012, 2, '#5F9C6E');
      for (i = 0; i < 9; i++) pine(S, i * 78 + R() * 30, HORIZON + 4, 1.05 + R() * 0.3, i % 2 ? '#2F7550' : '#3B8A5C');
      for (i = 0; i < 6; i++) pine(S, 40 + i * 120 + R() * 30, HORIZON + 26, 0.75 + R() * 0.2, '#4A9A63');
      groundFill(c, HORIZON + 20, '#6FB257', '#4A8E40');
      // dirt path to the vanishing point
      c.beginPath();
      c.moveTo(130, H + 10); c.quadraticCurveTo(280, 330, 300, HORIZON + 22);
      c.lineTo(345, HORIZON + 22); c.quadraticCurveTo(380, 330, 520, H + 10); c.closePath();
      c.fillStyle = '#C9A06E'; c.fill();
      c.fillStyle = '#B88E5E';
      for (i = 0; i < 14; i++) { ell(c, 200 + R() * 240, 330 + R() * 140, 6 + R() * 6, 3); c.fill(); }
      tufts(S, R, 34, HORIZON + 30, '#3E7F35');
      // mushrooms
      [[70, 440], [585, 420]].forEach(function (m) {
        rrect(c, m[0] - 4, m[1] - 14, 8, 14, 3); paint(S, '#FFF3E0', 0.6);
        c.beginPath(); c.arc(m[0], m[1] - 13, 13, Math.PI, TAU); c.closePath(); paint(S, '#E5484D', 0.6);
        c.fillStyle = '#fff'; circle(c, m[0] - 5, m[1] - 19, 2.5); c.fill(); circle(c, m[0] + 5, m[1] - 17, 2); c.fill();
      });
      mark(S, 'place', 0, 110, 230, 160);
      return { y0: HORIZON + 30, y1: H - 6, avoid: [250, 400] };
    },
    beach: function (S, R) {
      var c = S.c;
      var sea = c.createLinearGradient(0, HORIZON - 18, 0, 316);
      sea.addColorStop(0, '#2D8FC9'); sea.addColorStop(1, '#6FD0E6');
      c.fillStyle = sea; c.fillRect(-W, HORIZON - 18, W * 3, 120);
      c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 2.5; c.lineCap = 'round';
      for (var i = 0; i < 14; i++) {
        var wx = R() * W, wy = HORIZON - 6 + R() * 50;
        c.beginPath(); c.moveTo(wx - 14, wy); c.quadraticCurveTo(wx - 7, wy - 5, wx, wy); c.quadraticCurveTo(wx + 7, wy - 5, wx + 14, wy); c.stroke();
      }
      // sand with a foamy edge
      c.beginPath(); c.moveTo(-W, H * 2);
      for (var x = -W; x <= W * 2; x += 16) c.lineTo(x, 304 + Math.sin(x * 0.03) * 5);
      c.lineTo(W * 2, H * 2); c.closePath();
      var sand = c.createLinearGradient(0, 300, 0, H); sand.addColorStop(0, '#F6DFA8'); sand.addColorStop(1, '#E9C27F');
      c.fillStyle = sand; c.fill();
      c.strokeStyle = '#FFFFFF'; c.lineWidth = 5;
      c.beginPath(); for (x = -20; x <= W + 20; x += 16) c[x === -20 ? 'moveTo' : 'lineTo'](x, 304 + Math.sin(x * 0.03) * 5); c.stroke();
      // shells + starfish
      c.fillStyle = '#F7B6A0';
      for (i = 0; i < 6; i++) { ell(c, R() * W, 340 + R() * 130, 5, 4); c.fill(); }
      c.save(); c.translate(560, 448); c.fillStyle = '#F2884B';
      c.beginPath(); for (i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 6 : 15; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); paint(S, '#F2884B', 0.6);
      c.restore();
      mark(S, 'place', 0, HORIZON - 20, W, 90);
      return { y0: 330, y1: H - 6 };
    },
    'snowy hill': function (S, R) {
      var c = S.c;
      hills(c, HORIZON - 30, 60, 0.008, 2.2, '#DCE7F5');
      for (var i = 0; i < 6; i++) pine(S, 30 + i * 115 + R() * 30, HORIZON + 6, 0.8 + R() * 0.2, '#2F7550', true);
      hills(c, HORIZON + 16, 26, 0.011, 0.6, '#EEF4FC');
      groundFill(c, HORIZON + 30, '#FBFDFF', '#DDE8F6');
      c.fillStyle = 'rgba(160,185,220,.28)';
      for (i = 0; i < 7; i++) { ell(c, R() * W, 320 + R() * 150, 40 + R() * 40, 7); c.fill(); }
      mark(S, 'place', 0, HORIZON - 90, W, 140);
      return { y0: HORIZON + 34, y1: H - 6 };
    },
    'living room': function (S, R) {
      var c = S.c;
      var wall = c.createLinearGradient(0, 0, 0, 335); wall.addColorStop(0, '#F7DEC0'); wall.addColorStop(1, '#EDC9A0');
      c.fillStyle = wall; c.fillRect(-W, -H, W * 3, H + 335);
      c.fillStyle = 'rgba(255,255,255,.22)';
      for (var x = -40; x < W + 40; x += 40) c.fillRect(x, 0, 14, 330);
      // window: cut a hole so the sky layer shows through
      var wx = 382, wy = 46, ww = 196, wh = 172;
      c.save(); c.globalCompositeOperation = 'destination-out'; c.fillRect(wx, wy, ww, wh); c.restore();
      c.lineJoin = 'round';
      c.strokeStyle = '#FFFFFF'; c.lineWidth = 12; c.strokeRect(wx, wy, ww, wh);
      c.lineWidth = 7; c.beginPath(); c.moveTo(wx + ww / 2, wy); c.lineTo(wx + ww / 2, wy + wh); c.moveTo(wx, wy + wh / 2); c.lineTo(wx + ww, wy + wh / 2); c.stroke();
      if (S.outline) { c.strokeStyle = S.ink; c.lineWidth = S.lw * 0.7; c.strokeRect(wx - 6, wy - 6, ww + 12, wh + 12); }
      rrect(c, wx - 16, wy + wh + 2, ww + 32, 12, 4); paint(S, '#FFFFFF', 0.7);
      // curtains
      [[wx - 34, 1], [wx + ww + 8, -1]].forEach(function (p) {
        c.beginPath(); c.moveTo(p[0], 28); c.lineTo(p[0] + 26, 28); c.quadraticCurveTo(p[0] + 14 + p[1] * 6, 140, p[0] + 26, 250); c.lineTo(p[0], 250); c.closePath();
        paint(S, '#4FB3A9', 0.7);
      });
      c.fillStyle = '#C79A5E'; c.fillRect(wx - 44, 22, ww + 88, 8);
      // floor
      var fl = c.createLinearGradient(0, 330, 0, H); fl.addColorStop(0, '#C48A57'); fl.addColorStop(1, '#A86E42');
      c.fillStyle = fl; c.fillRect(-W, 330, W * 3, H);
      c.fillStyle = '#FFFFFF'; c.fillRect(-W, 322, W * 3, 10);
      c.strokeStyle = 'rgba(90,50,20,.25)'; c.lineWidth = 2;
      for (var y = 352; y < H; y += 30) { c.beginPath(); c.moveTo(-10, y); c.lineTo(W + 10, y); c.stroke(); }
      // sofa
      rrect(c, 20, 236, 230, 70, 22); paint(S, '#E8746A');
      rrect(c, 10, 276, 250, 56, 18); paint(S, '#F08A7E');
      rrect(c, 40, 262, 90, 26, 12); paint(S, '#F7A79C', 0.7); rrect(c, 140, 262, 90, 26, 12); paint(S, '#F7A79C', 0.7);
      c.fillStyle = '#6B4A30'; c.fillRect(26, 330, 10, 14); c.fillRect(234, 330, 10, 14);
      // rug
      ell(c, 330, 424, 262, 50); paint(S, '#6E9FD8', 0.8);
      ell(c, 330, 424, 222, 36); c.strokeStyle = '#F6E7B8'; c.lineWidth = 5; c.setLineDash([12, 10]); c.stroke(); c.setLineDash([]);
      // floor lamp
      c.fillStyle = '#4A4050'; c.fillRect(296, 170, 6, 160); ell(c, 299, 332, 18, 5); c.fill();
      c.beginPath(); c.moveTo(276, 176); c.lineTo(322, 176); c.lineTo(312, 140); c.lineTo(286, 140); c.closePath(); paint(S, '#F6D365', 0.7);
      S.lamps.push([299, 172, 120]);
      // side table (flowers go in a vase here)
      rrect(c, 548, 300, 82, 12, 4); paint(S, '#9A6A44', 0.7);
      c.fillStyle = '#7A5234'; c.fillRect(558, 312, 8, 30); c.fillRect(612, 312, 8, 30);
      mark(S, 'place', 10, 230, 250, 110);
      return { indoor: true, window: { x: wx, y: wy, w: ww, h: wh } };
    },
    'city street': function (S, R) {
      var c = S.c, x = -30, i = 0;
      var cols = ['#D98B6F', '#E4B96A', '#86A6D6', '#B993CF', '#7FC4A8', '#E99C9C'];
      while (x < W + 20) {
        var bw = 90 + R() * 40, top = 70 + R() * 100, col = cols[i % cols.length];
        rrect(c, x, top, bw, 320 - top, 4); paint(S, col, 0.8);
        c.fillStyle = mix(col, '#2B2540', 0.25); c.fillRect(x, top, bw, 8);
        for (var wy = top + 22; wy < 280; wy += 34) {
          for (var wx = x + 14; wx < x + bw - 22; wx += 28) {
            rrect(c, wx, wy, 16, 20, 3); c.fillStyle = '#E8F1FA'; c.fill();
            S.windows.push([wx, wy, 16, 20]);
          }
        }
        x += bw + 6; i++;
      }
      c.fillStyle = '#CFC8C0'; c.fillRect(-W, 300, W * 3, 42);
      c.fillStyle = '#5B6270'; c.fillRect(-W, 342, W * 3, 64);
      c.fillStyle = '#F4D35E';
      for (x = 10; x < W; x += 70) c.fillRect(x, 371, 40, 6);
      c.fillStyle = '#A8A097'; c.fillRect(-W, 404, W * 3, 8);
      c.fillStyle = '#DCD5CC'; c.fillRect(-W, 412, W * 3, H);
      c.strokeStyle = 'rgba(120,110,100,.35)'; c.lineWidth = 2;
      for (x = 0; x < W; x += 64) { c.beginPath(); c.moveTo(x, 412); c.lineTo(x - 30, H); c.stroke(); }
      // street lamp
      c.fillStyle = '#3F4A5C'; c.fillRect(602, 180, 8, 236);
      c.beginPath(); c.moveTo(606, 184); c.quadraticCurveTo(606, 160, 580, 162); c.lineWidth = 6; c.strokeStyle = '#3F4A5C'; c.stroke();
      rrect(c, 566, 160, 28, 14, 5); paint(S, '#FFE9A6', 0.7);
      S.lamps.push([580, 172, 110]);
      mark(S, 'place', 0, 70, W, 250);
      return { y0: 420, y1: H - 4, city: true };
    }
  };

  /* ───────────────────────── flowers ───────────────────────── */
  function flower(S, x, y, s, col) {
    var c = S.c, F = FLOWER[col];
    c.strokeStyle = '#3F9A3A'; c.lineWidth = 2.4 * s; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 16 * s); c.stroke();
    ell(c, x + 5 * s, y - 6 * s, 5 * s, 2.4 * s, -0.5); c.fillStyle = '#4FAE45'; c.fill();
    var cy = y - 19 * s;
    for (var i = 0; i < 5; i++) {
      var a = -Math.PI / 2 + i * TAU / 5;
      circle(S.c, x + Math.cos(a) * 5.4 * s, cy + Math.sin(a) * 5.4 * s, 4.8 * s);
      paint(S, F.petal, 0.45 * s);
    }
    for (i = 0; i < 5; i++) { var b = -Math.PI / 2 + i * TAU / 5; circle(c, x + Math.cos(b) * 5.6 * s - 0.8 * s, cy + Math.sin(b) * 5.6 * s - 1.2 * s, 1.8 * s); c.fillStyle = F.hi; c.globalAlpha = 0.7; c.fill(); c.globalAlpha = 1; }
    circle(c, x, cy, 3.4 * s); paint(S, F.mid, 0.4 * s);
    return { x: x - 11 * s, y: cy - 11 * s, w: 22 * s, h: 30 * s };
  }
  /** Returns { back: [...], front: [...] } flower lists split by the subjects' baseline. */
  function planFlowers(S, sc, area) {
    var out = { back: [], front: [], vase: null, planters: null };
    if (sc.flowerAmount === 'none' || !area) return out;
    var R = stream(S.seed, 'flowers');
    var lots = sc.flowerAmount === 'lots';
    if (area.indoor) { out.vase = { n: lots ? 9 : 3 }; return out; }
    if (area.city) { out.planters = { lots: lots }; return out; }
    var n = lots ? 52 : 7, base = BASE_Y[sc.place];
    for (var i = 0, tries = 0; i < n && tries < 400; tries++) {
      var x = 14 + R() * (W - 28), y = area.y0 + Math.sqrt(R()) * (area.y1 - area.y0);
      if (area.avoid && x > area.avoid[0] && x < area.avoid[1]) continue;
      if (!lots && y > base - 6 && y < base + 30 && Math.abs(x - 320) < 220) continue; // keep few flowers out from under the subjects
      var s = 0.65 + (y - area.y0) / (area.y1 - area.y0) * 0.95;
      (y > base + 8 ? out.front : out.back).push([x, y, s]);
      i++;
    }
    return out;
  }
  function drawFlowerList(S, sc, list) {
    list.forEach(function (f) {
      var b = flower(S, f[0], f[1], f[2], sc.flowerColor);
      mark(S, 'flowers', b.x, b.y, b.w, b.h);
    });
  }
  function drawVase(S, sc, n) {
    var c = S.c, x = 589, y = 298;
    var R = stream(S.seed, 'vase');
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.22, len = 46 + R() * 18;
      var fx = x + Math.cos(a) * len, fy = y - 30 + Math.sin(a) * len;
      c.strokeStyle = '#3F9A3A'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x, y - 30); c.lineTo(fx, fy + 18); c.stroke();
      flower(S, fx, fy + 18, 1.05, sc.flowerColor);
    }
    c.beginPath(); c.moveTo(x - 14, y - 40); c.quadraticCurveTo(x - 28, y - 14, x - 16, y); c.lineTo(x + 16, y); c.quadraticCurveTo(x + 28, y - 14, x + 14, y - 40); c.closePath();
    paint(S, '#5C7FD6', 0.8);
    mark(S, 'flowers', x - 70, y - 110, 140, 112);
  }
  function drawPlanters(S, sc, lots) {
    var c = S.c, R = stream(S.seed, 'planters');
    var spots = lots ? [[16, 458], [496, 458], [256, 458]] : [[16, 458], [520, 458]];
    spots.forEach(function (p) {
      var n = lots ? 6 : 3;
      for (var i = 0; i < n; i++) flower(S, p[0] + 14 + i * (96 / n) + R() * 6, p[1] - 6, 1.15 + R() * 0.2, sc.flowerColor);
      rrect(c, p[0], p[1] - 10, 112, 26, 5); paint(S, '#A0603A', 0.8);
      mark(S, 'flowers', p[0], p[1] - 50, 112, 66);
    });
    if (lots) {
      // window boxes on the buildings
      S.windows.filter(function (w, k) { return k % 3 === 0 && w[1] > 120; }).slice(0, 10).forEach(function (w) {
        for (var j = 0; j < 3; j++) flower(S, w[0] + 2 + j * 6, w[1] + 26, 0.55, sc.flowerColor);
        c.fillStyle = '#8A5234'; c.fillRect(w[0] - 3, w[1] + 22, 22, 6);
      });
    }
  }

  /* ───────────────────────── props ───────────────────────── */
  function ball(S, x, y, r) {
    var c = S.c;
    ell(c, x, y + r * 0.95, r * 0.9, r * 0.25); c.fillStyle = 'rgba(30,20,50,.18)'; c.fill();
    circle(c, x, y, r); paint(S, '#E8414B');
    c.save(); circle(c, x, y, r); c.clip();
    c.fillStyle = '#FFFFFF'; c.fillRect(x - r, y - r * 0.18, r * 2, r * 0.36);
    c.restore();
    if (S.outline) { circle(c, x, y, r); c.strokeStyle = S.ink; c.lineWidth = S.lw; c.stroke(); }
    circle(c, x - r * 0.4, y - r * 0.45, r * 0.22); c.fillStyle = 'rgba(255,255,255,.75)'; c.fill();
  }
  function bowl(S, x, y, s) {
    var c = S.c;
    s = s || 1;
    c.beginPath(); c.moveTo(x - 20 * s, y - 14 * s); c.quadraticCurveTo(x - 18 * s, y, x - 10 * s, y); c.lineTo(x + 10 * s, y); c.quadraticCurveTo(x + 18 * s, y, x + 20 * s, y - 14 * s); c.closePath();
    paint(S, '#4F8DE0');
    ell(c, x, y - 14 * s, 20 * s, 5 * s); paint(S, '#8A5A34', 0.8);
    c.fillStyle = '#B5824F';
    for (var i = 0; i < 5; i++) { circle(c, x - 12 * s + i * 6 * s, y - 16 * s + (i % 2) * 2 * s, 2.6 * s); c.fill(); }
  }
  function zzz(S, x, y, s) {
    var c = S.c;
    c.save();
    c.font = '900 ' + Math.round(18 * s) + 'px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    [['z', 0, 0, 1], ['z', 13, -16, 1.25], ['Z', 28, -36, 1.55]].forEach(function (z) {
      c.font = '900 ' + Math.round(16 * s * z[3]) + 'px system-ui, sans-serif';
      c.lineWidth = 4 * s; c.strokeStyle = '#3C3566'; c.strokeText(z[0], x + z[1] * s, y + z[2] * s);
      c.fillStyle = '#FFFFFF'; c.fillText(z[0], x + z[1] * s, y + z[2] * s);
    });
    c.restore();
  }
  function motionLines(S, x, y, dir, s) {
    var c = S.c;
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineCap = 'round'; c.lineWidth = 4 * s;
    [[-10, 0, 34], [0, 0, 46], [10, 6, 30]].forEach(function (l) {
      c.beginPath(); c.moveTo(x - dir * (l[1] * s), y + l[0] * s); c.lineTo(x - dir * (l[1] + l[2]) * s, y + l[0] * s); c.stroke();
    });
    // dust puffs
    c.fillStyle = 'rgba(240,230,215,.85)';
    circle(c, x - dir * 4 * s, y + 40 * s, 8 * s); c.fill();
    circle(c, x - dir * 18 * s, y + 36 * s, 6 * s); c.fill();
  }
  function shadow(S, x, y, rx, a) {
    var c = S.c;
    ell(c, x, y, rx, rx * 0.2); c.fillStyle = 'rgba(30,20,50,' + (a || 0.2) + ')'; c.fill();
  }

  /* ───────────────────────── faces ───────────────────────── */
  function eyes(S, x1, x2, y, r, mode) {
    var c = S.c;
    if (mode === 'closed' || mode === 'happy') {
      c.strokeStyle = '#1D1B30'; c.lineWidth = Math.max(2, r * 0.6); c.lineCap = 'round';
      [x1, x2].forEach(function (x) {
        c.beginPath();
        if (mode === 'closed') c.arc(x, y - r * 0.2, r, 0.15 * Math.PI, 0.85 * Math.PI);
        else c.arc(x, y + r * 0.5, r, 1.15 * Math.PI, 1.85 * Math.PI);
        c.stroke();
      });
      return;
    }
    [x1, x2].forEach(function (x) {
      ell(c, x, y, r, r * 1.2); c.fillStyle = '#1D1B30'; c.fill();
      circle(c, x + r * 0.35, y - r * 0.45, r * 0.42); c.fillStyle = '#FFFFFF'; c.fill();
    });
  }
  function cheeks(S, x1, x2, y, r) {
    var c = S.c;
    c.fillStyle = 'rgba(242,110,140,.35)';
    ell(c, x1, y, r, r * 0.65); c.fill(); ell(c, x2, y, r, r * 0.65); c.fill();
  }

  /* ───────────────────────── four-legged friends ───────────────────────── */
  var QUAD = {
    dog:   { rx: 36, ry: 20, L: 32, lr: 7.5, hr: 23 },
    cat:   { rx: 33, ry: 17, L: 30, lr: 6.5, hr: 21 },
    bunny: { rx: 30, ry: 23, L: 14, lr: 8, hr: 21 }
  };
  function quadPose(kind, action) {
    var k = QUAD[kind];
    var p = { lift: 0, rot: 0, bx: 0, rx: k.rx, ry: k.ry, legs: [], eyes: 'open', mouth: 'smile', tail: 'up', haunch: null, paws: null, bowl: null, zzz: false, lines: false };
    p.by = -(k.L + k.ry * 0.6);
    function four(aFarB, aFarF, aB, aF, len) {
      var y = p.by + p.ry * 0.45, fx = p.rx * 0.52, bx = -p.rx * 0.52;
      len = len || -y;
      p.legs = [{ x: bx + 8, y: y, a: aFarB, len: len, far: true }, { x: fx + 8, y: y, a: aFarF, len: len, far: true },
                { x: bx, y: y, a: aB, len: len }, { x: fx, y: y, a: aF, len: len }];
    }
    switch (action) {
      case 'running':
        p.rx *= 1.12; p.ry *= 0.92; p.by -= 6; p.rot = -0.04;
        four(-0.95, 0.95, -0.6, 0.6, (k.L + k.ry * 0.2) * 1.02);
        p.hx = p.rx * 1.08; p.hy = p.by - p.ry * 0.95; p.tail = 'back'; p.mouth = 'open'; p.lines = true;
        break;
      case 'jumping':
        p.lift = 46; p.rot = -0.22;
        four(-1.25, 1.2, -1.0, 1.0, k.L * 0.85 + 4);
        p.hx = p.rx * 1.02; p.hy = p.by - p.ry * 1.05; p.mouth = 'open'; p.eyes = 'happy';
        break;
      case 'sitting':
        p.rx = k.ry * 1.25; p.ry = k.rx * 0.74; p.bx = -2; p.by = -(p.ry + 6);
        p.haunch = { x: -k.rx * 0.32, y: -k.ry * 0.75, rx: k.rx * 0.6, ry: k.ry * 0.82 };
        var fy = p.by + 4;
        p.legs = [{ x: k.rx * 0.36 + 8, y: fy, a: 0, len: -fy, far: true }, { x: k.rx * 0.36, y: fy, a: 0, len: -fy }];
        p.hx = k.rx * 0.32; p.hy = p.by - p.ry * 0.98; p.tail = 'ground';
        break;
      case 'sleeping':
        p.rx *= 1.1; p.ry *= 0.82; p.by = -p.ry; p.rot = 0;
        p.paws = [[p.rx * 0.92, -5], [p.rx * 0.92 + 14, -4]];
        p.hx = p.rx * 1.02 + 4; p.hy = -k.hr * 0.82; p.eyes = 'closed'; p.mouth = 'none'; p.tail = 'ground'; p.zzz = true;
        break;
      case 'eating':
        four(0, 0, 0, 0);
        p.rot = 0.06; p.hx = p.rx * 1.2; p.hy = p.by + p.ry * 0.7; p.bowl = [p.rx * 1.42, 0]; p.mouth = 'none'; p.eyes = 'happy';
        break;
      case 'kite':
        four(0, 0, 0, 0);
        p.hx = p.rx * 0.98; p.hy = p.by - p.ry * 1.35; p.mouth = 'open';
        break;
      default: // playing (and plain standing)
        four(-0.1, 0.25, -0.05, 0.35);
        p.rot = 0.1; p.hx = p.rx * 1.05; p.hy = p.by - p.ry * 0.8; p.mouth = 'open'; p.tail = 'wag';
    }
    return p;
  }
  function drawQuad(S, kind, color, action, sub) {
    var c = S.c, k = QUAD[kind], f = FUR[color], p = quadPose(kind, action);
    var hr = k.hr, B = sub.bounds;
    var spotList = sub.spots;
    // whole-body rotation around the body centre
    c.translate(0, p.by); c.rotate(p.rot); c.translate(0, -p.by);

    // tail (behind)
    var tx = p.bx - p.rx * 0.9, ty = p.by - p.ry * 0.25;
    if (kind === 'bunny') {
      circle(c, p.bx - p.rx * 0.98, p.by - p.ry * 0.1, 9); paint(S, f === FUR.white || f === FUR.spotted ? '#FFFFFF' : f.light);
    } else {
      var tw = kind === 'dog' ? 8 : 7;
      strokeCurve(S, function () {
        c.beginPath(); c.moveTo(tx + 6, ty);
        if (kind === 'dog') {
          if (p.tail === 'back') c.quadraticCurveTo(tx - 22, ty - 4, tx - 34, ty - 14);
          else if (p.tail === 'ground') c.quadraticCurveTo(tx - 18, -2, tx + 6, -4);
          else c.quadraticCurveTo(tx - 22, ty - 4, tx - 18 + (p.tail === 'wag' ? -8 : 0), ty - 30);
        } else {
          if (p.tail === 'back') c.bezierCurveTo(tx - 24, ty + 4, tx - 34, ty - 14, tx - 52, ty - 10);
          else if (p.tail === 'ground') c.bezierCurveTo(tx - 24, -4, tx - 10, -2, tx + 20, -3);
          else c.bezierCurveTo(tx - 26, ty + 2, tx - 10, ty - 40, tx - 30, ty - 52);
        }
      }, kind === 'dog' ? f.base : (color === 'gray' ? f.dark : f.base), tw);
      B(tx - 54, ty - 54, 60, 60);
    }
    // far legs
    p.legs.forEach(function (l) { if (l.far) leg(l, f.dark); });
    // body
    function bodyPath() { ell(c, p.bx, p.by, p.rx, p.ry); }
    bodyPath(); paint(S, f.base);
    if (spotList) spots(S, bodyPath, f.spot, [[p.bx - p.rx * 0.35, p.by - p.ry * 0.3, p.rx * 0.32, p.ry * 0.5], [p.bx + p.rx * 0.3, p.by + p.ry * 0.1, p.rx * 0.22, p.ry * 0.4]]);
    if (color === 'gray' && kind === 'cat') {
      c.save(); bodyPath(); c.clip(); c.strokeStyle = f.stripe; c.lineWidth = 4; c.lineCap = 'round';
      for (var s = -2; s <= 2; s++) { c.beginPath(); c.moveTo(p.bx + s * 12, p.by - p.ry); c.lineTo(p.bx + s * 12 - 4, p.by - p.ry * 0.2); c.stroke(); }
      c.restore();
    }
    ell(c, p.bx + p.rx * 0.5, p.by + p.ry * 0.3, p.rx * 0.32, p.ry * 0.45); c.fillStyle = f.light; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    B(p.bx - p.rx, p.by - p.ry, p.rx * 2, p.ry * 2);
    if (p.haunch) {
      var hh = p.haunch;
      ell(c, hh.x, hh.y, hh.rx, hh.ry); paint(S, f.base);
      ell(c, hh.x + hh.rx * 0.55, -5, hh.rx * 0.5, 6); paint(S, f.light, 0.8);
    }
    // near legs
    p.legs.forEach(function (l) { if (!l.far) leg(l, f.base); });
    if (p.paws) p.paws.forEach(function (pw) { ell(c, pw[0], pw[1], 9, 6); paint(S, f.light, 0.8); });
    // collar for dogs
    if (kind === 'dog') {
      c.save(); c.translate(p.hx - 6, p.hy + hr * 0.8); c.rotate(-0.5);
      rrect(c, -13, -4, 26, 8, 4); paint(S, '#E5484D', 0.8);
      circle(c, 0, 7, 4); paint(S, '#F7C531', 0.6);
      c.restore();
    }
    quadHead(S, kind, f, color, p.hx, p.hy, hr, p, spotList);
    B(p.hx - hr * 1.3, p.hy - hr * (kind === 'bunny' ? 2.6 : 1.4), hr * 2.6, hr * (kind === 'bunny' ? 3.6 : 2.5));
    if (p.bowl) bowl(S, p.bowl[0], p.bowl[1], 1);
    // anchors (local) for strings and zzz
    sub.anchor = [p.hx + hr * 0.6, p.hy + hr * 0.4];
    sub.head = [p.hx, p.hy - hr];
    sub.pose = p;

    function leg(l, col) {
      var x2 = l.x + Math.sin(l.a) * l.len, y2 = l.y + Math.cos(l.a) * l.len;
      capsule(c, l.x, l.y, x2, y2, k.lr); paint(S, col);
      ell(c, x2 + 2, y2 - 2, k.lr * 1.15, k.lr * 0.75); paint(S, l.far ? f.dark : f.light, 0.8);
      B(x2 - 10, y2 - 10, 20, 14);
    }
  }
  function quadHead(S, kind, f, color, hx, hy, r, p, spotted) {
    var c = S.c, d = r * 0.16;
    if (kind === 'cat') {
      [[-1, -0.15], [1, 0.15]].forEach(function (e) {
        var sx = e[0];
        c.beginPath(); c.moveTo(hx + sx * r * 0.92, hy - r * 0.2); c.lineTo(hx + sx * r * 0.78 + e[1] * r, hy - r * 1.2); c.lineTo(hx + sx * r * 0.12, hy - r * 0.82); c.closePath();
        paint(S, f.base);
        c.beginPath(); c.moveTo(hx + sx * r * 0.76, hy - r * 0.38); c.lineTo(hx + sx * r * 0.72 + e[1] * r * 0.8, hy - r * 0.95); c.lineTo(hx + sx * r * 0.3, hy - r * 0.74); c.closePath();
        c.fillStyle = '#F4A6B8'; c.fill();
      });
    }
    if (kind === 'bunny') {
      [[-0.42, -0.18], [0.38, 0.2]].forEach(function (e) {
        var ex = hx + e[0] * r, ey = hy - r * 1.45;
        ell(c, ex, ey, r * 0.34, r * 0.98, e[1]); paint(S, f.base);
        ell(c, ex, ey + r * 0.08, r * 0.17, r * 0.72, e[1]); c.fillStyle = '#F6AFC0'; c.fill();
      });
    }
    function headPath() { if (kind === 'bunny') ell(c, hx, hy, r * 1.05, r * 0.95); else if (kind === 'cat') ell(c, hx, hy, r * 1.05, r * 0.93); else circle(c, hx, hy, r); }
    headPath(); paint(S, f.base);
    if (spotted) spots(S, headPath, f.spot, [[hx - r * 0.35 + d, hy - r * 0.2, r * 0.38, r * 0.42]]);
    if (kind === 'cat' && color === 'gray') {
      c.strokeStyle = f.stripe; c.lineWidth = 3; c.lineCap = 'round';
      for (var s = -1; s <= 1; s++) { c.beginPath(); c.moveTo(hx + d + s * 6, hy - r * 0.9); c.lineTo(hx + d + s * 5, hy - r * 0.55); c.stroke(); }
    }
    var ey = hy - r * 0.12, ex1 = hx - r * 0.36 + d, ex2 = hx + r * 0.36 + d;
    if (kind === 'dog') {
      // floppy ears over the sides of the head
      ell(c, hx - r * 0.86, hy + r * 0.1, r * 0.3, r * 0.62, 0.3); paint(S, f.ear);
      ell(c, hx + r * 0.9, hy + r * 0.1, r * 0.28, r * 0.6, -0.3); paint(S, f.ear);
      ell(c, hx + d, hy + r * 0.42, r * 0.5, r * 0.36); paint(S, f.light, 0.8);
      eyes(S, ex1, ex2, ey, r * 0.13, p.eyes);
      ell(c, hx + d, hy + r * 0.24, r * 0.2, r * 0.14); c.fillStyle = '#231C2B'; c.fill();
      circle(c, hx + d - r * 0.06, hy + r * 0.2, r * 0.05); c.fillStyle = '#FFFFFF'; c.fill();
      mouth(hx + d, hy + r * 0.4, r * 0.85);
    } else if (kind === 'cat') {
      ell(c, hx + d - r * 0.2, hy + r * 0.38, r * 0.26, r * 0.2); c.fillStyle = f.light; c.fill();
      ell(c, hx + d + r * 0.2, hy + r * 0.38, r * 0.26, r * 0.2); c.fill();
      if (p.eyes === 'open') {
        [ex1, ex2].forEach(function (x) {
          ell(c, x, ey, r * 0.16, r * 0.2); c.fillStyle = '#8CCB4E'; c.fill();
          if (S.outline) { c.strokeStyle = S.ink; c.lineWidth = 1.5; c.stroke(); }
          ell(c, x, ey, r * 0.05, r * 0.16); c.fillStyle = '#1D1B30'; c.fill();
          circle(c, x + r * 0.06, ey - r * 0.08, r * 0.04); c.fillStyle = '#FFFFFF'; c.fill();
        });
      } else eyes(S, ex1, ex2, ey, r * 0.13, p.eyes);
      c.beginPath(); c.moveTo(hx + d - r * 0.1, hy + r * 0.2); c.lineTo(hx + d + r * 0.1, hy + r * 0.2); c.lineTo(hx + d, hy + r * 0.32); c.closePath(); c.fillStyle = '#F07C98'; c.fill();
      c.strokeStyle = color === 'black' ? '#C9C4D6' : '#5A5468'; c.lineWidth = 1.4;
      [-1, 1].forEach(function (sx) {
        for (var w = -1; w <= 1; w++) { c.beginPath(); c.moveTo(hx + d + sx * r * 0.3, hy + r * 0.36 + w * 3); c.lineTo(hx + d + sx * r * 1.15, hy + r * 0.3 + w * 7); c.stroke(); }
      });
      mouth(hx + d, hy + r * 0.34, r * 0.6);
    } else { // bunny
      ell(c, hx + d, hy + r * 0.4, r * 0.42, r * 0.3); c.fillStyle = f.light; c.fill();
      eyes(S, ex1, ex2, ey, r * 0.14, p.eyes);
      ell(c, hx + d, hy + r * 0.22, r * 0.12, r * 0.09); c.fillStyle = '#F07C98'; c.fill();
      rrect(c, hx + d - r * 0.12, hy + r * 0.42, r * 0.24, r * 0.2, 2); paint(S, '#FFFFFF', 0.5);
      mouth(hx + d, hy + r * 0.34, r * 0.55);
    }
    cheeks(S, ex1 - r * 0.12, ex2 + r * 0.12, hy + r * 0.25, r * 0.15);

    function mouth(mx, my, w) {
      if (p.mouth === 'none') return;
      if (p.mouth === 'open') {
        c.beginPath(); c.moveTo(mx - w * 0.3, my); c.quadraticCurveTo(mx, my + w * 0.55, mx + w * 0.3, my); c.closePath();
        c.fillStyle = '#7A2A3A'; c.fill();
        if (kind === 'dog') { ell(c, mx + w * 0.04, my + w * 0.32, w * 0.14, w * 0.2); c.fillStyle = '#F47C8E'; c.fill(); }
        return;
      }
      c.strokeStyle = '#1D1B30'; c.lineWidth = 1.8; c.lineCap = 'round';
      c.beginPath(); c.arc(mx - w * 0.15, my, w * 0.15, 0.1 * Math.PI, 0.9 * Math.PI); c.arc(mx + w * 0.15, my, w * 0.15, 0.1 * Math.PI, 0.9 * Math.PI); c.stroke();
    }
  }

  /* ───────────────────────── ducks ───────────────────────── */
  function drawDuck(S, color, action, sub) {
    var c = S.c, f = FEATHER[color], B = sub.bounds;
    var p = { bx: 0, by: -32, rx: 32, ry: 22, rot: 0, hx: 22, hy: -68, hr: 17, legs: true, wing: 'rest', eyes: 'open', bill: 0, lift: 0 };
    switch (action) {
      case 'running': p.rot = -0.1; p.hx = 28; p.hy = -68; p.wing = 'flap'; p.legs = 'run'; break;
      case 'jumping': p.lift = 42; p.wing = 'up'; p.legs = 'dangle'; p.eyes = 'happy'; break;
      case 'sitting': p.by = -22; p.hy = -58; p.legs = false; break;
      case 'sleeping': p.by = -22; p.hx = 14; p.hy = -42; p.legs = false; p.eyes = 'closed'; break;
      case 'eating': p.rot = 0.28; p.hx = 38; p.hy = -30; p.bill = 0.5; break;
      case 'kite': p.hy = -72; p.bill = -0.35; break;
      default: p.wing = 'reach'; p.eyes = 'happy';
    }
    c.translate(0, p.by); c.rotate(p.rot); c.translate(0, -p.by);
    // legs
    if (p.legs) {
      [[-8, p.legs === 'run' ? -0.5 : p.legs === 'dangle' ? -0.6 : 0], [10, p.legs === 'run' ? 0.6 : p.legs === 'dangle' ? -0.3 : 0]].forEach(function (l) {
        var x2 = l[0] + Math.sin(l[1]) * 16, y2 = p.by + 18 + Math.cos(l[1]) * 16;
        c.strokeStyle = '#F08A24'; c.lineWidth = 4; c.lineCap = 'round';
        c.beginPath(); c.moveTo(l[0], p.by + 14); c.lineTo(x2, y2); c.stroke();
        c.beginPath(); c.moveTo(x2 - 6, y2 + 2); c.lineTo(x2 + 12, y2 + 2); c.lineTo(x2 + 2, y2 - 6); c.closePath(); paint(S, '#F59E2B', 0.7);
      });
    }
    // tail feathers
    c.beginPath(); c.moveTo(p.bx - p.rx + 6, p.by - 6); c.lineTo(p.bx - p.rx - 14, p.by - 22); c.lineTo(p.bx - p.rx + 4, p.by + 6); c.closePath(); paint(S, f.base);
    // neck + body
    capsule(c, p.bx + 14, p.by - 8, p.hx - 2, p.hy + 6, 11); paint(S, f.base);
    function bodyPath() { ell(c, p.bx, p.by, p.rx, p.ry); }
    bodyPath(); paint(S, f.base);
    capsule(c, p.bx + 14, p.by - 8, p.hx - 2, p.hy + 6, 10); c.fillStyle = f.base; c.fill();
    if (f.spot) spots(S, bodyPath, f.spot, [[-12, p.by - 8, 9, 7], [8, p.by + 8, 7, 5], [-20, p.by + 8, 5, 4]]);
    B(p.bx - p.rx - 16, p.by - p.ry, p.rx * 2 + 16, p.ry * 2 + 20);
    // wing
    c.save();
    c.translate(p.bx + 4, p.by - 6);
    var wr = p.wing === 'up' ? -2.2 : p.wing === 'flap' ? -1.2 : p.wing === 'reach' ? -0.5 : -0.12;
    c.rotate(wr);
    ell(c, -14, 0, 20, 11); paint(S, f.dark);
    c.restore();
    // head
    circle(c, p.hx, p.hy, p.hr); paint(S, f.base);
    if (color === 'brown') { circle(c, p.hx, p.hy, p.hr); c.save(); c.clip(); c.fillStyle = '#4F8F5A'; c.fillRect(p.hx - 30, p.hy - 30, 60, 26); c.restore(); if (S.outline) { circle(c, p.hx, p.hy, p.hr); c.lineWidth = S.lw; c.strokeStyle = S.ink; c.stroke(); } }
    B(p.hx - p.hr, p.hy - p.hr, p.hr * 2 + 22, p.hr * 2);
    // bill
    c.save(); c.translate(p.hx + p.hr * 0.75, p.hy + p.hr * 0.12); c.rotate(p.bill);
    c.beginPath(); c.moveTo(-4, -7); c.quadraticCurveTo(14, -10, 22, -1); c.quadraticCurveTo(14, 7, -4, 6); c.closePath(); paint(S, '#F59E2B', 0.8);
    c.strokeStyle = '#C46A12'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(16, 0); c.stroke();
    c.restore();
    // eye (profile)
    if (p.eyes === 'open') { ell(c, p.hx + p.hr * 0.3, p.hy - p.hr * 0.25, 3.4, 4.2); c.fillStyle = '#1D1B30'; c.fill(); circle(c, p.hx + p.hr * 0.38, p.hy - p.hr * 0.38, 1.4); c.fillStyle = '#fff'; c.fill(); }
    else { c.strokeStyle = '#1D1B30'; c.lineWidth = 2.2; c.lineCap = 'round'; c.beginPath(); if (p.eyes === 'closed') c.arc(p.hx + p.hr * 0.3, p.hy - p.hr * 0.3, 4, 0.15 * Math.PI, 0.85 * Math.PI); else c.arc(p.hx + p.hr * 0.3, p.hy - p.hr * 0.15, 4, 1.15 * Math.PI, 1.85 * Math.PI); c.stroke(); }
    ell(c, p.hx + p.hr * 0.15, p.hy + p.hr * 0.35, 4, 2.6); c.fillStyle = 'rgba(242,110,140,.4)'; c.fill();
    if (action === 'eating') bowl(S, 50, 0, 1);
    sub.anchor = [p.hx + p.hr + 16, p.hy + 4];
    sub.head = [p.hx, p.hy - p.hr];
    sub.pose = { lift: p.lift, zzz: action === 'sleeping', lines: action === 'running' };
  }

  /* ───────────────────────── kids & robots ───────────────────────── */
  function bipedPose(action) {
    var p = { lift: 0, lean: 0, legL: -0.08, legR: 0.08, armL: -0.25, armR: 0.25, sit: false, lie: false, eyes: 'open', mouth: 'smile', bowl: false, lines: false, zzz: false };
    switch (action) {
      case 'running': p.legL = -0.6; p.legR = 0.6; p.armL = 0.9; p.armR = -0.8; p.lean = 0.12; p.lift = 3; p.lines = true; p.mouth = 'open'; break;
      case 'jumping': p.lift = 46; p.legL = -0.42; p.legR = 0.42; p.armL = -2.5; p.armR = 2.5; p.eyes = 'happy'; p.mouth = 'open'; break;
      case 'sitting': p.sit = true; p.armL = -0.15; p.armR = 0.15; break;
      case 'sleeping': p.lie = true; p.eyes = 'closed'; p.mouth = 'none'; p.zzz = true; break;
      case 'eating': p.armL = 0.75; p.armR = -0.75; p.bowl = true; p.mouth = 'open'; break;
      case 'kite': p.armR = 2.6; p.armL = -0.5; p.mouth = 'open'; break;
      default: p.legR = 0.75; p.armL = -0.5; p.armR = 0.9; p.eyes = 'happy'; p.mouth = 'open'; // playing: kicking a ball
    }
    return p;
  }
  function drawBiped(S, kind, color, action, sub) {
    var c = S.c, B = sub.bounds, robot = kind === 'robot';
    var p = bipedPose(action);
    var m = robot ? METAL[color] : null;
    var skin = SKIN[sub.i % SKIN.length], shirt = robot ? m.base : SHIRT[(sub.i * 2 + (color.length % 3)) % SHIRT.length];
    var hair = HAIR[color], pants = robot ? m.dark : '#3E5C9E';
    if (p.lie) return lyingBiped();
    var hipY = p.sit ? -18 : -42, legLen = 40, shY = hipY - 36, headY = shY - 30;
    c.translate(0, 0); c.rotate(p.lean);
    // legs
    if (p.sit) {
      ell(c, 0, -12, 28, 12); paint(S, pants);
      [-24, 24].forEach(function (x) { ell(c, x, -6, 10, 7); paint(S, robot ? m.dark : '#E5484D', 0.8); });
    } else {
      [[-9, p.legL], [9, p.legR]].forEach(function (l) {
        var x2 = l[0] + Math.sin(l[1]) * legLen, y2 = hipY + Math.cos(l[1]) * legLen;
        capsule(c, l[0], hipY, x2, y2, robot ? 6 : 7.5); paint(S, pants);
        if (robot) { rrect(c, x2 - 10, y2 - 6, 20, 10, 3); paint(S, m.dark); }
        else { ell(c, x2 + 3, y2, 10, 6.5); paint(S, '#E5484D', 0.8); }
        B(x2 - 12, y2 - 8, 24, 14);
      });
    }
    // arms (behind torso for crossing poses)
    function arm(side, a) {
      var sx = side * 15, x2 = sx + Math.sin(a) * 32, y2 = shY + Math.cos(a) * 32;
      capsule(c, sx, shY, x2, y2, robot ? 5 : 6.5); paint(S, robot ? m.dark : shirt);
      circle(c, x2, y2, robot ? 7 : 6.5); paint(S, robot ? m.light : skin, 0.8);
      B(x2 - 8, y2 - 8, 16, 16);
      return [x2, y2];
    }
    var handL = arm(-1, p.armL);
    // torso
    var tw = robot ? 46 : 38;
    rrect(c, -tw / 2, shY - 8, tw, hipY - shY + 14, robot ? 9 : 13); paint(S, shirt);
    if (m && m.spot) spots(S, function () { rrect(c, -tw / 2, shY - 8, tw, hipY - shY + 14, 9); }, m.spot, [[-12, shY + 6, 8, 6], [10, shY + 22, 7, 5]]);
    if (robot) {
      rrect(c, -14, shY + 2, 28, 22, 5); paint(S, '#2E3954', 0.7);
      [['#5CE1E6', -7], ['#F7C531', 0], ['#FF6B6B', 7]].forEach(function (d) { circle(c, d[1], shY + 13, 3.2); c.fillStyle = d[0]; c.fill(); });
    } else if (color === 'spotted') {
      c.fillStyle = 'rgba(255,255,255,.75)';
      [[-8, shY + 6], [7, shY + 14], [-5, shY + 24], [9, shY + 30]].forEach(function (d) { circle(c, d[0], d[1], 3); c.fill(); });
    } else {
      c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(-tw / 2 + 2, shY + 10, tw - 4, 5);
    }
    B(-tw / 2, shY - 8, tw, hipY - shY + 14);
    var handR = arm(1, p.armR);
    if (p.bowl) { bowl(S, 0, shY + 30, 0.9); }
    // head
    if (robot) {
      c.strokeStyle = m.dark; c.lineWidth = 3; c.beginPath(); c.moveTo(0, headY - 18); c.lineTo(0, headY - 32); c.stroke();
      circle(c, 0, headY - 34, 5.5); paint(S, '#FF5A5F', 0.8);
      rrect(c, -24, headY - 20, 48, 40, 10); paint(S, m.base);
      circle(c, -25, headY, 5); paint(S, m.dark, 0.7); circle(c, 25, headY, 5); paint(S, m.dark, 0.7);
      rrect(c, -17, headY - 12, 34, 22, 7); paint(S, '#26304A', 0.7);
      if (p.eyes === 'open') { [-7, 7].forEach(function (x) { ell(c, x, headY - 2, 4, 5); c.fillStyle = '#6CF0F5'; c.fill(); }); }
      else { c.strokeStyle = '#6CF0F5'; c.lineWidth = 2.5; c.lineCap = 'round'; [-7, 7].forEach(function (x) { c.beginPath(); if (p.eyes === 'happy') c.arc(x, headY + 1, 4, 1.15 * Math.PI, 1.85 * Math.PI); else { c.moveTo(x - 4, headY - 1); c.lineTo(x + 4, headY - 1); } c.stroke(); }); }
      c.strokeStyle = '#6CF0F5'; c.lineWidth = 2; c.beginPath(); c.arc(0, headY + 3, 5, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke();
      B(-26, headY - 40, 52, 62);
    } else {
      circle(c, 0, headY, 24); paint(S, skin);
      // hair: a cap + bangs, pigtails on every other kid
      c.save(); circle(c, 0, headY, 24); c.clip();
      c.beginPath(); c.moveTo(-26, headY - 2); c.quadraticCurveTo(-20, headY - 30, 4, headY - 28); c.quadraticCurveTo(26, headY - 26, 26, headY - 2);
      c.quadraticCurveTo(14, headY - 14, 6, headY - 12); c.quadraticCurveTo(-6, headY - 16, -26, headY - 2); c.closePath(); c.fillStyle = hair; c.fill();
      c.restore();
      if (S.outline) { circle(c, 0, headY, 24); c.strokeStyle = S.ink; c.lineWidth = S.lw; c.stroke(); }
      if (sub.i % 2) { [-1, 1].forEach(function (sx) { circle(c, sx * 26, headY - 6, 8); paint(S, hair, 0.8); }); }
      eyes(S, -8, 8, headY + 1, 3, p.eyes);
      cheeks(S, -14, 14, headY + 9, 4);
      if (p.mouth === 'open') { c.beginPath(); c.moveTo(-5, headY + 10); c.quadraticCurveTo(0, headY + 18, 5, headY + 10); c.closePath(); c.fillStyle = '#7A2A3A'; c.fill(); }
      else if (p.mouth === 'smile') { c.strokeStyle = '#1D1B30'; c.lineWidth = 2; c.beginPath(); c.arc(0, headY + 8, 5, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); }
      B(-34, headY - 26, 68, 50);
    }
    sub.anchor = p.armR > 2 ? handR : p.bowl ? [0, shY] : handR;
    sub.head = [0, headY - 26];
    sub.pose = p;

    function lyingBiped() {
      // pillow, head and a cosy blanket
      ell(c, 50, -12, 24, 12); paint(S, '#FFFFFF');
      if (robot) {
        rrect(c, 24, -46, 44, 38, 10); paint(S, m.base);
        rrect(c, 31, -38, 30, 20, 6); paint(S, '#26304A', 0.7);
        c.strokeStyle = '#6CF0F5'; c.lineWidth = 2.5; [39, 53].forEach(function (x) { c.beginPath(); c.moveTo(x - 3, -29); c.lineTo(x + 3, -29); c.stroke(); });
        c.strokeStyle = m.dark; c.lineWidth = 3; c.beginPath(); c.moveTo(68, -27); c.lineTo(80, -27); c.stroke(); circle(c, 83, -27, 5); paint(S, '#FF5A5F', 0.8);
      } else {
        circle(c, 46, -28, 22); paint(S, skin);
        c.save(); circle(c, 46, -28, 22); c.clip(); c.fillStyle = hair; c.fillRect(56, -56, 20, 60); c.restore();
        if (S.outline) { circle(c, 46, -28, 22); c.strokeStyle = S.ink; c.lineWidth = S.lw; c.stroke(); }
        c.save(); c.translate(46, -28); c.rotate(-Math.PI / 2);
        eyes(S, -7, 7, -2, 3, 'closed'); cheeks(S, -13, 13, 6, 4);
        c.restore();
      }
      rrect(c, -66, -38, 96, 38, 16); paint(S, shirt);
      c.save(); rrect(c, -66, -38, 96, 38, 16); c.clip();
      c.fillStyle = 'rgba(255,255,255,.35)'; for (var x = -60; x < 30; x += 18) c.fillRect(x, -40, 7, 44);
      c.restore();
      B(-68, -50, 156, 52);
      sub.anchor = [20, -40];
      sub.head = [40, -50];
      sub.pose = p;
    }
  }

  /* ───────────────────────── subjects ───────────────────────── */
  function drawSubject(S, sc, sp) {
    var c = S.c;
    var sub = { i: sp.i, anchor: [0, -60], head: [0, -90], pose: {}, spots: sc.color === 'spotted' && sc.kind !== 'kid' };
    var bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    sub.bounds = function (x, y, w, h) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x + w); by1 = Math.max(by1, y + h); };
    var lift = sc.action === 'jumping' ? (sc.kind === 'duck' ? 42 : 46) : 0;
    shadow(S, sp.x, sp.y, (sc.kind === 'kid' || sc.kind === 'robot') && sc.action !== 'sleeping' ? 30 * sp.s : 44 * sp.s, lift ? 0.12 : 0.2);
    c.save();
    c.translate(sp.x, sp.y - lift * sp.s);
    c.scale(sp.s * sp.facing, sp.s);
    if (sc.kind === 'duck') drawDuck(S, sc.color, sc.action, sub);
    else if (sc.kind === 'kid' || sc.kind === 'robot') drawBiped(S, sc.kind, sc.color, sc.action, sub);
    else drawQuad(S, sc.kind, sc.color, sc.action, sub);
    c.restore();
    function toWorld(pt) { return [sp.x + sp.facing * sp.s * pt[0], sp.y + sp.s * (pt[1] - lift)]; }
    var a = toWorld([bx0, by0]), b = toWorld([bx1, by1]);
    var box = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    mark(S, 'subject', box.x, box.y, box.w, box.h);
    var head = toWorld(sub.head);
    if (sub.pose.zzz) zzz(S, head[0] + 10 * sp.facing, head[1] - 4, sp.s);
    if (sub.pose.lines) motionLines(S, box.x + (sp.facing > 0 ? 0 : box.w), sp.y - 44 * sp.s, sp.facing, sp.s);
    return { box: box, anchor: toWorld(sub.anchor), facing: sp.facing, s: sp.s, x: sp.x, y: sp.y };
  }

  /* ───────────────────────── extras ───────────────────────── */
  function adult(S, x, y, s, coat, hair, skin) {
    var c = S.c;
    c.save(); c.translate(x, y); c.scale(s, s);
    capsule(c, -7, -50, -8, -2, 6); paint(S, '#3A3F55'); capsule(c, 7, -50, 8, -2, 6); paint(S, '#3A3F55');
    rrect(c, -18, -104, 36, 60, 12); paint(S, coat);
    capsule(c, -16, -96, -22, -60, 5.5); paint(S, coat); capsule(c, 16, -96, 22, -60, 5.5); paint(S, coat);
    circle(c, 0, -118, 16); paint(S, skin);
    c.save(); circle(c, 0, -118, 16); c.clip(); c.fillStyle = hair; c.fillRect(-20, -140, 40, 16); c.restore();
    eyes(S, -5, 5, -117, 2, 'open');
    c.restore();
  }
  function drawExtrasBack(S, sc, area) {
    var c = S.c, has = function (e) { return sc.extras.indexOf(e) >= 0; };
    var indoor = !!(area && area.indoor);
    if (has('house')) {
      if (indoor) {
        rrect(c, 70, 62, 130, 104, 6); paint(S, '#8A5A3A');
        c.fillStyle = '#BFE3F7'; c.fillRect(80, 72, 110, 84);
        c.fillStyle = '#7CC46A'; c.fillRect(80, 132, 110, 24);
        houseShape(S, 135, 140, 0.5);
        mark(S, 'house', 66, 58, 138, 112);
      } else {
        var hx = sc.place === 'city street' ? 70 : 560, hy = sc.place === 'beach' ? 300 : HORIZON + 22;
        houseShape(S, hx, hy, sc.place === 'city street' ? 0.9 : 0.85);
        mark(S, 'house', hx - 60, hy - 110, 120, 116);
      }
    }
    if (has('tree')) {
      if (indoor) {
        // a big potted plant
        rrect(c, 268, 292, 44, 40, 8); paint(S, '#D9734A');
        [[-24, -0.6], [0, 0], [24, 0.6], [-12, -0.3], [12, 0.3]].forEach(function (l) { ell(c, 290 + l[0], 250, 13, 40, l[1]); paint(S, '#4FAE45', 0.7); });
        mark(S, 'tree', 250, 200, 80, 134);
      } else {
        var tx = sc.place === 'beach' ? 70 : 64, ty = sc.place === 'city street' ? 330 : HORIZON + 70;
        if (sc.place === 'beach') {
          // palm tree
          c.strokeStyle = '#9A6A44'; c.lineWidth = 14; c.lineCap = 'round';
          c.beginPath(); c.moveTo(tx, ty + 10); c.quadraticCurveTo(tx + 10, ty - 80, tx + 34, ty - 170); c.stroke();
          [-2.6, -1.9, -1.2, -0.5, 0.2].forEach(function (a) {
            c.save(); c.translate(tx + 34, ty - 170); c.rotate(a); ell(c, 44, 0, 46, 11); paint(S, '#3FA34D', 0.8); c.restore();
          });
          mark(S, 'tree', tx - 40, ty - 220, 150, 240);
        } else {
          c.fillStyle = '#7A4E30'; rrect(c, tx - 13, ty - 120, 26, 124, 6); paint(S, '#8A5A3A');
          circle(c, tx, ty - 150, 64); paint(S, '#4E9A46');
          circle(c, tx - 40, ty - 112, 42); paint(S, '#4E9A46');
          circle(c, tx + 44, ty - 116, 42); paint(S, '#4E9A46');
          circle(c, tx - 12, ty - 162, 40); c.fillStyle = '#6FBE55'; c.fill();
          mark(S, 'tree', tx - 86, ty - 216, 176, 220);
        }
      }
    }
    if (has('people')) {
      if (indoor) {
        adult(S, 130, 318, 0.95, '#6C7CE0', '#3A2A20', '#E6AF84');
        mark(S, 'people', 100, 180, 64, 140);
      } else {
        var py = sc.place === 'beach' ? 334 : sc.place === 'city street' ? 336 : HORIZON + 50;
        var ps = sc.place === 'city street' ? 0.78 : 0.7;
        adult(S, 120, py, ps, '#E86A92', '#5A3A28', '#F7D2AE');
        adult(S, 162, py + 4, ps * 1.05, '#4C8BE8', '#2E2833', '#B57A50');
        adult(S, 540, py + 2, ps, '#F2A53A', '#7B4A26', '#E6AF84');
        mark(S, 'people', 96, py - 150 * ps, 92, 150 * ps);
        mark(S, 'people', 520, py - 150 * ps, 40, 150 * ps);
      }
    }
  }
  function houseShape(S, x, y, s) {
    var c = S.c;
    c.save(); c.translate(x, y); c.scale(s, s);
    rrect(c, -50, -70, 100, 70, 4); paint(S, '#FFF1D6');
    c.beginPath(); c.moveTo(-62, -66); c.lineTo(0, -118); c.lineTo(62, -66); c.closePath(); paint(S, '#E5484D');
    rrect(c, -12, -40, 24, 40, 4); paint(S, '#8A5A3A', 0.8);
    rrect(c, 22, -54, 20, 18, 3); paint(S, '#BFE3F7', 0.8); rrect(c, -42, -54, 20, 18, 3); paint(S, '#BFE3F7', 0.8);
    c.restore();
  }
  function drawKite(S, from, facing) {
    var c = S.c;
    var kx = clamp(from[0] + facing * 130, 70, 570), ky = 92;
    c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(from[0], from[1]); c.quadraticCurveTo((from[0] + kx) / 2 - facing * 30, (from[1] + ky) / 2 + 30, kx, ky + 40); c.stroke();
    // tail with bows
    c.strokeStyle = '#2B2540'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(kx, ky + 40); c.bezierCurveTo(kx - 20, ky + 70, kx + 20, ky + 90, kx - 6, ky + 120); c.stroke();
    ['#FF5A5F', '#F7C531', '#3FB6A8'].forEach(function (col, i) {
      var bx = kx + [-8, 6, -4][i], by = ky + 62 + i * 20;
      c.beginPath(); c.moveTo(bx, by); c.lineTo(bx - 8, by - 5); c.lineTo(bx - 8, by + 5); c.closePath(); c.moveTo(bx, by); c.lineTo(bx + 8, by - 5); c.lineTo(bx + 8, by + 5); c.closePath();
      c.fillStyle = col; c.fill();
    });
    var q = [[kx, ky - 40], [kx + 28, ky], [kx, ky + 40], [kx - 28, ky]];
    var cols = ['#FF5A5F', '#F7C531', '#4C8BE8', '#3FB6A8'];
    for (var i = 0; i < 4; i++) {
      c.beginPath(); c.moveTo(kx, ky); c.lineTo(q[i][0], q[i][1]); c.lineTo(q[(i + 1) % 4][0], q[(i + 1) % 4][1]); c.closePath();
      c.fillStyle = cols[i]; c.fill();
    }
    c.beginPath(); q.forEach(function (pt, k) { c[k ? 'lineTo' : 'moveTo'](pt[0], pt[1]); }); c.closePath();
    if (S.outline) { c.strokeStyle = S.ink; c.lineWidth = S.lw; c.stroke(); }
    c.strokeStyle = 'rgba(43,37,64,.6)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(kx, ky - 40); c.lineTo(kx, ky + 40); c.moveTo(kx - 28, ky); c.lineTo(kx + 28, ky); c.stroke();
    mark(S, 'kite', kx - 36, ky - 46, 72, 170);
  }
  function drawBalloons(S, anchor, facing, s) {
    var c = S.c;
    var cols = ['#FF5A5F', '#F7C531', '#4C8BE8', '#F27BA5'];
    var bx = anchor[0] + facing * 10, by = anchor[1] - 120 * Math.max(0.8, s);
    var off = [[-24, 8], [0, -14], [24, 6], [6, 26]];
    c.strokeStyle = 'rgba(60,50,90,.8)'; c.lineWidth = 1.4;
    off.forEach(function (o) { c.beginPath(); c.moveTo(anchor[0], anchor[1]); c.quadraticCurveTo(bx + o[0] * 0.3, by + 60, bx + o[0], by + o[1] + 22); c.stroke(); });
    off.forEach(function (o, i) {
      var x = bx + o[0], y = by + o[1];
      ell(c, x, y, 18, 22); paint(S, cols[i]);
      ell(c, x - 6, y - 8, 4, 7, -0.4); c.fillStyle = 'rgba(255,255,255,.6)'; c.fill();
      c.beginPath(); c.moveTo(x - 4, y + 25); c.lineTo(x + 4, y + 25); c.lineTo(x, y + 20); c.closePath(); c.fillStyle = cols[i]; c.fill();
    });
    mark(S, 'balloons', bx - 46, by - 40, 92, 100);
  }

  /* ───────────────────────── tint + weather ───────────────────────── */
  function tintLayer(canvas, color) {
    var c = canvas.getContext('2d');
    var mask = makeCanvas(canvas.width, canvas.height);
    mask.getContext('2d').drawImage(canvas, 0, 0);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = color; c.fillRect(0, 0, canvas.width, canvas.height);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(mask, 0, 0);
    c.restore();
  }
  function tintFor(sc) {
    var indoor = INDOOR[sc.place], out = [];
    if (sc.time === 'night') out.push(indoor ? '#C2B4D8' : '#8F98D8');
    if (sc.time === 'sunset') out.push(indoor ? '#FFE3C6' : '#FFCFA8');
    if (!indoor && sc.weather === 'cloudy') out.push('#DCE0E8');
    if (!indoor && sc.weather === 'rain') out.push('#BAC2D0');
    return out;
  }
  function drawWeather(S, sc, area, k) {
    var c = S.c, R = stream(S.seed, 'weather');
    if (sc.weather !== 'rain' && sc.weather !== 'snow') return;
    c.save();
    c.setTransform(k, 0, 0, k, 0, 0);
    if (area && area.window) {
      var w = area.window, z = S.cam.z;
      c.beginPath(); c.rect(w.x * z + S.cam.tx, w.y * z + S.cam.ty, w.w * z, w.h * z); c.clip();
    }
    if (sc.weather === 'rain') {
      c.strokeStyle = 'rgba(225,238,255,.75)'; c.lineWidth = 2; c.lineCap = 'round';
      for (var i = 0; i < 150; i++) {
        var x = R() * (W + 60), y = R() * H, l = 12 + R() * 12;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x - l * 0.3, y + l); c.stroke();
      }
    } else {
      for (var j = 0; j < 120; j++) {
        var sx = R() * W, sy = R() * H, r = 1.5 + R() * 3.5;
        c.fillStyle = 'rgba(255,255,255,' + (0.7 + R() * 0.3).toFixed(2) + ')';
        circle(c, sx, sy, r); c.fill();
      }
    }
    c.restore();
  }
  function drawLights(S, sc) {
    var c = S.c;
    if (sc.time === 'day') return;
    var night = sc.time === 'night';
    c.save();
    c.globalCompositeOperation = 'lighter';
    S.lamps.forEach(function (l) {
      var g = c.createRadialGradient(l[0], l[1], 2, l[0], l[1], l[2]);
      g.addColorStop(0, 'rgba(255,214,120,' + (night ? 0.55 : 0.3) + ')'); g.addColorStop(1, 'rgba(255,214,120,0)');
      c.fillStyle = g; c.fillRect(l[0] - l[2], l[1] - l[2], l[2] * 2, l[2] * 2);
    });
    c.restore();
    if (night) {
      var R = stream(S.seed, 'windows');
      S.windows.forEach(function (w) { if (R() < 0.6) { rrect(c, w[0], w[1], w[2], w[3], 3); c.fillStyle = '#FFD86B'; c.fill(); } });
    }
  }

  /* ───────────────────────── style passes ───────────────────────── */
  var grainTile = null;
  function grain() {
    if (grainTile) return grainTile;
    grainTile = makeCanvas(128, 128);
    var g = grainTile.getContext('2d'), img = g.createImageData(128, 128), R = rng(99);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 200 + Math.floor(R() * 55);
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = Math.max(0, v - 6); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return grainTile;
  }
  function blurred(src, f) {
    var s = makeCanvas(src.width / f, src.height / f), g = s.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, s.width, s.height);
    return s;
  }
  function deckledFrame(o, w, h, R, col, k) {
    o.fillStyle = col;
    o.beginPath();
    o.rect(0, 0, w, h);
    var m = 10 * k, pts = [], n = 28, i;
    for (i = 0; i <= n; i++) pts.push([m + (w - 2 * m) * i / n, m + (R() - 0.5) * 6 * k]);
    for (i = 0; i <= n; i++) pts.push([w - m + (R() - 0.5) * 6 * k, m + (h - 2 * m) * i / n]);
    for (i = n; i >= 0; i--) pts.push([m + (w - 2 * m) * i / n, h - m + (R() - 0.5) * 6 * k]);
    for (i = n; i >= 0; i--) pts.push([m + (R() - 0.5) * 6 * k, m + (h - 2 * m) * i / n]);
    pts.forEach(function (p, j) { o[j ? 'lineTo' : 'moveTo'](p[0], p[1]); });
    o.closePath();
    o.fill('evenodd');
  }
  var STYLE_PASS = {
    cartoon: function (src) { return src; },
    watercolor: function (src, seed, k) {
      var w = src.width, h = src.height, out = makeCanvas(w, h), o = out.getContext('2d'), R = stream(seed, 'paper');
      o.fillStyle = '#FBF6EC'; o.fillRect(0, 0, w, h);
      o.globalAlpha = 0.55; o.drawImage(blurred(src, 9), 0, 0, w, h);          // pigment bleeding out of the shapes
      o.globalAlpha = 0.35; o.drawImage(src, -4 * k, -3 * k); o.drawImage(src, 4 * k, 3 * k); // offset washes
      o.globalAlpha = 0.72; o.drawImage(src, 0, 0);
      o.globalAlpha = 1;
      o.globalCompositeOperation = 'screen'; o.fillStyle = 'rgba(255,248,236,.24)'; o.fillRect(0, 0, w, h);
      o.globalCompositeOperation = 'multiply';
      for (var i = 0; i < 26; i++) { // blotchy pigment pooling
        var bx = R() * w, by = R() * h, br = (30 + R() * 70) * k;
        var gr = o.createRadialGradient(bx, by, 0, bx, by, br);
        gr.addColorStop(0, 'rgba(200,170,150,.16)'); gr.addColorStop(1, 'rgba(200,170,150,0)');
        o.fillStyle = gr; o.fillRect(bx - br, by - br, br * 2, br * 2);
      }
      o.globalAlpha = 0.45; o.fillStyle = o.createPattern(grain(), 'repeat'); o.fillRect(0, 0, w, h); o.globalAlpha = 1;
      o.globalCompositeOperation = 'source-over';
      deckledFrame(o, w, h, R, '#FBF6EC', k);
      return out;
    },
    pixel: function (src) {
      var w = src.width, h = src.height, sw = 100, sh = 75;
      var small = makeCanvas(sw, sh), g = small.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
      g.drawImage(src, 0, 0, sw, sh);
      var img = g.getImageData(0, 0, sw, sh), d = img.data;
      for (var i = 0; i < d.length; i += 4) { // posterise to a chunky retro palette
        d[i] = Math.min(255, Math.round(d[i] / 40) * 40 + 10);
        d[i + 1] = Math.min(255, Math.round(d[i + 1] / 40) * 40 + 10);
        d[i + 2] = Math.min(255, Math.round(d[i + 2] / 40) * 40 + 14);
      }
      g.putImageData(img, 0, 0);
      var out = makeCanvas(w, h), o = out.getContext('2d');
      o.imageSmoothingEnabled = false;
      o.drawImage(small, 0, 0, w, h);
      return out;
    },
    storybook: function (src, seed, k) {
      var w = src.width, h = src.height, out = makeCanvas(w, h), o = out.getContext('2d'), R = stream(seed, 'story');
      o.drawImage(src, 0, 0);
      o.globalCompositeOperation = 'screen'; o.fillStyle = 'rgba(255,236,214,.3)'; o.fillRect(0, 0, w, h);
      o.globalCompositeOperation = 'source-over';
      var vg = o.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.85);
      vg.addColorStop(0, 'rgba(255,244,225,0)'); vg.addColorStop(1, 'rgba(255,240,215,.75)');
      o.fillStyle = vg; o.fillRect(0, 0, w, h);
      o.fillStyle = '#FFF7E6';
      for (var i = 0; i < 14; i++) { o.globalAlpha = 0.6 + R() * 0.4; sparkle(o, R() * w, R() * h * 0.5, (4 + R() * 6) * k); }
      o.globalAlpha = 1;
      o.fillStyle = '#FFF4E0'; o.beginPath(); o.rect(0, 0, w, h); rrectPath(o, 12 * k, 12 * k, w - 24 * k, h - 24 * k, 26 * k); o.fill('evenodd');
      o.strokeStyle = '#C9A27E'; o.lineWidth = 3 * k; rrectPath(o, 12 * k, 12 * k, w - 24 * k, h - 24 * k, 26 * k); o.stroke();
      return out;
    },
    photo: function (src, seed, k) {
      var w = src.width, h = src.height, out = makeCanvas(w, h), o = out.getContext('2d');
      o.drawImage(src, 0, 0);
      o.globalAlpha = 0.45; o.drawImage(blurred(src, 2.5), 0, 0, w, h); o.globalAlpha = 1;
      o.globalCompositeOperation = 'saturation'; o.fillStyle = 'rgba(128,128,128,.55)'; o.fillRect(0, 0, w, h);
      o.globalCompositeOperation = 'multiply'; o.fillStyle = '#ECE6DA'; o.fillRect(0, 0, w, h);
      o.globalAlpha = 0.4; o.fillStyle = o.createPattern(grain(), 'repeat'); o.fillRect(0, 0, w, h); o.globalAlpha = 1;
      o.globalCompositeOperation = 'source-over';
      var vg = o.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.9);
      vg.addColorStop(0, 'rgba(10,10,20,0)'); vg.addColorStop(1, 'rgba(10,10,20,.5)');
      o.fillStyle = vg; o.fillRect(0, 0, w, h);
      o.font = '700 ' + Math.round(18 * k) + 'px ui-monospace, Menlo, Consolas, monospace';
      o.textAlign = 'right'; o.fillStyle = '#FF8A3D'; o.fillText("'26 11 10  14:02", w - 22 * k, h - 20 * k);
      o.strokeStyle = '#FFFFFF'; o.lineWidth = 8 * k; o.strokeRect(4 * k, 4 * k, w - 8 * k, h - 8 * k);
      return out;
    }
  };
  function rrectPath(o, x, y, w, h, r) {
    o.moveTo(x + r, y); o.arcTo(x + w, y, x + w, y + h, r); o.arcTo(x + w, y + h, x, y + h, r); o.arcTo(x, y + h, x, y, r); o.arcTo(x, y, x + w, y, r); o.closePath();
  }

  /* ───────────────────────── render ───────────────────────── */
  function render(scene, seed, opts) {
    opts = opts || {};
    var sc = normalize(scene);
    seed = (seed >>> 0) || 1;
    var k = opts.scale || 1, pw = Math.round(W * k), ph = Math.round(H * k);
    var look = LOOKS[sc.style];
    var subs = layoutSubjects(sc, seed);
    var S = { c: null, outline: look.outline, ink: look.ink, lw: look.lw, cam: cameraFor(sc, subs), boxes: {}, scale: k, seed: seed, lamps: [], windows: [] };

    // 1. sky
    var sky = makeCanvas(pw, ph);
    S.c = sky.getContext('2d'); setCam(S);
    drawSky(S, sc);

    // 2. world: place, extras, flowers, subjects
    var world = makeCanvas(pw, ph);
    S.c = world.getContext('2d'); setCam(S);
    var area = PLACES[sc.place](S, stream(seed, 'place'));
    if (area.y0) mark(S, 'ground', 0, area.y0 - 10, W, H - area.y0 + 10); else mark(S, 'ground', 0, 330, W, 150);
    drawExtrasBack(S, sc, area);
    var fl = planFlowers(S, sc, area);
    drawFlowerList(S, sc, fl.back);
    if (fl.vase) drawVase(S, sc, fl.vase.n);
    var drawn = subs.map(function (sp) { return drawSubject(S, sc, sp); });
    if (sc.action === 'playing' && drawn.length) {
      var d0 = drawn[0], bxp, byp;
      var bipedish = sc.kind === 'kid' || sc.kind === 'robot';
      if (drawn.length >= 2 && drawn[0].facing !== drawn[1].facing && !bipedish) { bxp = (drawn[0].x + drawn[1].x) / 2; byp = Math.max(drawn[0].y, drawn[1].y) - 14; }
      else { bxp = d0.x + d0.facing * (bipedish ? 50 : 76) * d0.s; byp = d0.y - 13 * d0.s; }
      ball(S, bxp, byp, 13 * d0.s);
      mark(S, 'subject', bxp - 14, byp - 14, 28, 28);
    }
    drawFlowerList(S, sc, fl.front);
    if (fl.planters) drawPlanters(S, sc, fl.planters.lots);
    if (sc.action === 'kite' && drawn.length) {
      var kid = drawn.reduce(function (a, b) { return Math.abs(b.x - 320) < Math.abs(a.x - 320) ? b : a; });
      drawKite(S, kid.anchor, kid.facing);
    }
    if (sc.extras.indexOf('balloons') >= 0) {
      if (drawn.length) drawBalloons(S, drawn[0].anchor, drawn[0].facing, drawn[0].s);
      else drawBalloons(S, [320, 380], 1, 1);
    }

    // 3. time / weather tint (world only — the sky has its own colours), then lights
    tintFor(sc).forEach(function (col) { tintLayer(world, col); });
    setCam(S);
    drawLights(S, sc);

    // 4. compose + particles + style
    var base = makeCanvas(pw, ph), b = base.getContext('2d');
    b.drawImage(sky, 0, 0); b.drawImage(world, 0, 0);
    S.c = b; drawWeather(S, sc, area, k);
    if (area.window) { S.c = b; setCam(S); mark(S, 'time', area.window.x, area.window.y, area.window.w, area.window.h); }
    var out = STYLE_PASS[sc.style](base, seed, k);
    S.boxes.frame = { x: 6, y: 6, w: W - 12, h: H - 12 };
    if (!S.boxes.subject) S.boxes.subject = { x: W / 2 - 80, y: H / 2, w: 160, h: 140 };
    if (area.window) { S.boxes.weather = S.boxes.time; S.boxes.sky = S.boxes.time; }
    return { canvas: out, boxes: S.boxes };
  }

  window.Scene = { W: W, H: H, render: render, rng: rng, hash: hashStr };
})();
