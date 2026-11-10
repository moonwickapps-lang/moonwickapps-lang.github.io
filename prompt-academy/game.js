/* Prompt Academy — a Moonwick Apps game for YouTube Playables.
 * Teach Wick (a very literal candle) by building prompts from cards.
 * Plain DOM + CSS, no engine, no external calls (only the Playables SDK).
 */
'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const LEVELS = window.LEVELS;
  const META = window.SLOT_META;
  const SAVE_KEY = 'moonwick.promptAcademy.v1';

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

  /* ───────────── Save state ───────────── */
  const state = { stars: {} }; // levelId -> best stars (1..3)
  let canSave = false;

  async function loadSave() {
    let raw = '';
    try { raw = await SDK.load(); canSave = true; }
    catch (e) { canSave = !IN_YT; SDK.logError(e); }
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      const ids = new Set(LEVELS.map(l => l.id));
      if (d && d.stars && typeof d.stars === 'object') {
        for (const [k, v] of Object.entries(d.stars)) {
          const n = Math.round(Number(v));
          if (ids.has(k) && n >= 1 && n <= 3) state.stars[k] = n;
        }
      }
    } catch (e) { /* unreadable or older save: start fresh, never crash */ }
  }
  function persist() {
    if (!canSave) return;
    Promise.resolve(SDK.save(JSON.stringify({ v: 1, stars: state.stars }))).catch(e => SDK.logError(e));
  }
  const totalStars = () => Object.values(state.stars).reduce((a, b) => a + b, 0);
  const isUnlocked = i => i === 0 || !!state.stars[LEVELS[i - 1].id];

  /* ───────────── Pausable clock (rAF) ───────────── */
  let paused = false, last = 0, gameTime = 0, rafOn = false;
  let timers = [];
  let typer = null;
  function after(ms, fn) { timers.push({ t: gameTime + ms, fn }); }
  function loop(now) {
    if (paused) { rafOn = false; last = 0; return; }
    const dt = last ? Math.min(now - last, 100) : 16;
    last = now; gameTime += dt;
    const due = timers.filter(t => t.t <= gameTime);
    if (due.length) { timers = timers.filter(t => t.t > gameTime); due.forEach(t => t.fn()); }
    if (typer) stepTyper(dt);
    requestAnimationFrame(loop);
  }
  function startLoop() { if (!rafOn && !paused) { rafOn = true; requestAnimationFrame(loop); } }

  function pause() {
    paused = true;
    document.body.classList.add('paused');
    if (actx) actx.suspend().catch(() => {});
  }
  function resume() {
    paused = false;
    document.body.classList.remove('paused');
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
    send() { tone(392, 0.08, 'sine', 0.07); tone(587, 0.12, 'sine', 0.07, 0.07); },
    tick() { tone(1400, 0.015, 'square', 0.01); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.08, i * 0.1)); },
    fail() { tone(311, 0.16, 'sawtooth', 0.035); tone(233, 0.28, 'sawtooth', 0.035, 0.13); },
  };

  /* ───────────── Wick the candle ───────────── */
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
  function show(name) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    if (name === 'levels') renderLevels();
    if (name === 'notebook') renderNotebook();
  }

  function renderLevels() {
    $('#total-stars').textContent = '★ ' + totalStars() + '/' + LEVELS.length * 3;
    const nextIdx = LEVELS.findIndex(l => !state.stars[l.id]);
    $('#level-grid').innerHTML = LEVELS.map((l, i) => {
      const unlocked = isUnlocked(i);
      const cls = ['level', unlocked ? '' : 'locked', i === nextIdx ? 'next' : ''].join(' ');
      return `<button class="${cls}" data-level="${i}" ${unlocked ? '' : 'aria-disabled="true"'}>
        <span class="num">LESSON ${i + 1}</span>
        <span class="name">${esc(l.title)}</span>
        <span class="stars">${unlocked ? starsHTML(state.stars[l.id] || 0) : ''}</span>
      </button>`;
    }).join('');
  }

  function renderNotebook() {
    $('#notebook-list').innerHTML = LEVELS.map((l, i) => state.stars[l.id]
      ? `<li><b>${esc(l.title)}</b>${esc(l.tip)}</li>`
      : `<li class="locked">Pass lesson ${i + 1} to unlock this rule.</li>`).join('');
  }

  /* ───────────── Gameplay ───────────── */
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
    const { lvl, idx } = cur;
    const skip = $('#ans-skip'); if (skip) skip.remove();
    const wick = $('#ans-wick');
    const who = esc(lvl.request.who);
    const v = $('#ans-verdict');

    if (r.ok) {
      setMood(wick, 'happy');
      sfx.win();
      const stars = Math.max(1, 4 - cur.tries);
      const prev = state.stars[lvl.id] || 0;
      if (stars > prev) { state.stars[lvl.id] = stars; persist(); SDK.score(totalStars()); }
      const last = idx === LEVELS.length - 1;
      v.innerHTML = `
        <div class="verdict ok">
          <div class="big-stars">${starsHTML(stars)}</div>
          <h4>${last ? 'You graduated! 🎓' : `Perfect prompt! ${who} got exactly what they needed.`}</h4>
          ${stars < 3 ? `<p class="more">Nail it on the first try for ★★★.</p>` : ''}
        </div>
        <p class="tipcard"><b>📓 New notebook rule:</b> ${esc(lvl.tip)}</p>
        ${last ? `<p class="tipcard"><b>Now try it for real:</b> use these rules with any AI assistant. Better prompts get better answers, every time.</p>` : ''}
        <div class="modal-actions">
          ${last ? `<button class="btn primary" data-act="notebook">Open my notebook</button>`
                 : `<button class="btn primary" data-act="next">Next lesson ›</button>`}
          <button class="btn ghost" data-act="levels">All lessons</button>
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

  /* ───────────── Input ───────────── */
  document.addEventListener('pointerdown', ensureAudio, { capture: true });
  document.addEventListener('keydown', ensureAudio, { capture: true, once: true });

  document.addEventListener('click', e => {
    if (paused) return;
    const t = e.target.closest('button, [data-close-sheet]');
    if (!t) return;

    if (t.id === 'btn-play') { sfx.tap(); return show('levels'); }
    if (t.id === 'btn-notebook') { sfx.tap(); return show('notebook'); }
    if (t.dataset.back) { sfx.tap(); return show(t.dataset.back); }
    if (t.dataset.level !== undefined) {
      const i = Number(t.dataset.level);
      if (isUnlocked(i)) { sfx.tap(); startLevel(i); }
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
    if (act === 'next') { closeModal(); return startLevel(cur.idx + 1); }
    if (act === 'levels') { closeModal(); return show('levels'); }
    if (act === 'notebook') { closeModal(); return show('notebook'); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sheetSlot) closeSheet();
  });

  /* ───────────── Boot ───────────── */
  SDK.onPause(pause);
  SDK.onResume(resume);
  SDK.onAudioChange(on => {
    audioOn = on;
    if (actx) (on && !paused ? actx.resume() : actx.suspend()).catch(() => {});
  });

  window.addEventListener('error', e => SDK.logError(e.error || e.message));

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
