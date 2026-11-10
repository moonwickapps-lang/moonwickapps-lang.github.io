/* Prompt Academy v3 — "Picture This". A Moonwick Apps game for YouTube Playables.
 * Screens, save data, audio and the ONE pausable clock live here.
 *  - LEARN: the card lessons (levels.js) teach each prompting principle.
 *  - PICTURE: picture.js (window.PicturePlay) — describe a picture with word chips,
 *    Wick paints it (scene.js), and you see how your words shifted the result.
 * Plain DOM + Canvas, no engine, no external calls (only the Playables SDK).
 */
'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const LEVELS = window.LEVELS;
  const META = window.SLOT_META;
  const PIC = window.PICTURE;
  const SAVE_KEY = 'moonwick.promptAcademy.v1'; // same key as v1/v2 so web saves migrate
  const DEBUG = /[?&]debug=1\b/.test(location.search);
  const SDK_TIMEOUT_MS = 3000;                  // boot never waits longer than this on the SDK

  /* ───────────── Playables SDK wrapper ─────────────
   * In YouTube we use ONLY the SDK for saves. Outside YouTube (e.g. a demo on
   * our own website) we fall back to localStorage so the web build still works.
   * Every call is guarded: a missing or misbehaving SDK must never block the game.
   */
  const yt = window.ytgame;
  const IN_YT = !!(yt && yt.IN_PLAYABLES_ENV);
  const SDK = {
    firstFrameReady() { try { yt && yt.game.firstFrameReady(); } catch (e) {} },
    gameReady() { try { yt && yt.game.gameReady(); } catch (e) {} },
    load() {
      if (IN_YT) return yt.game.loadData();
      try { return Promise.resolve(localStorage.getItem(SAVE_KEY) || ''); } catch (e) { return Promise.resolve(''); }
    },
    save(str) {
      if (IN_YT) return yt.game.saveData(str);
      try { localStorage.setItem(SAVE_KEY, str); } catch (e) {}
      return Promise.resolve();
    },
    score(value) {
      if (!IN_YT) return;
      try { yt.engagement.sendScore({ value }).catch(() => {}); } catch (e) {}
    },
    audioEnabled() { try { return yt ? yt.system.isAudioEnabled() !== false : true; } catch (e) { return true; } },
    onAudioChange(cb) { try { yt && yt.system.onAudioEnabledChange(cb); } catch (e) {} },
    onPause(cb) { try { yt && yt.system.onPause(cb); } catch (e) {} },
    onResume(cb) { try { yt && yt.system.onResume(cb); } catch (e) {} },
    logError(err) { try { yt && yt.health.logError(err); } catch (e) {} },
  };
  /** Resolves with the promise's value, or `fallback` after `ms` (never hangs). */
  function withTimeout(promise, ms, fallback) {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve(fallback), ms);
      Promise.resolve(promise).then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
    });
  }

  /* ───────────── Save state (v3) ─────────────
   * { v:3, learned:{lessonId:true}, stars:{levelId:1..3}, best:{levelId:0..100}, free:points }
   * v1 ({stars:{lessonId}}) and v2 ({learned, arcade stars}) keep `learned`; arcade progress is dropped.
   */
  const state = { learned: {}, stars: {}, best: {}, free: 0 };
  let canSave = false;      // true only once loadData has answered (Playables: load before save)
  let lastScoreSent = -1;
  const TIMED_OUT = {};

  const MAX_FREE = PIC.FREE.rounds * 100;
  const levelIds = new Set(LEVELS.map(l => l.id));

  function applySave(raw) {
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      if (d.learned && typeof d.learned === 'object') {
        for (const k of Object.keys(d.learned)) if (levelIds.has(k) && d.learned[k]) state.learned[k] = true;
      }
      if (d.v === 3) {
        if (d.stars && typeof d.stars === 'object') {
          for (const [k, v] of Object.entries(d.stars)) {
            const n = Math.round(Number(v));
            if (levelIds.has(k) && n >= 1 && n <= 3) state.stars[k] = Math.max(state.stars[k] || 0, n);
          }
        }
        if (d.best && typeof d.best === 'object') {
          for (const [k, v] of Object.entries(d.best)) {
            const n = Math.round(Number(v));
            if (levelIds.has(k) && n > 0 && n <= 100) state.best[k] = Math.max(state.best[k] || 0, n);
          }
        }
        const f = Math.round(Number(d.free));
        if (f > 0 && f <= MAX_FREE) state.free = Math.max(state.free, f);
      } else if (!d.v && d.stars && typeof d.stars === 'object') {
        // v1: lesson stars -> those lessons are learned
        for (const [k, v] of Object.entries(d.stars)) if (levelIds.has(k) && Number(v) >= 1) state.learned[k] = true;
      }
    } catch (e) { /* unreadable save: start fresh, never crash */ }
  }

  async function loadSave() {
    let raw, pending;
    try { pending = Promise.resolve(SDK.load()); raw = await withTimeout(pending, SDK_TIMEOUT_MS, TIMED_OUT); }
    catch (e) { raw = ''; SDK.logError(e); }
    if (raw === TIMED_OUT) {
      // The SDK is slow: start playing now, but do not save until the cloud save arrives
      // (otherwise we could overwrite it). When that same request lands, merge it in and allow saving.
      pending.then(late => {
        applySave(late); canSave = true; persist(); refreshScreen();
      }, e => SDK.logError(e));
      return;
    }
    canSave = true;
    applySave(raw);
    lastScoreSent = totalScore();
  }
  function persist() {
    if (!canSave) return;
    const data = { v: 3, learned: state.learned, stars: state.stars, best: state.best, free: state.free };
    try { Promise.resolve(SDK.save(JSON.stringify(data))).catch(e => SDK.logError(e)); } catch (e) { SDK.logError(e); }
  }
  /** The YouTube score: best match % of every picture level + best Free-play run. */
  function totalScore() {
    return Object.values(state.best).reduce((a, b) => a + b, 0) + state.free;
  }
  function reportScore() {
    const s = totalScore();
    if (s > lastScoreSent) { lastScoreSent = s; SDK.score(s); }
  }

  const totalStars = () => Object.values(state.stars).reduce((a, b) => a + b, 0);
  const isUnlocked = i => i === 0 || !!state.stars[LEVELS[i - 1].id];
  const freeUnlocked = () => !!state.stars[LEVELS[LEVELS.length - 1].id];

  /* ───────────── The one pausable clock (rAF) ─────────────
   * Drives lesson timers, the answer typer and Wick's painting animation.
   * On YouTube onPause it stops completely: no rAF, no timers, audio suspended.
   */
  let paused = false, last = 0, gameTime = 0, rafOn = false;
  let timers = [];
  let typer = null;
  let rafCount = 0; // debug only: frames run by the clock
  function after(ms, fn) { timers.push({ t: gameTime + ms, fn }); }
  function loop(now) {
    if (paused) { rafOn = false; last = 0; return; }
    rafCount++;
    const dt = last ? Math.min(now - last, 100) : 16;
    last = now; gameTime += dt;
    const due = timers.filter(t => t.t <= gameTime);
    if (due.length) { timers = timers.filter(t => t.t > gameTime); due.forEach(t => t.fn()); }
    if (typer) stepTyper(dt);
    window.PicturePlay.tick(dt);
    requestAnimationFrame(loop);
  }
  function startLoop() { if (!rafOn && !paused) { rafOn = true; requestAnimationFrame(loop); } }

  /* Pause never hides the game: a small overlay sits on top of whatever screen is showing.
   * Outside YouTube the platform may never send onResume, so the overlay offers "tap to continue". */
  function pause() {
    if (paused) return;
    paused = true;
    persist(); // Playables SHOULD: save on pause (progress is also saved at every milestone)
    document.body.classList.add('paused');
    $('#pause-overlay').hidden = false;
    if (actx) actx.suspend().catch(() => {});
  }
  function resume() {
    if (!paused) return;
    paused = false;
    document.body.classList.remove('paused');
    $('#pause-overlay').hidden = true;
    if (actx && audioOn) actx.resume().catch(() => {});
    startLoop();
  }

  /* ───────────── Audio (tiny synth, respects YouTube mute) ───────────── */
  let actx = null;
  let audioOn = SDK.audioEnabled();
  function ensureAudio() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { actx = new AC(); } catch (e) { return; }
    if (!audioOn || paused) actx.suspend().catch(() => {});
  }
  function tone(freq, dur, type = 'sine', vol = 0.08, delay = 0) {
    if (!actx || !audioOn || paused) return;
    const t = actx.currentTime + delay;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  const sfx = {
    tap() { tone(660, 0.06, 'triangle', 0.05); },
    pick() { tone(523, 0.07, 'triangle', 0.06); tone(784, 0.09, 'triangle', 0.06, 0.05); },
    send() { [392, 494, 587, 698, 784].forEach((f, i) => tone(f, 0.12, 'sine', 0.05, i * 0.18)); }, // brush strokes
    tick() { tone(1400, 0.015, 'square', 0.01); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.08, i * 0.1)); },
    fail() { tone(311, 0.16, 'sawtooth', 0.035); tone(233, 0.28, 'sawtooth', 0.035, 0.13); },
  };

  /* ───────────── Wick the candle (DOM screens) ───────────── */
  const WICK_SVG = `
<svg class="wick" viewBox="0 0 120 170" data-mood="neutral" aria-hidden="true">
  <defs>
    <radialGradient id="wfl" cx="50%" cy="72%" r="60%"><stop offset="0" stop-color="#fff6c8"/><stop offset=".55" stop-color="#F2C94C"/><stop offset="1" stop-color="#F28C38"/></radialGradient>
    <radialGradient id="wglow"><stop offset="0" stop-color="#F2C94C" stop-opacity=".45"/><stop offset="1" stop-color="#F2C94C" stop-opacity="0"/></radialGradient>
  </defs>
  <g class="body">
    <circle cx="60" cy="32" r="34" fill="url(#wglow)"/>
    <path class="flame" d="M60 6 C71 21 75 31 67 41 C63 46 57 46 53 41 C45 31 51 19 60 6Z" fill="url(#wfl)"/>
    <line x1="60" y1="43" x2="60" y2="54" stroke="#2e2b5c" stroke-width="3" stroke-linecap="round"/>
    <rect x="26" y="52" width="68" height="106" rx="22" fill="#f3f2ff"/>
    <path d="M26 76 Q26 52 48 52 H72 Q94 52 94 76 V82 Q90 90 85 82 Q81 72 75 80 Q71 98 64 82 Q59 72 51 82 Q45 92 40 80 Q34 72 26 82Z" fill="#e3e1f5"/>
    <circle cx="38" cy="114" r="6" fill="#F27BA5" opacity=".35"/><circle cx="82" cy="114" r="6" fill="#F27BA5" opacity=".35"/>
    <g fill="#15142b" stroke="#15142b" stroke-width="3.5" stroke-linecap="round">
      <g class="e e-open"><ellipse cx="47" cy="102" rx="5" ry="7" stroke="none"/><ellipse cx="73" cy="102" rx="5" ry="7" stroke="none"/><circle cx="49" cy="99" r="1.8" fill="#fff" stroke="none"/><circle cx="75" cy="99" r="1.8" fill="#fff" stroke="none"/></g>
      <g class="e e-happy" fill="none"><path d="M41 104 Q47 95 53 104"/><path d="M67 104 Q73 95 79 104"/></g>
      <g class="e e-confused"><ellipse cx="47" cy="102" rx="5" ry="7" stroke="none"/><path d="M67 102 h12" fill="none"/></g>
      <g class="e e-up"><ellipse cx="48" cy="98" rx="5" ry="7" stroke="none"/><ellipse cx="74" cy="98" rx="5" ry="7" stroke="none"/></g>
      <path class="m m-neutral" d="M52 120 Q60 125 68 120" fill="none"/>
      <path class="m m-happy" d="M49 117 Q60 132 71 117 Z" stroke-width="2"/>
      <path class="m m-confused" d="M49 123 q5.5 -5 11 0 t11 0" fill="none"/>
      <circle class="m m-thinking" cx="64" cy="122" r="3" stroke="none"/>
    </g>
  </g>
</svg>`;
  let wickId = 0;
  function mountWick(el, mood) {
    // Unique gradient ids per copy: url(#id) pointing into a hidden screen renders nothing.
    const n = ++wickId;
    el.innerHTML = WICK_SVG.replace(/\b(wfl|wglow)\b/g, '$1' + n);
    setMood(el, mood || el.dataset.mood || 'neutral');
  }
  function setMood(el, mood) { const s = el.querySelector('svg'); if (s) s.dataset.mood = mood; }

  /* ───────────── Helpers ───────────── */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const starsHTML = n => [0, 1, 2].map(i => `<span class="${i < n ? '' : 'off'}">★</span>`).join('');

  function makeSky() {
    const sky = $('#sky'); let html = '';
    for (let i = 0; i < 60; i++) {
      const s = Math.random() < 0.15 ? 3 : 2;
      html += `<i style="left:${(Math.random() * 100).toFixed(2)}%;top:${(Math.random() * 100).toFixed(2)}%;width:${s}px;height:${s}px;animation-delay:${(Math.random() * 3).toFixed(2)}s"></i>`;
    }
    sky.innerHTML = html;
  }

  /* ───────────── Screens ───────────── */
  let screen = 'loading';
  function show(name) {
    if (name !== 'picture') window.PicturePlay.stop();
    screen = name;
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    refreshScreen();
  }
  function refreshScreen() {
    if (screen === 'map') renderMap();
    if (screen === 'notebook') renderNotebook();
    if (screen === 'title') renderTitle();
  }

  function renderTitle() {
    const b = $('#btn-title-free');
    if (b) b.hidden = !freeUnlocked();
  }

  function renderMap() {
    $('#total-stars').textContent = '★ ' + totalStars() + '/' + LEVELS.length * 3;
    const current = LEVELS.findIndex((l, i) => isUnlocked(i) && !state.stars[l.id]);
    $('#map-path').innerHTML = LEVELS.map((l, i) => {
      const pic = PIC.LEVELS[i];
      const unlocked = isUnlocked(i), stars = state.stars[l.id] || 0;
      const cls = ['map-node', unlocked ? '' : 'locked', stars ? 'done' : '', i === current ? 'current' : ''].join(' ').trim();
      const label = `Stage ${i + 1}: ${l.title}` + (unlocked ? `, ${stars} of 3 stars` : ', locked');
      return `<button class="${cls}" data-node="${i}" aria-label="${esc(label)}" ${unlocked ? '' : 'aria-disabled="true"'}>
        <span class="node-num">${i + 1}</span>
        <span class="node-title">${esc(l.title)}<small>${esc(pic.short)}${state.best[l.id] ? ' · ' + state.best[l.id] + '%' : ''}</small></span>
        <span class="node-stars">${unlocked ? starsHTML(stars) : '🔒'}</span>
        ${unlocked && state.learned[l.id] ? `<span class="node-replay" data-replay="${i}" role="button" aria-label="Replay lesson ${i + 1}">Replay lesson</span>` : ''}
      </button>`;
    }).join('');
    const e = $('#btn-free');
    const open = freeUnlocked();
    e.classList.toggle('locked', !open);
    e.setAttribute('aria-disabled', open ? 'false' : 'true');
    $('#free-sub').textContent = open ? (state.free ? `Best ${state.free} pts` : 'A new picture every round') : 'Clear stage 8 to unlock';
    const cur = $('#map-path .map-node.current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }

  function renderNotebook() {
    $('#notebook-list').innerHTML = LEVELS.map((l, i) => state.learned[l.id]
      ? `<li><b>${esc(l.title)}</b>${esc(l.tip)}</li>`
      : `<li class="locked">Learn lesson ${i + 1} to unlock this rule.</li>`).join('');
  }

  /* Tap a map node: first time -> card lesson, then the picture level. Later -> picture directly. */
  function openNode(i) {
    if (i < 0 || i >= LEVELS.length || !isUnlocked(i)) return;
    if (!state.learned[LEVELS[i].id]) startLesson(i);
    else startPicture(i);
  }
  function startPicture(i) { closeModal(); closeSheet(); ensureAudio(); window.PicturePlay.startLevel(i); }
  function startFree() { closeModal(); closeSheet(); ensureAudio(); window.PicturePlay.startFree(); }

  /* ───────────── LEARN: card lessons ───────────── */
  let cur = null; // { lvl, idx, picks, tries, order, flagged }

  function startLesson(idx) {
    const lvl = LEVELS[idx];
    const prevKeys = idx > 0 ? new Set(LEVELS[idx - 1].slots.map(s => s.key)) : new Set();
    cur = { lvl, idx, picks: {}, tries: 0, order: {}, flagged: null, prevKeys };
    lvl.slots.forEach(s => { cur.order[s.key] = shuffle(s.cards.slice()); });

    $('#play-title').textContent = `${idx + 1}. ${lvl.title}`;
    $('#play-principle').textContent = lvl.principle;
    $('#req-who').textContent = lvl.request.who;
    $('#req-avatar').textContent = lvl.request.who[0];
    $('#req-text').textContent = '“' + lvl.request.text + '”';
    updateTry();
    renderSlots();
    show('play');
    $('#screen-play .scroll').scrollTop = 0;
    showTeach();
  }

  function updateTry() { $('#play-try').textContent = 'Try ' + (cur.tries + 1); }

  function renderSlots() {
    const { lvl, picks, prevKeys, flagged } = cur;
    $('#slots').innerHTML = lvl.slots.map(s => {
      const m = META[s.key], p = picks[s.key];
      const cls = ['slot', p ? 'filled' : '', !prevKeys.has(s.key) ? 'new' : '', flagged === s.key ? 'flag' : ''].join(' ');
      return `<button class="${cls}" data-slot="${s.key}" style="--c:${m.color}">
        <span class="tag">${esc(m.label)}</span>
        <span class="val">${esc(p ? p.t : 'Tap to choose: ' + m.hint)}</span>
      </button>`;
    }).join('');
    $('#btn-send').disabled = !lvl.slots.every(s => picks[s.key]);
  }

  /* Card sheet */
  let sheetSlot = null;
  function openSheet(key) {
    sheetSlot = key;
    const m = META[key];
    $('#sheet-title').textContent = 'Choose: ' + m.label;
    $('#sheet-hint').textContent = m.hint;
    $('#sheet-cards').innerHTML = cur.order[key].map((c, i) =>
      `<button class="card ${cur.picks[key] === c ? 'chosen' : ''}" data-card="${i}" style="--c:${m.color}">${esc(c.t)}</button>`).join('');
    $('#sheet').classList.add('open');
    $('#sheet').setAttribute('aria-hidden', 'false');
    const first = $('#sheet-cards .card'); if (first) first.focus({ preventScroll: true });
  }
  function closeSheet() {
    $('#sheet').classList.remove('open');
    $('#sheet').setAttribute('aria-hidden', 'true');
    sheetSlot = null;
  }

  /* Modal */
  function openModal(html) {
    $('#modal-body').innerHTML = html;
    $$('#modal-body [data-wick]').forEach(el => mountWick(el));
    $('#modal').classList.add('open');
    $('#modal').setAttribute('aria-hidden', 'false');
    $('.modal-panel').scrollTop = 0;
    const btn = $('#modal-body .modal-actions .btn'); if (btn) btn.focus({ preventScroll: true });
  }
  function closeModal() {
    $('#modal').classList.remove('open');
    $('#modal').setAttribute('aria-hidden', 'true');
    typer = null; timers = [];
  }

  function showTeach() {
    const { lvl, idx } = cur;
    openModal(`
      <div class="kicker">Lesson ${idx + 1} of ${LEVELS.length}</div>
      <h3>${esc(lvl.title)}</h3>
      <div class="chat"><div class="wick-slot" data-wick data-mood="happy"></div>
        <div class="bubble">${esc(lvl.teach)}</div></div>
      <p class="tipcard"><b>Your job:</b> build a prompt that gets ${esc(lvl.request.who)} exactly what they need. Tap each part of the prompt to pick a card.</p>
      <div class="modal-actions"><button class="btn primary" data-act="close">Let’s go</button></div>`);
  }

  function send() {
    const { lvl, picks } = cur;
    cur.tries++;
    const bad = lvl.slots.filter(s => !picks[s.key].ok);
    const result = bad.length ? { ok: false, slot: bad[0].key, card: picks[bad[0].key], more: bad.length - 1 } : { ok: true };
    sfx.tap();

    openModal(`
      <div class="kicker">Wick’s answer · try ${cur.tries}</div>
      <div class="chat"><div class="wick-slot" data-wick data-mood="thinking" id="ans-wick"></div>
        <div class="bubble ${result.ok && lvl.mono ? 'mono' : ''}" id="ans-bubble" aria-live="polite"><span class="dots"><span></span><span></span><span></span></span></div></div>
      <p class="skip-hint" id="ans-skip">Tap the answer to skip</p>
      <div id="ans-verdict"></div>`);

    const bubble = $('#ans-bubble');
    after(900, () => {
      const text = result.ok ? lvl.good : result.card.out;
      typer = { el: bubble, text, i: 0, tickAcc: 0, done: () => showVerdict(result) };
      bubble.textContent = '';
    });
    bubble.addEventListener('click', () => { if (typer) typer.i = typer.text.length; });
  }

  function stepTyper(dt) {
    const t = typer;
    t.i = Math.min(t.text.length, t.i + dt * 0.055); // ~55 chars/sec
    t.tickAcc += dt;
    if (t.tickAcc > 70) { t.tickAcc = 0; sfx.tick(); }
    const n = Math.floor(t.i);
    t.el.innerHTML = esc(t.text.slice(0, n)) + (n < t.text.length ? '<span class="caret"></span>' : '');
    if (n >= t.text.length) { typer = null; t.done(); }
  }

  function showVerdict(r) {
    const { lvl } = cur;
    const skip = $('#ans-skip'); if (skip) skip.remove();
    const wick = $('#ans-wick');
    const who = esc(lvl.request.who);
    const v = $('#ans-verdict');

    if (r.ok) {
      setMood(wick, 'happy');
      sfx.win();
      if (!state.learned[lvl.id]) { state.learned[lvl.id] = true; persist(); }
      v.innerHTML = `
        <div class="verdict ok">
          <h4>Perfect prompt! ${who} got exactly what they needed.</h4>
          <p class="more">Now see it in pictures: describe a scene and watch how your words change what Wick paints.</p>
        </div>
        <p class="tipcard"><b>📓 New notebook rule:</b> ${esc(lvl.tip)}</p>
        <div class="modal-actions">
          <button class="btn primary" data-act="picture">Now picture it! ›</button>
          <button class="btn ghost" data-act="map">Map</button>
        </div>`;
    } else {
      setMood(wick, 'confused');
      sfx.fail();
      const m = META[r.slot];
      cur.flagged = r.slot;
      v.innerHTML = `
        <div class="verdict no">
          <h4>Hmm… not what ${who} wanted.</h4>
          <p class="where" style="color:${m.color}">Problem: ${esc(m.label)}</p>
          <p>${esc(r.card.why)}</p>
          ${r.more ? `<p class="more">…and ${r.more} more part${r.more > 1 ? 's' : ''} could be better.</p>` : ''}
        </div>
        <div class="modal-actions"><button class="btn primary" data-act="fix">Fix my prompt</button></div>`;
    }
    const btn = $('#ans-verdict .btn'); if (btn) btn.focus({ preventScroll: true });
    $('#ans-verdict').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ───────────── PICTURE results (called by picture.js) ───────────── */
  function onLevelResult(i, pct, stars) {
    const id = LEVELS[i].id;
    let changed = false;
    if (pct > (state.best[id] || 0)) { state.best[id] = pct; changed = true; }
    if (stars > (state.stars[id] || 0)) { state.stars[id] = stars; changed = true; }
    if (changed) { persist(); reportScore(); }
  }
  function onFreeResult(points) {
    const newBest = points > state.free;
    if (newBest) { state.free = points; persist(); reportScore(); }
    openModal(`
      <div class="stage-result">
        <div class="kicker">Free play</div>
        <h3>${points >= 400 ? 'Prompt pro!' : points >= 250 ? 'Nice describing!' : 'Keep practising!'}</h3>
        <p class="score-line">Score <b>${points}</b> · Best <b>${state.free}</b>${newBest ? ' <span class="new-best">New best!</span>' : ''}</p>
        <p class="tipcard"><b>Remember:</b> anything you don’t say, the AI has to guess.</p>
        <div class="modal-actions">
          <button class="btn primary" data-act="free">Play again</button>
          <button class="btn ghost" data-act="map">Map</button>
        </div>
      </div>`);
  }
  function nextLevel(i) {
    if (i >= LEVELS.length - 1) return startFree();
    openNode(i + 1);
  }

  /* ───────────── Input ───────────── */
  document.addEventListener('pointerdown', ensureAudio, { capture: true });
  document.addEventListener('keydown', ensureAudio, { capture: true, once: true });

  document.addEventListener('click', e => {
    if (e.target.closest('#pause-overlay')) { if (!IN_YT) resume(); return; }
    if (paused) return;
    const replay = e.target.closest('[data-replay]');
    if (replay) { sfx.tap(); return startLesson(Number(replay.dataset.replay)); }
    const t = e.target.closest('button, [data-close-sheet]');
    if (!t) return;

    if (t.id === 'btn-play') { sfx.tap(); return show('map'); }
    if (t.id === 'btn-notebook') { sfx.tap(); return show('notebook'); }
    if (t.id === 'btn-free' || t.id === 'btn-title-free') {
      if (freeUnlocked()) { sfx.tap(); startFree(); }
      return;
    }
    if (t.dataset.back) { sfx.tap(); closeModal(); return show(t.dataset.back); }
    if (t.dataset.node !== undefined) {
      const i = Number(t.dataset.node);
      if (isUnlocked(i)) { sfx.tap(); openNode(i); }
      return;
    }
    if (t.dataset.slot) { sfx.tap(); return openSheet(t.dataset.slot); }
    if (t.dataset.card !== undefined && sheetSlot) {
      cur.picks[sheetSlot] = cur.order[sheetSlot][Number(t.dataset.card)];
      if (cur.flagged === sheetSlot) cur.flagged = null;
      sfx.pick(); closeSheet(); renderSlots();
      return;
    }
    if (t.hasAttribute('data-close-sheet')) return closeSheet();
    if (t.id === 'btn-send') { if (!t.disabled) send(); return; }

    const act = t.dataset.act;
    if (!act) return;
    sfx.tap();
    if (act === 'close') return closeModal();
    if (act === 'fix') {
      closeModal(); updateTry(); renderSlots();
      const f = $('#slots .slot.flag'); if (f) f.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (act === 'picture') return startPicture(cur.idx);
    if (act === 'free') return startFree();
    if (act === 'map') { closeModal(); return show('map'); }
  });

  // Esc closes the card sheet / dialogs / result view (Playables design SHOULD). Never preventDefault on Esc.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || paused) return;
    if (sheetSlot) return closeSheet();
    if ($('#modal').classList.contains('open')) {
      const b = $('#modal-body [data-act="close"], #modal-body [data-act="fix"], #modal-body [data-act="map"]');
      if (b) b.click();
      return;
    }
    if (screen === 'picture' && window.PicturePlay.escape()) sfx.tap();
  });

  /* ───────────── Boot ─────────────
   * Robust against any SDK behaviour: screens never depend on an animation to become
   * visible, a pause shows an overlay (it never hides the UI), and loadData has a timeout.
   */
  SDK.onPause(pause);
  SDK.onResume(resume);
  SDK.onAudioChange(on => {
    audioOn = on;
    if (actx) (on && !paused ? actx.resume() : actx.suspend()).catch(() => {});
  });

  window.addEventListener('error', e => SDK.logError(e.error || e.message));

  window.PicturePlay.init({
    show, sfx, openModal, closeModal, mountWick, setMood,
    isPaused: () => paused, onLevelResult, onFreeResult, nextLevel,
  });

  // Test hooks (only with ?debug=1): the same pause/resume the SDK calls, plus read-only state.
  if (DEBUG) {
    window.PADebug = {
      pause, resume,
      get rafCount() { return rafCount; },
      get paused() { return paused; },
      get save() { return JSON.parse(JSON.stringify({ v: 3, learned: state.learned, stars: state.stars, best: state.best, free: state.free })); },
      get totalScore() { return totalScore(); },
      get screen() { return screen; },
      unlockAll() { LEVELS.forEach(l => { state.learned[l.id] = true; state.stars[l.id] = state.stars[l.id] || 1; }); refreshScreen(); },
    };
  }

  document.body.classList.toggle('in-yt', IN_YT);
  makeSky();
  $$('[data-wick]').forEach(el => mountWick(el));

  let booted = false;
  async function boot() {
    if (booted) return;
    booted = true;
    SDK.firstFrameReady();           // loading screen is on screen
    await loadSave();                // cloud save MUST load before any save (timeout-guarded)
    show('title');
    startLoop();
    SDK.gameReady();                 // title screen is interactive
  }
  // First frame via rAF; a timer backs it up in case rAF is throttled (hidden iframe).
  requestAnimationFrame(boot);
  setTimeout(boot, 250);
})();
