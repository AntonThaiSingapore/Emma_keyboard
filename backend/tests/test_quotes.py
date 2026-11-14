"""Content checks for the quote level.

The quotes are the app's voice — they should read like something a teenager
would actually want on their wall, not like a motivational poster. These tests
are deliberately soft (length, punctuation, tone markers) because taste is not
machine-checkable, but they catch the copy-paste slips that do happen.
"""

import re

from app import content

QUOTES = content.LEVELS[-1]["bank"]
def test_quote_count_and_uniqueness():
    assert len(set(QUOTES)) == len(QUOTES) >= 12, "quotes must not repeat"
    # Long enough to be a real sentence, short enough to type in one breath.
    for q in QUOTES:
        words = len(q.split())
        assert 6 <= words <= 20, f"{words} words: {q!r}"


def test_quotes_are_properly_punctuated():
    for q in QUOTES:
        assert q.endswith("."), f"no full stop: {q!r}"
        assert q[0].isupper(), f"not capitalised: {q!r}"
        assert "  " not in q, f"double space: {q!r}"
        assert q == q.strip(), f"stray whitespace: {q!r}"


def test_quotes_avoid_shouting_and_odd_characters():
    for q in QUOTES:
        assert q.upper() != q, f"all caps: {q!r}"
        assert "!" not in q, f"exclamation marks read as shouting: {q!r}"
        # Only characters a player can type with the level's keymap.
        assert set(q) <= set(content.LEVELS[-1]["keys"]), f"untypeable characters: {q!r}"


def test_quotes_do_not_blame_the_reader():
    """Second person is fine; scolding is not. Keep the voice encouraging."""
    banned = [r"\byou (must|should have|failed)\b", r"\blazy\b", r"\bdiscipline\b", r"\bhustle\b"]
    for q in QUOTES:
        for pattern in banned:
            assert not re.search(pattern, q, re.IGNORECASE), f"scolding tone: {q!r}"


def test_lower_levels_ramp_from_letters_to_quotes():
    modes = [lvl["mode"] for lvl in content.LEVELS]
    assert modes[:6] == ["letter"] * 6
    assert modes[6:8] == ["word", "word"]
    assert modes[8:] == ["phrase", "quote"]
    # Letters must only ever use letters that earlier levels have taught.
    taught = set()
    for lvl in content.LEVELS[:6]:
        taught |= set(lvl["keys"])
        assert set(lvl["keys"]) <= taught
