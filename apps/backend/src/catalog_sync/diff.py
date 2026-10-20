"""Diff engine: existing `product_catalog` rows + parsed Excel rows ->
a `ChangeSet` of inserts, updates, adoptions, and soft-deletes
(`openspec/changes/catalog-sharepoint-sync` — design.md ADR-1, ADR-3,
ADR-4, ADR-6, ADR-7, Open Decision 1; spec scenarios SYNC-01 to SYNC-13).

Pure module: no I/O, no database. `official_lists` (the valid values for
`asset_class`, `geographic_focus`, `underlying`, and `manager`) is supplied
by the caller — this is what lets a pure function resolve composite and
finite-set fields to their canonical spelling (SYNC-19 to SYNC-26) without
fetching anything itself.

`CatalogRepository`-shaped rows in, `CatalogRepository`-shaped writes out:
`existing_rows` are `db.models.CatalogProduct` instances (already exactly
the read shape `CatalogRepository.list_for_sync` will return), and each
change's `fields` dict is ready to hand to `sync_insert`/`sync_update`
(Phase 4) — no second translation step.

Also derives `manager_score` from `OfficialLists.manager_scores` when
`manager` resolves to an entity with a fixed score (design.md, Open
Decision 2) — the Excel has no score column, so this is the only source
for it on a synced row.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from catalog_sync.composite import parse_composite
from catalog_sync.config import (
    CONTROL_FIELD_TYPE,
    FIELD_MAPPING,
    KEY_FIELD_TYPE,
    FieldMapping,
)
from catalog_sync.normalize import match_official_value, normalize_currency, normalize_key
from catalog_sync.parser import ParsedRow
from db.models import AssetAllocation, CatalogProduct

_COMPOSITE_FIELDS = {"asset_class", "geographic_focus", "underlying"}

_IGNORED_ELIMINAR_UNKNOWN_CODIGO = "eliminar_true_unknown_codigo"
_IGNORED_AMBIGUOUS_ADOPTION = "ambiguous_adoption_candidates"


@dataclass(frozen=True)
class OfficialLists:
    """Valid values for the sync's finite-set fields (design.md ADR-7).
    `asset_class`/`geographic_focus`/`underlying` are the fixed backend
    constants (`db.models`); `manager` is fetched live from the `manager`
    table by the caller, since it can grow. `administrator` has no source
    column in the Excel sheet and is intentionally absent.

    `manager_scores` maps each official manager name to its fixed score
    (only managers with a known score — e.g. skip "Cash o efectivo",
    `score_is_fixed=false`), for the derived `manager_score` rule (Open
    Decision 2). Defaults to empty, so existing callers that don't care
    about derived scores don't need to pass it."""

    asset_class: list[str]
    geographic_focus: list[str]
    underlying: list[str]
    manager: list[str]
    manager_scores: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class InsertChange:
    codigo: str
    fields: dict[str, object]


@dataclass(frozen=True)
class UpdateChange:
    catalog_id: int
    codigo: str
    fields: dict[str, object]


@dataclass(frozen=True)
class AdoptChange:
    """A `codigo IS NULL` legacy row matched by name to an Excel row with an
    unknown `codigo` (design.md, Open Decision 1). `fields` always includes
    `codigo` (unconditionally changing from `None`) plus any other mapped
    field that differs from the candidate's current values — same
    resolution and diffing as `UpdateChange`, just also assigning the code.
    Kept distinct from `UpdateChange` so a run report / dry-run CLI can
    call out adoptions rather than lump them in with ordinary updates."""

    catalog_id: int
    codigo: str
    fields: dict[str, object]


@dataclass(frozen=True)
class SoftDeleteChange:
    catalog_id: int
    codigo: str


@dataclass(frozen=True)
class IgnoredRow:
    row_number: int
    codigo: str
    reason: str


@dataclass(frozen=True)
class ChangeSet:
    inserts: tuple[InsertChange, ...] = ()
    updates: tuple[UpdateChange, ...] = ()
    adoptions: tuple[AdoptChange, ...] = ()
    soft_deletes: tuple[SoftDeleteChange, ...] = ()
    ignored: tuple[IgnoredRow, ...] = ()

    def is_empty(self) -> bool:
        return not (
            self.inserts or self.updates or self.adoptions or self.soft_deletes or self.ignored
        )


def _resolve_field_value(
    db_field: str, field_type: str, raw: str, official_lists: OfficialLists
) -> object:
    """Turn a mapped field's raw Excel text into its final, storable value:
    composite fields are parsed into allocations with each name matched
    against its official list (SYNC-19 to SYNC-21, SYNC-24, SYNC-25),
    `manager` is matched the same way (SYNC-23), `currency` is normalized
    (SYNC-26), and everything else is used as written."""
    if field_type == "composite":
        official = getattr(official_lists, db_field)
        resolved: list[AssetAllocation] = []
        for element in parse_composite(raw):
            matched_name, _matched = match_official_value(element.name, official)
            resolved.append(AssetAllocation(name=matched_name, percentage=element.percentage))
        return resolved
    if field_type == "finite_set":
        value, _matched = match_official_value(raw, official_lists.manager)
        return value
    if field_type == "normalized":
        return normalize_currency(raw)
    return raw


def _allocations_equal(a: list[AssetAllocation], b: list[AssetAllocation]) -> bool:
    """Order-insensitive comparison: the Excel and the DB may legitimately
    list the same allocations in a different order without that being a
    real change (SYNC-03)."""

    def key(allocations: list[AssetAllocation]) -> list[tuple[str, float]]:
        return sorted((alloc.name, alloc.percentage) for alloc in allocations)

    return key(a) == key(b)


def _values_equal(db_field: str, new_value: object, current_value: object) -> bool:
    if db_field in _COMPOSITE_FIELDS:
        return _allocations_equal(new_value, current_value)
    return new_value == current_value


def _derive_manager_score(
    parsed: ParsedRow,
    official_lists: OfficialLists,
    *,
    current_manager_score: int | None,
    manager_changed: bool,
) -> int | None:
    """Open Decision 2: when `manager` resolves to an entity with a fixed
    score, derive `manager_score` from it — filling it when it's currently
    empty (`current_manager_score is None`, always true for a new insert),
    or refreshing it when `manager` itself changed this run. Never
    overwrites a different existing score for an unchanged manager, never
    guesses for a manager with no fixed score, and never manufactures a
    no-op write when the derived score already matches. Returns the score
    to set, or `None` when nothing should be derived."""
    manager_raw = parsed.fields.get("manager", "")
    if not manager_raw:
        return None
    resolved_manager, _matched = match_official_value(manager_raw, official_lists.manager)
    score = official_lists.manager_scores.get(resolved_manager)
    if score is None or score == current_manager_score:
        return None
    if current_manager_score is None or manager_changed:
        return score
    return None


def _find_adoption_candidate(
    name: str, unadopted_by_name: dict[str, list[CatalogProduct]]
) -> tuple[CatalogProduct | None, bool]:
    """Adoption rule (design.md, Open Decision 1): when an Excel `codigo`
    matches no existing entry, a single `codigo IS NULL` row with the same
    normalized `name` is adopted (its `codigo` gets set) instead of
    inserting a duplicate — this is what makes the first sync safe even
    when seeding is imperfect.

    Returns `(candidate, ambiguous)`: `candidate` is set only for an
    unambiguous single match. `ambiguous` is `True` when more than one
    `codigo IS NULL` row shares the normalized name — nothing is adopted
    and nothing is inserted in that case; the row is logged instead of
    guessing."""
    matches = unadopted_by_name.get(normalize_key(name), [])
    if len(matches) == 1:
        return matches[0], False
    if len(matches) > 1:
        return None, True
    return None, False


def diff_catalog(
    existing_rows: list[CatalogProduct],
    parsed_rows: list[ParsedRow],
    official_lists: OfficialLists,
    *,
    field_mapping: dict[str, FieldMapping] = FIELD_MAPPING,
) -> ChangeSet:
    """Compute the `ChangeSet` for one sync run.

    Matches each `ParsedRow` to an existing entry by `codigo` (normalized on
    both sides — SYNC-04). When no entry has that `codigo`, and the row
    isn't delete-flagged, an unambiguous name match against a
    `codigo IS NULL` legacy row is adopted instead of inserting a duplicate
    (Open Decision 1) — see `_find_adoption_candidate`. A row absent from
    `parsed_rows` is never touched (SYNC-10) — this function only ever
    iterates `parsed_rows`.
    """
    mapped_fields = [
        entry["db_field"]
        for entry in field_mapping.values()
        if entry["type"] not in (KEY_FIELD_TYPE, CONTROL_FIELD_TYPE)
    ]
    field_types = {entry["db_field"]: entry["type"] for entry in field_mapping.values()}

    existing_by_codigo: dict[str, CatalogProduct] = {
        row.codigo.strip().upper(): row for row in existing_rows if row.codigo
    }
    unadopted_by_name: dict[str, list[CatalogProduct]] = {}
    for row in existing_rows:
        if row.codigo is None:
            unadopted_by_name.setdefault(normalize_key(row.name), []).append(row)

    inserts: list[InsertChange] = []
    updates: list[UpdateChange] = []
    adoptions: list[AdoptChange] = []
    soft_deletes: list[SoftDeleteChange] = []
    ignored: list[IgnoredRow] = []

    for parsed in parsed_rows:
        existing = existing_by_codigo.get(parsed.codigo)
        is_adoption = False

        if existing is None and not parsed.delete_flag:
            candidate, ambiguous = _find_adoption_candidate(
                parsed.fields.get("name", ""), unadopted_by_name
            )
            if ambiguous:
                ignored.append(
                    IgnoredRow(
                        row_number=parsed.row_number,
                        codigo=parsed.codigo,
                        reason=_IGNORED_AMBIGUOUS_ADOPTION,
                    )
                )
                continue
            if candidate is not None:
                existing = candidate
                is_adoption = True

        if existing is None:
            if parsed.delete_flag:
                # SYNC-08: no entry is created just to mark it deleted.
                ignored.append(
                    IgnoredRow(
                        row_number=parsed.row_number,
                        codigo=parsed.codigo,
                        reason=_IGNORED_ELIMINAR_UNKNOWN_CODIGO,
                    )
                )
                continue

            insert_fields: dict[str, object] = {}
            for db_field in mapped_fields:
                raw = parsed.fields.get(db_field, "")
                if not raw:
                    continue
                insert_fields[db_field] = _resolve_field_value(
                    db_field, field_types[db_field], raw, official_lists
                )
            derived_score = _derive_manager_score(
                parsed, official_lists, current_manager_score=None, manager_changed=False
            )
            if derived_score is not None:
                insert_fields["manager_score"] = derived_score
            inserts.append(InsertChange(codigo=parsed.codigo, fields=insert_fields))
            continue

        # Matched an existing entry — active or already soft-deleted, it
        # makes no difference to field updates (SYNC-11) — or an adopted
        # legacy row, same diffing either way.
        changed_fields: dict[str, object] = {}
        for db_field in mapped_fields:
            raw = parsed.fields.get(db_field, "")
            if not raw:
                # SYNC-12: a blank cell never overwrites the stored value.
                continue
            new_value = _resolve_field_value(db_field, field_types[db_field], raw, official_lists)
            current_value = getattr(existing, db_field)
            if not _values_equal(db_field, new_value, current_value):
                changed_fields[db_field] = new_value

        derived_score = _derive_manager_score(
            parsed,
            official_lists,
            current_manager_score=existing.manager_score,
            manager_changed="manager" in changed_fields,
        )
        if derived_score is not None:
            changed_fields["manager_score"] = derived_score

        if is_adoption:
            # `codigo` unconditionally changes from None, so this is never
            # empty even when every other field already matched.
            changed_fields["codigo"] = parsed.codigo
            adoptions.append(
                AdoptChange(catalog_id=existing.id, codigo=parsed.codigo, fields=changed_fields)
            )
        elif changed_fields:
            updates.append(
                UpdateChange(catalog_id=existing.id, codigo=parsed.codigo, fields=changed_fields)
            )

        if parsed.delete_flag and not existing.is_deleted:
            # SYNC-07. Blank/FALSE (parsed.delete_flag is False) never
            # restores an already-deleted entry (SYNC-09) — this branch
            # only ever sets `is_deleted`, never clears it.
            soft_deletes.append(SoftDeleteChange(catalog_id=existing.id, codigo=parsed.codigo))

    return ChangeSet(
        inserts=tuple(inserts),
        updates=tuple(updates),
        adoptions=tuple(adoptions),
        soft_deletes=tuple(soft_deletes),
        ignored=tuple(ignored),
    )
