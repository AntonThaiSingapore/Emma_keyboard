"""Scores, progress and profile storage.

Two backends behind one interface:
  * DATABASE_URL set   -> MySQL-wire (OceanBase / MySQL) via PyMySQL. Deployment.
  * DATABASE_URL unset -> local SQLite file. Development and tests.

The SQL is written once in MySQL syntax; `_adapt` rewrites the few placeholder
differences. Schema lives in the Flyway migration for deployed environments and
is created inline for SQLite only.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

DEFAULT_SQLITE = Path(__file__).resolve().parent.parent.parent / "data" / "keyfall.db"

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS scores (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    player_key        TEXT NULL,
    display_name      TEXT NOT NULL,
    level_id          INTEGER NOT NULL,
    score             INTEGER NOT NULL,
    wpm               REAL NOT NULL,
    accuracy          REAL NOT NULL,
    correct_chars     INTEGER NOT NULL,
    keystrokes        INTEGER NOT NULL,
    errors            INTEGER NOT NULL,
    max_combo         INTEGER NOT NULL,
    tokens_destroyed  INTEGER NOT NULL,
    lives_left        INTEGER NOT NULL,
    cleared           INTEGER NOT NULL,
    duration_ms       INTEGER NOT NULL,
    created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_level ON scores(level_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_player ON scores(player_key, created_at DESC);

CREATE TABLE IF NOT EXISTS profiles (
    player_key     TEXT PRIMARY KEY,
    display_name   TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
"""

SCORE_COLS = (
    "id, player_key, display_name, level_id, score, wpm, accuracy, correct_chars, "
    "keystrokes, errors, max_combo, tokens_destroyed, lives_left, cleared, "
    "duration_ms, created_at"
)


def database_url() -> str | None:
    url = os.environ.get("DATABASE_URL")
    return url.strip() if url and url.strip() else None


def using_mysql() -> bool:
    return database_url() is not None


def _mysql_params(url: str) -> dict:
    p = urlparse(url)
    if p.scheme not in ("mysql", "mysql+pymysql"):
        raise RuntimeError(
            f"DATABASE_URL scheme {p.scheme!r} is not supported by this app; "
            "it expects mysql:// (OceanBase / MySQL)."
        )
    return {
        "host": p.hostname or "127.0.0.1",
        "port": p.port or 2881,
        "user": unquote(p.username or ""),
        "password": unquote(p.password or ""),
        "database": (p.path or "").lstrip("/"),
        "charset": "utf8mb4",
        "autocommit": False,
        "connect_timeout": 10,
    }


def _adapt(sql: str) -> str:
    """Our SQL is MySQL flavour; SQLite needs `?` placeholders and no `%s`."""
    return sql.replace("%s", "?") if not using_mysql() else sql


@contextmanager
def connection():
    url = database_url()
    if url is not None:
        import pymysql
        from pymysql.cursors import DictCursor

        conn = pymysql.connect(**_mysql_params(url), cursorclass=DictCursor)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        return

    DEFAULT_SQLITE.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DEFAULT_SQLITE)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(SQLITE_SCHEMA)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def player_key(email: str | None) -> str | None:
    """Stable, opaque key for an SSO identity.

    Hashed so the stored rows never carry the player's email address: the
    account is still the same account on every sign-in, but the leaderboard
    table can't be read as a staff contact list.
    """
    if not email:
        return None
    digest = hashlib.sha256(f"keyfall:{email.strip().lower()}".encode()).hexdigest()
    return digest[:32]


def insert_score(row: dict) -> int:
    cols = (
        "player_key, display_name, level_id, score, wpm, accuracy, correct_chars, "
        "keystrokes, errors, max_combo, tokens_destroyed, lives_left, cleared, "
        "duration_ms, created_at"
    )
    values = (
        row["player_key"], row["display_name"], row["level_id"], row["score"],
        row["wpm"], row["accuracy"], row["correct_chars"], row["keystrokes"],
        row["errors"], row["max_combo"], row["tokens_destroyed"],
        row["lives_left"], 1 if row["cleared"] else 0, row["duration_ms"],
        row["created_at"],
    )
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(
            _adapt(
                f"INSERT INTO scores ({cols}) VALUES "
                "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
            ),
            values,
        )
        new_id = cur.lastrowid
    return int(new_id)


def _row_to_score(r) -> dict:
    d = dict(r)
    d["cleared"] = bool(d["cleared"])
    d["created_at"] = str(d["created_at"])
    return d


GUEST_KEY = "guest"


def list_scores(level_id: int | None, limit: int) -> list[dict]:
    """Top scores, one row per player.

    Every run is kept (a player's history matters to them), but the board shows
    each player's personal best so one fast learner can't fill it. Over-fetch,
    then keep the first row seen per player — the query is already ordered, so
    that row is their best.

    Anonymous runs collapse into a single "Guest" row (their best), otherwise a
    class playing without sign-in would fill the whole board with identical
    "Guest" entries and hide everyone else.
    """
    if limit < 1:
        return []
    where = ""
    params: tuple = ()
    if level_id is not None:
        where = "WHERE level_id = %s"
        params = (level_id,)
    sql = f"""
        SELECT {SCORE_COLS} FROM scores s
        {where}
        ORDER BY score DESC, wpm DESC, id ASC
        LIMIT %s
    """
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_adapt(sql), params + (limit * 5,))
        rows = cur.fetchall()

    out: list[dict] = []
    seen: set[str] = set()
    for r in rows:
        d = _row_to_score(r)
        owner = d["player_key"] or GUEST_KEY
        if owner in seen:
            continue
        seen.add(owner)
        out.append(d)
        if len(out) >= limit:
            break
    return out


def list_player_scores(key: str, limit: int) -> list[dict]:
    sql = f"SELECT {SCORE_COLS} FROM scores WHERE player_key = %s ORDER BY id DESC LIMIT %s"
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_adapt(sql), (key, limit))
        rows = cur.fetchall()
    return [_row_to_score(r) for r in rows]


def best_per_level(key: str) -> dict[int, int]:
    sql = "SELECT level_id, MAX(score) AS best FROM scores WHERE player_key = %s GROUP BY level_id"
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_adapt(sql), (key,))
        rows = cur.fetchall()
    return {int(r["level_id"]): int(r["best"]) for r in rows}


def level_rank(level_id: int, score: int) -> int:
    """1-based position of `score` on a level's leaderboard.

    Ranked against one row per player (their best), which is what the board
    shows — so a rank of 1 always means "top of what you can see".
    """
    sql = (
        "SELECT COUNT(*) AS n FROM ("
        "  SELECT player_key, MAX(score) AS best FROM scores"
        "  WHERE level_id = %s AND player_key IS NOT NULL GROUP BY player_key"
        ") t WHERE t.best > %s"
    )
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_adapt(sql), (level_id, score))
        row = cur.fetchone()
    return int(row["n"]) + 1


def get_profile(key: str) -> dict | None:
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_adapt("SELECT player_key, display_name, created_at FROM profiles WHERE player_key = %s"), (key,))
        r = cur.fetchone()
    return dict(r) if r else None


def upsert_profile(key: str, display_name: str) -> dict:
    ts = _now()
    existing = get_profile(key)
    with connection() as conn:
        cur = conn.cursor()
        if existing is None:
            cur.execute(
                _adapt("INSERT INTO profiles (player_key, display_name, created_at, updated_at) VALUES (%s, %s, %s, %s)"),
                (key, display_name, ts, ts),
            )
        else:
            cur.execute(
                _adapt("UPDATE profiles SET display_name = %s, updated_at = %s WHERE player_key = %s"),
                (display_name, ts, key),
            )
    return {"player_key": key, "display_name": display_name, "created_at": (existing or {}).get("created_at", ts)}


def rename_history(key: str, display_name: str) -> None:
    """Keep old scores attributed to the player's current name."""
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_adapt("UPDATE scores SET display_name = %s WHERE player_key = %s"), (display_name, key))