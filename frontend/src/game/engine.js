// Pure game helpers — no React, no DOM. Everything here is deterministic given
// its inputs so the tricky parts (finger mapping, target selection) can be read
// and tested on their own.

// The eight fingers, in the order they sit on the keyboard, each with the keys it
// owns. Colours are the validated dark categorical steps and are never the only
// cue: the keyboard always shows the letter, and the legend names the finger.
export const FINGERS = [
  { id: 'l-pinky', name: 'Left pinky', keys: '`1qaz', color: '#3987e5' },
  { id: 'l-ring', name: 'Left ring', keys: '2wsx', color: '#d95926' },
  { id: 'l-middle', name: 'Left middle', keys: '3edc', color: '#199e70' },
  { id: 'l-index', name: 'Left index', keys: '45rtfgvb', color: '#c98500' },
  { id: 'r-index', name: 'Right index', keys: '67yuhjnm', color: '#d55181' },
  { id: 'r-middle', name: 'Right middle', keys: '8ik,', color: '#008300' },
  { id: 'r-ring', name: 'Right ring', keys: '9ol.', color: '#9085e9' },
  { id: 'r-pinky', name: 'Right pinky', keys: "0p;/'-=[]\\", color: '#e66767' },
]

export const FINGER_BY_CHAR = (() => {
  const map = {}
  for (const finger of FINGERS) {
    for (const key of finger.keys) map[key] = finger
  }
  return map
})()

export const FINGER_BY_ID = Object.fromEntries(FINGERS.map((f) => [f.id, f]))

/** The finger that should press `char`, or null for space (either thumb). */
export function fingerFor(char) {
  if (!char) return null
  const lower = char.toLowerCase()
  return FINGER_BY_CHAR[lower] || null
}

/** Shift is held by the pinky of the hand that does not type the letter. */
export function shiftFingerFor(char) {
  const finger = fingerFor(char)
  if (!finger) return null
  return FINGER_BY_ID[finger.id.startsWith('l-') ? 'r-pinky' : 'l-pinky']
}

export const KEY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
]

export function needsShift(char) {
  return !!char && char !== char.toLowerCase() && char.toLowerCase() !== char.toUpperCase()
}

/**
 * Which token a keystroke hits.
 *
 * Several tokens can start with the same letter, so the rule is: among tokens
 * whose next expected character matches, take the one closest to the floor —
 * that is the one most urgent, and the choice a player would make anyway.
 * Returns null when nothing matches.
 */
export function findTarget(tokens, char) {
  let best = null
  for (const token of tokens) {
    if (token.text[token.typed] !== char) continue
    if (best === null || token.y > best.y) best = token
  }
  return best
}

/** Every character still needed on screen, for the "next key" hint. */
export function nextChars(tokens) {
  return tokens.map((t) => t.text[t.typed]).filter(Boolean)
}

/** Font size steps down as tokens get longer so a full quote still fits a lane. */
export function tokenFontSize(text) {
  const len = text.length
  if (len <= 1) return '2.1rem'
  if (len <= 5) return '1.45rem'
  if (len <= 12) return '1.15rem'
  if (len <= 24) return '0.95rem'
  return '0.84rem'
}

/**
 * Horizontal placement, as a percentage of the free track.
 *
 * Short tokens are scattered; long ones are centred and stacked slightly, since
 * two full-width phrases side by side would overlap. `occupied` holds the x of
 * tokens still near the top, so spawns do not land on top of each other.
 */
export function chooseX(text, occupied, random = Math.random) {
  // Rough share of the track the token needs, capped at 88% so even the longest
  // quote still starts near the left edge instead of hanging off the right.
  const widthHint = tokenWidthPercent(text)
  const free = 100 - widthHint

  let bestX = free * random()
  let bestGap = -1
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = free * random()
    const gap = occupied.reduce(
      (min, x) => Math.min(min, Math.abs(x - candidate)),
      Number.POSITIVE_INFINITY,
    )
    if (gap > bestGap) {
      bestGap = gap
      bestX = candidate
    }
    if (gap > widthHint * 0.7) break
  }
  return bestX
}

/**
 * Seconds this token takes to fall the field height.
 *
 * A 55-character quote needs far more time than a single letter, so the level's
 * base time is extended per character. This is the same formula the level panel
 * shows ("Falling speed"), so the promise matches the game.
 */
export function fallTimeFor(level, text) {
  const perChar = level.seconds_per_char || 0
  return level.fall_seconds + perChar * Math.max(0, text.length - 1)
}

/** Share of the track a token of this length occupies, in percent. */
export function tokenWidthPercent(text) {
  return Math.min(88, Math.max(10, text.length * 0.72))
}

/** Draw a token from the level bank, avoiding an immediate repeat when possible. */
export function pickToken(bank, onScreenTexts = [], random = Math.random) {
  const fresh = bank.filter((t) => !onScreenTexts.includes(t))
  const pool = fresh.length > 0 ? fresh : bank
  return pool[Math.floor(random() * pool.length)]
}

export function accuracy(correctChars, keystrokes) {
  if (!keystrokes) return 0
  return correctChars / keystrokes
}

export function wpm(correctChars, durationMs) {
  if (durationMs <= 0) return 0
  return correctChars / 5 / (durationMs / 60000)
}

/** Progress toward the level goal, 0..1. */
export function levelProgress(destroyed, target) {
  if (target <= 0) return 0
  return Math.min(1, destroyed / target)
}