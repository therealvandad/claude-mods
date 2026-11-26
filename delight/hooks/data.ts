// Hand-written content for the delight mod: cookies, soundtrack ideas, the tour,
// the wardrobe and the easter eggs. Nothing here touches the engine.

export const VERSION = '0.1.0'

// ------------------------------------------------------------------ cookies

export const COOKIES: readonly string[] = [
  'A bug you can explain out loud is a bug you have half fixed.',
  'The best commit message answers why, not what.',
  'Rest is part of the build. Close the lid at a good stopping point.',
  'Delete the code you are afraid to delete, and keep the tests that tell you it is safe.',
  'Name things for the reader who arrives tired.',
  'A walk solves more bugs than a fourth rewrite.',
  'Make it work, make it right, make it small, then make it lunch.',
  'The first error message is usually honest. The fifth is usually noise.',
  'Sleep is a debugger that runs in the background.',
  'Small diffs are easier to love than big ones.',
  'When two fixes seem equally good, pick the one you can undo.',
  'Read the failing line twice before you read anything else once.',
  'Your future self is a stranger who has your keyboard.',
  'Drink some water. The code will still be there.',
  'A test you have never seen fail is a test you cannot yet trust.',
  'Premature abstraction is a loan with a hidden interest rate.',
  'If it took an hour to find, spend two minutes on a comment.',
  'Done does not mean nobody can break it. It means you know how it breaks.',
  'Climb the problem one stair at a time: one step per commit.',
  'Stand up when you are stuck. The problem does not need your spine.',
  'Ask the rubber duck. The duck has never once been wrong about being confused.',
  'Fast code that is wrong is just a quick way to be wrong.',
  'A good pause beats a bad hour.',
  'Rename it until the comment is unnecessary.',
  'The bug is in the part you did not look at because you were sure.',
  'One thing at a time is faster than three things at once, every time.',
  'Let the build run. Look out of the window.',
  'Boring technology gives you interesting weekends.',
  'If production is on fire, revert first and understand second.',
  'Your tired brain writes tomorrow\u2019s bugs. Stop at a green test.',
  'Write the failing test, then the smallest code that quiets it.',
  'Not every warning deserves a fix, but every warning deserves a glance.',
  'Be kind in review. The author has already argued with the code.',
  'Lunch is a legitimate step in the pipeline.',
  'A TODO with a date gets done. A TODO without one is a poem.',
  'Write what you will not do in the ticket. It saves the argument later.',
  'Keep one hand on the problem and one on the undo button.',
  'If the plan needs a diagram, draw the diagram first.',
  'The log line you skip is the one that explains it.',
  'Hours are not output. Finished things are output.',
  'Take the compliment, then pay it forward in a code review.',
  'Fix the cause when you can, the symptom when you must, and note which one you did.',
  'Short functions rest the eyes.',
  'Do not guess. Print the value.',
  'A long weekend is the best refactoring tool ever shipped.',
  'Be lazy in the good way: automate what you did three times.',
  'Everyone is a beginner at the thing they are doing today.',
  'Stretch your wrists before they ask you to.',
  'Look away from the screen every twenty minutes: twenty seconds, twenty feet.',
  'Prefer a clear name over a clever one. Clever ages worse than milk.',
  'When the build is red, make it green before you make it pretty.',
  'A question asked early is cheaper than a rewrite asked late.',
  'The simplest design that passes the tests is not an insult.',
  'You are allowed to leave the hard part for tomorrow morning.',
  'Back up before the experiment, not after the surprise.',
  'Celebrate the deletion that made the diff negative.',
  'Breathe in before the merge conflict, and out after it.',
  'Ship small, learn big, rest well.',
  'A clean desk will not fix the bug, but the tea might help.',
  'The best time to stop is when you know exactly what to do next.',
]

// --------------------------------------------------------------- soundtrack

export type Mood = 'focus' | 'calm' | 'late' | 'upbeat'
export const MOODS: readonly Mood[] = ['focus', 'calm', 'late', 'upbeat']

export type Track = { mood: Mood; name: string; note: string }

// Text only. The mod plays nothing and links to nothing; search for the name in any player.
export const SOUNDTRACKS: readonly Track[] = [
  { mood: 'focus', name: 'Brown noise', note: 'a deep, even hush that covers office chatter' },
  { mood: 'focus', name: 'Lo-fi beats without vocals', note: 'steady, mellow, easy to forget about' },
  { mood: 'focus', name: 'Library room tone', note: 'pages, a far-off cough, nothing urgent' },
  { mood: 'focus', name: 'Minimal piano', note: 'slow single notes, lots of space between them' },
  { mood: 'calm', name: 'Rain on a window', note: 'soft and close, good for long reads of logs' },
  { mood: 'calm', name: 'Forest at dawn', note: 'birds, a little wind, no melody' },
  { mood: 'calm', name: 'Ocean waves', note: 'slow in and out, a natural metronome' },
  { mood: 'calm', name: 'Fireplace crackle', note: 'warm and irregular, nice in winter' },
  { mood: 'late', name: 'Distant thunderstorm', note: 'low rumbles far away, cozy for night sessions' },
  { mood: 'late', name: 'Night train', note: 'a steady rattle and the odd announcement' },
  { mood: 'late', name: 'Ambient drones', note: 'long slow pads, almost no rhythm' },
  { mood: 'upbeat', name: 'Synthwave instrumentals', note: 'driving but wordless, good for a push to the finish' },
  { mood: 'upbeat', name: 'Jazz cafe', note: 'light brushes and a walking bass' },
  { mood: 'upbeat', name: 'Video game soundtracks', note: 'written to be played under concentration' },
]

// ---------------------------------------------------------------------- tour

export type TourStep = { cmd: string; title: string; body: string }

export const TOUR: readonly TourStep[] = [
  {
    cmd: '/cockpit',
    title: 'The cockpit',
    body: 'One pane with tabs: session overview, tool timeline, edited files, todos, prompt history, errors, links and a command palette.',
  },
  {
    cmd: '/anim lab',
    title: 'The animation lab',
    body: 'A pane that shows each small animation on its own, so you can see what they do before you rely on them.',
  },
  {
    cmd: '/look',
    title: 'Looks',
    body: 'Opt-in colour palettes (paper, nord, solarized, sepia and more). Nothing changes until you pick one, and /look off goes back.',
  },
  {
    cmd: '/sound',
    title: 'Sound packs',
    body: 'Retro, wood or glass chimes for finished turns, errors and questions. Quiet hours and a silent pack are included.',
  },
  {
    cmd: '/pet',
    title: 'The pet',
    body: 'A tiny pane pet that reacts to your session. It belongs to the personality mod and needs /fun on.',
  },
  {
    cmd: '/motion',
    title: 'The motion switch',
    body: 'One global switch for every animation in every mod. /motion off makes the interface hold still.',
  },
  {
    cmd: '/cheats',
    title: 'The cheat sheet',
    body: 'Every slash command the mods add, as buttons that fill the prompt box. Your way back to anything you forget.',
  },
]

// ------------------------------------------------------------------ wardrobe

export type Counter = 'tools' | 'days' | 'edits' | 'commits' | 'testsPassed'

export type Accessory = {
  id: string
  name: string
  counter: Counter
  need: number
  // Lines drawn above, over and under the plain face (see petPreview in logic.ts).
  top: string[]
  face: string
  bottom: string
}

export const COUNTER_LABEL: Record<Counter, string> = {
  tools: 'tool calls',
  days: 'active days',
  edits: 'file edits',
  commits: 'commits',
  testsPassed: 'passing test runs',
}

export const WARDROBE: readonly Accessory[] = [
  { id: 'cap', name: 'Tiny cap', counter: 'tools', need: 50, top: ['   ____'], face: ' ( o.o )', bottom: '  > ^ <' },
  { id: 'glasses', name: 'Round glasses', counter: 'tools', need: 200, top: [], face: ' (8.8 )', bottom: '  > ^ <' },
  { id: 'scarf', name: 'Cosy scarf', counter: 'days', need: 7, top: [], face: ' ( o.o )', bottom: ' >~~~~<' },
  { id: 'phones', name: 'Headphones', counter: 'commits', need: 5, top: ['  .---.'], face: '(( o.o ))', bottom: '  > ^ <' },
  { id: 'bowtie', name: 'Bow tie', counter: 'testsPassed', need: 10, top: [], face: ' ( o.o )', bottom: '  >>X<<' },
  { id: 'wizard', name: 'Wizard hat', counter: 'edits', need: 100, top: ['    /\\', '   /__\\'], face: ' ( o.o )', bottom: '  > ^ <' },
  { id: 'crown', name: 'Small crown', counter: 'tools', need: 1000, top: ['  \\^v^/'], face: ' ( o.o )', bottom: '  > ^ <' },
]

// ---------------------------------------------------------------- easter eggs

export type Egg = { word: string; art: string; hint: string }

export const EGGS: readonly Egg[] = [
  {
    word: 'xyzzy',
    art: '  (\\_/)  (=\'.\'=)  (")_(")   Nothing happens.',
    hint: 'A magic word from a very old cave adventure.',
  },
  {
    word: 'plugh',
    art: '  ~ ~ ~ ~ ~ ~   a hollow voice says "plugh"   ~ ~ ~ ~ ~ ~',
    hint: 'Its twin from the same cave, five letters, starts with p.',
  },
  {
    word: 'quack',
    art: '   <(\')___   tell the duck what the bug is   ___(\')>',
    hint: 'What the debugging companion on your desk says.',
  },
  {
    word: 'sudo',
    art: '  [ sudo make me a sandwich ]  ->  okay.   ( )=( )   =[:::]=',
    hint: 'Four letters, the shell word that settles any argument.',
  },
  {
    word: 'meow',
    art: '   /\\_/\\    ( o.o )    > ^ <     purr purr, the build is green',
    hint: 'What the cat on the keyboard contributes.',
  },
]
