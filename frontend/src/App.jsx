import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import GameScreen from './game/GameScreen.jsx'

const STORAGE_NAME = 'keyfall.displayName'

// How far a player has unlocked. Stored locally because it is a convenience, not
// a record: the server keeps the scores, and any level can be replayed anyway.
const STORAGE_UNLOCKED = 'keyfall.unlocked'

function readUnlocked() {
  const raw = Number(localStorage.getItem(STORAGE_UNLOCKED))
  return Number.isFinite(raw) && raw >= 1 ? Math.min(10, raw) : 1
}

export default function App() {
  const [levels, setLevels] = useState(null)
  const [me, setMe] = useState(null)
  const [unlocked, setUnlocked] = useState(readUnlocked)
  const [view, setView] = useState({ name: 'menu' }) // menu | game | results
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api.me())
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [levelData] = await Promise.all([api.levels(), refreshMe()])
        if (!cancelled) setLevels(levelData.levels)
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshMe])

  const playerName =
    me?.signed_in && me.display_name && me.display_name !== 'Guest' ? me.display_name : null

  const finishRun = useCallback(
    async (stats) => {
      try {
        const saved = await api.submitScore(stats)
        setResult({ ...saved, levelId: stats.level_id })
        if (stats.cleared) {
          const next = Math.min(10, Math.max(unlocked, stats.level_id + 1))
          setUnlocked(next)
          localStorage.setItem(STORAGE_UNLOCKED, String(next))
        }
        refreshMe()
      } catch (err) {
        // A failed save must not hide the run: show the numbers and say so.
        setResult({ error: err.message, levelId: stats.level_id, stats })
      }
      setView({ name: 'results' })
    },
    [unlocked, refreshMe],
  )

  if (error && !levels) {
    return (
      <main className="shell">
        <div className="panel">
          <p className="eyebrow eyebrow-bad">Could not load</p>
          <h2>The game did not start</h2>
          <p className="panel-sub">{error}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </main>
    )
  }

  if (!levels) {
    return (
      <main className="shell">
        <p className="loading">Loading levels…</p>
      </main>
    )
  }

  if (view.name === 'game') {
    const level = levels.find((l) => l.id === view.levelId)
    return (
      <GameScreen
        key={level.id}
        level={level}
        playerName={playerName}
        onExit={() => setView({ name: 'menu' })}
        onFinish={finishRun}
      />
    )
  }

  if (view.name === 'results') {
    return (
      <Results
        result={result}
        levels={levels}
        onReplay={() => setView({ name: 'game', levelId: result.levelId })}
        onMenu={() => setView({ name: 'menu' })}
        onNext={(id) => setView({ name: 'game', levelId: id })}
      />
    )
  }

  return (
    <Menu
      levels={levels}
      me={me}
      playerName={playerName}
      unlocked={unlocked}
      onPlay={(id) => setView({ name: 'game', levelId: id })}
      onProfileSaved={refreshMe}
    />
  )
}

// ------------------------------------------------------------------ menu

function Menu({ levels, me, playerName, unlocked, onPlay, onProfileSaved }) {
  const [board, setBoard] = useState(null)
  const [boardLevel, setBoardLevel] = useState(1)
  const [tab, setTab] = useState('levels') // levels | board

  useEffect(() => {
    let cancelled = false
    setBoard(null)
    api
      .leaderboard(boardLevel, 8)
      .then((data) => !cancelled && setBoard(data.scores))
      .catch(() => !cancelled && setBoard([]))
    return () => {
      cancelled = true
    }
  }, [boardLevel])

  return (
    <main className="shell">
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Keyfall</h1>
            <p>Ten levels from single letters to whole sentences — with ten fingers.</p>
          </div>
        </div>
        <Profile me={me} playerName={playerName} onSaved={onProfileSaved} />
      </header>

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'levels'} className={tab === 'levels' ? 'is-active' : ''} onClick={() => setTab('levels')}>
          Levels
        </button>
        <button role="tab" aria-selected={tab === 'board'} className={tab === 'board' ? 'is-active' : ''} onClick={() => setTab('board')}>
          Leaderboard
        </button>
        <button role="tab" aria-selected={tab === 'how'} className={tab === 'how' ? 'is-active' : ''} onClick={() => setTab('how')}>
          How to type
        </button>
      </nav>

      {tab === 'levels' && (
        <section className="levels" aria-label="Levels">
          {levels.map((level) => {
            const locked = level.id > unlocked
            const best = me?.best_scores?.[String(level.id)]
            return (
              <button
                key={level.id}
                className={`level-card ${locked ? 'is-locked' : ''}`}
                onClick={() => !locked && onPlay(level.id)}
                disabled={locked}
              >
                <div className="level-num">{level.id}</div>
                <div className="level-body">
                  <h2>{level.title}</h2>
                  <p>{level.subtitle}</p>
                  <div className="level-meta">
                    <Chip>{level.mode === 'letter' ? 'Letters' : level.mode === 'word' ? 'Words' : level.mode === 'quote' ? 'Quotes' : 'Phrases'}</Chip>
                    <Chip>{level.target_count} targets</Chip>
                    <Chip>×{level.multiplier.toFixed(1)}</Chip>
                  </div>
                </div>
                <div className="level-score">
                  {locked ? (
                    <span className="muted">Clear level {level.id - 1}</span>
                  ) : best ? (
                    <>
                      <span className="muted">Best</span>
                      <strong>{best.toLocaleString()}</strong>
                    </>
                  ) : (
                    <span className="muted">Not played</span>
                  )}
                </div>
              </button>
            )
          })}
        </section>
      )}

      {tab === 'board' && (
        <section className="board">
          <div className="board-head">
            <h2>Top scores</h2>
            <label className="select">
              <span>Level</span>
              <select value={boardLevel} onChange={(e) => setBoardLevel(Number(e.target.value))}>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id}. {l.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {board === null ? (
            <p className="muted">Loading…</p>
          ) : board.length === 0 ? (
            <p className="muted">No scores on this level yet. Be the first.</p>
          ) : (
            <table className="score-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Score</th>
                  <th scope="col" className="num">WPM</th>
                  <th scope="col" className="num">Accuracy</th>
                  <th scope="col" className="num">Best combo</th>
                </tr>
              </thead>
              <tbody>
                {board.map((row, i) => (
                  <tr key={row.id} className={row.you ? 'is-you' : ''}>
                    <td>{i + 1}</td>
                    <td>
                      {row.display_name}
                      {row.you && <span className="you-tag">you</span>}
                    </td>
                    <td className="num">{row.score.toLocaleString()}</td>
                    <td className="num">{row.wpm}</td>
                    <td className="num">{Math.round(row.accuracy * 100)}%</td>
                    <td className="num">{row.max_combo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'how' && <HowToType />}
    </main>
  )
}

function Profile({ me, playerName, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(playerName || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.setProfile(name)
      await onSaved()
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!me) return null

  if (!me.signed_in) {
    return <p className="profile profile-anon">Playing as Guest — scores are saved but not tied to an account.</p>
  }

  if (editing) {
    return (
      <form className="profile profile-edit" onSubmit={save}>
        <label>
          <span>Display name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoFocus />
        </label>
        <button className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
        {error && <span className="form-error">{error}</span>}
      </form>
    )
  }

  return (
    <div className="profile">
      <span>
        Signed in as <strong>{playerName || me.display_name}</strong>
      </span>
      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
        Change name
      </button>
    </div>
  )
}

function HowToType() {
  return (
    <section className="how">
      <div className="how-col">
        <h2>Home position</h2>
        <p>
          Rest your left fingers on <Kbd>a s d f</Kbd> and your right on <Kbd>j k l ;</Kbd>. The
          little bumps on <Kbd>f</Kbd> and <Kbd>j</Kbd> are there so you can find them without
          looking. Thumbs sit on the space bar.
        </p>
        <h2>One finger per column</h2>
        <p>
          Each key belongs to one finger, drawn in its own colour on the keyboard below the game.
          When a token glows, the key it needs lights up, so you press with the right finger
          instead of the nearest one.
        </p>
        <h2>Never look down</h2>
        <p>
          Looking at your hands is the habit that keeps people slow. Keep your eyes on the tokens.
          Missing a token costs one life, and you have three.
        </p>
      </div>
      <FingerChart />
    </section>
  )
}

function FingerChart() {
  const rows = [
    { label: 'Left pinky', keys: '` 1 q a z' },
    { label: 'Left ring', keys: '2 w s x' },
    { label: 'Left middle', keys: '3 e d c' },
    { label: 'Left index', keys: '4 5 r t f g v b' },
    { label: 'Right index', keys: '6 7 y u h j n m' },
    { label: 'Right middle', keys: '8 i k ,' },
    { label: 'Right ring', keys: '9 o l .' },
    { label: 'Right pinky', keys: "0 p ; / ' - = [ ] \\" },
  ]
  const colors = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
  return (
    <div className="finger-chart">
      {rows.map((r, i) => (
        <div className="finger-row" key={r.label}>
          <span className="finger-dot" style={{ background: colors[i] }} />
          <span className="finger-name">{r.label}</span>
          <span className="finger-keys">{r.keys}</span>
        </div>
      ))}
      <div className="finger-note">
        <kbd>Shift</kbd> is pressed by the pinky of the hand that is not typing the letter — that is
        why capital letters are left-hand-to-right-shift and the other way round.
      </div>
    </div>
  )
}

// --------------------------------------------------------------- results

function Results({ result, levels, onReplay, onMenu, onNext }) {
  const level = levels.find((l) => l.id === result.levelId)
  const nextLevel = levels.find((l) => l.id === result.levelId + 1)
  const saved = result.saved

  if (result.error) {
    return (
      <main className="shell">
        <div className="panel">
          <p className="eyebrow eyebrow-bad">Run not saved</p>
          <h2>{result.error}</h2>
          <p className="panel-sub">
            Your run was played but the server did not record it. Check your connection and try the
            level again.
          </p>
          <div className="panel-actions">
            <button className="btn btn-primary" onClick={onReplay}>
              Play again
            </button>
            <button className="btn btn-ghost" onClick={onMenu}>
              Levels
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="shell results">
      <header className="results-head">
        <p className="eyebrow">
          Level {level.id} · {level.title}
        </p>
        <h1>
          {saved.cleared ? 'Level cleared' : 'Run ended'}
          <span className="results-score">{saved.score.toLocaleString()}</span>
        </h1>
        <p className="muted">
          {saved.cleared ? `Rank ${result.rank} on this level.` : 'No clear this time — the score still counts.'}
          {result.new_best ? ' New personal best.' : ''}
        </p>
      </header>

      <section className="stat-row" aria-label="Run summary">
        <StatTile label="Score" value={saved.score.toLocaleString()} note={`Personal best ${result.personal_best.toLocaleString()}`} />
        <StatTile label="Words per minute" value={saved.wpm} note={`${saved.correct_chars} correct characters`} />
        <StatTile label="Accuracy" value={`${Math.round(saved.accuracy * 100)}%`} note={`${saved.errors} of ${saved.keystrokes} keystrokes missed`} />
        <StatTile label="Best combo" value={saved.max_combo} note={`${saved.tokens_destroyed} of ${level.target_count} targets`} />
      </section>

      <section className="meter-block">
        <h2>Targets destroyed</h2>
        <Meter value={saved.tokens_destroyed} max={level.target_count} />
        <h2>Lives left</h2>
        <Meter value={saved.lives_left} max={level.lives} tone="lives" />
      </section>

      <div className="panel-actions results-actions">
        <button className="btn btn-primary" onClick={onReplay}>
          Play again
        </button>
        {saved.cleared && nextLevel && (
          <button className="btn btn-primary" onClick={() => onNext(nextLevel.id)}>
            Next: {nextLevel.title}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onMenu}>
          Levels
        </button>
      </div>
    </main>
  )
}

function StatTile({ label, value, note }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-note">{note}</span>
    </div>
  )
}

function Meter({ value, max, tone = 'accent' }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div className={`meter meter-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={`${value} of ${max}`}>
      <span style={{ width: `${pct * 100}%` }} />
    </div>
  )
}

function Chip({ children }) {
  return <span className="chip">{children}</span>
}

function Kbd({ children }) {
  return <kbd>{children}</kbd>
}