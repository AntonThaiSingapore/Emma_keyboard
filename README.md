# Keyfall

A ten-finger touch-typing trainer played as a falling-meteor game. Words, phrases and
quotes fall from the top of the field; you press the keys they want and they explode
before they reach the floor. Ten levels take a beginner from single home-row letters to
full sentences, and every run is scored **on the server** with per-level leaderboards
and personal bests.

The whole game is two services and one database:

| Piece | Stack | Role |
| --- | --- | --- |
| `backend/` | Python 3.12, FastAPI | Level content, scoring, leaderboards, profiles |
| `frontend/` | React 18 + Vite | Renders levels, the falling field, keyboard guide, results |
| MySQL-wire DB | OceanBase in deployment, SQLite locally | One row per finished run, plus player profiles |

---

## Table of contents

- [Playing the game](#playing-the-game)
- [Project structure](#project-structure)
- [How the game works](#how-the-game-works)
  - [Level content](#level-content)
  - [The game loop](#the-game-loop)
  - [Typing rules and the finger map](#typing-rules-and-the-finger-map)
  - [Scoring](#scoring)
- [Database](#database)
  - [Schema](#schema)
  - [Identity without an OAuth flow](#identity-without-an-oauth-flow)
  - [Leaderboard queries](#leaderboard-queries)
- [API](#api)
- [Running locally](#running-locally)
- [Tests](#tests)
- [Deployment](#deployment)

---

## Playing the game

1. Pick a level from the menu. Levels unlock as you clear the previous one (progress
   is remembered in `localStorage`; the server keeps the scores).
2. Type the text on a falling token. Each correct character advances that token; the
   last one destroys it and it explodes. A wrong key breaks your combo but does not
   lose a life.
3. A token that reaches the floor costs a life. Lose all lives and the run ends
   without the clear bonus.
4. Destroy `target_count` tokens to clear the level. The on-screen keyboard colours
   every key by the finger that should press it, and the "next key" hint shows every
   character currently needed.
5. Sign in (Google SSO, when the app owner enables it) to keep a display name, a
   personal best per level, and a place on the leaderboard. Playing signed out still
   works — those runs share a single "Guest" row on the board.

Press `Enter` to start a run, `Escape` to pause, and `Enter` or `Escape`
again to resume. Pausing also happens automatically when the tab is hidden, and the
paused time is excluded from the run's duration, so WPM measures typing and not a
coffee break.

---

## Project structure

```
keyfall/
├── backend/
│   ├── app/
│   │   ├── main.py             FastAPI app, routes, request identity, validation
│   │   ├── content.py          ← the ten level definitions (edit this to change content)
│   │   ├── score.py            scoring formula, WPM, accuracy, plausibility bounds
│   │   └── store.py            storage: MySQL-wire (PyMySQL) or SQLite behind one API
│   ├── resources/db/migration/
│   │   └── V1__init.sql        Flyway migration — the only DDL (MySQL dialect)
│   ├── tests/                  pytest: API, scoring, storage, content rules
│   ├── requirements.txt
│   └── .env.example            custom env vars the platform pre-creates
├── frontend/
│   ├── src/
│   │   ├── api.js              same-origin fetch client (relative /api paths)
│   │   ├── App.jsx             menu, level picker, leaderboard, results, "how to type"
│   │   ├── styles.css
│   │   └── game/
│   │       ├── engine.js       ← pure game logic: fingers, targeting, placement, timing
│   │       ├── engine.test.js  unit tests run by `node --test`
│   │       ├── GameScreen.jsx  the falling field, keyboard guide, pause/resume, submit
│   │       └── audio.js        small WebAudio sound effects
│   ├── package.json
│   └── vite.config.js          dev proxy: /api and /health → :8000
├── cicd/
│   ├── Dockerfile.backend      python:3.12-slim, uvicorn on :8000
│   ├── Dockerfile.frontend     node build → nginx on :80
│   └── nginx.conf              SPA fallback (no /api proxy — the ingress does that)
├── docker-compose.yml          local MySQL + Flyway only (dev convenience)
├── substrait.yaml              deploy contract: declares the OceanBase database
├── openapi.json                snapshot of the generated API spec
└── CLAUDE.md                   contributor notes for working in this repo
```

The split is deliberate: **`content.py` decides what the game teaches, `engine.js`
decides how the field behaves, `score.py` decides what a run is worth.** None of them
knows about the others' internals, and the frontend never hard-codes a word, a level
setting or a score formula.

---

## How the game works

### Level content

Everything the game displays comes from `backend/app/content.py` and is served as JSON
by `GET /api/levels`. The frontend renders whatever this ships.

Each level is a dict:

| Field | Meaning |
| --- | --- |
| `id`, `title`, `subtitle` | Display information |
| `mode` | `letter` / `word` / `phrase` / `quote` |
| `keys` | Characters the level trains — drives the on-screen keyboard and the key filter |
| `bank` | Tokens drawn for this level (letter levels build it from `keys`) |
| `target_count` | How many tokens must be destroyed to clear |
| `spawn_interval` | Seconds between spawns |
| `fall_seconds` | Seconds a token takes to cross the full field |
| `seconds_per_char` | Extra fall time per character beyond the first |
| `max_on_screen` | How many tokens may fall at once |
| `lives` | Misses allowed before the run ends |
| `multiplier` | Score multiplier (1.0 → 2.2 across the ten levels) |

The progression:

| Level | Content | Keys | Multiplier |
| --- | --- | --- | --- |
| 1 | Home row | `asdfjkl;` | 1.0 |
| 2 | Home row both hands | `asdfghjkl;` | 1.1 |
| 3 | Top row | `erui` | 1.2 |
| 4 | Top row full | `qwertyuiop` | 1.3 |
| 5 | Bottom row | `zxcvbnm` | 1.4 |
| 6 | Full alphabet | `a–z` | 1.5 |
| 7 | Short words (3 letters) | `a–z` | 1.6 |
| 8 | Everyday words | `a–z` | 1.7 |
| 9 | Short phrases | `a–z` + space | 1.9 |
| 10 | Teen life quotes | `a–zA–Z,.` + space | 2.2 |

Two content rules are encoded in the backend tests because they are easy to break by
accident:

- **Typeability** — every token in a level's bank must be typeable using only that
  level's `keys` (`test_every_level_bank_is_typeable_with_its_keys`). Level 10 needs
  capitals, commas and periods, so its `keys` include them.
- **Enough fall time** — a 15 WPM beginner must be able to finish the longest token in
  a level in under 80% of its fall time (`test_long_tokens_get_enough_fall_time`).
  That is why long tokens get extra time:

  ```
  fall_seconds(token) = level.fall_seconds + level.seconds_per_char × (len(token) − 1)
  ```

  A single letter in level 1 falls in 9 s; the longest quote in level 10 (58
  characters) gets 24 s + 0.75 s × 57 ≈ 66.8 s. The same formula is shown in the level
  panel ("Falling speed") and implemented in `fallTimeFor()` in `engine.js`, so the
  promise matches the game.

### The game loop

`GameScreen.jsx` keeps the entire run in a `useRef` object that the
`requestAnimationFrame` loop mutates 60 times a second, then asks React to repaint.
State never flows through a stale closure, and pausing is just skipping the update.

On every frame:

1. Move each token down by `speed × dt`, where `speed` is **per token**
   (`1 / fallTimeFor(level, text)`), so a quote falls far more slowly than a letter
   even in the same level.
2. Spawn a new token when `now >= nextSpawnAt`, the on-screen count is below
   `max_on_screen`, fewer than `target_count` tokens have spawned, and nothing spawned
   in the top few percent of the field. The text comes from the level bank, avoiding an
   immediate repeat where possible.
3. Any token past the floor line (`MAX_SEGMENT = 0.9` of the field height) is a miss:
   decrement `lives`, reset the combo, show a burst.
4. End the run when `lives <= 0` (`lost`) or `destroyed >= target_count` (`won`).

Placement (`chooseX`) samples up to eight candidate x positions and keeps the one
farthest from tokens still near the top, within the part of the track the token's own
width leaves free. Long tokens are capped at 88% of the track and shrink their font as
they grow (`tokenFontSize`) so a full sentence fits a lane.

Results are submitted **once per finished run** (guarded by a ref, reset on start), and
pausing time is subtracted from the duration before WPM is computed.

### Typing rules and the finger map

`engine.js` is pure — no React, no DOM — so the tricky parts are unit-tested directly.

- **Fingers.** The eight fingers each own a set of keys (`FINGERS`), painted on the
  keyboard guide with a distinct colour. Colour is never the only cue: the letter is
  always visible and the legend names the finger.
- **Shift.** Capitals require shift, pressed by the pinky of the *opposite* hand
  (`shiftFingerFor`).
- **Targeting.** Several tokens may be waiting for the same character. A keystroke hits
  the matching token **closest to the floor** — the most urgent one, and the choice a
  player would make anyway (`findTarget`). The comparison is against the *next expected*
  character, not the token's first character.
- **Correct vs. wrong.** A correct character increments `correctChars` and the combo;
  a wrong key increments `errors` and resets the combo. Both count as a keystroke, so
  accuracy is `correctChars / keystrokes`.
- **Space** has no finger of its own (either thumb), and the quote level types it like
  any other character.

### Scoring

The client sends only raw counters (`correct_chars`, `keystrokes`, `errors`,
`max_combo`, `tokens_destroyed`, `lives_left`, `cleared`, `duration_ms`). The server
computes everything else:

```
accuracy      = correct_chars / keystrokes
wpm           = (correct_chars / 5) / minutes        # one "word" = five characters
accuracy_f    = 0.5 + 0.5 × accuracy                 # 0.5 … 1.0
speed_f       = clamp(wpm / 30, 0.5, 2.0)            # 0.5 … 2.0
base          = correct_chars×8 + max_combo×6 + tokens_destroyed×25
score         = floor(base × level_multiplier × accuracy_f × speed_f) + (200 if cleared)
```

Properties worth knowing:

- **Accuracy never zeroes a run out.** Even a rough first attempt keeps half its
  points, so the board rewards finishing rather than only perfection.
- **Speed is bounded.** A clean 10-second burst is capped at double the 30-WPM base;
  a slow, careful run still keeps half. Tuning constants sit at the top of
  `backend/app/score.py`.
- **The server has the last word.** Because the formula lives server-side, a saved
  score can't disagree with the results screen, and tuning it doesn't need a frontend
  release.
- **Implausible submissions are rejected** with 422: counters outside fixed bounds,
  `errors > keystrokes`, `lives_left` above the level's allowance, a "cleared" run that
  didn't destroy every target, or more targets than the level contains.

---

## Database

Deployment uses **OceanBase** (MySQL wire, declared in `substrait.yaml`), so the app
gets a real DDL-managed schema; local development and tests fall back to SQLite. Both
sit behind the same functions in `store.py`, and all SQL is written once in MySQL
syntax — `_adapt()` rewrites `%s` to `?` for SQLite. The schema is applied by
`V1__init.sql` (Flyway) in deployed environments and created inline for SQLite only:
**the app itself never issues `CREATE TABLE`.**

### Schema

```sql
CREATE TABLE scores (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    player_key        VARCHAR(32)  NULL,      -- truncated SHA-256 of the SSO email
    display_name      VARCHAR(24)  NOT NULL,
    level_id          INT          NOT NULL,
    score             INT          NOT NULL,
    wpm               DOUBLE       NOT NULL,
    accuracy          DOUBLE       NOT NULL,
    correct_chars     INT          NOT NULL,
    keystrokes        INT          NOT NULL,
    errors            INT          NOT NULL,
    max_combo         INT          NOT NULL,
    tokens_destroyed  INT          NOT NULL,
    lives_left        INT          NOT NULL,
    cleared           TINYINT(1)   NOT NULL,
    duration_ms       INT          NOT NULL,
    created_at        DATETIME     NOT NULL,
    PRIMARY KEY (id),
    KEY idx_scores_level (level_id, score DESC),
    KEY idx_scores_player (player_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE profiles (
    player_key     VARCHAR(32)  NOT NULL,
    display_name   VARCHAR(24)  NOT NULL,
    created_at     DATETIME     NOT NULL,
    updated_at     DATETIME     NOT NULL,
    PRIMARY KEY (player_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Design decisions:

- **One row per run, not per player.** A player's history is theirs to keep; the
  leaderboard aggregates to one best row per player at read time.
- **`player_key` is a hash, never an email.** `sha256("keyfall:" + lower(email))`
  truncated to 32 hex characters. The same account is recognised on every sign-in, but
  the table can't be read as a staff contact list. It is never returned by the API.
- **`NULL` `player_key` = anonymous.** Those runs collapse into a single "Guest" row
  on the board; otherwise a class playing without sign-in would fill it with identical
  entries and hide everyone else.
- **Indexes match the queries:** `(level_id, score DESC)` for the board, `player_key`
  for a player's history and personal bests.
- **`profiles` holds the chosen display name.** Renaming rewrites `display_name` on
  all of that player's existing score rows (`rename_history`), so old runs are
  attributed to the current name. A first-time player gets the local part of their
  email, clipped to 24 characters.

### Identity without an OAuth flow

When the app owner enables SSO, the platform injects unspoofable `X-Forwarded-Email` /
`X-Forwarded-User` headers on gated requests. The browser can't read them, so
`GET /api/me` exposes `signed_in`, `email`, `display_name` and `best_scores`. The
headers are absent in local dev and on public paths, so the game still plays signed
out. They are treated as **identity, not access control**.

### Leaderboard queries

```sql
-- Board: top runs by score, then over-fetch and keep the first row seen per player.
SELECT ... FROM scores [WHERE level_id = %s]
ORDER BY score DESC, wpm DESC, id ASC LIMIT %s;   -- limit × 5 fetched

-- Personal bests, keyed by level.
SELECT level_id, MAX(score) AS best FROM scores
WHERE player_key = %s GROUP BY level_id;

-- 1-based rank: how many *other players' bests* on this level beat this score.
SELECT COUNT(*) FROM (
  SELECT player_key, MAX(score) AS best FROM scores
  WHERE level_id = %s AND player_key IS NOT NULL GROUP BY player_key
) t WHERE t.best > %s;
```

The rank uses the same one-row-per-player view the board shows, so a rank of 1 always
means "top of what you can see".

---

## API

All routes are under `/api` except `/health` (the platform's liveness probe). FastAPI
also serves the generated spec at `/openapi.json` and the interactive docs at `/docs`;
a snapshot of the spec is committed as `openapi.json`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, returns `{"status":"ok"}` |
| `GET` | `/api/levels` | All ten level definitions (content, timing, keys, bank) |
| `GET` | `/api/me` | SSO identity, display name, best score per level |
| `POST` | `/api/profile` | Set display name (requires sign-in) |
| `POST` | `/api/scores` | Submit a finished run; returns saved row, rank, personal best |
| `GET` | `/api/scores?level_id=&limit=` | Leaderboard, one row per player |
| `GET` | `/api/scores/mine?limit=` | The signed-in player's recent runs |

The frontend calls these through `src/api.js` with **relative paths** — one origin in
production (the ingress routes `/api` to the backend) and Vite's proxy in development.
There is no CORS configuration because there is never a cross-origin request.

---

## Running locally

The backend falls back to SQLite when `DATABASE_URL` is unset, which is enough to play
the whole game — no Docker required.

```bash
# backend (Python 3.12)
.venv/bin/uvicorn app.main:app --app-dir backend --port 8000

# frontend
cd frontend && npm install && npm run dev     # http://localhost:5173
```

If port 8000 is taken, run the backend on 8010 and point Vite at it:

```bash
VITE_DEV_API=http://127.0.0.1:8010 npm run dev
```

To exercise the MySQL path and the real migrations instead:

```bash
docker compose up -d db && docker compose run --rm migrate
DATABASE_URL="mysql://root:root@localhost:3306/keyfall" \
  .venv/bin/uvicorn app.main:app --app-dir backend --port 8000
```

The SQLite file lives at `data/keyfall.db` and is gitignored.

---

## Tests

```bash
.venv/bin/python -m pytest backend/tests -q     # API, scoring, storage, content
cd frontend && npm test                         # game logic (node --test)
```

The two content rules above (`test_quotes.py`, `test_long_tokens_get_enough_fall_time`)
and the API tests that prove the server owns scoring (`test_score_is_scored_by_server`,
`test_rejects_impossible_counters`) are the ones to watch when changing content or
tuning the formula.

---

## Deployment

This project deploys to the **Substrait platform** (see `CLAUDE.md` for the full
contract):

- Backend image from `cicd/Dockerfile.backend` — `EXPOSE 8000`, `GET /health`, API
  under `/api`.
- Frontend image from `cicd/Dockerfile.frontend` — built with Vite, served by nginx on
  port 80. One ingress host routes `/api` to the backend, everything else to the
  frontend, so the app must keep calling **relative** `/api` paths.
- `substrait.yaml` declares `database: oceanbase`; the platform provisions it and
  injects `DATABASE_URL` (`JWT_SECRET` is always injected). DDL only ever comes from
  `backend/resources/db/migration/V*.sql`.
- Custom non-secret env vars are declared in `backend/.env.example` (currently just the
  optional `KEYFALL_BOARD_TITLE`).

`docker-compose.yml` exists purely for local development and is ignored on upload.