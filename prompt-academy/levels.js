/* Prompt Academy — level content.
 * Each level teaches one prompting principle. A level has slots (parts of a
 * prompt); each slot offers cards. Exactly one card per slot is `ok`. Every
 * weak card carries the (simulated) answer Wick gives and a short lesson.
 */
'use strict';

window.SLOT_META = {
  role:        { label: 'Role',        hint: 'Who should Wick act as?',            color: '#B07CF2' },
  task:        { label: 'Task',        hint: 'What exactly should Wick do?',       color: '#8B88F5' },
  context:     { label: 'Context',     hint: 'Who is it for? Why? What matters?',  color: '#4FC3B8' },
  format:      { label: 'Format',      hint: 'What shape should the answer take?', color: '#F2B84B' },
  constraints: { label: 'Limits',      hint: 'Length, tone, must-include…',        color: '#F27BA5' },
  example:     { label: 'Example',     hint: 'Show Wick what good looks like.',    color: '#7BD389' },
  steps:       { label: 'Steps',       hint: 'How should Wick work through it?',   color: '#6CB4F5' },
};

window.LEVELS = [
  /* 1 ─────────────────────────────────────────────── */
  {
    id: 'specific',
    title: 'Be Specific',
    principle: 'Vague in, vague out.',
    teach: 'I take every word literally — and only those words. Tell me exactly what you want, with the details that matter.',
    request: { who: 'Sam', text: 'I need dinner ideas for tonight. I only have chicken, rice and spinach, and 30 minutes.' },
    slots: [
      { key: 'task', cards: [
        { t: 'Suggest 3 dinners I can cook in 30 minutes using chicken, rice and spinach.', ok: true },
        { t: 'Food.',
          out: 'Food is any substance consumed to provide nutritional support for an organism. It is usually of plant, animal or fungal origin, and contains essential nutrients such as…',
          why: 'One word gives me nothing to act on. Say what you want me to DO.' },
        { t: 'Give me some ideas.',
          out: 'Sure! Here are some ideas:\n1. Learn to juggle\n2. Start a podcast\n3. Repaint the fence',
          why: 'Ideas for what? I can’t read minds. Name the topic.' },
        { t: 'Suggest some dinners.',
          out: '1. Beef Wellington (3 hours)\n2. Seafood paella for 12\n3. Homemade ramen (2 days)',
          why: 'Closer! But without your time limit and ingredients, I guessed — and guessed big.' },
      ]},
    ],
    good: '1. Chicken & spinach fried rice — 25 min\n2. Garlic chicken over rice with wilted spinach — 30 min\n3. Chicken rice bowls with sautéed spinach — 20 min',
    tip: 'Include the key details: what you want, plus the facts that limit it (time, ingredients, budget).',
  },

  /* 2 ─────────────────────────────────────────────── */
  {
    id: 'context',
    title: 'Give Context',
    principle: 'Tell me who it’s for and why.',
    teach: 'The same request can need wildly different answers. Who is the audience? What’s the occasion? Context steers everything.',
    request: { who: 'Ana', text: 'Can you help me write a short toast for Grandma’s 80th birthday? It’s a family party.' },
    slots: [
      { key: 'task', cards: [
        { t: 'Write a 1-minute birthday toast.', ok: true },
        { t: 'Write a speech.',
          out: 'Ladies and gentlemen, distinguished guests… (Wick wrote 2,400 words. Reading time: 19 minutes.)',
          why: 'How long? What kind? A specific task gets a usable result.' },
        { t: 'Say something nice.',
          out: 'You are doing great! Keep it up! 😊',
          why: 'Nice… but not a toast. Name the actual thing you need.' },
      ]},
      { key: 'context', cards: [
        { t: 'It’s for my grandma’s 80th; family audience; warm and a little funny. She loves card games.', ok: true },
        { t: 'It’s really important.',
          out: 'Esteemed colleagues and shareholders, today marks a pivotal moment for our organization…',
          why: '“Important” isn’t context. Who’s listening? What’s the occasion?' },
        { t: 'I’m nervous about it.',
          out: 'Don’t worry! Here’s a calm toast: “Hello everyone. Thank you for coming to this event. Please enjoy it.”',
          why: 'I hear you — but I still need the facts: occasion, audience, mood.' },
      ]},
    ],
    good: '“Eighty years ago, the world got a little louder — Grandma arrived! She taught us to cook, to forgive, and to never, ever let her deal the cards. Raise your glasses: to 80 years of love, laughter and suspiciously good hands!”',
    tip: 'Add context: audience, occasion, purpose, and anything special about the situation.',
  },

  /* 3 ─────────────────────────────────────────────── */
  {
    id: 'format',
    title: 'Set the Format',
    principle: 'Say what shape the answer should be.',
    teach: 'A table? Bullets? One sentence? If you don’t say, I pick — and you may get a wall of text.',
    request: { who: 'Jay', text: 'I’m choosing between Phone A and Phone B. I’m a student on a budget and I take lots of photos.' },
    slots: [
      { key: 'task', cards: [
        { t: 'Compare Phone A and Phone B on price, battery and camera.', ok: true },
        { t: 'Tell me about phones.',
          out: 'The telephone was patented in 1876. Early models used a hand crank to signal an operator…',
          why: 'Way too broad. Name exactly what to compare and on what.' },
        { t: 'Which phone is best?',
          out: 'The best phone is the one that best fits your needs! Consider your needs carefully.',
          why: 'Best at what? Give me the criteria that matter to you.' },
      ]},
      { key: 'context', cards: [
        { t: 'I’m a student on a budget and I take lots of photos.', ok: true },
        { t: 'I like phones.',
          out: 'Great! Both phones are phones, so you will probably like both of them.',
          why: 'That doesn’t help me weigh anything. What do you need it for?' },
      ]},
      { key: 'format', cards: [
        { t: 'Answer as a small table, then a one-line recommendation.', ok: true },
        { t: 'Any format is fine.',
          out: 'Phone A, which features a battery that is notably large relative to its overall chassis dimensions, while Phone B on the other hand offers a camera system that, when compared to…',
          why: 'Want it skimmable? Ask for it: table, bullets, steps.' },
        { t: 'Make it fancy.',
          out: '✨🌟 PHONE A 🌟✨ is a ✨MAGNIFICENT✨ device of 💫 unparalleled 💫 elegance…',
          why: '“Fancy” is vague. Name a concrete format instead.' },
      ]},
    ],
    good: '           Phone A    Phone B\nPrice      $399       $649\nBattery    2 days     1 day\nCamera     Good       Excellent\n\n→ On a budget, Phone A wins. If photos matter most, save up for B.',
    mono: true,
    tip: 'Name the output format: table, list, steps, short paragraph, single line.',
  },

  /* 4 ─────────────────────────────────────────────── */
  {
    id: 'constraints',
    title: 'Add Limits',
    principle: 'Set length, tone and must-haves.',
    teach: 'Limits are your friend. Tell me how long, what tone, and anything I must include or avoid.',
    request: { who: 'Rita', text: 'I have to cancel Saturday’s movie with my friend Tom — I’m stuck working late. I want to move it to Sunday.' },
    slots: [
      { key: 'task', cards: [
        { t: 'Write a text cancelling our Saturday movie plan.', ok: true },
        { t: 'Write a message.',
          out: 'Message: Hello.',
          why: 'Technically a message! Be specific about what it’s for.' },
      ]},
      { key: 'context', cards: [
        { t: 'It’s to my friend Tom; I have to work late and want to reschedule.', ok: true },
        { t: 'Tom is a person.',
          out: 'Dear Tom, You are a person. Regards.',
          why: 'Give me the real situation: your relationship and why you’re cancelling.' },
      ]},
      { key: 'format', cards: [
        { t: 'One casual text message.', ok: true },
        { t: 'An essay.',
          out: 'Introduction: On the Nature of Cancellation. Throughout human history, plans have…',
          why: 'Match the format to where it’s going. A text is not an essay.' },
      ]},
      { key: 'constraints', cards: [
        { t: 'Under 30 words, friendly, suggest Sunday instead.', ok: true },
        { t: 'Make it good.',
          out: 'Dearest Tom, it is with a heavy heart and profound regret that I must inform you of a change in circumstances that…',
          why: '“Good” can’t be measured. Give limits: length, tone, what to include.' },
        { t: 'No limits.',
          out: '(312 words of apology, a poem about Saturdays, and a proposed 5-step reconciliation plan.)',
          why: 'Without limits, I tend to overdo it. Tell me where to stop.' },
      ]},
    ],
    good: 'Hey Tom! So sorry — I’m stuck working late Saturday 😩 Can we do the movie Sunday instead? Snacks on me! 🍿',
    tip: 'Add limits: word count, tone, and the must-include details.',
  },

  /* 5 ─────────────────────────────────────────────── */
  {
    id: 'example',
    title: 'Show an Example',
    principle: 'Show, don’t just tell.',
    teach: 'Describing a style is hard. Showing me one or two examples is the fastest way to get exactly your vibe.',
    request: { who: 'Kai', text: 'My café is space-themed. I need names for 3 new drinks that match the ones we already have.' },
    slots: [
      { key: 'task', cards: [
        { t: 'Name 3 new drinks for my café menu.', ok: true },
        { t: 'Name some things.',
          out: '1. Gerald\n2. A chair\n3. Tuesday',
          why: 'Names for what? Tell me the job.' },
      ]},
      { key: 'context', cards: [
        { t: 'My café is space-themed, cozy and playful.', ok: true },
        { t: 'It’s a café.',
          out: '1. Coffee Deluxe\n2. Latte Supreme\n3. Hot Drink No. 3',
          why: 'Every café is a café! What makes yours different?' },
      ]},
      { key: 'example', cards: [
        { t: 'Match our current names, like “Milky Way Mocha” and “Black Hole Brew”.', ok: true },
        { t: '(No example — you’ll figure it out.)',
          out: '1. The Cosmic Coffee Experience™\n2. Interstellar Bean Journey\n3. Galactic Caffeinated Beverage',
          why: 'On theme, but not YOUR style. One or two examples beat a long description.' },
        { t: 'Make them sound like a fancy restaurant.',
          out: '1. Café au Lait, Infused with Notes of Hazelnut\n2. Single-Origin Pour-Over, Reimagined',
          why: 'That style description fought your theme. Show real examples instead.' },
      ]},
    ],
    good: '1. Saturn Ring Latte\n2. Nebula Chai\n3. Supernova Cold Brew',
    tip: 'Give 1–2 examples of what you want. Wick copies the pattern.',
  },

  /* 6 ─────────────────────────────────────────────── */
  {
    id: 'role',
    title: 'Give Wick a Role',
    principle: 'A role sets voice and expertise.',
    teach: 'Tell me who to be — a teacher, a coach, an editor — and I’ll pick the right words, depth and tone.',
    request: { who: 'Leo', text: 'My 7-year-old asked why the sky is blue. I need a bedtime-friendly answer.' },
    slots: [
      { key: 'role', cards: [
        { t: 'You are a fun science teacher for young kids.', ok: true },
        { t: 'You are a physics professor.',
          out: 'Rayleigh scattering intensity is inversely proportional to the fourth power of wavelength (I ∝ 1/λ⁴), therefore…',
          why: 'Accurate — but way over a 7-year-old’s head. Pick a role that fits the audience.' },
        { t: 'You are a pirate.',
          out: 'Arr! The sky be blue ’cause it be reflectin’ the sea, matey!',
          why: 'Fun voice, wrong answer! A playful role still needs to be the right expert.' },
      ]},
      { key: 'task', cards: [
        { t: 'Explain why the sky is blue.', ok: true },
        { t: 'Talk about the sky.',
          out: 'The sky contains clouds, birds, airplanes and, at night, the moon. Some people like the sky.',
          why: 'Too loose. Ask the actual question.' },
      ]},
      { key: 'context', cards: [
        { t: 'It’s for my 7-year-old at bedtime.', ok: true },
        { t: 'It’s for someone.',
          out: 'Dear Someone, the sky appears blue due to the preferential scattering of short wavelengths…',
          why: 'Who is it for? Age and setting change everything.' },
      ]},
      { key: 'format', cards: [
        { t: '3 short sentences with one simple comparison.', ok: true },
        { t: 'As long as possible.',
          out: '(Chapter 1 of 14: The Electromagnetic Spectrum…)',
          why: 'At bedtime? Short and simple works better. Say so.' },
      ]},
    ],
    good: 'Sunlight is secretly all the colors mixed together. When it zooms into our air, the blue light bounces around the most — like a bouncy ball in a tiny room! So wherever you look up, blue is bouncing back at you.',
    tip: 'Start with a role: “You are a …” that fits the task and the audience.',
  },

  /* 7 ─────────────────────────────────────────────── */
  {
    id: 'steps',
    title: 'Go Step by Step',
    principle: 'Break big jobs into steps — and let Wick ask.',
    teach: 'For big tasks, tell me how to work: ask you questions first, then go step by step. I’ll fill gaps instead of guessing.',
    request: { who: 'Nora', text: 'I want a weekend trip to a nearby city but I’m overwhelmed. I don’t even know where to start.' },
    slots: [
      { key: 'role', cards: [
        { t: 'You are an organized travel planner.', ok: true },
        { t: 'You are a poet.',
          out: 'O weekend, sweet escape of two short days, / Where shall thy wandering traveler stray…',
          why: 'Lovely, but no plan. Choose a role that does the job.' },
      ]},
      { key: 'task', cards: [
        { t: 'Help me plan a 2-day trip to a nearby city.', ok: true },
        { t: 'Plan my life.',
          out: 'Step 1: Become an astronaut. Step 2: Buy a lighthouse…',
          why: 'Scope it! Name the actual task.' },
      ]},
      { key: 'steps', cards: [
        { t: 'First ask me 3 quick questions, then build the plan step by step.', ok: true },
        { t: 'Do everything at once, don’t ask me anything.',
          out: 'Day 1: Fly to Tokyo. Day 2: Fly to Paris. Estimated budget: $14,000.',
          why: 'I had to guess your budget and travel style. Letting me ask first fills the gaps.' },
        { t: 'Surprise me.',
          out: 'Surprise! You are going camping. In January. On a mountain.',
          why: 'Surprises are risky for big plans. Give me a process to follow.' },
      ]},
      { key: 'format', cards: [
        { t: 'Give a simple Day 1 / Day 2 schedule.', ok: true },
        { t: 'One long paragraph.',
          out: 'So first you might want to think about where to go and then maybe consider what time and then also food, and after that perhaps…',
          why: 'A plan is easier to follow as a schedule. Ask for one.' },
      ]},
    ],
    good: 'First, 3 quick questions:\n1. Budget? → $300\n2. Car or train? → Train\n3. Food, nature or museums? → Food!\n\nDay 1: Train in by 10am → market food tour → sunset by the river\nDay 2: Bakery breakfast → cooking class → train home',
    tip: 'For big tasks: ask Wick to ask you questions first, then work step by step.',
  },

  /* 8 ─────────────────────────────────────────────── */
  {
    id: 'final',
    title: 'Final Exam',
    principle: 'Put it all together.',
    teach: 'Final exam! Role, task, context, format, limits and an example. Use everything you’ve learned.',
    request: { who: 'Omar', text: 'My family bakery launches a maple cinnamon roll this Friday. I need a social media post for our local customers.' },
    slots: [
      { key: 'role', cards: [
        { t: 'You are a social media writer for small food shops.', ok: true },
        { t: 'You are a lawyer.',
          out: 'NOTICE: Consumption of cinnamon rolls is at the consumer’s sole risk. Maple content may vary. All rights reserved.',
          why: 'Wrong expert for the job. Pick a role that writes this kind of thing.' },
      ]},
      { key: 'task', cards: [
        { t: 'Write a post announcing our new maple cinnamon roll.', ok: true },
        { t: 'Write about baking.',
          out: 'Baking dates back over 6,000 years to ancient Egypt, where early bakers…',
          why: 'Too broad. Say exactly what the post announces.' },
      ]},
      { key: 'context', cards: [
        { t: 'Small family bakery; launches this Friday; our customers are local families.', ok: true },
        { t: 'We want more sales.',
          out: 'BUY NOW!!! 50% OFF!!! LIMITED TIME ONLY!!!',
          why: 'I invented a discount you never offered! Give real facts, not just goals.' },
      ]},
      { key: 'format', cards: [
        { t: 'A short caption plus 3 hashtags.', ok: true },
        { t: 'A press release.',
          out: 'FOR IMMEDIATE RELEASE — Local Bakery Announces Strategic Expansion of Rolled Pastry Portfolio…',
          why: 'Wrong format for a social post. Say what you need.' },
      ]},
      { key: 'constraints', cards: [
        { t: 'Under 40 words, warm tone, mention Friday.', ok: true },
        { t: 'Make it go viral.',
          out: 'You WON’T BELIEVE what happened at this bakery 😱😱 (number 4 will SHOCK you)',
          why: '“Viral” isn’t a limit — it’s a wish. Set length and tone instead.' },
      ]},
      { key: 'example', cards: [
        { t: 'Match our last post: “Fresh from Grandma’s oven: lemon bars are back! 🍋 See you Saturday!”', ok: true },
        { t: '(No example.)',
          out: 'We are pleased to announce the availability of a new product offering at our establishment.',
          why: 'Correct but cold. An example shows me your friendly voice.' },
      ]},
    ],
    good: 'Fresh from our oven this Friday: the Maple Cinnamon Roll! 🍁 Gooey, warm, and made by our family for yours. Come early — they won’t last!\n#MapleMagic #LocalBakery #FreshFriday',
    tip: 'A great prompt: Role + Task + Context + Format + Limits + Example.',
  },
];
