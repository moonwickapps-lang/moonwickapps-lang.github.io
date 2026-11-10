/* picture.js — Prompt Academy v3 "Picture This": the build → paint → compare loop.
 *
 *  BUILD:  the target picture + word-chip tabs + a live sentence preview.
 *  PAINT:  Wick paints the result (1.2 s brush reveal, driven by game.js's one clock).
 *  RESULT: target vs result, MATCH %, differences circled, Wick's notes, what Wick guessed.
 *
 * Talks to game.js only through the `api` passed to PicturePlay.init().
 */
'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const P = window.PICTURE;
  const RENDER_SCALE = 1.5;         // 960×720 canvases: crisp on phones, cheap to draw
  const PAINT_MS = 1200;
  const PASS = 80;
  const FREE_PAINTS = 3;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let api = null;
  let cur = null;    // the level / free-play round being played
  let paint = null;  // the running brush animation

  /* ───────────── setup ───────────── */
  function levelTabs(def, step) { return def.steps ? def.steps[step].tabs : def.tabs; }
  function allTabs(def) { return def.steps ? def.steps.reduce((a, s) => a.concat(s.tabs), []) : def.tabs; }

  function begin(c) {
    cur = Object.assign({ picks: {}, step: 0, gens: 0, best: 0, fixed: null, last: null, active: null }, c);
    cur.layoutSeed = window.Scene.hash('layout:' + cur.key);
    cur.targetPic = window.Scene.render(P.toScene(cur.target), cur.layoutSeed, { scale: RENDER_SCALE });
    if (cur.def.example) {
      const ex = window.Scene.render(P.toScene(cur.def.example), 77, { scale: 0.5 });
      cur.exampleURL = ex.canvas.toDataURL('image/png');
    }
    cur.active = levelTabs(cur.def, 0)[0][0];
    // Chips are listed in a shuffled order (once per level), so the right one is never simply first.
    cur.order = {};
    allTabs(cur.def).forEach(([id, chips]) => {
      const idx = chips.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      cur.order[id] = idx;
    });
    api.show('picture');
    showBuild();
    $('#pic-target-box').replaceChildren(fitCanvas(cur.targetPic.canvas));
  }

  function startLevel(i) {
    const def = P.LEVELS[i];
    begin({ mode: 'level', idx: i, def, key: def.id, target: def.target });
    api.openModal(`
      <div class="kicker">Picture ${i + 1} of ${P.LEVELS.length} · ${esc(window.LEVELS[i].title)}</div>
      <h3>${esc(def.short)}</h3>
      <div class="chat"><div class="wick-slot" data-wick data-mood="happy"></div>
        <div class="bubble">${esc(def.intro)}</div></div>
      <p class="tipcard"><b>How to win:</b> describe the picture with word chips, then tap <b>Paint it</b>. Match 80% to pass, 100% in two paints for ★★★.</p>
      <div class="modal-actions"><button class="btn primary" data-act="close">Let’s paint!</button></div>`);
  }

  function startFree(run) {
    run = run || { round: 1, points: 0, seed: (Math.random() * 4294967296) >>> 0 };
    const r = window.Scene.rng(run.seed + run.round * 7919);
    begin({ mode: 'free', def: P.FREE, key: 'free:' + run.seed + ':' + run.round, target: P.randomTarget(r), run });
  }

  /* ───────────── BUILD view ───────────── */
  function showBuild() {
    $('#pic-build').hidden = false;
    $('#pic-result').hidden = true;
    paint = null;
    renderHeader();
    renderTabs();
    renderChips();
    renderSentence();
    $('#pic-scroll').scrollTop = 0;
  }

  function renderHeader() {
    const lvl = cur.mode === 'level';
    $('#pic-title').textContent = lvl ? `${cur.idx + 1}. ${cur.def.short}` : 'Free play';
    $('#pic-pill').textContent = lvl ? (cur.best ? `Best ${cur.best}%` : `Paint ${cur.gens + 1}`)
      : `Round ${cur.run.round}/${P.FREE.rounds} · ${cur.run.points} pts`;
    const step = cur.def.steps ? cur.def.steps[cur.step].title : '';
    $('#pic-step').textContent = step;
    $('#pic-step').hidden = !step;
    $('#btn-step-back').hidden = !(cur.def.steps && cur.step === 1);
    const gen = $('#btn-generate');
    if (cur.mode === 'free') {
      const left = FREE_PAINTS - cur.gens;
      gen.textContent = left > 0 ? `Paint it, Wick! 🖌 (${left} left)` : 'Next picture ›';
      gen.dataset.pact = left > 0 ? 'generate' : 'free-next';
    } else { gen.textContent = 'Paint it, Wick! 🖌'; gen.dataset.pact = 'generate'; }
  }

  function renderTabs() {
    const tabs = levelTabs(cur.def, cur.step);
    $('#pic-tabs').innerHTML = tabs.map(([id]) => {
      const t = P.TAB_INFO[id];
      return `<button class="tab ${cur.active === id ? 'active' : ''} ${cur.picks[id] ? 'done' : ''}" data-tab="${id}" role="tab"
        aria-selected="${cur.active === id}" style="--c:${t.color}">${esc(t.label)}</button>`;
    }).join('');
    const a = $('#pic-tabs .tab.active'); if (a) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderChips() {
    const tab = levelTabs(cur.def, cur.step).find(t => t[0] === cur.active);
    const info = P.TAB_INFO[cur.active];
    const chips = tab ? tab[1] : [];
    let hint = esc(info.hint);
    if (chips.some(c => c.example) && cur.exampleURL) {
      hint += `<span class="example-pic"><img src="${cur.exampleURL}" alt="Example picture: pixel art"><small>An example you can show Wick</small></span>`;
    }
    $('#pic-hint').innerHTML = hint;
    $('#pic-chips').innerHTML = (cur.order[cur.active] || chips.map((_, i) => i)).map(i => [chips[i], i]).map(([c, i]) =>
      `<button class="chip ${cur.picks[cur.active] === c ? 'chosen' : ''}" data-chip="${i}" style="--c:${info.color}" aria-pressed="${cur.picks[cur.active] === c}">${esc(c.label)}</button>`).join('');
  }

  function renderSentence() {
    const s = P.sentence(cur.picks, allTabs(cur.def));
    const el = $('#pic-sentence');
    el.textContent = s || 'Tap the words below to describe the picture…';
    el.classList.toggle('empty', !s);
  }

  function pickChip(i) {
    const tab = levelTabs(cur.def, cur.step).find(t => t[0] === cur.active);
    const chip = tab[1][i];
    if (cur.picks[cur.active] === chip) delete cur.picks[cur.active];      // tap again = remove
    else {
      cur.picks[cur.active] = chip;
      // hop to the next unfilled tab to keep the flow going
      const tabs = levelTabs(cur.def, cur.step);
      const next = tabs.find(t => !cur.picks[t[0]]);
      if (next) setTimeout(() => { if (cur && !$('#pic-build').hidden) { cur.active = next[0]; renderTabs(); renderChips(); } }, 260);
    }
    api.sfx.pick();
    renderTabs(); renderChips(); renderSentence();
  }

  /* ───────────── GENERATE ───────────── */
  function generate(samePrompt) {
    if (cur.mode === 'free' && cur.gens >= FREE_PAINTS) return;
    const stepOne = cur.def.steps && cur.step === 0;
    const tabs = stepOne ? levelTabs(cur.def, 0) : allTabs(cur.def);
    const relevant = P.relevantFields(tabs);

    // Vague = unpredictable: a repaint of the same prompt always comes out different somewhere.
    let res, tries = 0;
    do {
      const seed = (Math.random() * 4294967296) >>> 0;
      res = P.resolve(cur.picks, tabs, cur.target, seed, stepOne ? null : cur.fixed);
      tries++;
    } while (cur.last && res.guessed.length && sameGuesses(res, cur.last) && tries < 16);
    cur.last = res;

    const scene = Object.assign({}, res.scene);
    if (stepOne) scene.count = 0; // step 1 paints the empty scene only
    const cmp = P.compare(cur.target, scene, relevant);
    cur.gens++;
    cur.lastStepOne = stepOne;
    if (stepOne) cur.stepOneScene = res.scene;
    const pic = window.Scene.render(P.toScene(scene), cur.layoutSeed, { scale: RENDER_SCALE });
    showResult({ res, scene, cmp, pic, stepOne, samePrompt });
  }
  function sameGuesses(a, b) {
    return a.guessed.every(g => a.scene[g.field] === b.scene[g.field]);
  }

  /* ───────────── RESULT view ───────────── */
  function showResult(r) {
    $('#pic-build').hidden = true;
    $('#pic-result').hidden = false;
    $('#pic-scroll').scrollTop = 0;
    renderHeader();
    $('#res-target').replaceChildren(fitCanvas(copyCanvas(cur.targetPic.canvas)));
    const disp = document.createElement('canvas');
    disp.width = r.pic.canvas.width; disp.height = r.pic.canvas.height;
    $('#res-result').replaceChildren(fitCanvas(disp));
    $('#res-pct').textContent = '…';
    $('#res-stars').innerHTML = '';
    $('#res-notes').innerHTML = '';
    $('#res-guess').textContent = '';
    $('#res-actions').innerHTML = '';
    $('#res-prompt').textContent = '“' + (P.sentence(cur.picks, allTabs(cur.def)) || '(an empty prompt)') + '”';
    const wick = $('#res-wick');
    if (!wick.querySelector('svg')) api.mountWick(wick, 'thinking');
    api.setMood(wick, 'thinking');
    $('#res-bubble').textContent = r.samePrompt ? 'Same words, new painting…' : 'Painting…';
    api.sfx.send();
    paint = { t: 0, disp, r };
    drawPaint();
  }

  /** Brush reveal: rows painted left/right, a faint sketch underneath, Wick riding the brush. */
  function tick(dt) {
    if (!paint) return;
    paint.t += dt;
    drawPaint();
    if (paint.t >= PAINT_MS) { const p = paint; paint = null; finishResult(p.r, p.disp); }
  }
  function drawPaint() {
    const { disp, r } = paint;
    const c = disp.getContext('2d'), w = disp.width, h = disp.height;
    const p = Math.min(1, paint.t / PAINT_MS), rows = 5, rh = h / rows;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#F5EFE2'; c.fillRect(0, 0, w, h);
    c.globalAlpha = 0.16; c.drawImage(r.pic.canvas, 0, 0); c.globalAlpha = 1;
    const done = p * rows, full = Math.floor(done), part = done - full;
    c.save(); c.beginPath();
    c.rect(0, 0, w, full * rh);
    let bx = 0, by = 0;
    if (full < rows) {
      const ltr = full % 2 === 0, pw = part * w;
      const x0 = ltr ? 0 : w - pw;
      c.rect(x0, full * rh, pw, rh);
      c.moveTo(ltr ? pw : x0, full * rh + rh / 2);
      c.arc(ltr ? pw : x0, full * rh + rh / 2, rh / 2, 0, Math.PI * 2);
      bx = ltr ? pw : x0; by = full * rh + rh / 2;
    }
    c.clip();
    c.drawImage(r.pic.canvas, 0, 0);
    c.restore();
    if (full < rows && window.Art && window.Art.drawWick) {
      const k = w / 640;
      c.save(); c.scale(1, 1);
      window.Art.drawWick(c, bx, by + 44 * k, 64 * k, { t: paint.t / 1000, mood: 'send' });
      c.restore();
    }
  }

  function boxFor(field, res, tgt) {
    if (['kind', 'count', 'color', 'action'].includes(field)) return res.subject || tgt.subject;
    if (field === 'place') return res.place || res.ground || res.frame;
    if (field === 'flowerColor' || field === 'flowerAmount') return res.flowers || tgt.flowers || res.ground;
    if (field === 'time') return res.time || res.sky || res.frame;      // a close-up may crop the sky away
    if (field === 'weather') return res.weather || res.sky || res.frame;
    if (field.startsWith('x_')) { const e = field.slice(2); return res[e] || tgt[e] || res.frame; }
    return res.frame; // style, camera
  }

  function finishResult(r, disp) {
    const c = disp.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(r.pic.canvas, 0, 0);
    const k = disp.width / 640;
    const shown = r.cmp.diffs.slice(0, 3);
    shown.forEach((d, i) => circleBox(c, boxFor(d.field, r.pic.boxes, cur.targetPic.boxes), i + 1, k, d.field === 'style' || d.field === 'camera'));

    const pct = r.cmp.pct;
    const pass = pct >= PASS;
    const stepOne = r.stepOne;
    let stars = 0;
    if (!stepOne && cur.mode === 'level') {
      stars = pct === 100 && cur.gens <= 2 ? 3 : pct >= 90 ? 2 : pct >= PASS ? 1 : 0;
      cur.best = Math.max(cur.best, pct);
      if (pass) api.onLevelResult(cur.idx, pct, stars);
      else api.onLevelResult(cur.idx, pct, 0);
    }
    if (cur.mode === 'free') cur.roundBest = Math.max(cur.roundBest || 0, pct);

    $('#res-pct').textContent = pct + '%';
    $('#res-pct').className = pass ? 'good' : 'bad';
    $('#res-stars').innerHTML = cur.mode === 'level' && !stepOne
      ? [0, 1, 2].map(i => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('') : '';
    renderHeader();

    // Wick's notes (numbers match the circles)
    const wick = $('#res-wick');
    api.setMood(wick, pass ? 'happy' : 'confused');
    let say;
    if (pct === 100) say = stepOne ? 'The scene is spot on! Now let’s add who’s in it.' : 'Perfect match! You said everything I needed.';
    else if (pass) say = 'So close! Look at the circle' + (shown.length > 1 ? 's' : '') + ':';
    else say = 'Hmm, not quite. Here’s what came out different:';
    $('#res-bubble').textContent = say;
    $('#res-notes').innerHTML = shown.map((d, i) =>
      `<li><span class="num">${i + 1}</span>${esc(P.noteFor(d, cur.target, r.scene, r.res.guessed))}</li>`).join('')
      + (r.cmp.diffs.length > 3 ? `<li class="more">…and ${r.cmp.diffs.length - 3} more.</li>` : '');

    // 🎲 what Wick had to guess
    const g = r.res.guessed;
    if (g.length) {
      const byChip = new Map();
      g.forEach(x => {
        const key = x.chip ? `“${x.chip.label}”` : P.FIELD_NAME[x.field];
        const val = P.valueWord(x.field, r.res.scene[x.field], r.res.scene);
        if (!byChip.has(key)) byChip.set(key, []);
        byChip.get(key).push(val);
      });
      $('#res-guess').innerHTML = '<b>🎲 Wick guessed:</b> ' + Array.from(byChip, ([k, v]) => `${esc(k)} → ${esc(v.join(', '))}`).join(' · ');
    } else $('#res-guess').innerHTML = '<b>🎯 No guessing:</b> every detail came from your words.';

    // actions
    const A = [];
    const again = g.length ? `<button class="btn ghost" data-pact="again">🎲 Paint again (same words)</button>` : '';
    if (cur.mode === 'free') {
      const left = FREE_PAINTS - cur.gens;
      const last = cur.run.round >= P.FREE.rounds;
      if (left > 0 && pct < 100) A.push(`<button class="btn primary" data-pact="tweak">Tweak my prompt (${left} left)</button>`);
      A.push(`<button class="btn ${left > 0 && pct < 100 ? 'ghost' : 'primary'}" data-pact="free-next">${last ? 'See my score ›' : 'Next picture ›'} <small>+${cur.roundBest} pts</small></button>`);
      if (left > 0 && again) A.push(again);
    } else if (stepOne) {
      A.push(`<button class="btn primary" data-pact="step2">Step 2: add who’s in it ›</button>`);
      A.push(`<button class="btn ghost" data-pact="tweak">Tweak the scene</button>`);
      if (again) A.push(again);
    } else if (pass) {
      const lastLvl = cur.idx === P.LEVELS.length - 1;
      A.push(`<button class="btn primary" data-pact="next">${lastLvl ? 'Free play unlocked! ›' : 'Next: ' + esc(window.LEVELS[cur.idx + 1].title) + ' ›'}</button>`);
      A.push(`<button class="btn ghost" data-pact="tweak">${stars < 3 ? 'Try for ★★★' : 'Experiment: change some words'}</button>`);
      if (again) A.push(again);
    } else {
      A.push(`<button class="btn primary" data-pact="tweak">Tweak my prompt</button>`);
      if (again) A.push(again);
    }
    A.push(`<button class="btn ghost" data-back="map">Map</button>`);
    $('#res-actions').innerHTML = A.join('');
    if (pass) api.sfx.win(); else api.sfx.fail();
  }

  function circleBox(c, b, n, k, frame) {
    if (!b) return;
    const pad = 10, x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
    c.save();
    c.scale(k, k);
    c.lineWidth = 4.5; c.setLineDash([12, 7]); c.lineCap = 'round';
    c.strokeStyle = '#FF4D6D'; c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 6;
    c.beginPath();
    if (frame) { const r = 18; c.moveTo(14 + r, 14); c.arcTo(626, 14, 626, 466, r); c.arcTo(626, 466, 14, 466, r); c.arcTo(14, 466, 14, 14, r); c.arcTo(14, 14, 626, 14, r); }
    else c.ellipse(x + w / 2, y + h / 2, Math.max(28, w / 2 * 1.08), Math.max(24, h / 2 * 1.08), 0, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]); c.shadowBlur = 0;
    // number badge on the top-left of the circle
    const bx = frame ? 36 + (n - 1) * 30 : Math.max(18, Math.min(622, x + w * 0.15)), by = frame ? 36 : Math.max(18, Math.min(462, y + h * 0.08));
    c.beginPath(); c.arc(bx, by, 15, 0, Math.PI * 2); c.fillStyle = '#FF4D6D'; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#FFFFFF'; c.stroke();
    c.fillStyle = '#FFFFFF'; c.font = '900 18px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(n), bx, by + 1);
    c.restore();
  }

  /* ───────────── helpers ───────────── */
  function fitCanvas(cv) { cv.className = 'pic-canvas'; return cv; }
  function copyCanvas(src) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  function nextFree() {
    const run = cur.run;
    run.points += cur.roundBest || 0;
    if (run.round >= P.FREE.rounds) { api.onFreeResult(run.points); return; }
    run.round++;
    startFree(run);
  }

  /* ───────────── input ───────────── */
  function onClick(e) {
    if (!cur || api.isPaused()) return;
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.tab) { cur.active = t.dataset.tab; api.sfx.tap(); renderTabs(); renderChips(); return; }
    if (t.dataset.chip !== undefined) return pickChip(Number(t.dataset.chip));
    switch (t.dataset.pact) {
      case 'generate': return generate(false);
      case 'again': return generate(true);
      case 'tweak': api.sfx.tap(); return showBuild();
      case 'clear': api.sfx.tap(); levelTabs(cur.def, cur.step).forEach(([id]) => { delete cur.picks[id]; }); cur.last = null; renderTabs(); renderChips(); renderSentence(); return;
      case 'step2':
        api.sfx.tap();
        cur.fixed = {};
        P.relevantFields(levelTabs(cur.def, 0)).forEach(f => { cur.fixed[f] = cur.stepOneScene[f]; });
        cur.step = 1; cur.gens = 0; cur.last = null;
        cur.active = levelTabs(cur.def, 1)[0][0];
        return showBuild();
      case 'step1': api.sfx.tap(); cur.step = 0; cur.fixed = null; cur.last = null; cur.active = levelTabs(cur.def, 0)[0][0]; return showBuild();
      case 'next': api.sfx.tap(); return api.nextLevel(cur.idx);
      case 'free-next': api.sfx.tap(); return nextFree();
    }
  }

  window.PicturePlay = {
    init(a) { api = a; $('#screen-picture').addEventListener('click', onClick); },
    startLevel, startFree, tick,
    get painting() { return !!paint; },
    /** Esc: result -> back to the builder. Returns true when handled. */
    escape() {
      if (cur && !$('#pic-result').hidden && !paint) { showBuild(); return true; }
      return false;
    },
    stop() { paint = null; },
  };
})();
