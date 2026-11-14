"""Scoring, derived entirely on the server.

The client sends raw keystroke statistics; the score, WPM and accuracy it sees
back are whatever this module computes. Keeping the formula here means a saved
score can't disagree with the results screen, and tuning it later doesn't
require a frontend release.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Bounds used to reject nonsense submissions (e.g. a bot posting 10^9 chars).
MAX_CORRECT_CHARS = 3000
MAX_KEYSTROKES = 5000
MAX_TOKENS = 400
MIN_DURATION_MS = 1000
MAX_DURATION_MS = 3_600_000

# Points per unit of work, before the level multiplier and accuracy factor.
POINTS_PER_CORRECT_CHAR = 8
POINTS_PER_COMBO_STEP = 6
POINTS_PER_TOKEN = 25
CLEAR_BONUS = 200

# Pace the score is tuned around. Hitting it scores the base value; slower runs
# keep half, faster runs earn up to double, so speed matters without letting a
# lucky 10-second burst beat an honest long run.
TARGET_WPM = 30.0
SPEED_FLOOR = 0.5
SPEED_CEILING = 2.0


@dataclass(frozen=True)
class Stats:
    correct_chars: int
    keystrokes: int
    errors: int
    max_combo: int
    tokens_destroyed: int
    lives_left: int
    cleared: bool
    duration_ms: int


@dataclass(frozen=True)
class Result:
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


def validate(stats: Stats, max_lives: int) -> str | None:
    """Return a human-readable problem, or None when the numbers are plausible."""
    if not (0 <= stats.correct_chars <= MAX_CORRECT_CHARS):
        return f"correct_chars must be between 0 and {MAX_CORRECT_CHARS}"
    if not (0 <= stats.keystrokes <= MAX_KEYSTROKES):
        return f"keystrokes must be between 0 and {MAX_KEYSTROKES}"
    if not (0 <= stats.errors <= stats.keystrokes):
        return "errors cannot exceed keystrokes"
    if stats.correct_chars > stats.keystrokes:
        return "correct_chars cannot exceed keystrokes"
    if not (0 <= stats.max_combo <= stats.correct_chars):
        return "max_combo must be between 0 and correct_chars"
    if not (0 <= stats.tokens_destroyed <= MAX_TOKENS):
        return f"tokens_destroyed must be between 0 and {MAX_TOKENS}"
    if not (0 <= stats.lives_left <= max_lives):
        return "lives_left is out of range"
    if not (MIN_DURATION_MS <= stats.duration_ms <= MAX_DURATION_MS):
        return "duration is out of range"
    return None


def accuracy(stats: Stats) -> float:
    """Share of keystrokes that were correct, 0..1."""
    if stats.keystrokes <= 0:
        return 0.0
    return stats.correct_chars / stats.keystrokes


def wpm(stats: Stats) -> float:
    """Gross words per minute, one word = five correct characters (typing standard)."""
    minutes = stats.duration_ms / 60_000
    if minutes <= 0:
        return 0.0
    return (stats.correct_chars / 5) / minutes


def compute(stats: Stats, multiplier: float) -> Result:
    acc = accuracy(stats)
    words = wpm(stats)
    # Accuracy never zeroes a run out: even a rough first attempt keeps half its
    # points, so the leaderboard rewards finishing rather than only perfection.
    accuracy_factor = 0.5 + 0.5 * acc
    speed_factor = min(SPEED_CEILING, max(SPEED_FLOOR, words / TARGET_WPM))
    base = (
        stats.correct_chars * POINTS_PER_CORRECT_CHAR
        + stats.max_combo * POINTS_PER_COMBO_STEP
        + stats.tokens_destroyed * POINTS_PER_TOKEN
    )
    score = int(math.floor(base * multiplier * accuracy_factor * speed_factor))
    if stats.cleared:
        score += CLEAR_BONUS
    return Result(
        score=score,
        wpm=round(words, 1),
        accuracy=round(acc, 4),
        correct_chars=stats.correct_chars,
        keystrokes=stats.keystrokes,
        errors=stats.errors,
        max_combo=stats.max_combo,
        tokens_destroyed=stats.tokens_destroyed,
        lives_left=stats.lives_left,
        cleared=stats.cleared,
        duration_ms=stats.duration_ms,
    )