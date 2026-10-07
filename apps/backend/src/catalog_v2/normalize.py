"""Normalization and name matching for the v2 sync.

Pure functions, no database and no Graph. Official values (currency, horizon and
the composite names) are matched tolerantly: case, accents, spaces and dashes do
not matter, and a value that matches nothing is kept as typed. Managers and
administrators are matched far more strictly (see `find_entity`): only case,
accents and spacing make two names the same entity, and a name that differs in
anything else, including a legal form such as SAB or SAF, is a different entity.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass

from catalog_v2.config import (
    ARTICLES,
    CURRENCY_ALIASES,
    HORIZON_OPTIONS,
    LEGAL_FORMS,
    PENDING_VALUE,
)

_DASHES = re.compile("[‐-―−\\-]+")

# Reasons a new name is reported as a possible duplicate of an existing one.
SAME_WITHOUT_ARTICLES = "same_without_articles"
ABBREVIATION = "abbreviation"
TYPO = "typo"


def clean_text(value: object) -> str:
    """A cell as plain text: empty for a blank cell, otherwise stripped."""
    return "" if value is None else str(value).strip()


def normalize_key(value: object) -> str:
    """Lower case, no accents, every kind of dash unified, spaces collapsed and
    the spaces around an ampersand ignored (`S &T` and `S&T` are the same).
    Used to compare headers, official values and entity names."""
    text = _DASHES.sub("-", clean_text(value))
    text = re.sub(r"\s*&\s*", "&", text)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"\s+", " ", text).strip()


def is_pending(value: object) -> bool:
    """True for the `por confirmar` placeholder, however it is written."""
    return normalize_key(value) == normalize_key(PENDING_VALUE)


def match_official(value: object, options: Iterable[str]) -> str | None:
    """The official spelling of `value`, or `None` when it matches no option."""
    key = normalize_key(value)
    if not key:
        return None
    for option in options:
        if normalize_key(option) == key:
            return option
    return None


def normalize_currency(value: object) -> tuple[str, bool]:
    """`(value, matched)`: the official currency when the text is a known
    spelling, otherwise the text as typed and `False`."""
    text = clean_text(value)
    official = CURRENCY_ALIASES.get(normalize_key(text))
    return (official, True) if official else (text, False)


def normalize_horizon(value: object) -> tuple[str, bool]:
    """`(value, matched)` for the investment horizon, like `normalize_currency`."""
    text = clean_text(value)
    official = match_official(text, HORIZON_OPTIONS)
    return (official, True) if official else (text, False)


# --- Managers and administrators --------------------------------------------


def index_entities(names: Iterable[str]) -> dict[str, str]:
    """Existing entity names by their key, so a lookup is one dictionary read."""
    return {normalize_key(name): name for name in names}


def find_entity(name: object, existing: dict[str, str]) -> str | None:
    """The existing entity that `name` refers to, or `None` when it is new. Two
    names are the same entity only when they differ in case, accents or
    spacing. Nothing else is merged."""
    key = normalize_key(name)
    return existing.get(key) if key else None


def _words(value: object) -> list[str]:
    return re.sub(r"[^a-z0-9]+", " ", normalize_key(value)).split()


def _one_edit_apart(a: str, b: str) -> bool:
    """True when `a` and `b` differ by exactly one insertion, deletion or
    substitution of a character."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b, strict=True)) == 1
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    return any(long_[:i] + long_[i + 1 :] == short for i in range(len(long_)))


def similarity_reason(a: str, b: str) -> str | None:
    """Why `a` and `b` look like the same entity written two ways, or `None`.

    Three narrow patterns only, so the report stays short: the same words once
    articles are ignored, a single word that abbreviates the first word of the
    other name, and a one-character typo. Names that differ only by a legal form
    (SAB, SAF...), by an extra word, or that merely look alike are not reported.
    """
    key_a, key_b = normalize_key(a), normalize_key(b)
    if not key_a or not key_b or key_a == key_b:
        return None
    words_a, words_b = _words(a), _words(b)

    def strip_legal(words: list[str]) -> list[str]:
        return [w for w in words if w not in LEGAL_FORMS]

    if words_a != words_b and strip_legal(words_a) == strip_legal(words_b):
        return None  # only the legal form differs: distinct by definition

    def strip_articles(words: list[str]) -> list[str]:
        return [w for w in words if w not in ARTICLES]

    if words_a != words_b and strip_articles(words_a) == strip_articles(words_b):
        return SAME_WITHOUT_ARTICLES

    short, long_ = (words_a, words_b) if len(key_a) < len(key_b) else (words_b, words_a)
    if (
        len(short) == 1
        and len(short[0]) >= 3
        and long_
        and short[0] != long_[0]
        and long_[0].startswith(short[0])
    ):
        return ABBREVIATION

    if len(key_a) >= 6 and len(key_b) >= 6 and _one_edit_apart(key_a, key_b):
        return TYPO
    return None


@dataclass(frozen=True)
class PossibleDuplicate:
    """A name added as a new entity that looks like another one. Advisory only:
    nothing is merged and nothing in the database depends on it."""

    name: str
    similar_to: str
    reason: str


def find_possible_duplicates(
    new_names: Iterable[str], known_names: Iterable[str]
) -> list[PossibleDuplicate]:
    """Possible duplicates among the new names, compared with the known entities
    and with each other (each pair of new names is reported once)."""
    new = sorted(set(new_names))
    known = sorted(set(known_names))
    found: list[PossibleDuplicate] = []
    for name in new:
        for other in [*known, *new]:
            if other == name or (other in new and other < name):
                continue
            reason = similarity_reason(name, other)
            if reason:
                found.append(PossibleDuplicate(name, other, reason))
    return found
