# Keyfall

A ten-finger touch-typing trainer played as a falling-meteor game. Tokens fall
from the top of the field; you press the key they want and they explode. Ten
levels go from single home-row letters to full teenage life quotes. Every run is
scored on the server, with a per-level leaderboard and personal bests.

## Layout

- `backend/app/content.py` — **the file to edit to change what the game teaches**:
  the ten level definitions (keys, bank of letters/words/phrases/quotes, spawn
  rate, fall speed, lives, multiplier). The frontend renders whatever this ships.
- `backend/app/score.py` — the scoring formula, WPM and accuracy. The client sends
  raw counters; the server decides the score, so a saved score can't disagree
  with the results screen.
- `backend/app/store.py` — MySQL-wire (OceanBase) when `DATABASE_URL` is set,
  SQLite otherwise. One row per run; the leaderboard reads one best row per player.
- `backend/app/main.py` — the FastAPI routes under `/api`. `GET /api/me` exposes
  the SSO identity (`X-Forwarded-Email`) to the browser.
- `frontend/src/game/engine.js` — pure game logic: finger map, target selection,
  token placement. Unit-tested, no DOM.
- `frontend/src/game/GameScreen.jsx` — the falling field, keyboard guide and
  pause/resume. The run state lives in a ref mutated by the rAF loop.
- `frontend/src/App.jsx` — menu, leaderboard, how-to-type and results screens.
- `backend/resources/db/migration/` — Flyway migrations (MySQL dialect).

## Tests

```
.venv/bin/python -m pytest backend/tests -q     # API, scoring, storage, content
cd frontend && npm test                         # game logic (node --test)
```

`backend/tests/test_quotes.py` and `test_long_tokens_get_enough_fall_time` encode
the two content rules that are easy to break by accident: every token must be
typeable with its level's keymap, and a 15 WPM beginner must finish the longest
token in under 80% of its fall time.

## Local run

There is no Docker in this checkout; the backend falls back to SQLite when
`DATABASE_URL` is unset, which is enough to play the whole game.

```
.venv/bin/uvicorn app.main:app --app-dir backend --port 8000
cd frontend && npm run dev     # http://localhost:5173, proxies /api
```

If port 8000 is taken by another app, run Keyfall on 8010 and point Vite at it:
`VITE_DEV_API=http://127.0.0.1:8010 npm run dev`.

With MySQL instead: `docker compose up -d db && docker compose run --rm migrate`,
then start the backend with
`DATABASE_URL="mysql://root:root@localhost:3306/keyfall"`.

## Scoring

`score = (correct_chars×8 + max_combo×6 + targets×25) × level_multiplier ×
accuracy_factor × speed_factor`, plus 200 for clearing the level. Accuracy factor
runs 0.5–1.0, speed factor 0.5–2.0 around a 30 WPM target. Tune the constants at
the top of `backend/app/score.py`.

<!-- BEGIN substrait-app contract (v7) — managed by the substrait plugin (link/deploy); edits inside this block are overwritten on update. Delete the whole block to opt out. -->
## Substrait deployment

**Linked app:** `keyfall` — https://keyfall.dev.sctp-dsai-1.apps.pluto.substrait.build

This project deploys to the **Substrait platform** (linked via the gitignored
`.substrait/config.json`). Deploy with **`/substrait:deploy`** (packages source-only,
uploads, `--watch` follows the build to the live preview); re-link with
`/substrait:link`. When the DEPLOYED app misbehaves (500s, blank page, a change that
didn't take), read its runtime logs with **`/substrait:logs`** — `--watch` stops at the
green deploy and cannot see runtime faults. The `substrait-app` skill has the full
contract; the essentials:

**Hard requirements (platform-enforced):**
- Backend in any language. Its Dockerfile — `cicd/Dockerfile.backend` (repo-root build
  context), `cicd/Dockerfile`, or `backend/Dockerfile` (backend/ context) — must
  `EXPOSE 8000`, serve `GET /health` (200) and the API under **`/api`**.
- Frontend optional, any framework: built site served on **port 80** via
  `cicd/Dockerfile.frontend` (or `frontend/Dockerfile`). One ingress host routes
  `/api` → backend, everything else → frontend (no `frontend/` → everything → backend,
  so serve `/` yourself). The frontend calls the API via **relative `/api` paths** —
  never an absolute URL, never `VITE_API_URL`.
- Database is **explicit**: declare `database:` in `substrait.yaml` and the platform
  provisions it and injects `DATABASE_URL`; no declaration → no database, no
  `DATABASE_URL` (`JWT_SECRET` is always injected). Engines: `oceanbase` (default —
  shared HA cluster, MySQL wire, backed up, portal Database tab) or `postgres` /
  `mysql` (the app's own single-node pod + disk: real engine, but no HA, no backups,
  no Database-tab tooling). The engine can't change after the first deploy. **All DDL
  lives in Flyway files** `backend/resources/db/migration/V*.sql` in that engine's
  dialect — the app never `CREATE TABLE`s, and migrations without a `database:`
  declaration fail validation.
- Backing services (redis / kafka / qdrant / object-storage): declare them in a
  **`substrait.yaml`** at the repo root (`services: {redis: {}, kafka: {persistent: true},
  qdrant: {}, object-storage: {}}`) — the platform provisions them and injects
  `REDIS_URL` / `KAFKA_BROKERS` / `QDRANT_URL` / `OBJECT_STORAGE_BUCKET` only for what's
  declared. The three pod services are ephemeral unless `persistent: true`;
  `object-storage` is a private file bucket per app PER ENVIRONMENT — durable, no options,
  no credential to configure, and removing the declaration never deletes the files. Read
  `OBJECT_STORAGE_BUCKET` rather than hard-coding a name; a new environment's bucket
  starts empty.
- Custom env vars/secrets: declare in `backend/.env.example` (`NAME=value`, trailing
  `# secret` marks a secret) — the portal pre-creates them for the owner to fill in.
  Build-time frontend vars go in a committed `frontend/.env.production` (public,
  non-secret values only).
- Never create `k8s/` (platform-owned, discarded). Uploads are source-only, ≤ 16 MB
  (no `node_modules/`, `.venv/`, `dist/`, build output).

**Platform capabilities to build on:**
- **User identity (Google SSO):** when the app owner enables SSO (portal Access tab),
  every gated backend request carries unspoofable `X-Forwarded-Email` /
  `X-Forwarded-User` headers — identity with no OAuth flow in the app. Absent in local
  dev, on declared public paths, and when SSO is off (then they're client-spoofable —
  never treat as access control). The browser can't see them: expose e.g. `/api/me`.
  SSO-exempt paths (MCP servers, webhooks) are declared on the Access tab and must be
  authenticated by the app itself (e.g. Bearer token from an env secret).
- **API endpoint inventory:** the portal's API tab lists the backend's endpoints,
  auto-harvested from the app's OpenAPI spec after each deploy (FastAPI serves
  `/openapi.json` by default). Spec-less stacks: `/substrait:deploy` generates
  `.substrait/endpoints.json` instead.

**Local dev:** use a MySQL-wire DB so drivers/migrations run unchanged — never SQLite.
Scaffolded projects: `docker compose up -d db && docker compose run --rm migrate`, then
the backend on `:8000` (reading `DATABASE_URL`) and `npm run dev` in `frontend/`.
<!-- END substrait-app contract -->
