/* picture-levels.js — Prompt Academy v3 "Picture This": word chips, the 8 picture
 * levels (one per card lesson in levels.js, same ids) and the Free-play generator.
 *
 * A prompt is a set of picked chips, at most one per tab. Each chip `set`s scene
 * fields to an exact value, or to { guess: [...] } (a vague chip: Wick picks from
 * that list). Fields a level can set but the player left unsaid are guessed too.
 * Fields no chip in the level can set are copied from the target.
 *
 * Flat scene fields (PICTURE.toScene turns them into the renderer's model):
 *   kind count color action place flowerColor flowerAmount time weather style camera
 *   x_tree x_house x_rainbow x_balloons x_people   (true/false: extras in the picture)
 */
'use strict';
(function () {
  const EXTRAS = ['tree', 'house', 'rainbow', 'balloons', 'people'];
  const OPTIONS = {
    kind: ['dog', 'cat', 'bunny', 'duck', 'kid', 'robot'],
    count: [1, 2, 3, 4, 5],
    color: ['golden', 'black', 'white', 'brown', 'spotted', 'gray'],
    action: ['playing', 'running', 'sleeping', 'sitting', 'jumping', 'eating', 'kite'],
    place: ['field', 'beach', 'park', 'forest', 'snowy hill', 'living room', 'city street'],
    flowerColor: ['red', 'yellow', 'blue', 'purple', 'white'],
    flowerAmount: ['none', 'few', 'lots'],
    time: ['day', 'sunset', 'night'],
    weather: ['sunny', 'cloudy', 'rain', 'snow'],
    style: ['cartoon', 'watercolor', 'pixel', 'storybook', 'photo'],
    camera: ['wide', 'close-up'],
  };
  EXTRAS.forEach(e => { OPTIONS['x_' + e] = [false, true]; });
  const FIELDS = Object.keys(OPTIONS);

  /* Match weights (spec). Extras are 2 points each. */
  const WEIGHT = { kind: 20, count: 10, color: 8, action: 14, place: 14, flowerColor: 8, flowerAmount: 4, time: 6, weather: 4, style: 6, camera: 4 };
  EXTRAS.forEach(e => { WEIGHT['x_' + e] = 2; });

  /* ───────── Wick's guesses for unsaid / vague fields (seeded) ───────── */
  function weighted(r, pairs) {
    let t = r() * pairs.reduce((a, p) => a + p[1], 0);
    for (const [v, w] of pairs) { if ((t -= w) < 0) return v; }
    return pairs[pairs.length - 1][0];
  }
  const anyOf = (r, list) => list[Math.floor(r() * list.length)];
  const EXTRA_P = { tree: 0.3, house: 0.25, rainbow: 0.2, balloons: 0.3, people: 0.5 };
  function guess(field, r, from) {
    if (from) return anyOf(r, from);
    switch (field) {
      case 'count': return anyOf(r, [1, 2, 3]);
      case 'time': return weighted(r, [['day', 6], ['sunset', 2], ['night', 2]]);
      case 'style': return weighted(r, [['cartoon', 7], ['watercolor', 1.5], ['pixel', 1.5]]);
      case 'camera': return weighted(r, [['wide', 7], ['close-up', 3]]);
      case 'flowerAmount': return anyOf(r, ['none', 'few', 'lots']);
      default:
        if (field.startsWith('x_')) return r() < EXTRA_P[field.slice(2)];
        return anyOf(r, OPTIONS[field]);
    }
  }

  /* ───────── words ───────── */
  const NOUN = { dog: ['dog', 'dogs'], cat: ['cat', 'cats'], bunny: ['bunny', 'bunnies'], duck: ['duck', 'ducks'], kid: ['kid', 'kids'], robot: ['robot', 'robots'] };
  const COLOR_WORD = {
    kid: { golden: 'blond', black: 'dark-haired', brown: 'brown-haired', white: 'white-haired', gray: 'gray-haired', spotted: 'red-haired' },
    robot: { golden: 'gold', gray: 'silver', white: 'white', black: 'black', brown: 'rusty', spotted: 'patchy' },
    duck: { golden: 'yellow', black: 'black', white: 'white', brown: 'brown', spotted: 'spotted', gray: 'gray' },
  };
  const colorWord = (kind, c) => (COLOR_WORD[kind] && COLOR_WORD[kind][c]) || c;
  const NUM = ['no', 'one', 'two', 'three', 'four', 'five'];
  const ACTION = { playing: 'playing with a ball', running: 'running', sleeping: 'sleeping', sitting: 'sitting', jumping: 'jumping', eating: 'eating from a bowl', kite: 'flying a kite' };
  const PLACE = { field: 'in a field', beach: 'on a beach', park: 'in a park', forest: 'on a forest path', 'snowy hill': 'on a snowy hill', 'living room': 'in a living room', 'city street': 'on a city street' };
  const TIME = { day: 'in the daytime', sunset: 'at sunset', night: 'at night' };
  const WEATHER = { sunny: 'with clear skies', cloudy: 'under gray clouds', rain: 'in the rain', snow: 'in the snow' };
  const STYLE = { cartoon: 'cartoon style', watercolor: 'watercolor painting', pixel: 'pixel art', storybook: 'storybook illustration', photo: 'news photo' };
  const STYLE_NOTE = { cartoon: 'a cartoon', watercolor: 'a watercolor painting', pixel: 'pixel art', storybook: 'a storybook illustration', photo: 'a news photo' };
  const CAMERA = { wide: 'wide shot', 'close-up': 'close-up' };
  const AMOUNT = { few: 'a few', lots: 'lots of' };

  /** How a field value reads in Wick's notes. `s` = the whole scene (for kind-aware words). */
  function valueWord(field, v, s) {
    switch (field) {
      case 'kind': return NOUN[v][s.count > 1 ? 1 : 0];
      case 'count': return NUM[v] || String(v);
      case 'color': return colorWord(s.kind, v);
      case 'action': return ACTION[v];
      case 'place': return PLACE[v].replace(/^(in|on) /, '');
      case 'flowerColor': return v;
      case 'flowerAmount': return v === 'none' ? 'no flowers' : v === 'few' ? 'a few' : 'lots of';
      case 'time': return v === 'day' ? 'daytime' : v;
      case 'weather': return v === 'sunny' ? (s.time === 'night' ? 'clear' : 'sunny') : v === 'rain' ? 'rainy' : v === 'snow' ? 'snowy' : v;
      case 'style': return STYLE_NOTE[v];
      case 'camera': return 'a ' + CAMERA[v];
      default: return v ? 'yes' : 'no';
    }
  }
  const FIELD_NAME = {
    kind: 'what it is', count: 'how many', color: 'color', action: 'action', place: 'place', flowerColor: 'flower color',
    flowerAmount: 'how many flowers', time: 'time of day', weather: 'weather', style: 'style', camera: 'camera',
  };
  EXTRAS.forEach(e => { FIELD_NAME['x_' + e] = e; });

  /** "Flowers came out yellow" — the first half of a difference note. */
  function diffHead(field, rv, res) {
    const w = valueWord(field, rv, res);
    switch (field) {
      case 'kind': return `Wick drew ${w}`;
      case 'count': return `Wick drew ${w}`;
      case 'color': return res.kind === 'kid' ? `Their hair came out ${w}` : res.kind === 'robot' ? `The robot came out ${w}` : `The ${res.kind === 'duck' ? 'feathers' : 'fur'} came out ${w}`;
      case 'action': return `They came out ${w}`;
      case 'place': return `Wick put them ${PLACE[rv]}`;
      case 'flowerColor': return `Flowers came out ${w}`;
      case 'flowerAmount': return rv === 'none' ? 'Wick drew no flowers' : `Wick drew ${w} flowers`;
      case 'time': return `It came out at ${w}`;
      case 'weather': return `The weather came out ${w}`;
      case 'style': return `It came out as ${w}`;
      case 'camera': return `Wick drew ${w}`;
      default: { const e = field.slice(2); return rv ? `Wick added ${e === 'people' ? 'other people' : e === 'balloons' ? 'balloons' : 'a ' + e}` : `No ${e === 'people' ? 'people' : e}`; }
    }
  }
  /** "red" — the target value as the note's second half needs it. */
  function diffWant(field, tv, tgt) {
    if (field.startsWith('x_')) { const e = field.slice(2); return tv ? (e === 'people' ? 'other people' : e === 'balloons' ? 'balloons' : 'a ' + e) : `no ${e}`; }
    if (field === 'kind') return NOUN[tv][1];
    if (field === 'place') return PLACE[tv].replace(/^(in|on) /, '');
    if (field === 'flowerAmount') return tv === 'none' ? 'no flowers' : `${valueWord(field, tv, tgt)} flowers`;
    return valueWord(field, tv, tgt);
  }

  /* ───────── chips ─────────
   * chip: { label, set: { field: value | { guess: [...] } }, say?: phrase, vague? }
   * Subject chips use { noun:[sg,pl], adj } instead of `say`; count chips use { word, n }.
   */
  const G = list => ({ guess: list });
  const ANY = { guess: null };
  const TAB_INFO = {
    role:     { label: 'Role', color: '#B07CF2', hint: 'Who should Wick draw as?' },
    subject:  { label: 'Subject', color: '#8B88F5', hint: 'Who is in the picture?' },
    color:    { label: 'Color', color: '#F2B84B', hint: 'What color are they?' },
    count:    { label: 'How many', color: '#6CB4F5', hint: 'Count them!' },
    action:   { label: 'Doing', color: '#4FC3B8', hint: 'What are they doing?' },
    place:    { label: 'Where', color: '#7BD389', hint: 'Where are they?' },
    details:  { label: 'Details', color: '#F27BA5', hint: 'Look at the ground. Any flowers?' },
    famount:  { label: 'How many flowers', color: '#F27BA5', hint: 'A few flowers, or lots?' },
    extras:   { label: 'Extras', color: '#F2A23A', hint: 'Anything else in the picture?' },
    time:     { label: 'Time & weather', color: '#6C9BF5', hint: 'Look at the sky.' },
    weather:  { label: 'Weather', color: '#6C9BF5', hint: 'Sun, clouds, rain or snow?' },
    style:    { label: 'Style', color: '#E58BE0', hint: 'How is it drawn?' },
    camera:   { label: 'Camera', color: '#A9A7C8', hint: 'Far away or up close?' },
    limits:   { label: 'Limits', color: '#F27BA5', hint: 'Anything Wick must NOT add?' },
  };

  const subj = (kind, color, label) => ({
    label: label || (color ? colorWord(kind, color) + ' ' : '') + NOUN[kind][0],
    set: color ? { kind, color } : { kind },   // unsaid color is guessed only if the level scores color
    noun: NOUN[kind], adj: color ? colorWord(kind, color) : '',
  });
  const vagueSubj = (label, noun, kinds) => ({ label, vague: true, set: { kind: G(kinds) }, noun });
  const cnt = n => ({ label: NUM[n], set: { count: n }, word: NUM[n], n });
  const vagueCnt = (label, list) => ({ label, vague: true, set: { count: G(list) }, word: label, n: 2 });
  const act = (a, label) => ({ label: label || ACTION[a], set: { action: a }, say: ACTION[a] });
  const vague = (label, set, say) => ({ label, vague: true, set, say: say || label });
  const plc = (place, extra, label) => ({ label: label || PLACE[place], set: Object.assign({ place }, extra || {}), say: label || PLACE[place] });
  const flw = (color, amount) => ({
    label: amount === 'none' ? 'no flowers' : `${AMOUNT[amount]} ${color} flowers`,
    set: amount === 'none' ? { flowerAmount: 'none' } : { flowerColor: color, flowerAmount: amount },
    say: amount === 'none' ? 'with no flowers' : `with ${AMOUNT[amount]} ${color} flowers`,
  });
  const tw = (label, time, weather) => ({ label, set: weather ? { time, weather } : { time }, say: label });
  const sty = (style, label) => ({ label: label || STYLE[style], set: { style }, say: label || STYLE[style] });
  const cam = c => ({ label: CAMERA[c], set: { camera: c }, say: CAMERA[c] });
  const onlyExtras = (list, label) => {
    const set = {};
    EXTRAS.forEach(e => { set['x_' + e] = list.indexOf(e) >= 0; });
    return { label, set, say: 'with ' + label.replace(/^with /, '') };
  };
  const extrasAll = (v) => { const s = {}; EXTRAS.forEach(e => { s['x_' + e] = v; }); return s; };

  /* ───────── targets ───────── */
  const T = o => Object.assign({
    kind: 'dog', count: 1, color: 'golden', action: 'sitting', place: 'park', flowerColor: 'yellow', flowerAmount: 'few',
    time: 'day', weather: 'sunny', style: 'cartoon', camera: 'wide',
  }, extrasAll(false), o);

  /* ───────── the 8 picture levels (ids match levels.js) ───────── */
  const LEVELS = [
    {
      id: 'specific', short: 'One good dog',
      intro: 'Here’s a picture. Pick words so I paint the SAME thing. Anything you don’t say, I’ll have to guess!',
      target: T({}),
      tabs: [
        ['subject', [subj('dog', 'golden'), subj('dog'), subj('dog', 'black'), subj('cat', 'golden'), vagueSubj('an animal', ['animal', 'animals'], ['dog', 'cat', 'bunny', 'duck'])]],
        ['count', [cnt(1), cnt(2), cnt(3), vagueCnt('some', [2, 3, 4])]],
        ['action', [act('sitting'), act('sleeping'), act('running'), act('jumping'), vague('doing something', { action: ANY })]],
      ],
    },
    {
      id: 'context', short: 'Dogs at play',
      intro: 'Context is everything AROUND the subject: where they are, what’s nearby, what the day is like.',
      target: T({ count: 2, action: 'playing', place: 'field', flowerColor: 'red', flowerAmount: 'lots' }),
      tabs: [
        ['subject', [subj('dog', 'golden'), subj('dog'), subj('dog', 'brown'), subj('cat', 'golden'), vagueSubj('some animals', ['animal', 'animals'], ['dog', 'cat', 'bunny', 'duck'])]],
        ['count', [cnt(2), cnt(1), cnt(3), cnt(5), vagueCnt('a few', [2, 3])]],
        ['action', [act('playing'), act('running'), act('sleeping'), act('eating'), vague('having fun', { action: G(['playing', 'running', 'jumping']) })]],
        ['place', [plc('field', { time: 'day', weather: 'sunny' }, 'in a sunny field'), plc('field'), plc('beach', { time: 'day', weather: 'sunny' }, 'on a sunny beach'), plc('park'), vague('outside', { place: G(['field', 'beach', 'park', 'forest', 'snowy hill', 'city street']) })]],
        ['details', [flw('red', 'lots'), flw('red', 'few'), flw('yellow', 'lots'), flw('red', 'none'), vague('nice flowers', { flowerColor: ANY, flowerAmount: G(['few', 'lots']) }, 'with nice flowers')]],
      ],
    },
    {
      id: 'format', short: 'Watercolor cat',
      intro: 'Format is the SHAPE of the result. For pictures, that’s the style: cartoon, watercolor, pixel art…',
      target: T({ kind: 'cat', color: 'gray', action: 'sleeping', place: 'living room', flowerColor: 'purple', time: 'night', style: 'watercolor' }),
      tabs: [
        ['subject', [subj('cat', 'gray'), subj('cat'), subj('cat', 'black'), subj('dog', 'gray'), vagueSubj('a pet', ['pet', 'pets'], ['dog', 'cat', 'bunny'])]],
        ['count', [cnt(1), cnt(2), cnt(3), vagueCnt('some', [2, 3])]],
        ['action', [act('sleeping'), act('sitting'), act('eating'), vague('relaxing', { action: G(['sleeping', 'sitting']) })]],
        ['place', [plc('living room'), plc('park'), plc('city street'), vague('at home', { place: G(['living room', 'park', 'field']) }, 'at home')]],
        ['time', [tw('at night', 'night'), tw('in the daytime', 'day'), tw('at sunset', 'sunset'), vague('anytime', { time: ANY })]],
        ['style', [sty('watercolor'), sty('cartoon'), sty('pixel'), vague('pretty style', { style: ANY }, 'in a pretty style')]],
      ],
    },
    {
      id: 'constraints', short: 'Kite at sunset',
      intro: 'Limits tell me what NOT to do. If you don’t set any, I might add whatever I think is fun…',
      target: T({ kind: 'kid', count: 2, color: 'brown', action: 'kite', place: 'beach', flowerAmount: 'none', time: 'sunset' }),
      tabs: [
        ['subject', [subj('kid', null, 'kid'), subj('dog', null, 'dog'), subj('robot', null, 'robot'), vagueSubj('someone', ['someone', 'people'], ['kid', 'robot', 'dog', 'cat'])]],
        ['count', [cnt(2), cnt(1), cnt(4), vagueCnt('a few', [2, 3, 4])]],
        ['action', [act('kite'), act('running'), act('playing'), vague('playing', { action: G(['kite', 'playing', 'running', 'jumping']) }, 'playing outside')]],
        ['place', [plc('beach'), plc('park'), plc('snowy hill'), vague('outside', { place: G(['beach', 'park', 'field', 'forest']) })]],
        ['time', [tw('at sunset', 'sunset'), tw('in the daytime', 'day'), tw('at night', 'night'), vague('whenever', { time: ANY })]],
        ['limits', [
          { label: 'only them — no one and nothing else', set: extrasAll(false), say: 'Only them: no other people, nothing extra.' },
          { label: 'no other people', set: { x_people: false }, say: 'No other people.' },
          { label: 'a busy beach with lots of people', set: { x_people: true }, say: 'A busy beach with lots of people.' },
          vague('make it fun!', { x_tree: ANY, x_house: ANY, x_rainbow: ANY, x_balloons: ANY, x_people: ANY }, 'Make it fun!'),
        ]],
      ],
    },
    {
      id: 'example', short: 'Bunnies, retro',
      intro: 'Some styles are hard to describe. Show me an example and I’ll copy it!',
      target: T({ kind: 'bunny', count: 3, color: 'brown', action: 'eating', place: 'snowy hill', flowerAmount: 'none', weather: 'snow', style: 'pixel' }),
      example: T({ kind: 'duck', count: 1, color: 'white', action: 'sitting', place: 'park', flowerColor: 'red', style: 'pixel' }),
      tabs: [
        ['subject', [subj('bunny', 'brown'), subj('bunny', 'white'), subj('bunny'), subj('dog', 'brown'), vagueSubj('cute animals', ['cute animal', 'cute animals'], ['bunny', 'cat', 'dog', 'duck'])]],
        ['count', [cnt(3), cnt(1), cnt(5), vagueCnt('a bunch', [3, 4, 5])]],
        ['action', [act('eating'), act('sleeping'), act('jumping'), vague('hanging out', { action: G(['sitting', 'eating', 'sleeping']) })]],
        ['place', [plc('snowy hill'), plc('field'), plc('forest'), vague('outside', { place: G(['snowy hill', 'field', 'forest', 'park']) })]],
        ['style', [
          { label: 'like this example 🖼', set: { style: 'pixel' }, say: 'in the style of this example 🖼', example: true },
          sty('cartoon'), sty('watercolor'),
          vague('retro style', { style: G(['pixel', 'cartoon', 'photo']) }, 'in a retro style'),
        ]],
      ],
    },
    {
      id: 'role', short: 'Storybook ducks',
      intro: 'A role changes HOW I work. Tell me who to draw as, and my whole style changes.',
      target: T({ kind: 'duck', count: 3, color: 'golden', action: 'running', flowerColor: 'white', style: 'storybook' }),
      tabs: [
        ['role', [
          { label: 'as a children’s-book illustrator', set: { style: 'storybook' }, say: 'As a children’s-book illustrator, draw' },
          { label: 'as a news photographer', set: { style: 'photo' }, say: 'As a news photographer, shoot' },
          { label: 'as a video-game artist', set: { style: 'pixel' }, say: 'As a video-game artist, draw' },
          vague('as an artist', { style: ANY }, 'As an artist, draw'),
        ]],
        ['subject', [subj('duck', 'golden', 'yellow duckling'), subj('duck', 'white'), subj('duck'), subj('bunny', 'golden'), vagueSubj('some birds', ['bird', 'birds'], ['duck'])]],
        ['count', [cnt(3), cnt(1), cnt(2), vagueCnt('a few', [2, 3, 4])]],
        ['action', [act('running'), act('sleeping'), act('eating'), vague('waddling about', { action: G(['running', 'sitting', 'playing']) })]],
        ['place', [plc('park'), plc('beach'), plc('forest'), vague('somewhere nice', { place: ANY })]],
      ],
    },
    {
      id: 'steps', short: 'Rainy-night robot',
      intro: 'Big pictures are easier in steps. First set the scene, then add who’s in it — and fix as you go.',
      target: T({ kind: 'robot', count: 1, color: 'white', action: 'jumping', place: 'city street', flowerColor: 'red', time: 'night', weather: 'rain' }),
      steps: [
        { title: 'Step 1 of 2 · Set the scene', tabs: [
          ['place', [plc('city street'), plc('park'), plc('living room'), vague('somewhere', { place: ANY })]],
          ['time', [tw('on a rainy night', 'night', 'rain'), tw('at night', 'night'), tw('on a sunny day', 'day', 'sunny'), tw('on a snowy night', 'night', 'snow'), vague('whenever', { time: ANY, weather: ANY })]],
        ] },
        { title: 'Step 2 of 2 · Now add…', tabs: [
          ['subject', [subj('robot', 'white'), subj('robot', 'gray'), subj('robot'), subj('kid', 'golden', 'kid'), vagueSubj('a character', ['character', 'characters'], ['robot', 'kid', 'dog', 'cat'])]],
          ['count', [cnt(1), cnt(2), cnt(3), vagueCnt('some', [2, 3])]],
          ['action', [act('jumping'), act('running'), act('sitting'), act('sleeping'), vague('doing something', { action: ANY })]],
        ] },
      ],
    },
    {
      id: 'final', short: 'The big picture',
      intro: 'Final exam! Subject, action, place, details, time, style, camera — put it ALL together.',
      target: T({ kind: 'dog', count: 3, color: 'spotted', action: 'running', place: 'forest', flowerColor: 'yellow', flowerAmount: 'lots', time: 'sunset', style: 'watercolor', camera: 'close-up', x_balloons: true }),
      tabs: [
        ['subject', [subj('dog', 'spotted'), subj('dog', 'white'), subj('dog'), subj('cat', 'spotted'), vagueSubj('some pets', ['pet', 'pets'], ['dog', 'cat', 'bunny'])]],
        ['count', [cnt(3), cnt(2), cnt(4), vagueCnt('a few', [2, 3, 4])]],
        ['action', [act('running'), act('jumping'), act('playing'), vague('having fun', { action: G(['running', 'jumping', 'playing']) })]],
        ['place', [plc('forest'), plc('park'), plc('field'), vague('in nature', { place: G(['forest', 'park', 'field', 'snowy hill']) })]],
        ['details', [flw('yellow', 'lots'), flw('yellow', 'few'), flw('red', 'lots'), flw('yellow', 'none'), vague('pretty flowers', { flowerColor: ANY, flowerAmount: G(['few', 'lots']) }, 'with pretty flowers')]],
        ['extras', [onlyExtras(['balloons'], 'with balloons'), onlyExtras(['rainbow'], 'with a rainbow'), onlyExtras([], 'with nothing extra'), vague('with fun stuff', { x_tree: ANY, x_house: ANY, x_rainbow: ANY, x_balloons: ANY, x_people: ANY })]],
        ['time', [tw('at sunset', 'sunset', 'sunny'), tw('in the daytime', 'day', 'sunny'), tw('at night', 'night', 'sunny'), tw('on a rainy evening', 'sunset', 'rain'), vague('at some point', { time: ANY, weather: ANY }, 'at some point')]],
        ['style', [sty('watercolor'), sty('cartoon'), sty('pixel'), vague('artsy', { style: ANY }, 'artsy style')]],
        ['camera', [cam('close-up'), cam('wide'), vague('nice angle', { camera: ANY }, 'from a nice angle')]],
      ],
    },
  ];

  /* ───────── Free play: random target + every chip ───────── */
  const KID_COLORS = ['golden', 'black', 'brown'];
  function randomTarget(r) {
    const kind = anyOf(r, OPTIONS.kind);
    const colors = kind === 'kid' ? KID_COLORS : OPTIONS.color;
    const place = anyOf(r, OPTIONS.place);
    const t = T({
      kind, color: anyOf(r, colors), count: anyOf(r, [1, 2, 3, 4]),
      action: anyOf(r, kind === 'kid' ? OPTIONS.action : OPTIONS.action.filter(a => a !== 'kite')),
      place,
      flowerColor: anyOf(r, OPTIONS.flowerColor), flowerAmount: anyOf(r, ['none', 'few', 'lots']),
      time: weighted(r, [['day', 5], ['sunset', 2], ['night', 2]]),
      weather: place === 'snowy hill' ? anyOf(r, ['sunny', 'snow']) : weighted(r, [['sunny', 5], ['cloudy', 2], ['rain', 1.5], ['snow', 0.5]]),
      style: weighted(r, [['cartoon', 5], ['watercolor', 2], ['pixel', 2]]),
      camera: r() < 0.25 ? 'close-up' : 'wide',
    });
    if (r() < 0.4) t['x_' + anyOf(r, ['tree', 'house', 'rainbow', 'balloons'])] = true;
    return t;
  }
  const FREE_TABS = [
    ['subject', OPTIONS.kind.map(k => subj(k, null, NOUN[k][0])).concat([vagueSubj('something', ['thing', 'things'], OPTIONS.kind)])],
    ['color', OPTIONS.color.map(c => ({ label: c, set: { color: c }, adj: c })).concat([{ label: 'colorful', vague: true, set: { color: ANY }, adj: 'colorful' }])],
    ['count', [1, 2, 3, 4, 5].map(cnt).concat([vagueCnt('some', [2, 3, 4])])],
    ['action', OPTIONS.action.map(a => act(a)).concat([vague('doing stuff', { action: ANY })])],
    ['place', OPTIONS.place.map(p => plc(p)).concat([vague('somewhere', { place: ANY })])],
    ['details', OPTIONS.flowerColor.map(c => ({ label: c + ' flowers', set: { flowerColor: c }, flower: c })).concat([{ label: 'no flowers', set: { flowerAmount: 'none' }, say: 'with no flowers' }, vague('nice flowers', { flowerColor: ANY }, 'with nice flowers')])],
    ['famount', [{ label: 'a few', set: { flowerAmount: 'few' }, amount: 'a few' }, { label: 'lots', set: { flowerAmount: 'lots' }, amount: 'lots of' }, vague('some', { flowerAmount: G(['few', 'lots']) }, 'some')]],
    ['time', [tw('in the daytime', 'day'), tw('at sunset', 'sunset'), tw('at night', 'night'), vague('anytime', { time: ANY })]],
    ['weather', OPTIONS.weather.map(w => ({ label: WEATHER[w], set: { weather: w }, say: WEATHER[w] })).concat([vague('nice weather', { weather: G(['sunny', 'cloudy']) }, 'in nice weather')])],
    ['style', ['cartoon', 'watercolor', 'pixel'].map(s => sty(s)).concat([vague('pretty style', { style: ANY }, 'in a pretty style')])],
    ['camera', [cam('wide'), cam('close-up'), vague('nice angle', { camera: ANY }, 'from a nice angle')]],
    ['extras', [onlyExtras([], 'with nothing extra'), onlyExtras(['tree'], 'with a tree'), onlyExtras(['house'], 'with a house'), onlyExtras(['rainbow'], 'with a rainbow'), onlyExtras(['balloons'], 'with balloons'), vague('with fun stuff', { x_tree: ANY, x_house: ANY, x_rainbow: ANY, x_balloons: ANY, x_people: ANY })]],
  ];
  const FREE = { id: 'free', short: 'Free play', intro: 'Free play! A new picture every round. Every word counts.', tabs: FREE_TABS, rounds: 5 };

  /* ───────── prompt logic ───────── */
  /** Every field any chip in these tabs can set (= the fields this level scores). */
  function relevantFields(tabs) {
    const set = new Set();
    tabs.forEach(([, chips]) => chips.forEach(ch => Object.keys(ch.set).forEach(f => set.add(f))));
    return FIELDS.filter(f => set.has(f));
  }

  /**
   * Resolve picked chips into a full flat scene.
   * picks: { tabId: chip }. fixed: values that must not change (step 2 keeps step 1).
   * Returns { scene, guessed: [{ field, chip? }] }.
   */
  function resolve(picks, tabs, target, seed, fixed) {
    const r = window.Scene.rng(seed);
    const scene = Object.assign({}, target);
    const relevant = relevantFields(tabs);
    const said = {};
    Object.values(picks).forEach(ch => { if (ch) Object.entries(ch.set).forEach(([f, v]) => { said[f] = { v, chip: ch }; }); });
    const guessed = [];
    relevant.forEach(f => {
      const r2 = r(); // one draw per field keeps the stream aligned no matter what was said
      const fr = window.Scene.rng(Math.floor(r2 * 4294967296));
      if (fixed && f in fixed) { scene[f] = fixed[f]; return; }
      const s = said[f];
      if (s && (typeof s.v !== 'object' || s.v === null)) { scene[f] = s.v; return; }
      scene[f] = guess(f, fr, s && s.v.guess);
      guessed.push({ field: f, chip: s ? s.chip : null });
    });
    if (scene.kind === 'kid' && KID_COLORS.indexOf(scene.color) < 0 && guessed.some(g => g.field === 'color')) scene.color = 'brown';
    return { scene, guessed };
  }

  /** Compare a result with the target over the relevant fields. */
  function compare(target, result, relevant) {
    let total = 0, got = 0;
    const diffs = [];
    relevant.forEach(f => {
      let w = WEIGHT[f] || 0;
      if (f === 'flowerColor' && (target.flowerAmount === 'none' || result.flowerAmount === 'none')) {
        if (target.flowerAmount === 'none' && result.flowerAmount === 'none') return; // nothing to compare
        if (target.flowerAmount === 'none') return;               // amount already counts it
      }
      total += w;
      if (target[f] === result[f]) got += w;
      else diffs.push({ field: f, weight: w, tv: target[f], rv: result[f] });
    });
    diffs.sort((a, b) => b.weight - a.weight);
    return { pct: total ? Math.round(100 * got / total) : 100, diffs };
  }

  /** One short Wick note per difference. */
  function noteFor(d, target, result, guessed) {
    const g = guessed.find(x => x.field === d.field);
    const head = diffHead(d.field, d.rv, result), want = diffWant(d.field, d.tv, target);
    if (g && g.chip) return `${head} — “${g.chip.label}” was too vague (the picture ${d.field === 'style' || d.field === 'camera' ? 'is' : 'has'} ${want}).`;
    if (g) return `${head} — you didn’t say ${want}.`;
    return `${head} — the picture ${d.field === 'style' || d.field === 'camera' ? 'is' : 'has'} ${want}.`;
  }

  /** The live English sentence for the picked chips. */
  function sentence(picks, tabs) {
    const order = tabs.map(t => t[0]);
    const p = id => picks[id];
    const parts = [];
    const sub = p('subject'), col = p('color'), n = p('count');
    const plural = n ? n.n > 1 : null;
    const noun = sub ? sub.noun : ['thing', 'things'];
    const adj = [col ? col.adj : '', sub ? sub.adj : ''].filter(Boolean).join(' ');
    let head;
    if (n) head = `${n.word} ${adj ? adj + ' ' : ''}${noun[plural ? 1 : 0]}`;
    else if (sub || col) head = `${adj ? adj + ' ' : ''}${noun[0]}(s)`;
    if (order.indexOf('subject') < 0 && order.indexOf('count') < 0) head = '';
    if (head) parts.push(head);
    ['action', 'place'].forEach(id => { if (p(id)) parts.push(p(id).say); });
    // flowers: one "details" chip, or (free play) color + amount chips combined
    const d = p('details'), fa = p('famount');
    if (d && d.flower) parts.push(`with ${fa ? fa.amount + ' ' : ''}${d.flower} flowers`);
    else if (d) parts.push(d.say);
    else if (fa) parts.push(`with ${fa.amount} flowers`);
    ['extras', 'time', 'weather'].forEach(id => { if (p(id)) parts.push(p(id).say); });
    let s = parts.join(' ');
    const tail = ['style', 'camera'].filter(id => p(id)).map(id => p(id).say);
    if (tail.length) s += (s ? ', ' : '') + tail.join(', ');
    if (p('role')) s = p('role').say + (s ? ': ' + s : ' something');
    if (!s) return '';
    s = s.charAt(0).toUpperCase() + s.slice(1) + '.';
    if (p('limits')) s += ' ' + p('limits').say;
    return s;
  }

  /** Flat fields -> the renderer's scene model. */
  function toScene(f) {
    return {
      subject: { kind: f.kind, count: f.count, color: f.color },
      action: f.action, place: f.place,
      flowers: { color: f.flowerColor, amount: f.flowerAmount },
      time: f.time, weather: f.weather, style: f.style, camera: f.camera,
      extras: EXTRAS.filter(e => f['x_' + e]),
    };
  }

  window.PICTURE = {
    LEVELS, FREE, TAB_INFO, FIELDS, FIELD_NAME, OPTIONS,
    relevantFields, resolve, compare, noteFor, sentence, toScene, randomTarget, valueWord,
  };
})();
