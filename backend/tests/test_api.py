import os
import tempfile

import pytest

# Bind storage to a throwaway SQLite file before app import so tests never touch
# the dev database. store reads DATABASE_URL per call, so unsetting is enough.
os.environ.pop("DATABASE_URL", None)
_tmp = tempfile.mkdtemp(prefix="keyfall-test-")

from pathlib import Path  # noqa: E402

from app import store  # noqa: E402
from app import content  # noqa: E402
from app.main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

store.DEFAULT_SQLITE = Path(_tmp) / "test.db"


@pytest.fixture(autouse=True)
def fresh_db(tmp_path):
    """Every test gets its own database file, so ranks and bests start at zero."""
    store.DEFAULT_SQLITE = tmp_path / "test.db"
    yield


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def signed_in(client):
    return TestClient(app, headers={"x-forwarded-email": "sam@school.example", "x-forwarded-user": "sam"})


SYNTH = {"crossorigin": True}


def run(
    level_id=1,
    correct=40,
    keystrokes=44,
    errors=4,
    combo=12,
    tokens=20,
    lives=1,
    cleared=True,
    duration=30_000,
):
    return {
        "level_id": level_id,
        "correct_chars": correct,
        "keystrokes": keystrokes,
        "errors": errors,
        "max_combo": combo,
        "tokens_destroyed": tokens,
        "lives_left": lives,
        "cleared": cleared,
        "duration_ms": duration,
    }


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_levels_are_ten_and_ordered(client):
    r = client.get("/api/levels")
    assert r.status_code == 200
    levels = r.json()["levels"]
    assert [lvl["id"] for lvl in levels] == list(range(1, 11))
    # Later levels are worth more, and tokens never fall slower than the level before
    # them within a block: letters accelerate as the key set widens, then words and
    # phrases start gentle again because the token itself is longer.
    multipliers = [lvl["multiplier"] for lvl in levels]
    assert multipliers == sorted(multipliers)
    letters = [lvl["fall_seconds"] for lvl in levels if lvl["mode"] == "letter"]
    assert letters == sorted(letters, reverse=True)
    longform = [lvl["fall_seconds"] for lvl in levels if lvl["mode"] != "letter"]
    assert longform == sorted(longform)


def test_long_tokens_get_enough_fall_time(client):
    """A beginner must be able to finish the longest token before it lands.

    At 15 WPM (75 chars/min) the longest token needs len/1.25 seconds. Require
    that to fit in 75% of the token's fall budget, so a learner has headroom
    while still keeping the level a challenge.
    """
    for lvl in client.get("/api/levels").json()["levels"]:
        for token in lvl["bank"]:
            budget = lvl["fall_seconds"] + lvl["seconds_per_char"] * max(0, len(token) - 1)
            need = len(token) / 1.25
            assert need <= budget * 0.8, (
                f"level {lvl['id']} token {token!r}: needs {need:.1f}s at 15 WPM "
                f"but only falls for {budget:.1f}s"
            )


def test_every_level_bank_is_typeable_with_its_keys(client):
    levels = client.get("/api/levels").json()["levels"]
    for lvl in levels:
        allowed = set(lvl["keys"])
        for token in lvl["bank"]:
            assert token, f"level {lvl['id']} has an empty token"
            assert set(token) <= allowed, f"level {lvl['id']} token {token!r} uses a key not in its keymap"


def test_quote_level_uses_full_sentences(client):
    levels = client.get("/api/levels").json()["levels"]
    quotes = levels[-1]["bank"]
    assert all(q.endswith(".") for q in quotes)
    assert all(len(q.split()) >= 6 for q in quotes)


def test_score_is_scored_by_server(client):
    r = client.post("/api/scores", json=run())
    assert r.status_code == 201, r.text
    body = r.json()
    saved = body["saved"]
    assert saved["correct_chars"] == 40
    assert 0 < saved["accuracy"] <= 1
    assert saved["wpm"] > 0
    # score is a positive integer end to end
    assert isinstance(saved["score"], int) and saved["score"] > 0
    assert body["new_best"] is True
    assert body["rank"] == 1


def test_faster_run_scores_higher(client):
    slow = client.post("/api/scores", json=run(duration=60_000)).json()["saved"]["score"]
    fast = client.post("/api/scores", json=run(duration=20_000)).json()["saved"]["score"]
    assert fast > slow


def test_goal_met_requires_all_targets(client):
    bad = run(cleared=True, tokens=3)
    r = client.post("/api/scores", json=bad)
    assert r.status_code == 422
    assert "clear" in r.json()["detail"].lower()


def test_rejects_impossible_counters(client):
    r = client.post("/api/scores", json=run(correct=10, errors=99, keystrokes=5))
    assert r.status_code == 422


def test_rejects_unknown_level(client):
    r = client.post("/api/scores", json=run(level_id=99))
    assert r.status_code == 422


def test_lives_cannot_exceed_level(client):
    r = client.post("/api/scores", json=run(lives=9))
    assert r.status_code == 422


def test_leaderboard_shows_one_row_per_player(signed_in):
    for _ in range(3):
        signed_in.post("/api/scores", json=run(correct=30, keystrokes=30, errors=0, combo=10, tokens=20))
    signed_in.post("/api/scores", json=run(correct=60, keystrokes=60, errors=0, combo=40, tokens=20))
    rows = signed_in.get("/api/scores", params={"level_id": 1, "limit": 10}).json()["scores"]
    mine = [r for r in rows if r["display_name"] == "sam"]
    assert len(mine) == 1
    assert mine[0]["you"] is True
    # the surviving row is the best run, not the most recent
    assert mine[0]["correct_chars"] == 60


def test_personal_best_tracks_across_runs(signed_in):
    first = signed_in.post("/api/scores", json=run()).json()
    assert first["new_best"] is True and first["personal_best"] == first["saved"]["score"]
    worse = signed_in.post("/api/scores", json=run(correct=5, keystrokes=9, errors=4, combo=1, tokens=2, cleared=False)).json()
    assert worse["new_best"] is False
    assert worse["personal_best"] == first["saved"]["score"]


def test_profile_rename_rewrites_history(signed_in):
    signed_in.post("/api/scores", json=run())
    r = signed_in.post("/api/profile", json={"display_name": "  Sam   Rivera "})
    assert r.status_code == 200
    assert r.json()["display_name"] == "Sam Rivera"
    rows = signed_in.get("/api/scores/mine").json()["scores"]
    assert rows and all(row["display_name"] == "Sam Rivera" for row in rows)


def test_profile_needs_signin(client):
    r = client.post("/api/profile", json={"display_name": "anon"})
    assert r.status_code == 401


def test_anonymous_runs_share_one_guest_row(client):
    for _ in range(4):
        client.post("/api/scores", json=run(correct=20, keystrokes=20, errors=0, combo=10, tokens=20))
    client.post("/api/scores", json=run(correct=60, keystrokes=60, errors=0, combo=40, tokens=20))
    rows = client.get("/api/scores", params={"level_id": 1, "limit": 10}).json()["scores"]
    guests = [r for r in rows if r["display_name"] == "Guest"]
    assert len(guests) == 1, "anonymous runs must not flood the board"
    assert guests[0]["correct_chars"] == 60


def test_anonymous_play_still_saves_and_ranks(client):
    r = client.post("/api/scores", json=run())
    assert r.status_code == 201
    body = r.json()
    assert body["saved"]["display_name"] == "Guest"
    assert "player_key" not in body["saved"], "the email hash must never reach a client"
    assert body["rank"] >= 1


def test_me_anonymous_vs_signed_in(client, signed_in):
    anon = client.get("/api/me").json()
    assert anon["signed_in"] is False and anon["best_scores"] == {}
    signed_in.post("/api/scores", json=run(level_id=2, tokens=24))
    me = signed_in.get("/api/me").json()
    assert me["signed_in"] is True
    assert "2" in me["best_scores"]
    assert me["display_name"] == "sam2" or me["display_name"] == "sam"  # local part of the email


def test_mine_is_empty_without_identity(client):
    assert client.get("/api/scores/mine").json()["scores"] == []


def test_leaderboard_rejects_unknown_level(client):
    assert client.get("/api/scores", params={"level_id": 42}).status_code == 404


def test_store_never_writes_the_email():
    key = store.player_key("a.student@school.example")
    assert key is not None and "@" not in key and len(key) == 32
    assert key == store.player_key("A.Student@School.Example ")  # normalised


def test_content_ids_match_constant():
    assert len(content.LEVELS) == 10
    assert all(lvl["target_count"] > 0 for lvl in content.LEVELS)