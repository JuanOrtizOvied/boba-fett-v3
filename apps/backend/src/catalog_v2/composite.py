"""Parser for the composite columns of the v2 workbook (`Clase de Activo`,
`Foco Geográfico`, `Subyacente`).

A cell reads `Name 73%. Name 25%. Name 2%`: items separated by a period and a
space, each one a name followed by a percentage with a dot or comma decimal.
The percentages are on a 0 to 100 scale. A cell that does not fit is kept as one
raw-text item at 0 and is never guessed; the text `por confirmar` is a
placeholder that stores an empty composite. Pure functions: no database, no
Graph.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

from catalog_v2.normalize import clean_text, is_pending, match_official

# Statuses of a parsed cell.
EMPTY = "empty"  # blank cell
PENDING = "pending"  # the `por confirmar` placeholder
OK = "ok"  # every item was read
RAW = "raw"  # not readable: kept as one raw-text item at 0

# A name cannot contain a percent sign, so it never swallows a previous item
# when the separator is wrong ("Cash 85% y Bonos 15%" is not one item).
_ITEM = re.compile(r"\s*([^%]+?)\s+(\d+(?:[.,]\d+)?)\s*%\s*(?:\.\s+|\.?\s*$)")


@dataclass(frozen=True)
class CompositeItem:
    name: str
    percentage: float


@dataclass(frozen=True)
class Composite:
    """What a cell holds. `items` is empty for `EMPTY` and `PENDING`, the read
    items for `OK`, and a single raw-text item at 0 for `RAW`."""

    items: tuple[CompositeItem, ...]
    status: str
    raw: str

    @property
    def total(self) -> float:
        return round(sum(item.percentage for item in self.items), 6)

    def as_json(self) -> list[dict[str, object]]:
        """The shape stored in the JSONB columns."""
        return [{"name": i.name, "percentage": i.percentage} for i in self.items]


def parse_composite(value: object) -> Composite:
    text = clean_text(value)
    if not text:
        return Composite((), EMPTY, text)
    if is_pending(text):
        return Composite((), PENDING, text)

    items: list[CompositeItem] = []
    position = 0
    while position < len(text):
        match = _ITEM.match(text, position)
        if match is None:
            return Composite((CompositeItem(text, 0.0),), RAW, text)
        items.append(CompositeItem(match.group(1).strip(), float(match.group(2).replace(",", "."))))
        position = match.end()
    return Composite(tuple(items), OK, text)


def apply_official_names(
    composite: Composite, options: Iterable[str]
) -> tuple[Composite, list[str]]:
    """Replace each item name by its official spelling when it has one. Names
    that match nothing are kept as typed and returned, so the caller can report
    them as observations. A raw-text item is not a name and is left alone."""
    if composite.status != OK:
        return composite, []
    options = tuple(options)
    unmatched: list[str] = []
    items: list[CompositeItem] = []
    for item in composite.items:
        official = match_official(item.name, options)
        if official is None:
            unmatched.append(item.name)
        items.append(CompositeItem(official or item.name, item.percentage))
    return Composite(tuple(items), composite.status, composite.raw), unmatched
