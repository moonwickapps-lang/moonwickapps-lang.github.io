/* Prompt Academy v2 — "Catch the Prompt" arcade engine.
 * A Moonwick Apps game for YouTube Playables.
 *
 * Wick (the candle) slides along the bottom catching falling prompt blocks:
 *   GOOD  block  -> flies into its socket in the prompt bar (+points, combo++)
 *   WRONG block  -> right type but doesn't fit the request (bounces off, combo reset, Wick explains why)
 *   JUNK  block  -> vague fog (lose a flame, shake, lesson toast)
 *   power-ups    -> clarity (pop all junk), wax (+1 flame), slow (slow motion)
 * All sockets filled -> SEND: the prompt is shown and Wick types a great answer.
 * 3 requests per stage -> stage clear. 0 flames -> stage failed. Endless: until flames run out.
 * Rules and numbers follow the game design doc (GDD.md); they are collected in CONFIG.
 *
 * Clock: this module owns NO requestAnimationFrame loop and NO timers. game.js's
 * single pausable clock calls Arcade.tick(dtMs) every frame while the arcade is
 * on screen; when YouTube pauses the game that clock stops, so nothing here runs.
 * All drawing goes through window.Art (art.js). Content comes from content.js.
 */
'use strict';
(() => {
  /* ───────────── Tuning (from GDD.md) ───────────── */
  const CONFIG = {
    flames: 3,
    points: {
      goodFill: 100,        // × combo multiplier
      goodExtra: 50,        // socket already filled (bonus catch) × multiplier
      wrong: -50,           // score floors at 0
      power: 50,            // flat
      waxAtFull: 150,       // wax caught with 3 flames
      clearPerFlame: 100,   // stage clear bonus per flame left (stages only)
      wave: 500,            // endless: every 5th SEND
    },
    comboTiers: [3, 6, 10], // streak needed for ×2, ×3, ×4
    send: { base: 250, parBase: 6, parPerSocket: 3, perSecond: 25, perStreak: 20, perFlame: 50 },
    fallSeconds: 5.5,       // speed 1.0: a block crosses the playfield height in 5.5 s
    reqSpeedRamp: 0.05,     // stages: speed × (1 + 0.05·r) for request r
    reqSpawnRamp: 0.07,     // stages: interval × (1 − 0.07·r)
    unfilledChance: 0.7,    // GOOD/WRONG type: 70% an unfilled socket type, else any stage type
    pity: 3,                // after 3 spawns that were not GOOD-for-an-unfilled-socket, force one
    junkNoRepeat: 3,
    margin: 12,
    minCenterGap: 0.25,     // × playfield width between consecutive spawn centres
    rerolls: 4,
    maxOnScreen: 7,
    // Catch zone, all × Wick size: rows = flame + head (top 40%); half = candle body half-width.
    // GOOD/power-ups get a little forgiveness, junk/wrong must really overlap the body.
    hit: { top: 0.88, depth: 0.4, half: 0.2, goodPad: 0.07, badPad: -0.07 },
    power: { every: [20, 30], stage2Clarity: 12, speedMul: 0.85, r: 22,
      hurt: { wax: 40, clarity: 35, slow: 25 }, full: { clarity: 55, slow: 45 } },
    slow: { seconds: 5, scale: 0.5 },
    sendFx: { slowScale: 0.25, slowSecs: 0.6, flashSecs: 0.08, cps: 45, holdMin: 1.2, holdAuto: 2.6 },
    shake: { px: 8, secs: 0.25 },
    endless: {
      sockets: k => 3 + (k >= 3 ? 1 : 0) + (k >= 8 ? 1 : 0),
      speed: k => Math.min(2.2, 1.3 + 0.06 * k),
      spawn: k => Math.max(0.55, 0.95 - 0.025 * k),
      junk: k => Math.min(0.45, 0.30 + 0.01 * k),
      wrong: k => Math.min(0.35, 0.25 + 0.01 * k),
      waveEvery: 5,
      extras: ['role', 'context', 'format', 'constraints', 'example'],
    },
    wick: { follow: 16, keySpeed: 640, size: 0.27, minSize: 84, maxSize: 132 }, // size × fall-zone height, css px
    maxW: 520,
  };
  const TYPE_ORDER = ['role', 'task', 'context', 'format', 'constraints', 'example', 'steps'];
  const DEBUG = /[?&]debug=1\b/.test(location.search);
  const SHOW_HITBOX = DEBUG && /[?&]hitbox=1\b/.test(location.search);
  const REDUCED_MOTION = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';

  /* ───────────── Small helpers ───────────── */
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const typeColor = t => (window.Art.TYPES[t] && window.Art.TYPES[t].color) || (window.SLOT_META[t] || {}).color || '#8B88F5';
  function weighted(w) {
    const keys = Object.keys(w), total = keys.reduce((a, k) => a + w[k], 0);
    let r = Math.random() * total;
    for (const k of keys) { r -= w[k]; if (r < 0) return k; }
    return keys[keys.length - 1];
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function wrapText(ctx, text, maxW) {
    const out = [];
    String(text).split('\n').forEach(par => {
      let line = '';
      par.split(' ').forEach(word => {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
      });
      out.push(line);
    });
    return out;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* ───────────── Module state ───────────── */
  let canvas = null, ctx = null, dpr = 1;
  let L = null;            // layout (css px), recomputed on resize
  let S = null;            // current run
  let paused = false;
  let sound = () => {};    // sound(name, data) — set via setAudio() or opts.sfx
  let nextId = 1;
  const seen = { tags: false, wrongSlow: false, junkSlow: false }; // first-time callouts, once per session
  const perf = { frames: 0, total: 0, max: 0 };
  const drawers = new Map(); // Art.particle drawers per kind|color

  /* ───────────── Layout ───────────── */
  function computeLayout() {
    const A = window.Art, M = A.METRICS || {};
    const W = canvas.clientWidth || window.innerWidth, H = canvas.clientHeight || window.innerHeight;
    // Short landscape screens (phones on their side): the request card moves into a left gutter
    // so the blocks keep enough fall height; the playfield narrows a little to make room.
    const side = H < 600 && W >= 700;
    const pw = side ? clamp(W - 400, 360, CONFIG.maxW) : Math.min(W, CONFIG.maxW), ox = Math.round((W - pw) / 2);
    const hudH = M.hudHeight || 52, barH = M.promptBarH || 52;
    const cardW = side ? ox - 24 : pw - 24;
    const cardX = side ? -ox + 12 : 12, cardY = side ? 12 : hudH;
    let cardH = M.requestCardMinH || 76;
    const reqs = S ? (S.endless ? window.ENDLESS_REQUESTS || [] : S.stage.requests) : [];
    if (A.requestCardHeight) reqs.forEach(r => { cardH = Math.max(cardH, A.requestCardHeight(cardW, r.need)); });
    const barY = side ? hudH : cardY + cardH + 8;
    const zoneTop = barY + barH + 10;
    const wickBase = H - Math.max(12, Math.round(H * 0.025));
    const CW = CONFIG.wick, wickSize = Math.round(clamp((wickBase - zoneTop) * CW.size, CW.minSize, CW.maxSize));
    const hitTop = wickBase - wickSize * CONFIG.hit.top;
    const hitBot = hitTop + wickSize * CONFIG.hit.top * CONFIG.hit.depth;
    return { W, H, pw, ox, hudH, side, cardX, cardY, cardW, cardH, barY, barH, zoneTop,
      wickBase, wickSize, hitTop, hitBot, fieldH: Math.max(140, wickBase - zoneTop) };
  }

  function resize() {
    const old = L;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    L = computeLayout();
    canvas.width = Math.round(L.W * dpr);
    canvas.height = Math.round(L.H * dpr);
    // let the DOM exit button sit at the playfield's top-left corner (see arcade.css)
    if (canvas.parentElement) canvas.parentElement.style.setProperty('--pf-left', L.ox + 'px');
    if (S && old) {
      // keep everything proportionally in place after a rotate / resize
      const sx = L.pw / old.pw, sy = L.fieldH / old.fieldH;
      S.objs.forEach(o => {
        o.x = clamp(o.x * sx, 4, Math.max(4, L.pw - o.w - 4));
        o.y = L.zoneTop + (o.y - old.zoneTop) * sy;
      });
      S.wick.x = clamp(S.wick.x * sx, 0, L.pw); S.wick.tx = clamp(S.wick.tx * sx, 0, L.pw);
    }
  }

  /* ───────────── Run setup ───────────── */
  function newRun(opts) {
    const stage = opts.stage, endless = !!opts.endless;
    const stageIndex = endless ? -1 : (window.ARCADE_STAGES || []).indexOf(stage);
    S = {
      opts, stage, endless, stageIndex, firstTime: !!opts.firstTime,
      phase: 'intro', phaseT: 0, t: 0, world: 0,
      score: 0, flames: CONFIG.flames, combo: 0, maxCombo: 0, comboPop: 0,
      reqIndex: -1, reqDone: 0, req: null, types: [], filled: {}, shown: {}, pops: {},
      reqStart: 0, cardIn: 0, sendPending: false,
      objs: [], flyers: [], debris: [], parts: [], floats: [], toasts: [], bubble: null, wave: null,
      spawnT: 0.3, spawnCount: 0, sinceGood: 0, lastSpawnCx: null, recentJunk: [],
      powerT: 0, forcedPower: null, script: [],
      slowT: 0, tutorSlowT: 0, flash: 0, shake: 0, flameDip: 0,
      wick: { x: 0, tx: 0, lean: 0, squash: 0, mood: 'idle', moodT: 0, flame: 1 },
      keys: { l: false, r: false }, dragging: false, moved: false, idleT: 0,
      send: null, lastLesson: '', bag: [], lastReq: null,
      result: null, ended: false,
    };
    resize();
    S.wick.x = S.wick.tx = L.pw / 2;
    if (stageIndex === 0) S.powerT = Infinity;                              // no power-ups in stage 1
    else if (stageIndex === 1) { S.powerT = CONFIG.power.stage2Clarity; S.forcedPower = 'clarity'; }
    else S.powerT = rand(CONFIG.power.every[0], CONFIG.power.every[1]);
    nextRequest();
  }

  /** Current difficulty: { speed, spawn, junk, wrong }. */
  function diff() {
    if (S.endless) {
      const k = Math.max(0, S.reqIndex), e = CONFIG.endless;
      return { speed: e.speed(k), spawn: e.spawn(k), junk: e.junk(k), wrong: e.wrong(k) };
    }
    const st = S.stage, r = Math.max(0, S.reqIndex);
    let wrong = st.wrong == null ? 0.25 : st.wrong;
    if (S.stageIndex === 0 && r === 0) wrong = 0;                           // onboarding: no wrong-fits in request 1
    return {
      speed: (st.speed || 1) * (1 + CONFIG.reqSpeedRamp * r),
      spawn: (st.spawn || 1.2) * (1 - CONFIG.reqSpawnRamp * r),
      junk: st.junk == null ? 0.3 : st.junk,
      wrong,
    };
  }
  const speedPx = () => (L.fieldH / CONFIG.fallSeconds) * diff().speed;

  function nextRequest() {
    S.reqIndex++;
    if (S.endless) {
      const pool = window.ENDLESS_REQUESTS || [];
      if (!S.bag.length) S.bag = shuffle(pool.slice());
      let r = S.bag.pop();
      if (r === S.lastReq && pool.length > 1) { S.bag.unshift(r); r = S.bag.pop(); }
      S.req = r; S.lastReq = r;
      const n = CONFIG.endless.sockets(S.reqIndex);
      const extras = shuffle(CONFIG.endless.extras.filter(t => r.good && r.good[t] && r.good[t].length));
      const chosen = new Set(['task'].concat(extras.slice(0, n - 1)));
      S.types = TYPE_ORDER.filter(t => chosen.has(t) && r.good[t]);
    } else {
      S.req = S.stage.requests[S.reqIndex];
      S.types = S.stage.types.filter(t => S.req.good && S.req.good[t] && S.req.good[t].length);
    }
    S.filled = {}; S.shown = {}; S.pops = {};
    S.reqStart = S.world; S.cardIn = 0; S.sinceGood = 0; S.spawnCount = 0; S.sendPending = false;
    S.script = []; S.scriptClock = 0; S.forceWrongAt = 0;
    if (S.stageIndex === 0 && S.reqIndex === 0) {
      // Onboarding (GDD §8): a GOOD block a little away from Wick, then a JUNK block on the other side.
      const showTags = !seen.tags; seen.tags = true;
      S.script.push({ at: 0.0, kind: 'good', tag: showTags ? 'Catch me!' : '', side: 1 });
      S.script.push({ at: 1.5, kind: 'junk', text: 'stuff', tag: showTags ? 'Fog = vague. Dodge!' : '', side: -1 });
      S.spawnT = 99; // normal spawning resumes after the script
    } else if (S.stageIndex === 0 && S.reqIndex === 1) {
      S.forceWrongAt = 2; // its 2nd spawn is a WRONG-FIT, so the player has to read
    }
    sound('request');
    emit('request', { index: S.reqIndex, who: S.req.who });
  }

  /* ───────────── Spawning ───────────── */
  const unfilled = () => S.types.filter(t => !S.filled[t]);
  const onScreenTexts = () => new Set(S.objs.map(o => o.text));
  const live = o => !o.gone && !o.popAt;

  function chooseType(forceUnfilled, kind) {
    const req = S.req;
    const ok = t => (kind === 'wrong' ? req.wrong && req.wrong[t] && req.wrong[t].length : true);
    const un = unfilled().filter(ok), all = S.types.filter(ok);
    if (!all.length) return null;
    if (kind === 'good' && forceUnfilled) {
      // prefer an unfilled type that has no GOOD block falling already
      const starved = un.filter(t => !S.objs.some(o => live(o) && o.kind === 'good' && o.type === t));
      return pick(starved.length ? starved : un);
    }
    return un.length && Math.random() < CONFIG.unfilledChance ? pick(un) : pick(all);
  }

  function chooseText(list, avoid) {
    const fresh = list.filter(x => !avoid.has(x));
    return pick(fresh.length ? fresh : list);
  }

  function makeBlock(kind, fixedText) {
    const req = S.req, avoid = onScreenTexts();
    if (kind === 'wrong') {
      const type = chooseType(false, 'wrong');
      if (type) return { kind, type, text: chooseText(req.wrong[type], avoid) };
      kind = 'junk';
    }
    if (kind === 'junk') {
      const pool = window.JUNK || ['stuff'];
      const text = fixedText || chooseText(pool, new Set(S.recentJunk.concat([...avoid])));
      S.recentJunk.push(text); if (S.recentJunk.length > CONFIG.junkNoRepeat) S.recentJunk.shift();
      return { kind, type: 'task', text };
    }
    const forced = S.sinceGood >= CONFIG.pity;
    const type = chooseType(forced, 'good');
    return { kind: 'good', type, text: chooseText(req.good[type], avoid) };
  }

  /** The top of the fall zone must be clear: one object per row, so blocks never overlap. */
  function topIsFree() { return S.objs.every(o => o.gone || o.y >= L.zoneTop + 8); }

  /** x for a new object: 12 px margin, centre ≥ 25% of the width from the previous spawn, clear of power-ups. */
  function placeX(w, side) {
    const m = CONFIG.margin, maxX = Math.max(m, L.pw - w - m);
    const powers = S.objs.filter(o => live(o) && o.kind === 'power');
    const clearOfPowers = x => powers.every(p => x + w < p.x - 6 || x > p.x + p.w + 6);
    if (side) {
      // scripted: about 30% of the width to one side of Wick
      const cx = clamp(S.wick.x + side * L.pw * 0.3, m + w / 2, L.pw - m - w / 2);
      return cx - w / 2;
    }
    let x = rand(m, maxX);
    for (let i = 0; i < CONFIG.rerolls + 4; i++) {
      const farEnough = S.lastSpawnCx == null || Math.abs(x + w / 2 - S.lastSpawnCx) >= L.pw * CONFIG.minCenterGap || i >= CONFIG.rerolls;
      if (farEnough && clearOfPowers(x)) break;
      x = rand(m, maxX);
    }
    return x;
  }

  function addObj(o) {
    o.id = nextId++; o.born = S.t; o.wob = Math.random() * 6;
    S.objs.push(o);
    S.lastSpawnCx = o.x + o.w / 2;
  }

  function spawnBlock(spec) {
    spec = spec || {};
    if (!unfilled().length || S.sendPending) return true;
    if (S.objs.filter(live).length >= CONFIG.maxOnScreen) return false;
    if (!topIsFree()) return false;
    let kind = spec.kind;
    if (!kind) {
      const d = diff();
      S.spawnCount++;
      if (S.sinceGood >= CONFIG.pity) kind = 'good';
      else if (S.forceWrongAt === S.spawnCount) { kind = 'wrong'; S.forceWrongAt = 0; }
      else kind = Math.random() < d.junk ? 'junk' : Math.random() < d.wrong ? 'wrong' : 'good';
    }
    const b = makeBlock(kind, spec.text);
    const size = window.Art.measureBlock(ctx, b.text);
    b.w = size.w; b.h = size.h;
    b.x = placeX(b.w, spec.side);
    b.y = L.zoneTop - b.h;
    b.tag = spec.tag || '';
    addObj(b);
    if (b.kind === 'good' && !S.filled[b.type]) S.sinceGood = 0; else S.sinceGood++;
    return true;
  }

  function spawnPower(kind) {
    if (S.objs.some(o => live(o) && o.kind === 'power') || !topIsFree()) return false;
    const r = CONFIG.power.r, w = r * 2;
    kind = kind || weighted(S.flames < CONFIG.flames ? CONFIG.power.hurt : CONFIG.power.full);
    addObj({ kind: 'power', power: kind, r, w, h: w, x: placeX(w), y: L.zoneTop - w });
    return true;
  }

  /* ───────────── Effects ───────────── */
  function drawer(kind, color) {
    const key = kind + '|' + color;
    let d = drawers.get(key);
    if (!d) { d = window.Art.particle ? window.Art.particle(kind, color) : null; drawers.set(key, d); }
    return d;
  }
  function burst(x, y, color, n, opt) {
    opt = opt || {};
    if (REDUCED_MOTION) n = Math.ceil(n / 2);
    const kind = opt.kind || 'spark';
    for (let i = 0; i < n && S.parts.length < 320; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(opt.min || 60, opt.speed || 260);
      S.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opt.up || 80), age: 0, max: rand(0.45, opt.life || 0.9),
        size: rand(opt.sizeMin || 3, opt.size || 6), rot: rand(0, 6), vr: rand(-6, 6), g: opt.g == null ? 420 : opt.g,
        d: drawer(kind, color), color });
    }
  }
  function floatText(x, y, text, color, px, secs) {
    S.floats.push({ x, y, text, color: color || '#F2C94C', age: 0, max: secs || 0.9, px: px || 20 });
  }
  function toast(text, kind) { S.toasts = [{ text, kind: kind || 'bad', age: 0, max: 2.0 }]; }
  function say(text, secs) { S.bubble = { text, age: 0, max: secs || 1.6 }; }
  function setMood(mood, secs) { S.wick.mood = mood; S.wick.moodT = secs || 0; }
  function mult() {
    const t = CONFIG.comboTiers;
    return S.combo >= t[2] ? 4 : S.combo >= t[1] ? 3 : S.combo >= t[0] ? 2 : 1;
  }
  function addScore(n) { S.score = Math.max(0, Math.round(S.score + n)); }
  function emit(name, data) { try { S && S.opts.onEvent && S.opts.onEvent(name, data || {}); } catch (e) { /* never break the game */ } }
  function breakCombo() {
    if (mult() > 1) { sound('fizz'); floatText(S.wick.x, L.hitTop - 30, 'combo lost', '#a9a7c8', 15, 0.8); }
    S.combo = 0;
  }

  function socketRects() {
    const n = S.types.length || 1, pad = 6, gap = 6, x = 12, w = L.pw - 24;
    const sw = (w - pad * 2 - gap * (n - 1)) / n, h = L.barH - pad * 2;
    const out = {};
    S.types.forEach((t, i) => { const sx = x + pad + i * (sw + gap); out[t] = { x: sx, y: L.barY + pad, w: sw, h, cx: sx + sw / 2, cy: L.barY + L.barH / 2 }; });
    return out;
  }

  /* ───────────── Catching ───────────── */
  function catchObj(o) {
    o.gone = true;
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    S.wick.squash = -0.6;
    if (o.kind === 'power') return catchPower(o, cx, cy);
    if (o.kind === 'good') return catchGood(o, cx, cy);
    S.lastHitKind = o.kind;
    if (o.kind === 'wrong') {
      breakCombo();
      addScore(CONFIG.points.wrong);
      const why = (S.req.whyWrong && S.req.whyWrong[o.text]) || 'That doesn’t fit ' + S.req.who + '’s request.';
      S.lastLesson = '“' + o.text + '” — ' + why; // shown on the fail screen, so name the block
      say('Hmm… ' + why, 1.6);
      floatText(cx, o.y - 4, String(CONFIG.points.wrong), '#F27B7B', 18);
      // bounce off Wick and tumble away (no shake: it's a reading mistake, not danger)
      const dir = cx < S.wick.x ? -1 : 1;
      S.debris.push({ type: o.type, text: o.text, kind: 'wrong', w: o.w, h: o.h, x: cx, y: cy,
        vx: dir * rand(110, 170), vy: -rand(240, 300), rot: 0, vr: dir * rand(3, 5), age: 0, max: 0.9 });
      setMood('sad', 0.9);
      sound('wrong');
      tutorSlow('wrongSlow');
      emit('catch', { kind: 'wrong', type: o.type, text: o.text, why });
      return;
    }
    // junk
    breakCombo();
    S.flames = Math.max(0, S.flames - 1);
    const lessons = window.JUNK_LESSONS || {};
    const lesson = lessons[o.text] || lessons.default || 'Vague! Be specific.';
    S.lastLesson = '“' + o.text + '” — ' + lesson;
    toast(lesson, 'bad');
    if (!REDUCED_MOTION) S.shake = CONFIG.shake.secs;
    S.flameDip = 0.3;
    burst(cx, cy, '#b9b6cf', 18, { kind: 'smoke', g: -40, speed: 120, size: 16, sizeMin: 8, life: 1.1 });
    setMood('hurt', 0.8);
    sound('junk');
    tutorSlow('junkSlow');
    emit('catch', { kind: 'junk', text: o.text, lesson });
    if (S.flames <= 0) beginFail();
  }

  /** Stage 1 only, first time per session: world ×0.5 for 1 s so the lesson can be read. */
  function tutorSlow(key) {
    if (S.stageIndex !== 0 || seen[key]) return;
    seen[key] = true; S.tutorSlowT = 1;
  }

  function catchGood(o, cx, cy) {
    const before = mult();
    S.combo++; S.maxCombo = Math.max(S.maxCombo, S.combo);
    const m = mult(), color = typeColor(o.type);
    if (!S.filled[o.type]) {
      S.filled[o.type] = o.text;
      const pts = CONFIG.points.goodFill * m;
      addScore(pts);
      floatText(cx, o.y - 4, '+' + pts, color);
      // the block flies in an arc from Wick into its socket
      const r = socketRects()[o.type];
      S.flyers.push({ type: o.type, text: o.text, w: o.w, h: o.h, x0: cx, y0: cy, x1: r.cx, y1: r.cy, age: 0, dur: 0.25 });
      sound('catch', { type: o.type, mult: m });
    } else {
      const pts = CONFIG.points.goodExtra * m;
      addScore(pts);
      floatText(cx, o.y - 4, '+' + pts + ' bonus', color);
      sound('bonus', { mult: m });
    }
    burst(cx, L.hitTop, color, 14);
    setMood('happy', 0.6);
    if (m > before) {
      floatText(S.wick.x, L.hitTop - 44, m >= 4 ? '×4 ON FIRE!' : '×' + m + '!', '#F2C94C', 28, 1.1);
      S.comboPop = 1;
      sound('combo', { mult: m });
    }
    emit('catch', { kind: 'good', type: o.type, text: o.text });
    if (!unfilled().length) S.sendPending = true; // SEND once the last block lands in its socket
  }

  function catchPower(o, cx, cy) {
    addScore(CONFIG.points.power);
    sound('power', { kind: o.power });
    setMood('happy', 0.6);
    if (o.power === 'clarity') {
      // a light wave expands from Wick; each junk block pops as the wave reaches it (40 ms stagger)
      const wx = S.wick.x, wy = L.hitTop;
      const junk = S.objs.filter(b => live(b) && b.kind === 'junk')
        .sort((a, b) => Math.hypot(a.x + a.w / 2 - wx, a.y - wy) - Math.hypot(b.x + b.w / 2 - wx, b.y - wy));
      junk.forEach((b, i) => { b.popAt = S.t + 0.05 + i * 0.04; });
      S.wave = { x: wx, y: wy, age: 0 };
      toast(junk.length ? 'Clarity! The fog clears.' : 'Clarity! All clear.', 'good');
    } else if (o.power === 'wax') {
      if (S.flames < CONFIG.flames) { S.flames++; toast('Wax! +1 flame.', 'good'); }
      else { addScore(CONFIG.points.waxAtFull); toast('Wax! +' + CONFIG.points.waxAtFull + ' points.', 'good'); }
    } else {
      S.slowT = CONFIG.slow.seconds;
      toast('Slow motion!', 'info');
    }
    burst(cx, cy, (window.Art.POWERUPS && window.Art.POWERUPS[o.power] || {}).color || '#fff6c8', 20, { speed: 300 });
    floatText(cx, cy - 20, '+' + CONFIG.points.power, '#fff6c8');
    emit('powerup', { kind: o.power });
  }

  /* ───────────── SEND / clear / fail ───────────── */
  function beginSend() {
    const c = CONFIG.send, n = S.types.length;
    const took = S.world - S.reqStart, par = c.parBase + c.parPerSocket * n;
    const timeB = Math.round(Math.max(0, par - took) * c.perSecond);
    const comboB = c.perStreak * S.combo, flameB = c.perFlame * S.flames;
    const total = c.base + timeB + comboB + flameB;
    addScore(total);
    S.phase = 'send'; S.phaseT = 0; S.flash = CONFIG.sendFx.flashSecs;
    S.sendPending = false;
    S.send = { step: 'flash', t: 0, typed: 0, text: String(S.req.answer || ''), total, parts: [timeB, comboB, flameB], ticks: 0 };
    S.toasts = []; S.bubble = null;
    setMood('send');
    sound('send');
    floatText(L.pw / 2, L.zoneTop + 44, '+' + total + ' SEND!', '#ffffff', 26, 1.4);
    S.sendLine = { text: 'time +' + timeB + ' · combo +' + comboB + ' · flames +' + flameB, age: 0, max: 1.4 };
    emit('send', { index: S.reqIndex, bonus: total });
  }

  function popAll() {
    S.objs.forEach(b => {
      if (b.gone) return;
      b.gone = true;
      const col = b.kind === 'junk' ? '#c9c6dc' : b.kind === 'power' ? '#fff6c8' : typeColor(b.type);
      burst(b.x + b.w / 2, b.y + b.h / 2, col, 8, { g: 100 });
    });
  }

  function finishSend() {
    S.send = null; S.sendLine = null;
    S.reqDone++;
    popAll(); // nothing from the old request is left on screen
    if (!S.endless && S.reqIndex >= S.stage.requests.length - 1) return beginClear();
    if (S.endless && S.reqDone % CONFIG.endless.waveEvery === 0) {
      const wave = S.reqDone / CONFIG.endless.waveEvery;
      addScore(CONFIG.points.wave);
      floatText(L.pw / 2, L.zoneTop + 90, 'WAVE ' + wave + ' CLEARED  +' + CONFIG.points.wave, '#F2C94C', 22, 1.8);
      sound('wave');
      if (S.flames < CONFIG.flames) S.forcedPowerAt = { kind: 'wax', at: S.world + 2 };
    }
    S.phase = 'play'; S.phaseT = 0; S.spawnT = 0.6;
    setMood('idle');
    nextRequest();
  }

  function starsFor() {
    let s = 1;
    if (S.flames >= 2) s = 2;
    if (S.flames >= 3 && S.score >= (S.stage.target || 0)) s = 3;
    return s;
  }

  function beginClear() {
    addScore(CONFIG.points.clearPerFlame * S.flames);
    S.phase = 'clear'; S.phaseT = 0;
    setMood('happy');
    sound('clear');
    const cols = S.types.map(typeColor).concat('#F2C94C');
    for (let i = 0; i < 6; i++) burst(rand(40, L.pw - 40), rand(L.zoneTop, L.zoneTop + 160), pick(cols), 14, { kind: 'confetti', speed: 320, g: 300, life: 1.6 });
    if (S.flames) floatText(L.pw / 2, (L.zoneTop + L.hitTop) / 2 + 44, 'Flames +' + CONFIG.points.clearPerFlame * S.flames, '#F2C94C', 20, 1.6);
    S.result = { cleared: true, stars: starsFor(), score: S.score, flames: S.flames, failReason: '', endless: false, requests: S.reqDone, maxCombo: S.maxCombo };
    emit('clear', S.result);
  }

  function beginFail() {
    S.phase = 'fail'; S.phaseT = 0;
    S.flyers = []; S.sendPending = false;
    setMood('sad');
    sound(S.endless ? 'over' : 'fail');
    S.result = { cleared: false, stars: 0, score: S.score, flames: 0, failReason: S.lastLesson || 'Vague! Be specific.',
      endless: S.endless, requests: S.reqDone, maxCombo: S.maxCombo };
    emit('fail', S.result);
  }

  /* ───────────── Update ───────────── */
  function update(dt) {
    S.t += dt; S.phaseT += dt;
    // world time: slow-mo power-up, tutorial slow, SEND slow-mo
    let scale = 1;
    if (S.slowT > 0) scale *= CONFIG.slow.scale;
    if (S.tutorSlowT > 0) scale *= 0.5;
    if (S.phase === 'send' && S.phaseT < CONFIG.sendFx.slowSecs) scale *= CONFIG.sendFx.slowScale;
    const wdt = dt * scale;
    S.world += wdt;
    S.slowT = Math.max(0, S.slowT - dt);           // 5 REAL seconds
    S.tutorSlowT = Math.max(0, S.tutorSlowT - dt);
    S.flash = Math.max(0, S.flash - dt);
    S.shake = Math.max(0, S.shake - dt);
    S.flameDip = Math.max(0, S.flameDip - dt);
    S.comboPop = Math.max(0, S.comboPop - dt * 3);
    S.cardIn = Math.min(1, S.cardIn + dt * 3.5);
    for (const k in S.pops) S.pops[k] = Math.max(0, S.pops[k] - dt * 5);

    updateWick(dt);

    const introLen = S.firstTime ? 2.0 : 1.6;
    if (S.phase === 'intro' && S.phaseT > introLen) { S.phase = 'play'; S.phaseT = 0; }

    if (S.phase === 'play') {
      // scripted onboarding spawns, then the normal spawner
      if (S.script.length) {
        S.scriptClock += wdt;
        if (S.scriptClock >= S.script[0].at + 0.3 && spawnBlock(S.script[0])) {
          S.script.shift();
          if (!S.script.length) S.spawnT = diff().spawn;
        }
      } else {
        S.spawnT -= wdt;
        if (S.spawnT <= 0) S.spawnT = spawnBlock() ? diff().spawn * rand(0.9, 1.1) : 0.08;
      }
      if (S.forcedPowerAt && S.world >= S.forcedPowerAt.at && spawnPower(S.forcedPowerAt.kind)) S.forcedPowerAt = null;
      S.powerT -= wdt;
      if (S.powerT <= 0) {
        if (spawnPower(S.forcedPower)) { S.forcedPower = null; S.powerT = rand(CONFIG.power.every[0], CONFIG.power.every[1]); }
        else S.powerT = 0.3;
      }
    }

    // falling objects + catching
    const v = speedPx(), H = CONFIG.hit, half = L.wickSize * H.half, wx = S.wick.x;
    for (const o of S.objs) {
      if (o.gone) continue;
      if (o.popAt) {
        if (S.t >= o.popAt) { o.gone = true; burst(o.x + o.w / 2, o.y + o.h / 2, '#fff1a8', 12, { g: 120 }); sound('pop'); }
        continue;
      }
      o.y += v * wdt * (o.kind === 'power' ? CONFIG.power.speedMul : 1);
      if (S.phase !== 'play' || o.missed) continue;
      if (o.y > L.hitBot) { o.missed = true; continue; } // missing a GOOD block costs nothing
      const pad = L.wickSize * (o.kind === 'good' || o.kind === 'power' ? H.goodPad : H.badPad);
      if (o.y + o.h >= L.hitTop && o.y <= L.hitBot && o.x < wx + half + pad && o.x + o.w > wx - half - pad) catchObj(o);
    }
    S.objs = S.objs.filter(o => !o.gone && o.y < L.H + 10);

    // flying blocks land in their sockets
    for (const f of S.flyers) {
      f.age += dt;
      if (f.age >= f.dur && !f.landed) {
        f.landed = true;
        S.shown[f.type] = true; S.pops[f.type] = 1;
        const r = socketRects()[f.type];
        if (r) burst(r.cx, r.cy, typeColor(f.type), 14, { speed: 200, up: 10, g: 160 });
      }
    }
    S.flyers = S.flyers.filter(f => !f.landed);
    if (S.sendPending && !S.flyers.length && S.phase === 'play') beginSend();

    for (const d of S.debris) { d.age += dt; d.vy += 900 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt; }
    S.debris = S.debris.filter(d => d.age < d.max);
    for (const p of S.parts) { p.age += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.rot += p.vr * dt; }
    S.parts = S.parts.filter(p => p.age < p.max);
    for (const f of S.floats) { f.age += dt; f.y -= 40 * dt; }
    S.floats = S.floats.filter(f => f.age < f.max);
    for (const t of S.toasts) t.age += dt;
    S.toasts = S.toasts.filter(t => t.age < t.max);
    if (S.bubble) { S.bubble.age += dt; if (S.bubble.age > S.bubble.max) S.bubble = null; }
    if (S.wave) { S.wave.age += dt; if (S.wave.age > 0.8) S.wave = null; }
    if (S.sendLine) { S.sendLine.age += dt; if (S.sendLine.age > S.sendLine.max) S.sendLine = null; }

    if (S.phase === 'send') updateSend(dt);
    if ((S.phase === 'clear' || S.phase === 'fail') && S.phaseT > 1.6 && !S.ended) {
      S.ended = true;
      const res = S.result, cb = S.opts.onExit;
      S.phase = 'done';
      if (cb) cb(res);
    }
  }

  function updateWick(dt) {
    const w = S.wick, half = L.wickSize * 0.3;
    const dir = (S.keys.r ? 1 : 0) - (S.keys.l ? 1 : 0);
    if (dir && (S.phase === 'play' || S.phase === 'intro')) w.tx = w.x + dir * CONFIG.wick.keySpeed / CONFIG.wick.follow; // steady ≈ keySpeed px/s
    w.tx = clamp(w.tx, half, L.pw - half);
    const prev = w.x;
    w.x += (w.tx - w.x) * (1 - Math.exp(-CONFIG.wick.follow * dt));
    w.x = clamp(w.x, half, L.pw - half);
    const vx = dt > 0 ? (w.x - prev) / dt : 0;
    w.lean += (clamp(vx / 700, -1, 1) - w.lean) * Math.min(1, dt * 10);
    if (S.phase === 'send') w.squash += (1 - w.squash) * Math.min(1, dt * 8);  // stretch +20% on SEND
    else { w.squash *= Math.exp(-7 * dt); if (Math.abs(w.squash) < 0.01) w.squash = 0; }
    let flame = S.phase === 'fail' || S.phase === 'done' && !S.result.cleared ? 0.1 : 0.6 + 0.12 * S.flames + 0.05 * (mult() - 1);
    if (S.flameDip > 0) flame = 0.2;
    w.flame += (flame - w.flame) * Math.min(1, dt * 8);
    if (w.moodT > 0) { w.moodT -= dt; if (w.moodT <= 0 && S.phase === 'play') w.mood = 'idle'; }
    S.idleT += dt;
  }

  function updateSend(dt) {
    const s = S.send; if (!s) return;
    const F = CONFIG.sendFx;
    s.t += dt;
    if (s.step === 'flash' && s.t > F.slowSecs) { s.step = 'prompt'; s.t = 0; popAll(); }
    else if (s.step === 'prompt' && s.t > 1.6) { s.step = 'type'; s.t = 0; setMood('happy'); }
    else if (s.step === 'type') {
      const before = Math.floor(s.typed);
      s.typed = Math.min(s.text.length, s.typed + dt * F.cps);
      if (Math.floor(s.typed) !== before && ++s.ticks % 3 === 0) sound('tick');
      if (s.typed >= s.text.length) { s.step = 'hold'; s.t = 0; }
    } else if (s.step === 'hold' && s.t > F.holdAuto) finishSend();
  }

  /** Tap / Space: skip the intro, or hurry the SEND sequence along. */
  function skip() {
    if (!S || paused) return;
    if (S.phase === 'intro' && S.phaseT > 0.3) { S.phase = 'play'; S.phaseT = 0; return; }
    if (S.phase === 'send' && S.send) {
      const s = S.send;
      if (s.step === 'prompt' && s.t > 0.3) { s.step = 'type'; s.t = 0; setMood('happy'); }
      else if (s.step === 'type') s.typed = s.text.length;
      else if (s.step === 'hold' && s.t >= CONFIG.sendFx.holdMin) finishSend();
    }
  }

  /* ───────────── Render ───────────── */
  function render() {
    const A = window.Art, t = S.t;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    A.drawBackground(ctx, L.W, L.H, t);

    ctx.save();
    if (S.shake > 0) {
      const k = S.shake / CONFIG.shake.secs * CONFIG.shake.px;
      ctx.translate(Math.sin(t * 90) * k, Math.cos(t * 70) * k * 0.5);
    }
    ctx.translate(L.ox, 0);

    // falling objects slide out from under the prompt bar, fading in as they emerge
    // (a half-hidden block with cut-off text reads as a glitch)
    const clipTop = L.zoneTop - 6;
    ctx.save();
    ctx.beginPath(); ctx.rect(-L.ox, clipTop, L.W, L.H); ctx.clip();
    for (const o of S.objs) {
      const enter = clamp((o.y + o.h - clipTop) / o.h, 0, 1);
      if (o.kind === 'power') {
        ctx.globalAlpha = enter;
        A.drawPowerup(ctx, o.x + o.r, o.y + o.r, o.r, o.power, t);
        ctx.globalAlpha = 1;
        continue;
      }
      const fade = (o.missed ? clamp(1 - (o.y - L.hitBot) / 80, 0, 1) : 1) * enter * enter;
      if (fade <= 0) continue;
      ctx.globalAlpha = fade;
      A.drawBlock(ctx, o.x, o.y, o.w, o.h, { type: o.type, text: o.text, kind: o.kind, glow: o.popAt ? 1 : 0 }, t + o.wob);
      ctx.globalAlpha = 1;
      if (o.tag) drawTag(o);
    }
    for (const d of S.debris) drawDebris(d);
    ctx.restore();

    if (S.wave) drawWave();
    drawGhostHint();
    A.drawWick(ctx, S.wick.x, L.wickBase, L.wickSize,
      { mood: S.wick.mood, squash: S.wick.squash, lean: S.wick.lean, flame: S.wick.flame, t });
    if (SHOW_HITBOX) drawHitbox();
    drawParticles();
    ctx.restore();

    // slow-mo tint over the world, under the HUD chrome
    if (S.slowT > 0 && A.drawSlowmo) A.drawSlowmo(ctx, L.W, L.H, Math.min(1, S.slowT * 2), t);

    ctx.save();
    ctx.translate(L.ox, 0);
    const k = S.reqIndex, wave = CONFIG.endless.waveEvery;
    A.drawHUD(ctx, L.pw, L.H, {
      score: S.score, combo: mult(), comboPop: S.comboPop, flames: S.flames, maxFlames: CONFIG.flames,
      stageTitle: S.endless ? 'Endless · Wave ' + (Math.floor(k / wave) + 1) : S.stage.title,
      reqIndex: S.endless ? S.reqDone : k, reqTotal: S.endless ? 0 : S.stage.requests.length,
      slowmo: false, left: 56, height: L.hudH,
    }, t);
    const slide = (1 - easeOut(S.cardIn)) * -(L.cardH + 20);
    ctx.save();
    ctx.globalAlpha = easeOut(S.cardIn);
    A.drawRequestCard(ctx, L.cardX, L.cardY + slide, L.cardW, L.cardH, S.req.who, S.req.need, t);
    ctx.restore();
    drawPromptBar();
    for (const f of S.flyers) drawFlyer(f);
    // score pop-ups: under Wick's "Hmm…" bubble during play, above the scrims of SEND / stage end
    const floatsOnTop = S.phase !== 'play' && S.phase !== 'intro';
    if (!floatsOnTop) drawFloats();
    drawToasts();
    if (S.bubble && S.phase === 'play') {
      const a = Math.min(1, S.bubble.age / 0.12, (S.bubble.max - S.bubble.age) / 0.2);
      ctx.globalAlpha = a;
      wickBubble(S.bubble.text, S.bubble.text, Math.min(290, L.pw - 24));
      ctx.globalAlpha = 1;
    }
    if (S.phase === 'intro') drawIntro();
    if (S.phase === 'send' && S.send) drawSend();
    if (S.phase === 'clear' || S.phase === 'fail' || S.phase === 'done') drawEndBanner();
    if (floatsOnTop) drawFloats();
    ctx.restore();

    if (S.flash > 0 && A.drawFlash) A.drawFlash(ctx, L.W, L.H, S.flash / CONFIG.sendFx.flashSecs * 0.5);
  }

  function drawPromptBar() {
    const A = window.Art;
    // SEND ripple: sockets pop left to right, 60 ms apart
    const pops = {};
    S.types.forEach((ty, i) => {
      let p = S.pops[ty] || 0;
      if (S.phase === 'send') { const q = S.phaseT - i * 0.06; if (q > 0 && q < 0.2) p = Math.max(p, Math.sin(q / 0.2 * Math.PI)); }
      pops[ty] = p;
    });
    if (A.drawPromptBar) A.drawPromptBar(ctx, 12, L.barY, L.pw - 24, L.barH, S.types, S.shown, pops, S.t);
    else {
      const r = socketRects();
      S.types.forEach(ty => A.drawSocket(ctx, r[ty].x, r[ty].y, r[ty].w, r[ty].h, ty, !!S.shown[ty], pops[ty], S.t));
    }
  }

  /** Speech bubble above Wick, tail pointing at his flame. Box size comes from the FULL text so it stays put while typing. */
  function wickBubble(text, fullText, maxW) {
    const A = window.Art;
    const sz = A.bubbleSize ? A.bubbleSize(maxW, fullText) : { w: maxW, h: 80, tail: 11 };
    const bx = clamp(S.wick.x - sz.w / 2, 8, L.pw - sz.w - 8);
    const by = Math.max(L.zoneTop + 4, L.hitTop - 8 - (sz.tail || 11) - sz.h);
    // drawBubble centres the measured box inside [x, x + w]; offset x so the box lands at bx
    const cur = A.bubbleSize ? A.bubbleSize(maxW, text) : sz;
    A.drawBubble(ctx, bx + (sz.w - cur.w) / 2 - (maxW - cur.w) / 2, by, maxW, text, S.t, S.wick.x);
  }

  function drawFlyer(f) {
    const p = easeOut(f.age / f.dur), x = f.x0 + (f.x1 - f.x0) * p;
    const y = f.y0 + (f.y1 - f.y0) * p - Math.sin(p * Math.PI) * 60;
    const s = 1 - 0.6 * p;
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s);
    window.Art.drawBlock(ctx, -f.w / 2, -f.h / 2, f.w, f.h, { type: f.type, text: f.text, kind: 'good', glow: 0.6 }, S.t);
    ctx.restore();
  }

  function drawDebris(d) {
    ctx.save();
    ctx.globalAlpha = clamp(1 - d.age / d.max, 0, 1);
    ctx.translate(d.x, d.y); ctx.rotate(d.rot);
    window.Art.drawBlock(ctx, -d.w / 2, -d.h / 2, d.w, d.h, { type: d.type, text: d.text, kind: 'wrong', glow: 0 }, S.t);
    if (d.age < 0.2) { ctx.strokeStyle = '#F27B7B'; ctx.lineWidth = 3; roundRect(ctx, -d.w / 2 - 2, -d.h / 2 - 2, d.w + 4, d.h + 4, 16); ctx.stroke(); }
    ctx.restore();
  }

  function drawTag(o) {
    ctx.font = '800 13px ' + FONT;
    const w = ctx.measureText(o.tag).width + 20, h = 24;
    const x = clamp(o.x + o.w / 2 - w / 2, 4, L.pw - w - 4), y = o.y - h - 8;
    const bob = Math.sin(S.t * 5) * 2;
    ctx.fillStyle = o.kind === 'junk' ? '#F27B7B' : '#F2C94C';
    roundRect(ctx, x, y + bob, w, h, 12); ctx.fill();
    ctx.fillStyle = '#15142b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.tag, x + w / 2, y + h / 2 + bob + 1);
  }

  function drawWave() {
    const p = S.wave.age / 0.8, r = p * Math.max(L.pw, L.H);
    ctx.save();
    ctx.globalAlpha = (1 - p) * 0.8;
    ctx.strokeStyle = '#fff1a8'; ctx.lineWidth = 10 * (1 - p) + 2;
    ctx.beginPath(); ctx.arc(S.wave.x, S.wave.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  /** Ghost finger (stage 1): hides on the first real input, comes back after 6 s without input. */
  function drawGhostHint() {
    if (S.stageIndex !== 0 || S.phase !== 'play') return;
    if (S.moved && S.idleT < 6) return;
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const a = 0.55 + 0.25 * Math.sin(S.t * 3);
    const x = S.wick.x + Math.sin(S.t * 2.4) * Math.min(70, L.pw * 0.18), y = L.wickBase - L.wickSize * 0.25;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '800 14px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(21,20,43,.85)';
    const label = coarse ? '← Drag to move →' : '← → or mouse to move';
    const lx = clamp(S.wick.x, 90, L.pw - 90);
    ctx.strokeText(label, lx, L.hitTop - 10); ctx.fillStyle = '#ffffff'; ctx.fillText(label, lx, L.hitTop - 10);
    ctx.restore();
  }

  function drawHitbox() {
    const H = CONFIG.hit, half = L.wickSize * H.half, gp = L.wickSize * H.goodPad, bp = L.wickSize * H.badPad;
    ctx.save();
    ctx.strokeStyle = '#7BD389'; ctx.lineWidth = 1;
    ctx.strokeRect(S.wick.x - half - gp, L.hitTop, (half + gp) * 2, L.hitBot - L.hitTop);
    ctx.strokeStyle = '#F27B7B';
    ctx.strokeRect(S.wick.x - half - bp, L.hitTop, (half + bp) * 2, L.hitBot - L.hitTop);
    ctx.restore();
  }

  function drawParticles() {
    for (const p of S.parts) {
      const life = 1 - p.age / p.max;
      if (p.d) { p.life = life; p.d.draw(ctx, p); continue; }
      ctx.globalAlpha = life; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloats() {
    const A = window.Art;
    for (const f of S.floats) {
      const a = Math.min(1, (f.max - f.age) / 0.3), sc = 1 + 0.3 * Math.max(0, 1 - f.age * 6);
      if (A.drawPopText) A.drawPopText(ctx, f.x, f.y, f.text, f.color, a, sc, f.px);
    }
    if (S.sendLine) {
      const a = Math.min(1, (S.sendLine.max - S.sendLine.age) / 0.3);
      ctx.globalAlpha = a; ctx.font = '700 14px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#c9c7ea'; ctx.fillText(S.sendLine.text, L.pw / 2, L.zoneTop + 72);
      ctx.globalAlpha = 1;
    }
  }

  function drawToasts() {
    const A = window.Art;
    for (const tt of S.toasts) {
      const a = Math.min(1, tt.age / 0.15, (tt.max - tt.age) / 0.35);
      const y = L.zoneTop + 26 - (1 - Math.min(1, tt.age / 0.15)) * 8;
      A.drawToast(ctx, L.pw / 2, y, tt.text, tt.kind, a, L.pw - 16);
    }
  }

  /** Dims the play area under the prompt bar. On wide screens the side gutters dim full-height too,
   *  so there is no hard bright band across the whole screen (the landscape request card stays lit). */
  function scrim(alpha) {
    ctx.fillStyle = 'rgba(10,9,26,' + alpha + ')';
    const y = L.zoneTop - 6;
    if (L.side || L.ox <= 0) { ctx.fillRect(-L.ox, y, L.W, L.H - y); return; }
    ctx.fillRect(0, y, L.pw, L.H - y);
    ctx.fillRect(-L.ox, 0, L.ox, L.H);
    ctx.fillRect(L.pw, 0, L.W - L.ox - L.pw, L.H);
  }

  function centerLines(lines, y, lh) {
    lines.forEach((l, i) => ctx.fillText(l, L.pw / 2, y + i * lh));
    return y + lines.length * lh;
  }

  function drawIntro() {
    const len = S.firstTime ? 2.0 : 1.6;
    const a = Math.max(0, Math.min(1, S.phaseT / 0.2, (len - S.phaseT) / 0.3));
    ctx.globalAlpha = a;
    scrim(0.6);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    let y = L.zoneTop + Math.max(24, (L.hitTop - L.zoneTop) * 0.2);
    if (S.firstTime && S.phaseT < 0.8) {
      ctx.fillStyle = '#F2C94C'; ctx.font = '900 34px ' + FONT;
      ctx.fillText('Now catch it!', L.pw / 2, y + 30);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = '#8B88F5'; ctx.font = '800 13px ' + FONT;
    ctx.fillText(S.endless ? 'ENDLESS MODE' : 'STAGE ' + (S.stageIndex + 1), L.pw / 2, y);
    y += 22;
    ctx.fillStyle = '#ffffff'; ctx.font = '800 30px ' + FONT;
    y = centerLines(wrapText(ctx, S.endless ? 'How long can you glow?' : S.stage.title, L.pw - 48), y, 36) + 8;
    ctx.fillStyle = '#c9c7ea'; ctx.font = '600 16px ' + FONT;
    const intro = S.endless ? 'Random requests. It keeps getting faster!' : (S.stage.intro || '');
    centerLines(wrapText(ctx, intro, L.pw - 56), y, 22);
    ctx.globalAlpha = 1;
  }

  function drawSend() {
    const s = S.send, A = window.Art;
    if (s.step === 'flash' || s.step === 'prompt') {
      const a = s.step === 'flash' ? Math.min(1, s.t / 0.3) : 1;
      ctx.globalAlpha = a;
      scrim(0.55);
      // the assembled prompt: the caught blocks snap together into a stack (2 columns / scaled when tall)
      const items = S.types.map(type => ({ type, text: S.filled[type] }));
      const gap = 6, sizes = items.map(it => A.measureBlock(ctx, it.text));
      const bw0 = Math.max(...sizes.map(z => z.w)), bh = Math.max(...sizes.map(z => z.h));
      const top = L.zoneTop + 112, avail = Math.max(120, L.hitTop - 12 - top); // keep Wick visible below the stack
      let cols = 1;
      if (items.length * (bh + gap) - gap > avail && L.pw >= bw0 * 2 + gap + 16) cols = 2;
      const rows = Math.ceil(items.length / cols);
      const bw = cols === 1 ? Math.min(L.pw - 32, bw0 + 20) : Math.min((L.pw - 16 - gap) / 2, bw0 + 12);
      const gridW = cols * bw + (cols - 1) * gap, gridH = rows * bh + (rows - 1) * gap;
      const sc = Math.min(1, avail / gridH);
      const y0 = top + Math.max(0, (avail - gridH * sc) / 2 - 20);
      ctx.fillStyle = '#c9c7ea'; ctx.font = '800 13px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('YOUR PROMPT ➤ WICK', L.pw / 2, y0 - 8);
      ctx.save();
      ctx.translate(L.pw / 2, y0); ctx.scale(sc, sc);
      items.forEach((it, i) => {
        const appear = clamp((s.t + (s.step === 'prompt' ? 0.6 : 0) - i * 0.08) / 0.25, 0, 1);
        const c = i % cols, r = Math.floor(i / cols);
        const x = -gridW / 2 + c * (bw + gap), y = r * (bh + gap) + (1 - easeOut(appear)) * 30;
        ctx.globalAlpha = a * appear;
        A.drawBlock(ctx, x, y, bw, bh, { type: it.type, text: it.text, kind: 'good', glow: 0.5 }, S.t);
      });
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    // Wick's answer types out in a speech bubble pointing at Wick
    scrim(0.35);
    const text = s.text.slice(0, Math.floor(s.typed));
    wickBubble(text || '…', s.text, Math.min(L.pw - 24, 360));
    if (s.step === 'hold' && s.t >= CONFIG.sendFx.holdMin) {
      ctx.fillStyle = '#c9c7ea'; ctx.font = '700 13px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const last = !S.endless && S.reqIndex >= S.stage.requests.length - 1;
      ctx.fillText(last ? 'Tap to finish' : 'Tap for the next request', L.pw / 2, L.zoneTop + 8);
    }
  }

  function drawEndBanner() {
    const clear = S.result && S.result.cleared;
    ctx.globalAlpha = Math.min(1, S.phaseT / 0.4);
    scrim(0.45);
    const msg = clear ? 'Stage clear!' : S.endless ? 'Game over' : 'Out of flames!';
    const y = (L.zoneTop + L.hitTop) / 2;
    if (window.Art.drawPopText) window.Art.drawPopText(ctx, L.pw / 2, y, msg, clear ? '#F2C94C' : '#F27B7B', 1, 1 + 0.2 * Math.max(0, 1 - S.phaseT * 4), 34);
    ctx.globalAlpha = 1;
  }

  /* ───────────── Input ───────────── */
  function localX(e) { const r = canvas.getBoundingClientRect(); return e.clientX - r.left - L.ox; }
  function steer(x) {
    if (S.phase !== 'play' && S.phase !== 'intro') return;
    S.wick.tx = x;
    S.moved = true; S.idleT = 0;
  }
  const onPointerDown = e => {
    if (paused || !S) return;
    if (e.pointerType !== 'mouse') { S.dragging = true; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ } }
    steer(localX(e));
    skip();
  };
  const onPointerMove = e => {
    if (paused || !S) return;
    if (e.pointerType === 'mouse' || S.dragging) steer(localX(e));
  };
  const onPointerUp = () => { if (S) S.dragging = false; };
  const KEYS_L = ['ArrowLeft', 'a', 'A'], KEYS_R = ['ArrowRight', 'd', 'D'];
  const onKeyDown = e => {
    if (!S || paused) return;
    if (KEYS_L.includes(e.key)) { S.keys.l = true; S.moved = true; S.idleT = 0; e.preventDefault(); }
    else if (KEYS_R.includes(e.key)) { S.keys.r = true; S.moved = true; S.idleT = 0; e.preventDefault(); }
    else if ((e.key === ' ' || e.key === 'Enter') && !(e.target && e.target.closest && e.target.closest('button'))) { skip(); e.preventDefault(); }
  };
  const onKeyUp = e => {
    if (!S) return;
    if (KEYS_L.includes(e.key)) S.keys.l = false;
    if (KEYS_R.includes(e.key)) S.keys.r = false;
  };
  const onResize = () => { if (canvas && S) resize(); };
  const onContextMenu = e => e.preventDefault(); // long-press on a phone must not open a menu mid-game

  function bind(on) {
    const m = on ? 'addEventListener' : 'removeEventListener';
    canvas[m]('pointerdown', onPointerDown);
    canvas[m]('pointermove', onPointerMove);
    canvas[m]('pointerup', onPointerUp);
    canvas[m]('pointercancel', onPointerUp);
    canvas[m]('contextmenu', onContextMenu);
    window[m]('keydown', onKeyDown);
    window[m]('keyup', onKeyUp);
    window[m]('resize', onResize);
  }

  /* ───────────── Public API ───────────── */
  window.Arcade = {
    CONFIG,
    /** opts = { canvas, stage, endless, firstTime, sfx(name, data), onExit(result), onEvent(name, data) }
     *  result = { cleared, stars, score, flames, failReason, endless, requests, maxCombo } */
    start(opts) {
      if (S) this.stop();
      canvas = opts.canvas; ctx = canvas.getContext('2d');
      if (typeof opts.sfx === 'function') sound = opts.sfx;
      paused = false;
      newRun(opts);
      bind(true);
      perf.frames = 0; perf.total = 0; perf.max = 0;
    },
    /** Advance and draw one frame. Called only by game.js's pausable clock. */
    tick(dtMs) {
      if (!S || paused || !canvas) return;
      const t0 = performance.now();
      if (canvas.clientWidth !== L.W || canvas.clientHeight !== L.H) resize();
      // dt is clamped (a hitch never teleports blocks); long frames are split for stable catching
      const dt = Math.min(Math.max(dtMs, 0), 50) / 1000;
      if (dt > 0.025) { update(dt / 2); if (S && S.phase !== 'done') update(dt / 2); } else update(dt);
      if (S) render();
      const ms = performance.now() - t0;
      perf.frames++; perf.total += ms; perf.max = Math.max(perf.max, ms);
    },
    pause() { paused = true; if (S) { S.keys.l = S.keys.r = false; S.dragging = false; } },
    resume() { paused = false; },
    /** Ends the run without a result (exit button). Returns a snapshot { score, endless, phase, requests }. */
    stop() {
      const snap = S ? { score: S.score, endless: S.endless, phase: S.phase, requests: S.reqDone } : null;
      if (canvas) bind(false);
      S = null;
      return snap;
    },
    /** fn(name, data) plays sound effects: request, catch, bonus, combo, fizz, wrong, junk, power, pop, send, tick, wave, clear, fail, over. */
    setAudio(fn) { sound = typeof fn === 'function' ? fn : () => {}; },
    get active() { return !!S; },
  };

  /* Read-only snapshot for automated tests (only with ?debug=1). */
  if (DEBUG) {
    window.ArcadeDebug = {
      get state() {
        if (!S) return null;
        const r = canvas.getBoundingClientRect();
        return JSON.parse(JSON.stringify({
          phase: S.phase, sendStep: S.send && S.send.step, t: S.t, world: S.world, score: S.score, flames: S.flames,
          combo: S.combo, mult: mult(), reqIndex: S.reqIndex, reqDone: S.reqDone, types: S.types, filled: S.filled,
          need: unfilled(), slowT: S.slowT, diff: diff(), stageIndex: S.stageIndex,
          wickX: S.wick.x, wickSize: L.wickSize, hitHalf: L.wickSize * CONFIG.hit.half,
          goodPad: L.wickSize * CONFIG.hit.goodPad, badPad: L.wickSize * CONFIG.hit.badPad,
          hitTop: L.hitTop, hitBot: L.hitBot, ox: L.ox, pw: L.pw, W: L.W, H: L.H, zoneTop: L.zoneTop,
          canvasLeft: r.left, canvasTop: r.top, speedPx: speedPx(),
          objs: S.objs.filter(o => !o.gone).map(o => ({ id: o.id, kind: o.kind, type: o.type, power: o.power, text: o.text,
            x: o.x, y: o.y, w: o.w, h: o.h, missed: !!o.missed, popping: !!o.popAt })),
          result: S.result, bubble: S.bubble ? S.bubble.text : '', toast: S.toasts.length ? S.toasts[0].text : '',
        }));
      },
      get perf() { return { frames: perf.frames, avgMs: perf.frames ? perf.total / perf.frames : 0, maxMs: perf.max }; },
    };
  }
})();
