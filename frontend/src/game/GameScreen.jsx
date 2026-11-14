import { useCallback, useEffect, useRef, useState } from 'react'
import {
  KEY_ROWS,
  fingerFor,
  needsShift,
  chooseX,
  pickToken,
  findTarget,
  tokenFontSize,
  fallTimeFor,
} from './engine.js'
import { sfx, setMuted, isMuted } from './audio.js'

const BURST_MS = 480
// A token is missed here, as a fraction of the field height. The floor line in
// styles.css is drawn at the same offset (see .field::after). `y` is already a
// fraction of the field, so positions use it directly — scaling it again here
// would make tokens vanish above the floor and fall slower than configured.
export const MAX_SEGMENT = 0.9

function makeToken(text, occupied, level) {
  return {
    id: `${text}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    typed: 0,
    x: chooseX(text, occupied),
    y: 0,
    // Per token, not per level: a quote falls for far longer than a letter.
    speed: 1 / fallTimeFor(level, text),
    bornAt: performance.now(),
  }
}

export default function GameScreen({ level, onExit, onFinish, playerName }) {
  const [status, setStatus] = useState('ready') // ready | playing | paused | won | lost
  const [frame, setFrame] = useState(0)
  const [lastKey, setLastKey] = useState(null) // {char, ok, at}
  const [bursts, setBursts] = useState([])
  const [muted, setMutedState] = useState(isMuted())

  // The whole run lives in a ref: the animation loop mutates it 60x a second and
  // asks React to repaint, so no state update ever depends on a stale closure.
  const game = useRef(null)
  const raf = useRef(0)
  const lastTs = useRef(0)
  // Guards the results submit: one POST per finished run, and reset on start().
  const submitted = useRef(null)

  const reset = useCallback(() => {
    game.current = {
      tokens: [],
      lives: level.lives,
      destroyed: 0,
      spawned: 0,
      keystrokes: 0,
      correctChars: 0,
      errors: 0,
      combo: 0,
      maxCombo: 0,
      nextSpawnAt: 0,
      startedAt: 0,
      // Time spent paused is excluded from the run duration: WPM must measure
      // typing, not how long the player stepped away.
      pausedAt: 0,
      pausedMs: 0,
      elapsedMs: 0,
    }
    setBursts([])
    setLastKey(null)
  }, [level])

  useEffect(() => {
    reset()
    setStatus('ready')
  }, [reset])

  // ---------------------------------------------------------------- animation
  useEffect(() => {
    if (status !== 'playing') return undefined

    const step = (ts) => {
      const g = game.current
      if (!g) return
      // One clock for the whole run. rAF's argument is the same time origin in a
      // browser, but reading performance.now() here keeps the spawn schedule and
      // the duration comparable with the timestamps start() writes.
      const now = performance.now()
      if (!lastTs.current) lastTs.current = now
      const dt = Math.min(0.05, (now - lastTs.current) / 1000) // clamp after a tab switch
      lastTs.current = now

      g.elapsedMs = now - g.startedAt

      let escaped = 0
      const survivors = []
      for (const token of g.tokens) {
        token.y += token.speed * dt
        if (token.y >= MAX_SEGMENT) {
          escaped += 1
        } else {
          survivors.push(token)
        }
      }
      g.tokens = survivors

      if (escaped > 0) {
        g.lives = Math.max(0, g.lives - escaped)
        g.combo = 0
        sfx.hurt()
      }

      if (g.lives <= 0) {
        setStatus('lost')
        sfx.lose()
        return
      }

      if (g.destroyed >= level.target_count) {
        setStatus('won')
        sfx.win()
        return
      }

      // Spawn on schedule, but never stack a token on one that just launched.
      const crowded = g.tokens.some((t) => t.y < 0.07)
      if (
        now >= g.nextSpawnAt &&
        g.tokens.length < level.max_on_screen &&
        g.spawned < level.target_count &&
        !crowded
      ) {
        const text = pickToken(level.bank, g.tokens.map((t) => t.text))
        const occupied = g.tokens.map((t) => t.x)
        g.tokens.push(makeToken(text, occupied, level))
        g.spawned += 1
        g.nextSpawnAt = now + level.spawn_interval * 1000
      }

      setFrame((f) => f + 1)
      raf.current = requestAnimationFrame(step)
    }

    lastTs.current = 0
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [status, level])

  // Bursts are cosmetic; drop them once their animation has finished.
  useEffect(() => {
    if (bursts.length === 0) return undefined
    const id = setTimeout(() => {
      const cutoff = performance.now() - BURST_MS
      setBursts((list) => list.filter((b) => b.at > cutoff))
    }, BURST_MS)
    return () => clearTimeout(id)
  }, [bursts])

  // -------------------------------------------------------------------- input
  const pause = useCallback(() => {
    const g = game.current
    if (g && !g.pausedAt) g.pausedAt = performance.now()
    setStatus('paused')
  }, [])

  const resume = useCallback(() => {
    const g = game.current
    if (g && g.pausedAt) {
      const pausedFor = performance.now() - g.pausedAt
      g.pausedMs += pausedFor
      // Anything scheduled for "N ms from now" slides by the pause as well.
      g.nextSpawnAt += pausedFor
      g.pausedAt = 0
    }
    // Drops the stale timestamp so a long pause does not dump one huge frame.
    lastTs.current = 0
    setStatus('playing')
  }, [])

  const start = useCallback(() => {
    const g = game.current
    if (!g) return
    reset()
    submitted.current = null
    const now = performance.now()
    game.current.startedAt = now
    game.current.nextSpawnAt = now + 350
    lastTs.current = 0
    setStatus('playing')
  }, [reset])

  const finish = useCallback(
    (cleared) => {
      const g = game.current
      if (!g) return
      const duration = Math.max(1000, Math.round(g.elapsedMs - g.pausedMs))
      onFinish({
        level_id: level.id,
        correct_chars: g.correctChars,
        keystrokes: g.keystrokes,
        errors: g.errors,
        max_combo: g.maxCombo,
        tokens_destroyed: g.destroyed,
        lives_left: g.lives,
        cleared,
        duration_ms: duration,
      })
    },
    [level.id, onFinish],
  )

  const handleKey = useCallback(
    (event) => {
      const g = game.current
      if (!g || status !== 'playing') return

      // Let the browser keep its own shortcuts (Ctrl+R, Cmd+W, DevTools, …).
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key.length !== 1) return

      const char = event.key
      if (char === ' ' || char === "'" || char === '/' || char === ';') {
        event.preventDefault()
      }
      if (event.repeat) return

      g.keystrokes += 1
      const target = findTarget(g.tokens, char)

      if (target) {
        g.correctChars += 1
        g.combo += 1
        g.maxCombo = Math.max(g.maxCombo, g.combo)
        target.typed += 1
        if (target.typed >= target.text.length) {
          g.tokens = g.tokens.filter((t) => t.id !== target.id)
          g.destroyed += 1
          sfx.explode(g.combo)
          setBursts((list) => [...list, { id: target.id, x: target.x, y: target.y, at: performance.now(), combo: g.combo }])
        } else {
          sfx.hit()
        }
        setLastKey({ char, ok: true, at: performance.now() })
      } else {
        g.errors += 1
        g.combo = 0
        sfx.miss()
        setLastKey({ char, ok: false, at: performance.now() })
      }
      setFrame((f) => f + 1)
    },
    [status],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  // Enter/Space starts and Escape pauses — the game itself must not swallow these
  // before it has started, or the first keystroke of a run would get eaten.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Enter' && status === 'ready') {
        event.preventDefault()
        start()
        return
      }
      if (event.key === 'Escape' && status === 'playing') {
        pause()
        return
      }
      if (event.key === 'Enter' && status === 'paused') {
        event.preventDefault()
        resume()
        return
      }
      if (event.key === 'Escape' && status === 'paused') resume()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, start, resume, pause])

  // Leaving the tab must not let tokens fall unseen.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && status === 'playing') pause()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [status, pause])

  // Submit exactly once per finished run. onFinish is called from an effect so
  // the results never depend on the animation frame that ended the game.
  useEffect(() => {
    if (status !== 'won' && status !== 'lost') return
    const cleared = status === 'won'
    if (submitted.current === cleared) return
    submitted.current = cleared
    finish(cleared)
  }, [status, finish])

  const toggleMute = () => {
    setMuted(muted)
    setMutedState(!muted)
  }

  const g = game.current
  const accuracyPct = g && g.keystrokes ? Math.round((g.correctChars / g.keystrokes) * 100) : 100
  const wpmNow = g && g.elapsedMs > 0 ? (g.correctChars / 5 / (g.elapsedMs / 60000)).toFixed(0) : '0'
  const progress = g ? Math.min(1, g.destroyed / level.target_count) : 0
  // Recomputed every frame: which keys are needed right now, and which of them
  // need Shift. This is the whole "guide" — no memorising a keyboard chart.
  const activeKeys = { keys: new Set(), shift: new Set() }
  for (const token of g?.tokens || []) {
    const ch = token.text[token.typed]
    if (!ch) continue
    activeKeys.keys.add(ch.toLowerCase())
    if (needsShift(ch)) activeKeys.shift.add(ch.toLowerCase())
  }
  void frame // consuming the tick keeps the repaint intentional

  return (
    <div className="game">
      <header className="hud">
        <button className="btn btn-ghost" onClick={onExit} title="Back to levels">
          ← Levels
        </button>

        <div className="hud-level">
          <span className="hud-eyebrow">Level {level.id}</span>
          <h1>{level.title}</h1>
        </div>

        <div className="hud-stats">
          <HudStat label="Goal" value={`${g?.destroyed || 0}/${level.target_count}`} />
          <HudStat label="Combo" value={g?.combo || 0} accent={g?.combo >= 5} />
          <HudStat label="WPM" value={wpmNow} />
          <HudStat label="Accuracy" value={`${accuracyPct}%`} />
          <Lives count={g?.lives ?? level.lives} max={level.lives} />
        </div>

        <button className="btn btn-ghost icon-btn" onClick={toggleMute} aria-pressed={!muted}>
          {muted ? 'Sound off' : 'Sound on'}
        </button>
      </header>

      <div className="goal-meter" role="progressbar" aria-valuemin={0} aria-valuemax={level.target_count} aria-valuenow={g?.destroyed || 0}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>

      <div
        className={`field ${status === 'paused' ? 'field-paused' : ''}`}
        style={{ '--floor': `${MAX_SEGMENT * 100}%` }}
      >
        <div className="field-grid" aria-hidden="true" />
        {(status === 'playing' || status === 'paused') &&
          g?.tokens.map((token) => (
            <Token key={token.id} token={token} />
          ))}

        {bursts.map((b) => (
          <span
            key={b.id}
            className={`burst ${b.combo >= 10 ? 'burst-big' : ''}`}
            style={{ left: `${b.x}%`, top: `${b.y * 100}%` }}
            aria-hidden="true"
          />
        ))}

        {status !== 'playing' && (
          <Overlay
            status={status}
            level={level}
            stats={{ destroyed: g?.destroyed || 0, maxCombo: g?.maxCombo || 0, accuracyPct, wpm: wpmNow, lives: g?.lives ?? level.lives }}
            playerName={playerName}
            onStart={start}
            onResume={resume}
            onExit={onExit}
          />
        )}
      </div>

      <Keyboard keys={activeKeys.keys} shift={activeKeys.shift} lastKey={lastKey} />

      <p className="field-hint">
        Type the glowing key. A token that reaches the bottom costs a life. Press
        <kbd>Esc</kbd> to pause.
      </p>
    </div>
  )
}

function HudStat({ label, value, accent }) {
  return (
    <div className={`hud-stat ${accent ? 'is-hot' : ''}`}>
      <span className="hud-stat-label">{label}</span>
      <span className="hud-stat-value">{value}</span>
    </div>
  )
}

function Lives({ count, max }) {
  return (
    <div className="hud-lives" aria-label={`${count} of ${max} lives left`}>
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={`pip ${i < count ? 'pip-on' : ''}`} />
      ))}
    </div>
  )
}

function Token({ token }) {
  const next = token.text[token.typed]
  const finger = fingerFor(next)
  const typedPart = token.text.slice(0, token.typed)
  const rest = token.text.slice(token.typed)
  const urgent = token.y > 0.68

  return (
    <div
      className={`token ${urgent ? 'token-urgent' : ''}`}
      style={{
        left: `${token.x}%`,
        top: `${token.y * 100}%`,
        '--ring': finger ? finger.color : '#8b93a1',
        fontSize: tokenFontSize(token.text),
      }}
    >
      <span className="token-typed">{typedPart}</span>
      <span className="token-next">{rest.slice(0, 1)}</span>
      <span className="token-rest">{rest.slice(1)}</span>
    </div>
  )
}

function Overlay({ status, level, stats, playerName, onStart, onResume, onExit }) {
  if (status === 'ready') {
    return (
      <div className="overlay">
        <div className="panel">
          <p className="eyebrow">Level {level.id}</p>
          <h2>{level.title}</h2>
          <p className="panel-sub">{level.subtitle}</p>

          <div className="panel-facts">
            <div>
              <span>Goal</span>
              <strong>{level.target_count} targets</strong>
            </div>
            <div>
              <span>Falling speed</span>
              <strong>
                {level.seconds_per_char
                  ? `${Math.round(level.fall_seconds)}s + ${level.seconds_per_char}s per letter`
                  : `${level.fall_seconds}s to the floor`}
              </strong>
            </div>
            <div>
              <span>Lives</span>
              <strong>{level.lives}</strong>
            </div>
          </div>

          <p className="panel-note">
            {playerName
              ? `Playing as ${playerName}.`
              : 'Playing as Guest. Sign in to have your scores attributed to you.'}
          </p>

          <div className="panel-actions">
            <button className="btn btn-primary" onClick={onStart} autoFocus>
              Start {level.mode === 'letter' ? 'drill' : 'run'} ⏎
            </button>
            <button className="btn btn-ghost" onClick={onExit}>
              Levels
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'paused') {
    return (
      <div className="overlay">
        <div className="panel panel-compact">
          <p className="eyebrow">Paused</p>
          <h2>The clock is stopped</h2>
          <p className="panel-sub">Press Esc to resume. Leaving the tab also pauses.</p>
          <div className="panel-actions">
            <button className="btn btn-primary" onClick={onResume}>
              Resume ⏎
            </button>
            <button className="btn btn-ghost" onClick={onExit}>
              Quit to levels
            </button>
          </div>
        </div>
      </div>
    )
  }

  // A finished run unmounts this screen (App shows the results), so there is no
  // "won/lost" overlay to draw here.
  return null
}

function Keyboard({ keys, shift, lastKey }) {
  return (
    <section className="keyboard" aria-label="Keyboard guide">
      {KEY_ROWS.map((row, i) => (
        <div className={`kb-row kb-row-${i}`} key={i}>
          {i === 1 && <span className="kb-spacer" />}
          {row.map((key) => {
            const finger = fingerFor(key)
            const active = keys.has(key)
            return (
              <span
                key={key}
                className={`kb-key ${active ? 'kb-active' : ''}`}
                style={{ '--finger': finger ? finger.color : '#6b7280' }}
              >
                {key}
              </span>
            )
          })}
          {i === 1 && <span className="kb-spacer" />}
        </div>
      ))}
      <div className="kb-row">
        <span className={`kb-key kb-space ${keys.has(' ') ? 'kb-active' : ''}`}>space</span>
      </div>

      <div className="kb-legend">
        <span className={`kb-shift ${shift.size ? 'kb-shift-on' : ''}`}>
          <kbd>Shift</kbd> {shift.size ? 'needed now' : 'not needed'}
        </span>
        <span className="kb-last">
          {lastKey ? (lastKey.ok ? `hit ${lastKey.char}` : `missed ${lastKey.char}`) : '—'}
        </span>
      </div>
    </section>
  )
}