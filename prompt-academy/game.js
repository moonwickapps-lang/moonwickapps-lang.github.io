/* Prompt Academy v2 — "Catch the Prompt". A Moonwick Apps game for YouTube Playables.
 * Screens, save data, audio and the ONE pausable clock live here.
 *  - LEARN: the v1 card lessons (levels.js) teach each prompting principle.
 *  - ARCADE: arcade.js (window.Arcade) — catch the right prompt blocks.
 * Plain DOM + Canvas, no engine, no external calls (only the Playables SDK).
 */
'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const LEVELS = window.LEVELS;
  const META = window.SLOT_META;
  const STAGES = window.ARCADE_STAGES || [];
  const SAVE_KEY = 'moonwick.promptAcademy.v1'; // same key as v1 so web saves migrate
  const DEBUG = /[?&]debug=1\b/.test(location.search);

  /* ───────────── Playables SDK wrapper ─────────────
   * In YouTube we use ONLY the SDK for saves. Outside YouTube (e.g. a demo on
   * our own website) we fall back to localStorage so the web build still works.
   */
  const yt = window.ytgame;
  const IN_YT = !!(yt && yt.IN_PLAYABLES_ENV);
  const SDK = {
    firstFrameReady() { try { yt && yt.game.firstFrameReady(); } catch (e) {} },
    gameReady() { try { yt && yt.game.gameReady(); } catch (e) {} },
    async load() {
      if (IN_YT) return yt.game.loadData();
      try { return localStorage.getItem(SAVE_KEY) || ''; } catch (e) { return ''; }
    },
    async save(str) {
      if (IN_YT) return yt.game.saveData(str);
      try { localStorage.setItem(SAVE_KEY, str); } catch (e) {}
    },
    score(value) {
      if (!IN_YT) return;
      try { yt.engagement.sendScore({ value }).catch(() => {}); } catch (e) {}
    },
    audioEnabled() { try { return yt ? yt.system.isAudioEnabled() : true; } catch (e) { return true; } },
    onAudioChange(cb) { try { yt && yt.system.onAudioEnabledChange(cb); } catch (e) {} },
    onPause(cb) { try { yt && yt.system.onPause(cb); } catch (e) {} },
    onResume(cb) { try { yt && yt.system.onResume(cb); } catch (e) {} },
    logError(err) { try { yt && yt.health.logError(err); } catch (e) {} },
  };

  /* ───────────── Save state (v2) ─────────────
   * { v:2, learned:{lessonId:true}, stars:{stageId:1..3}, best:{stageId:score}, endless:score }
   * v1 saves ({ v:1, stars:{lessonId:n} }) migrate to `learned`.
   */
  const state = { learned: {}, stars: {}, best: {}, endless: 0 };
  let canSave = false;
  let lastScoreSent = -1;

  const MAX_SCORE = 10000000;
  const cleanScore = v => { const n = Math.floor(Number(v)); return n > 0 && n < MAX_SCORE ? n : 0; };

  async function loadSave() {
    let raw = '';
    try { raw = await SDK.load(); canSave = true; }
    catch (e) { canSave = !IN_YT; SDK.logError(e); }
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      const lessonIds = new Set(LEVELS.map(l => l.id));
      const stageIds = new Set(STAGES.map(s => s.id));
      if (d.v === 2) {
        if (d.learned && typeof d.learned === 'object') {
          for (const k of Object.keys(d.learned)) if (lessonIds.has(k) && d.learned[k]) state.learned[k] = true;
        }
        if (d.stars && typeof d.stars === 'object') {
          for (const [k, v] of Object.entries(d.stars)) {
            const n = Math.round(Number(v));
            if (stageIds.has(k) && n >= 1 && n <= 3) state.stars[k] = n;
          }
        }
        if (d.best && typeof d.best === 'object') {
          for (const [k, v] of Object.entries(d.best)) if (stageIds.has(k) && cleanScore(v)) state.best[k] = cleanScore(v);
        }
        state.endless = cleanScore(d.endless);
      } else if (d.stars && typeof d.stars === 'object') {
        // v1: lesson stars -> those lessons are learned (arcade stages still to play)
        for (const [k, v] of Object.entries(d.stars)) if (lessonIds.has(k) && Number(v) >= 1) state.learned[k] = true;
      }
    } catch (e) { /* unreadable save: start fresh, never crash */ }
    lastScoreSent = totalScore();
  }
  function persist() {
    if (!canSave) return;
    const data = { v: 2, learned: state.learned, stars: state.stars, best: state.best, endless: state.endless };
    Promise.resolve(SDK.save(JSON.stringify(data))).catch(e => SDK.logError(e));
  }
  /** The YouTube score: endless best + sum of best stage scores (always derivable from the save). */
  function totalScore() {
    return Math.floor(state.endless + Object.values(state.best).reduce((a, b) => a + b, 0));
  }
  function reportScore() {
    const s = totalScore();
    if (s > lastScoreSent) { lastScoreSent = s; SDK.score(s); }
  }

  const stageFor = i => STAGES.find(s => s.id === LEVELS[i].id) || null;
  const totalStars = () => Object.values(state.stars).reduce((a, b) => a + b, 0);
  const isUnlocked = i => i === 0 || !!state.stars[LEVELS[i - 1].id];
  const endlessUnlocked = () => !!state.stars[LEVELS[LEVELS.length - 1].id];

  /* ───────────── The one pausable clock (rAF) ─────────────
   * Drives lesson timers, the answer typer, the arcade and the music.
   * On YouTube onPause it stops completely: no rAF, no timers, audio suspended.
   */
  let paused = false, last = 0, gameTime = 0, rafOn = false;
  let timers = [];
  let typer = null;
  let arcadeOn = false;
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
    if (arcadeOn) window.Arcade.tick(dt);
    musicTick();
    requestAnimationFrame(loop);
  }
  function startLoop() { if (!rafOn && !paused) { rafOn = true; requestAnimationFrame(loop); } }

  function pause() {
    if (paused) return;
    paused = true;
    persist(); // Playables SHOULD: save on pause (progress is also saved at every milestone)
    document.body.classList.add('paused');
    window.Arcade.pause();
    if (actx) actx.suspend().catch(() => {});
  }
  function resume() {
    paused = false;
    document.body.classList.remove('paused');
    window.Arcade.resume();
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
    actx = new AC();
    if (!audioOn || paused) actx.suspend().catch(() => {});
  }
  function tone(freq, dur, type = 'sine', vol = 0.08, delay = 0) {
    if (!actx || !audioOn || paused) return;
    toneAt(freq, dur, type, vol, actx.currentTime + delay);
  }
  function toneAt(freq, dur, type, vol, t) {
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
    send() { tone(392, 0.08, 'sine', 0.07); tone(587, 0.12, 'sine', 0.07, 0.07); },
    tick() { tone(1400, 0.015, 'square', 0.01); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.08, i * 0.1)); },
    fail() { tone(311, 0.16, 'sawtooth', 0.035); tone(233, 0.28, 'sawtooth', 0.035, 0.13); },
  };
  // Arcade sounds: each prompt-block type has its own note so a full prompt "plays a chord".
  const TYPE_NOTE = { role: 392, task: 440, context: 494, format: 523, constraints: 587, example: 659, steps: 698 };
  function arcadeSound(name, d) {
    d = d || {};
    switch (name) {
      case 'catch': { // pitch rises one semitone per combo tier
        const f = (TYPE_NOTE[d.type] || 523) * Math.pow(2, ((d.mult || 1) - 1) / 12);
        tone(f, 0.09, 'triangle', 0.07); tone(f * 1.5, 0.14, 'triangle', 0.05, 0.06); break;
      }
      case 'bonus': tone(880, 0.07, 'triangle', 0.05); tone(1175, 0.09, 'triangle', 0.04, 0.05); break;
      case 'combo': [659, 831, 988, 1319].slice(0, (d.mult || 2) + 1).forEach((f, i) => tone(f, 0.1, 'triangle', 0.05, i * 0.05)); break;
      case 'wrong': tone(247, 0.1, 'square', 0.025); tone(220, 0.16, 'square', 0.025, 0.08); break;
      case 'junk': tone(150, 0.25, 'sawtooth', 0.05); tone(95, 0.32, 'sawtooth', 0.045, 0.06); break; // "pfft"
      case 'fizz': tone(330, 0.18, 'sine', 0.03); tone(262, 0.22, 'sine', 0.025, 0.08); break;
      case 'pop': tone(1568, 0.05, 'sine', 0.03); break;
      case 'wave': [523, 659, 784, 1046, 1319, 1568].forEach((f, i) => tone(f, 0.16, 'triangle', 0.05, i * 0.06)); break;
      case 'power': [523, 659, 784, 1046, 1319].forEach((f, i) => tone(f, 0.12, 'sine', 0.05, i * 0.04)); break;
      case 'send': sfx.send(); [784, 988, 1175].forEach((f, i) => tone(f, 0.2, 'sine', 0.04, 0.15 + i * 0.06)); break;
      case 'request': tone(587, 0.06, 'sine', 0.04); tone(784, 0.08, 'sine', 0.04, 0.06); break;
      case 'tick': sfx.tick(); break;
      case 'clear': sfx.win(); break;
      case 'fail': case 'over': sfx.fail(); break;
    }
  }

  /* Soft procedural music for the arcade: a slow pentatonic arpeggio + bass.
   * Scheduled a little ahead from the clock, so it stops with pause and mute. */
  const music = { on: false, next: 0, step: 0 };
  const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 784.0, 880.0];
  const ROOTS = [0, 4, 2, 3];
  const ARP = [0, 2, 4, 2, 5, 4, 2, 4];
  function musicTick() {
    if (!music.on || !actx || !audioOn || paused || actx.state !== 'running') return;
    const now = actx.currentTime;
    if (music.next < now) music.next = now + 0.05;
    while (music.next < now + 0.3) {
      const i = music.step++, root = ROOTS[Math.floor(i / 8) % ROOTS.length];
      toneAt(SCALE[(root + ARP[i % 8]) % SCALE.length], 0.32, 'triangle', 0.018, music.next);
      if (i % 8 === 0) toneAt(SCALE[root] / 2, 1.7, 'sine', 0.03, music.next);
      music.next += 0.24;
    }
  }

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
  const fmt = n => Math.floor(n).toLocaleString('en-US');

  function makeSky() {
    const sky = $('#sky'); let html = '';
    for (let i = 0; i < 60; i++) {
      const s = Math.random() < 0.15 ? 3 : 2;
      html += `<i style="left:${(Math.random() * 100).toFixed(2)}%;top:${(Math.random() * 100).toFixed(2)}%;width:${s}px;height:${s}px;animation-delay:${(Math.random() * 3).toFixed(2)}s"></i>`;
    }
    sky.innerHTML = html;
  }

  /* ───────────── Screens ───────────── */
  function show(name) {
    if (name !== 'arcade' && arcadeOn) stopArcade();
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    document.body.classList.toggle('in-arcade', name === 'arcade');
    if (name === 'map') renderMap();
    if (name === 'notebook') renderNotebook();
    if (name === 'title') renderTitle();
  }

  function renderTitle() {
    const b = $('#btn-title-endless');
    if (b) b.hidden = !endlessUnlocked();
  }

  function renderMap() {
    $('#total-stars').textContent = '★ ' + totalStars() + '/' + LEVELS.length * 3;
    const current = LEVELS.findIndex((l, i) => isUnlocked(i) && !state.stars[l.id]);
    $('#map-path').innerHTML = LEVELS.map((l, i) => {
      const st = stageFor(i);
      const unlocked = isUnlocked(i), stars = state.stars[l.id] || 0;
      const cls = ['map-node', unlocked ? '' : 'locked', stars ? 'done' : '', i === current ? 'current' : ''].join(' ').trim();
      const label = `Stage ${i + 1}: ${l.title}` + (unlocked ? `, ${stars} of 3 stars` : ', locked');
      return `<button class="${cls}" data-node="${i}" aria-label="${esc(label)}" ${unlocked ? '' : 'aria-disabled="true"'}>
        <span class="node-num">${i + 1}</span>
        <span class="node-title">${esc(l.title)}${st ? `<small>${esc(st.title)}</small>` : ''}</span>
        <span class="node-stars">${unlocked ? starsHTML(stars) : '🔒'}</span>
        ${unlocked && state.learned[l.id] ? `<span class="node-replay" data-replay="${i}" role="button" aria-label="Replay lesson ${i + 1}">Replay lesson</span>` : ''}
      </button>`;
    }).join('');
    const e = $('#btn-endless');
    const open = endlessUnlocked();
    e.classList.toggle('locked', !open);
    e.setAttribute('aria-disabled', open ? 'false' : 'true');
    $('#endless-sub').textContent = open ? (state.endless ? 'Best ' + fmt(state.endless) : 'How long can you glow?') : 'Clear stage 8 to unlock';
    const cur = $('#map-path .map-node.current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }

  function renderNotebook() {
    $('#notebook-list').innerHTML = LEVELS.map((l, i) => state.learned[l.id]
      ? `<li><b>${esc(l.title)}</b>${esc(l.tip)}</li>`
      : `<li class="locked">Learn lesson ${i + 1} to unlock this rule.</li>`).join('');
  }

  /* Tap a map node: first time -> lesson, then arcade. Later -> arcade directly. */
  function openNode(i) {
    if (i < 0 || i >= LEVELS.length || !isUnlocked(i)) return;
    if (!state.learned[LEVELS[i].id] || !stageFor(i)) startLevel(i);
    else startArcade(i);
  }

  /* ───────────── LEARN: v1 card lessons ───────────── */
  let cur = null; // { lvl, idx, picks, tries, order, flagged }

  function startLevel(idx) {
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
    sfx.send();

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
      const hasStage = !!stageFor(cur.idx);
      v.innerHTML = `
        <div class="verdict ok">
          <h4>Perfect prompt! ${who} got exactly what they needed.</h4>
          ${hasStage ? '<p class="more">Now use it under pressure: catch the right prompt blocks as they fall!</p>' : ''}
        </div>
        <p class="tipcard"><b>📓 New notebook rule:</b> ${esc(lvl.tip)}</p>
        <div class="modal-actions">
          ${hasStage ? `<button class="btn primary" data-act="catch">Now catch it! ›</button>` : ''}
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

  /* ───────────── ARCADE ───────────── */
  let arc = null; // { idx, endless, stage }

  function startArcade(idx, firstTime) {
    const endless = idx === 'endless';
    const stage = endless ? { id: 'endless', title: 'Endless', types: [], requests: [] } : stageFor(idx);
    if (!stage) return;
    arc = { idx, endless, stage };
    closeModal(); closeSheet();
    show('arcade');
    ensureAudio();
    window.Arcade.start({
      canvas: $('#arcade-canvas'), stage, endless, firstTime: !!firstTime,
      sfx: arcadeSound, onExit: onArcadeEnd, onEvent: () => {},
    });
    arcadeOn = true;
    music.on = true; music.next = 0;
  }

  function stopArcade() {
    arcadeOn = false;
    music.on = false;
    return window.Arcade.stop();
  }

  /** Records a finished run in the save (GDD: best = max score cleared or not; only clears earn stars).
   *  Returns { newBest, best }. */
  function recordRun(score, cleared, stars) {
    let newBest = false, best;
    score = Math.max(0, Math.floor(score));
    if (arc.endless) {
      if (score > state.endless) { state.endless = score; newBest = true; }
      best = state.endless;
    } else {
      const id = arc.stage.id;
      if (cleared && stars > (state.stars[id] || 0)) state.stars[id] = stars;
      if (score > (state.best[id] || 0)) { state.best[id] = score; newBest = true; }
      best = state.best[id] || 0;
    }
    persist();
    reportScore();
    return { newBest, best };
  }

  function onArcadeEnd(result) {
    stopArcade();
    const { newBest, best } = recordRun(result.score, result.cleared, result.stars);
    showStageResult(result, best, newBest);
  }

  function showStageResult(r, best, newBest) {
    const i = arc.idx, endless = arc.endless;
    const st = arc.stage;
    const lastStage = !endless && i === LEVELS.length - 1;
    let head, body = '', actions = '';
    if (endless) {
      head = `<div class="kicker">Endless mode</div><h3>Game over</h3>`;
      body = r.failReason ? `<p class="tipcard"><b>Remember:</b> ${esc(r.failReason)}</p>` : '';
      actions = `<button class="btn primary" data-act="retry">Play again</button>`;
    } else if (r.cleared) {
      head = `<div class="kicker">Stage ${i + 1} · ${esc(st.title)}</div>
        <div class="big-stars" aria-label="${r.stars} of 3 stars">${starsHTML(r.stars)}</div>
        <h3>${lastStage ? 'You beat the Academy!' : 'Stage clear!'}</h3>`;
      if (r.stars < 3) {
        body = `<p class="tipcard"><b>For ★★★:</b> keep all 3 flames and score ${fmt(st.target || 0)}+.</p>`;
      }
      if (lastStage) body += `<p class="tipcard"><b>Endless mode unlocked!</b> Random requests, rising speed. How long can you glow?</p>`;
      actions = lastStage ? `<button class="btn primary" data-act="endless">Play Endless ›</button>`
        : `<button class="btn primary" data-act="next-stage">Next: ${esc(LEVELS[i + 1].title)} ›</button>`;
      actions += `<button class="btn ghost" data-act="retry">Retry</button>`;
    } else {
      head = `<div class="kicker">Stage ${i + 1} · ${esc(st.title)}</div>
        <div class="big-stars" aria-label="0 of 3 stars">${starsHTML(0)}</div>
        <h3>Out of flames!</h3>`;
      body = `<p class="tipcard"><b>What went wrong:</b> ${esc(r.failReason)}</p>
        <p class="tipcard"><b>📓 Rule:</b> ${esc(LEVELS[i].tip)}</p>`;
      actions = `<button class="btn primary" data-act="retry">Retry</button>
        <button class="btn ghost" data-act="replay-lesson">Replay lesson</button>`;
    }
    openModal(`
      <div class="stage-result">
        ${head}
        <p class="score-line">Score <b>${fmt(r.score)}</b> · Best <b>${fmt(best)}</b>${newBest && r.score > 0 ? ' <span class="new-best">New best!</span>' : ''}</p>
        ${body}
        <div class="modal-actions">${actions}<button class="btn ghost" data-act="map">Map</button></div>
      </div>`);
  }

  /** Exit button on the arcade screen: leave the run. Endless scores still count. */
  function exitArcade() {
    const snap = stopArcade();
    if (snap && arc && arc.endless && snap.score > 0) recordRun(snap.score, false, 0);
    show('map');
  }

  /* ───────────── Input ───────────── */
  document.addEventListener('pointerdown', ensureAudio, { capture: true });
  document.addEventListener('keydown', ensureAudio, { capture: true, once: true });

  document.addEventListener('click', e => {
    if (paused) return;
    const replay = e.target.closest('[data-replay]');
    if (replay) { sfx.tap(); return startLevel(Number(replay.dataset.replay)); }
    const t = e.target.closest('button, [data-close-sheet]');
    if (!t) return;

    if (t.id === 'btn-play') { sfx.tap(); return show('map'); }
    if (t.id === 'btn-notebook') { sfx.tap(); return show('notebook'); }
    if (t.id === 'btn-endless' || t.id === 'btn-title-endless') {
      if (endlessUnlocked()) { sfx.tap(); startArcade('endless'); }
      return;
    }
    if (t.id === 'arcade-exit') { sfx.tap(); return exitArcade(); }
    if (t.dataset.back) { sfx.tap(); return show(t.dataset.back); }
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
    if (act === 'catch') return startArcade(cur.idx, !state.stars[LEVELS[cur.idx].id]);
    if (act === 'retry') return startArcade(arc.endless ? 'endless' : arc.idx);
    if (act === 'next-stage') { closeModal(); return openNode(arc.idx + 1); }
    if (act === 'endless') return startArcade('endless');
    if (act === 'replay-lesson') { closeModal(); return startLevel(arc.idx); }
    if (act === 'map') { closeModal(); return show('map'); }
    if (act === 'notebook') { closeModal(); return show('notebook'); }
  });

  // Esc closes the card sheet / dialogs (Playables design SHOULD). Never preventDefault on Esc.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || paused) return;
    if (sheetSlot) return closeSheet();
    if ($('#modal').classList.contains('open')) {
      const b = $('#modal-body [data-act="close"], #modal-body [data-act="fix"], #modal-body [data-act="map"]');
      if (b) b.click();
      return;
    }
    if (arcadeOn) { sfx.tap(); exitArcade(); }
  });

  /* ───────────── Boot ───────────── */
  SDK.onPause(pause);
  SDK.onResume(resume);
  SDK.onAudioChange(on => {
    audioOn = on;
    if (actx) (on && !paused ? actx.resume() : actx.suspend()).catch(() => {});
  });

  window.addEventListener('error', e => SDK.logError(e.error || e.message));

  // Test hooks (only with ?debug=1): the same pause/resume the SDK calls, plus read-only state.
  if (DEBUG) {
    window.PADebug = {
      pause, resume,
      get rafCount() { return rafCount; },
      get paused() { return paused; },
      get save() { return JSON.parse(JSON.stringify({ v: 2, learned: state.learned, stars: state.stars, best: state.best, endless: state.endless })); },
      get totalScore() { return totalScore(); },
      get arcadeOn() { return arcadeOn; },
    };
  }

  makeSky();
  $$('[data-wick]').forEach(el => mountWick(el));
  requestAnimationFrame(async () => {
    SDK.firstFrameReady();           // loading screen is on screen
    await loadSave();                // cloud save MUST load before any save
    startLoop();
    show('title');
    SDK.gameReady();                 // title screen is interactive
  });
})();
