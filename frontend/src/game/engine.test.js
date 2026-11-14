// Run with: npm test  (node's built-in runner; no test framework to install)
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FINGERS,
  FINGER_BY_CHAR,
  fingerFor,
  shiftFingerFor,
  needsShift,
  findTarget,
  pickToken,
  chooseX,
  tokenFontSize,
  wpm,
  accuracy,
  levelProgress,
  KEY_ROWS,
  tokenWidthPercent,
  fallTimeFor,
} from './engine.js'

test('every letter belongs to exactly one finger', () => {
  const seen = new Map()
  for (const finger of FINGERS) {
    for (const key of finger.keys) {
      assert.ok(!seen.has(key), `${key} is on both ${seen.get(key)} and ${finger.name}`)
      seen.set(key, finger.name)
    }
  }
  for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
    assert.ok(seen.has(letter), `${letter} has no finger`)
  }
})

test('home row is split between the hands the way a keyboard is drawn', () => {
  assert.equal(fingerFor('a').id, 'l-pinky')
  assert.equal(fingerFor('s').id, 'l-ring')
  assert.equal(fingerFor('d').id, 'l-middle')
  assert.equal(fingerFor('f').id, 'l-index')
  assert.equal(fingerFor('j').id, 'r-index')
  assert.equal(fingerFor('k').id, 'r-middle')
  assert.equal(fingerFor('l').id, 'r-ring')
  assert.equal(fingerFor(';').id, 'r-pinky')
})

test('g and h are the index fingers reaching inward', () => {
  assert.equal(fingerFor('g').id, 'l-index')
  assert.equal(fingerFor('h').id, 'r-index')
})

test('case does not change the finger, but does require shift', () => {
  assert.equal(fingerFor('A').id, fingerFor('a').id)
  assert.equal(needsShift('A'), true)
  assert.equal(needsShift('a'), false)
  assert.equal(needsShift(','), false)
})

test('shift is pressed by the opposite hand', () => {
  assert.equal(shiftFingerFor('a').id, 'r-pinky')
  assert.equal(shiftFingerFor('j').id, 'l-pinky')
  assert.equal(shiftFingerFor('K').id, 'l-pinky')
})

test('space has no finger of its own', () => {
  assert.equal(fingerFor(' '), null)
  assert.equal(shiftFingerFor(' '), null)
})

test('every on-screen key maps to a finger', () => {
  for (const row of KEY_ROWS) {
    for (const key of row) assert.ok(fingerFor(key), `no finger for ${key}`)
    // sanity: the keyboard shows letters in the order a player types them
  }
  assert.deepEqual(KEY_ROWS[1].slice(0, 4), ['a', 's', 'd', 'f'])
})

test('a keystroke hits the most urgent matching token', () => {
  const tokens = [
    { text: 'sad', typed: 0, y: 0.1 },
    { text: 'sit', typed: 0, y: 0.6 },
    { text: 'dog', typed: 0, y: 0.9 },
  ]
  assert.equal(findTarget(tokens, 's').text, 'sit')
  assert.equal(findTarget(tokens, 'd').text, 'dog')
  assert.equal(findTarget(tokens, 'z'), null)
})

test('the next expected character, not the first, decides a hit', () => {
  const tokens = [{ text: 'sad', typed: 1, y: 0.2 }]
  assert.equal(findTarget(tokens, 'a'), tokens[0])
  assert.equal(findTarget(tokens, 's'), null)
})

test('token placement stays inside the field and avoids crowding', () => {
  const positions = new Set()
  for (let i = 0; i < 200; i += 1) {
    const x = chooseX('word', [])
    assert.ok(x >= 0 && x <= 100, `x out of range: ${x}`)
    positions.add(x.toFixed(3))
  }
  assert.ok(positions.size > 100, 'placement is not varied')

  // With a token already sitting at 0, a new long token should prefer elsewhere.
  let clear = 0
  for (let i = 0; i < 100; i += 1) {
    if (chooseX('a fairly long phrase here', [0]) > 20) clear += 1
  }
  assert.ok(clear > 70, `only ${clear}/100 spawns avoided an occupied lane`)
})

test('fall time grows with the token and matches the level promise', () => {
  const letterLevel = { fall_seconds: 9, seconds_per_char: 0 }
  assert.equal(fallTimeFor(letterLevel, 'a'), 9)

  const quoteLevel = { fall_seconds: 24, seconds_per_char: 0.75 }
  assert.equal(fallTimeFor(quoteLevel, 'a'), 24)
  assert.equal(fallTimeFor(quoteLevel, 'ab'), 24.75)
  // A 55-character quote must outlast a one-letter token by its own length.
  assert.ok(fallTimeFor(quoteLevel, 'x'.repeat(55)) > 2 * fallTimeFor(quoteLevel, 'a'))
})

test('a token never starts so far right that it runs off the field', () => {
  // The real contract: x plus the token's own width share never exceeds 100%.
  for (const text of ['a', 'word', 'a short phrase', 'x'.repeat(65), 'x'.repeat(200)]) {
    const width = tokenWidthPercent(text)
    for (let i = 0; i < 50; i += 1) {
      const x = chooseX(text, [])
      assert.ok(x + width <= 100.001, `${text.length}-char token starts at ${x} + ${width}`)
    }
  }
})

test('the width estimate grows with the token and is capped', () => {
  assert.ok(tokenWidthPercent('a short phrase') > tokenWidthPercent('a'))
  assert.equal(tokenWidthPercent('x'.repeat(200)), 88)
  assert.equal(tokenWidthPercent('x'), 10)
})

test('tokens are drawn from the bank and avoid repeats where possible', () => {
  const bank = ['a', 'b', 'c']
  for (let i = 0; i < 50; i += 1) {
    assert.ok(bank.includes(pickToken(bank, ['a'])))
  }
  assert.notEqual(pickToken(['a', 'b'], ['a'], () => 0), 'a')
  // A one-entry bank still returns something when its only entry is on screen.
  assert.equal(pickToken(['a'], ['a'], () => 0), 'a')
})

test('font size shrinks as the token grows', () => {
  const sizes = ['a', 'hello', 'short words', 'a full sentence of several words', 'x'.repeat(90)].map((t) =>
    parseFloat(tokenFontSize(t)),
  )
  for (let i = 1; i < sizes.length; i += 1) assert.ok(sizes[i] <= sizes[i - 1], 'size is not monotonic')
})

test('wpm uses the five-characters-per-word convention', () => {
  // 100 correct chars in one minute == 20 words per minute
  assert.equal(wpm(100, 60_000), 20)
  assert.equal(wpm(100, 30_000), 40)
  assert.equal(wpm(100, 0), 0)
})

test('accuracy handles the empty and perfect cases', () => {
  assert.equal(accuracy(0, 0), 0)
  assert.equal(accuracy(10, 10), 1)
  assert.equal(accuracy(5, 10), 0.5)
})

test('level progress clamps between 0 and 1', () => {
  assert.equal(levelProgress(0, 20), 0)
  assert.equal(levelProgress(10, 20), 0.5)
  assert.equal(levelProgress(25, 20), 1)
  assert.equal(levelProgress(5, 0), 0)
})

test('the finger map covers uppercase through fingerFor only', () => {
  assert.equal(FINGER_BY_CHAR.A, undefined)
  assert.equal(fingerFor('A').id, fingerFor('a').id)
})