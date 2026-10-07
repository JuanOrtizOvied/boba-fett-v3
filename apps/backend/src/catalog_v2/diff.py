"""Compares what the parser read with what is stored and lists the changes.

Pure: it takes the parsed workbook and a snapshot of the stored rows and returns
a `ChangeSet`; it does not read or write the database. The rules are those of
the current sync:

- a field absent from a row (a blank cell) never changes a stored value, and
  fields without a workbook column are never touched;
- an update lists only the fields whose value differs;
- a row is deleted only by an explicit `Eliminar`, never because it is missing,
  and a delete of an unknown key is ignored, never created;
- the sync never restores, and a deleted row can still be updated, without
  touching its `is_deleted`;
- a `por confirmar` composite fills an empty composite on insert but never
  overwrites a stored one;
- a series or a link whose parent does not exist is ignored and reported;
- managers and administrators are the same entity only when they differ in
  case, accents or spacing; any other name is added without score.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from catalog_v2.composite import PENDING, Composite
from catalog_v2.normalize import (
    PossibleDuplicate,
    find_entity,
    find_possible_duplicates,
    index_entities,
    normalize_key,
)
from catalog_v2.parser import ParsedRow, ParseResult

PRODUCT = "product"
SERIES = "series"
LINK = "link"

INSERT = "insert"
UPDATE = "update"
DELETE = "delete"

MANAGER = "manager"
ADMINISTRATOR = "administrator"

DELETE_UNKNOWN_KEY = "delete_unknown_key"
ORPHAN_SERIES = "orphan_series"
ORPHAN_LINK = "orphan_link"

_TOLERANCE = 1e-9


# --- What is stored ---------------------------------------------------------


@dataclass(frozen=True)
class StoredProduct:
    id: int
    codigo: str
    fields: dict[str, object]
    is_deleted: bool = False


@dataclass(frozen=True)
class StoredSeries:
    id: int
    codigo: str
    series: str
    fields: dict[str, object]
    is_deleted: bool = False


@dataclass(frozen=True)
class StoredLink:
    id: int
    codigo: str
    series: str
    administrator: str
    fields: dict[str, object]
    is_deleted: bool = False


@dataclass(frozen=True)
class StoredState:
    """A snapshot of the v2 tables. `fields` use the stored shapes: composites as
    lists of `{"name", "percentage"}`, the manager as its name, numbers as
    numbers."""

    products: tuple[StoredProduct, ...] = ()
    series: tuple[StoredSeries, ...] = ()
    links: tuple[StoredLink, ...] = ()
    managers: tuple[str, ...] = ()
    administrators: tuple[str, ...] = ()


# --- What the diff produces -------------------------------------------------


@dataclass(frozen=True)
class Change:
    """One change. `id` is the stored row for an update or a delete. `fields`
    holds the values to write: all provided ones for an insert, only the
    different ones for an update, nothing for a delete. Composites are lists of
    `{"name", "percentage"}` and the manager is the entity name to resolve."""

    level: str
    action: str
    key: tuple[str, ...]
    row_number: int
    id: int | None = None
    fields: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class NewEntity:
    role: str
    name: str


@dataclass(frozen=True)
class Ignored:
    level: str
    key: tuple[str, ...]
    row_number: int
    reason: str


@dataclass
class ChangeSet:
    """The result, in apply order: entities, then product, series and link
    changes. `unchanged` counts the rows that already match."""

    new_entities: list[NewEntity] = field(default_factory=list)
    changes: list[Change] = field(default_factory=list)
    ignored: list[Ignored] = field(default_factory=list)
    possible_duplicates: dict[str, list[PossibleDuplicate]] = field(default_factory=dict)
    unchanged: dict[str, int] = field(default_factory=lambda: {PRODUCT: 0, SERIES: 0, LINK: 0})

    def of(self, level: str, action: str) -> list[Change]:
        return [c for c in self.changes if c.level == level and c.action == action]

    @property
    def is_empty(self) -> bool:
        return not self.changes and not self.new_entities


# --- Comparison helpers -----------------------------------------------------


def _pairs(value: object) -> list[tuple[str, float]]:
    """A composite, stored or read, as comparable (name, percentage) pairs."""
    if isinstance(value, Composite):
        return [(i.name, float(i.percentage)) for i in value.items]
    pairs = []
    for item in value or []:
        name = item["name"] if isinstance(item, dict) else item.name
        percentage = item["percentage"] if isinstance(item, dict) else item.percentage
        pairs.append((name, float(percentage)))
    return pairs


def _differs(new: object, old: object) -> bool:
    if isinstance(new, Composite):
        a, b = _pairs(new), _pairs(old)
        return len(a) != len(b) or any(
            x[0] != y[0] or abs(x[1] - y[1]) > _TOLERANCE for x, y in zip(a, b, strict=True)
        )
    if isinstance(new, (int, float)) and not isinstance(new, bool):
        if old is None:
            return True
        return abs(float(new) - float(old)) > _TOLERANCE
    return (old or "") != new


def _storable(value: object) -> object:
    """The value as it is written: composites become lists of name and percentage."""
    return value.as_json() if isinstance(value, Composite) else value


def _series_key(codigo: str, series: str) -> tuple[str, str]:
    return codigo, normalize_key(series)


# --- The diff ---------------------------------------------------------------


class _Entities:
    """Managers or administrators known to the run: the stored ones plus the
    ones this run adds, so a name that repeats is added once."""

    def __init__(self, role: str, stored: tuple[str, ...], out: ChangeSet):
        self.role, self.out = role, out
        self.stored = tuple(stored)
        self.index = index_entities(stored)
        self.added: list[str] = []

    def resolve(self, name: str) -> str:
        """The entity `name` refers to, adding it (without score) when it is new."""
        found = find_entity(name, self.index)
        if found is not None:
            return found
        self.index[normalize_key(name)] = name
        self.added.append(name)
        self.out.new_entities.append(NewEntity(self.role, name))
        return name

    def finish(self) -> None:
        self.out.possible_duplicates[self.role] = find_possible_duplicates(self.added, self.stored)


def _ignore(out: ChangeSet, level: str, row: ParsedRow, reason: str) -> None:
    out.ignored.append(Ignored(level, row.key, row.row_number, reason))


def _changed_fields(row: ParsedRow, stored: dict[str, object], skip: set[str]) -> dict[str, object]:
    changed: dict[str, object] = {}
    for name, value in row.fields.items():
        if name in skip:
            continue
        if isinstance(value, Composite) and value.status == PENDING:
            continue  # a placeholder never overwrites a stored composite
        if _differs(value, stored.get(name)):
            changed[name] = _storable(value)
    return changed


def _insert_fields(row: ParsedRow, skip: set[str]) -> dict[str, object]:
    return {name: _storable(value) for name, value in row.fields.items() if name not in skip}


def diff_workbook(parsed: ParseResult, state: StoredState) -> ChangeSet:
    """The changes that turn the stored state into what the workbook says."""
    out = ChangeSet()
    managers = _Entities(MANAGER, state.managers, out)
    administrators = _Entities(ADMINISTRATOR, state.administrators, out)

    stored_products = {p.codigo: p for p in state.products}
    stored_series = {_series_key(s.codigo, s.series): s for s in state.series}
    stored_links = {
        (*_series_key(link.codigo, link.series), normalize_key(link.administrator)): link
        for link in state.links
    }
    known_products = set(stored_products)
    known_series = set(stored_series)

    # --- Products ---
    for row in parsed.products:
        (codigo,) = row.key
        existing = stored_products.get(codigo)
        if row.delete:
            if existing is None:
                _ignore(out, PRODUCT, row, DELETE_UNKNOWN_KEY)
            elif not existing.is_deleted:
                out.changes.append(Change(PRODUCT, DELETE, row.key, row.row_number, existing.id))
            else:
                out.unchanged[PRODUCT] += 1
            continue
        if existing is None:
            fields = _insert_fields(row, {"manager"})
            if "manager" in row.fields:
                fields["manager"] = managers.resolve(str(row.fields["manager"]))
            out.changes.append(Change(PRODUCT, INSERT, row.key, row.row_number, None, fields))
            known_products.add(codigo)
            continue
        fields = _changed_fields(row, existing.fields, {"manager"})
        if "manager" in row.fields:
            wanted = str(row.fields["manager"])
            if normalize_key(existing.fields.get("manager")) != normalize_key(wanted):
                fields["manager"] = managers.resolve(wanted)
        if fields:
            change = Change(PRODUCT, UPDATE, row.key, row.row_number, existing.id, fields)
            out.changes.append(change)
        else:
            out.unchanged[PRODUCT] += 1

    # --- Series ---
    for row in parsed.series:
        codigo, series = row.key
        key = _series_key(codigo, series)
        existing = stored_series.get(key)
        if codigo not in known_products:
            _ignore(out, SERIES, row, DELETE_UNKNOWN_KEY if row.delete else ORPHAN_SERIES)
            continue
        if row.delete:
            if existing is None:
                _ignore(out, SERIES, row, DELETE_UNKNOWN_KEY)
            elif not existing.is_deleted:
                out.changes.append(Change(SERIES, DELETE, row.key, row.row_number, existing.id))
            else:
                out.unchanged[SERIES] += 1
            continue
        if existing is None:
            out.changes.append(
                Change(SERIES, INSERT, row.key, row.row_number, None, _insert_fields(row, set()))
            )
            known_series.add(key)
            continue
        fields = _changed_fields(row, existing.fields, set())
        if fields:
            out.changes.append(Change(SERIES, UPDATE, row.key, row.row_number, existing.id, fields))
        else:
            out.unchanged[SERIES] += 1

    # --- Links ---
    for row in parsed.links:
        codigo, series, administrator = row.key
        series_key = _series_key(codigo, series)
        key = (*series_key, normalize_key(administrator))
        existing = stored_links.get(key)
        if series_key not in known_series:
            _ignore(out, LINK, row, DELETE_UNKNOWN_KEY if row.delete else ORPHAN_LINK)
            continue
        if row.delete:
            if existing is None:
                _ignore(out, LINK, row, DELETE_UNKNOWN_KEY)
            elif not existing.is_deleted:
                out.changes.append(Change(LINK, DELETE, row.key, row.row_number, existing.id))
            else:
                out.unchanged[LINK] += 1
            continue
        if existing is None:
            name = administrators.resolve(administrator)
            change_key = (codigo, series, name)
            out.changes.append(
                Change(LINK, INSERT, change_key, row.row_number, None, _insert_fields(row, set()))
            )
            continue
        fields = _changed_fields(row, existing.fields, set())
        if fields:
            out.changes.append(Change(LINK, UPDATE, row.key, row.row_number, existing.id, fields))
        else:
            out.unchanged[LINK] += 1

    managers.finish()
    administrators.finish()
    return out
