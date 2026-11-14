"""Keyfall backend — level content, score submission, leaderboards, progress.

Contract (Substrait upload mode): listen on 8000, serve GET /health, API under /api.
Database is OceanBase/MySQL-wire in deployment and SQLite locally (see store.py).
All DDL lives in backend/resources/db/migration/V1__init.sql.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from . import content, score as scoring, store


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Touch storage once so a misconfigured DATABASE_URL fails at boot rather
    # than on a player's first submission.
    with store.connection():
        pass
    yield


app = FastAPI(
    title="Keyfall",
    description="A falling-meteor typing trainer: ten levels from single letters to full teenage life quotes.",
    version="1.0.0",
    lifespan=lifespan,
)

DEFAULT_DISPLAY_NAME = "Guest"


# --------------------------------------------------------------------------- models


class Health(BaseModel):
    status: str


class Level(BaseModel):
    id: int
    title: str
    subtitle: str
    mode: str
    keys: str
    target_count: int
    spawn_interval: float
    fall_seconds: float
    seconds_per_char: float
    max_on_screen: int
    lives: int
    multiplier: float
    bank: list[str]


class LevelList(BaseModel):
    levels: list[Level]


class Me(BaseModel):
    signed_in: bool
    email: str | None
    display_name: str
    # Keyed by level id as a string, because JSON object keys are always strings.
    best_scores: dict[str, int]


class ScoreIn(BaseModel):
    level_id: int = Field(ge=1, le=len(content.LEVELS))
    correct_chars: int = Field(ge=0)
    keystrokes: int = Field(ge=0)
    errors: int = Field(ge=0)
    max_combo: int = Field(ge=0)
    tokens_destroyed: int = Field(ge=0)
    lives_left: int = Field(ge=0)
    cleared: bool
    duration_ms: int = Field(ge=0)


class ScoreRow(BaseModel):
    # No player_key: it is a hash of the player's email, and publishing it would
    # let anyone confirm whether a given address has played. `you` is the only
    # identity a client needs.
    id: int
    display_name: str
    level_id: int
    score: int
    wpm: float
    accuracy: float
    correct_chars: int
    keystrokes: int
    errors: int
    max_combo: int
    tokens_destroyed: int
    lives_left: int
    cleared: bool
    duration_ms: int
    created_at: str
    you: bool = False


class ScoreResult(BaseModel):
    saved: ScoreRow
    rank: int
    personal_best: int
    new_best: bool


class ScoreList(BaseModel):
    level_id: int | None
    scores: list[ScoreRow]


class ProfileIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=24)


class ProfileOut(BaseModel):
    display_name: str
    signed_in: bool


# ---------------------------------------------------------------------------- auth


def _identity(request: Request) -> tuple[str | None, str]:
    """(player_key, display_name) for this request.

    Under Google SSO the platform injects X-Forwarded-Email on gated requests;
    it is absent in local dev and on public paths, so play still works without
    it. A signed-in player's name comes from their profile when they set one.
    """
    email = request.headers.get("x-forwarded-email")
    key = store.player_key(email)
    if key is None:
        return None, DEFAULT_DISPLAY_NAME
    profile = store.get_profile(key)
    if profile:
        return key, profile["display_name"]
    # First visit: use the email's local part, clipped to the scoreboard width.
    local = (email or "").split("@")[0]
    return key, (local[:24] or DEFAULT_DISPLAY_NAME)


def _score_row(row: dict, key: str | None) -> ScoreRow:
    fields = {k: v for k, v in row.items() if k != "player_key"}
    return ScoreRow(**fields, you=bool(key) and row.get("player_key") == key)


# ---------------------------------------------------------------------------- routes


@app.get("/health", response_model=Health)
def health():
    return {"status": "ok"}


@app.get("/api/levels", response_model=LevelList)
def levels():
    return {"levels": [content.public_level(lvl) for lvl in content.LEVELS]}


@app.get("/api/me", response_model=Me)
def me(request: Request):
    key, name = _identity(request)
    return {
        "signed_in": key is not None,
        "email": request.headers.get("x-forwarded-email"),
        "display_name": name,
        "best_scores": (
            {str(lid): best for lid, best in store.best_per_level(key).items()} if key else {}
        ),
    }


@app.post("/api/profile", response_model=ProfileOut)
def set_profile(body: ProfileIn, request: Request):
    key, _ = _identity(request)
    if key is None:
        raise HTTPException(status_code=401, detail="Sign in to keep a display name.")
    name = " ".join(body.display_name.split())
    if not name:
        raise HTTPException(status_code=422, detail="Display name cannot be blank.")
    store.upsert_profile(key, name)
    store.rename_history(key, name)
    return {"display_name": name, "signed_in": True}


@app.post("/api/scores", status_code=201, response_model=ScoreResult)
def submit_score(body: ScoreIn, request: Request):
    level = content.LEVELS_BY_ID[body.level_id]
    stats = scoring.Stats(
        correct_chars=body.correct_chars,
        keystrokes=body.keystrokes,
        errors=body.errors,
        max_combo=body.max_combo,
        tokens_destroyed=body.tokens_destroyed,
        lives_left=body.lives_left,
        cleared=body.cleared,
        duration_ms=body.duration_ms,
    )
    problem = scoring.validate(stats, level["lives"])
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    if stats.tokens_destroyed > level["target_count"]:
        raise HTTPException(status_code=422, detail="More targets than the level contains.")
    if stats.cleared and stats.tokens_destroyed < level["target_count"]:
        raise HTTPException(
            status_code=422,
            detail="A cleared run must destroy every target in the level.",
        )

    # The server owns the formula: the client only ever sends raw counters.
    result = scoring.compute(stats, level["multiplier"])
    key, name = _identity(request)
    previous_best = store.best_per_level(key).get(body.level_id, 0) if key else 0

    row = {
        "player_key": key,
        "display_name": name,
        "level_id": body.level_id,
        **{
            k: getattr(result, k)
            for k in (
                "score", "wpm", "accuracy", "correct_chars", "keystrokes",
                "errors", "max_combo", "tokens_destroyed", "lives_left",
                "cleared", "duration_ms",
            )
        },
        "created_at": store.now_iso(),
    }
    new_id = store.insert_score(row)
    row["id"] = new_id
    return {
        "saved": _score_row(row, key),
        "rank": store.level_rank(body.level_id, result.score),
        "personal_best": max(previous_best, result.score),
        "new_best": result.score > previous_best,
    }


@app.get("/api/scores", response_model=ScoreList)
def leaderboard(request: Request, level_id: int | None = None, limit: int = 10):
    limit = max(1, min(limit, 50))
    if level_id is not None and level_id not in content.LEVELS_BY_ID:
        raise HTTPException(status_code=404, detail="No such level.")
    key, _ = _identity(request)
    rows = store.list_scores(level_id, limit)
    return {"level_id": level_id, "scores": [_score_row(r, key) for r in rows]}


@app.get("/api/scores/mine", response_model=ScoreList)
def my_scores(request: Request, limit: int = 20):
    limit = max(1, min(limit, 100))
    key, _ = _identity(request)
    if key is None:
        return {"level_id": None, "scores": []}
    rows = store.list_player_scores(key, limit)
    return {"level_id": None, "scores": [_score_row(r, key) for r in rows]}


# The frontend is served by nginx on the same origin, so there is no CORS setup here.