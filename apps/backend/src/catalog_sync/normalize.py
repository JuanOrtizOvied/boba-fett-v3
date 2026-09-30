"""Tolerant normalization and official-list matching for finite-set Excel
fields (`manager`, `administrator`, `currency`, `geographic_focus`,
`underlying`, `asset_class`), plus currency normalization
(`openspec/changes/catalog-sharepoint-sync` — design.md ADR-7; spec
scenarios SYNC-23 to SYNC-26).

Pure module: no I/O, no database. Callers supply the official list of valid
values for a field — the backend constants in `db.models` for
`asset_class`/`geographic_focus`/`underlying`/`currency`, or the `manager`/
`administrator` names fetched separately by the caller. This module never
knows or cares where a list comes from.
"""

from __future__ import annotations

import unicodedata

from catalog_sync.config import ALIAS_TABLE, CURRENCY_ALIAS_TABLE

# En dash, em dash, minus sign -> plain hyphen (design.md ADR-7). Official
# lists mix these inconsistently (e.g. `UNDERLYING_OPTIONS` has "US
# Treasuries – Largo Plazo" with an en dash), so admins typing a plain
# hyphen in the Excel must still match.
_DASH_VARIANTS = {"–": "-", "—": "-", "−": "-"}


def normalize_key(value: str) -> str:
    """Comparison key for tolerant matching: lower-case, strip accents
    (NFKD), unify dash variants to `-`, and collapse whitespace."""
    text = value.strip()
    for variant, dash in _DASH_VARIANTS.items():
        text = text.replace(variant, dash)
    text = text.lower()
    decomposed = unicodedata.normalize("NFKD", text)
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(without_accents.split())


def _match_with_aliases(
    raw: str, official_values: list[str], alias_table: dict[str, str]
) -> tuple[str, bool]:
    key = normalize_key(raw)
    official_by_key = {normalize_key(v): v for v in official_values}

    if key in official_by_key:
        return official_by_key[key], True

    for alias_key, alias_target in alias_table.items():
        if normalize_key(alias_key) != key:
            continue
        target_key = normalize_key(alias_target)
        if target_key in official_by_key:
            return official_by_key[target_key], True

    return raw, False


def match_official_value(raw: str, official_values: list[str]) -> tuple[str, bool]:
    """Match `raw` against `official_values` tolerantly (SYNC-23), falling
    back to `ALIAS_TABLE` for known non-trivial variants (SYNC-24).

    Returns `(value, matched)`: on a hit, `value` is the official spelling
    and `matched` is `True`. On a miss, `value` is `raw` unchanged and
    `matched` is `False` (SYNC-25) so the caller (Observaciones) can flag
    it — this function never raises and never guesses.
    """
    return _match_with_aliases(raw, official_values, ALIAS_TABLE)


def normalize_currency(raw: str) -> str:
    """Normalize a currency value to one of `db.models.CURRENCY_OPTIONS`
    (SYNC-26): tolerant case/accent matching first ("soles", "Dolares",
    "dólares"), then `CURRENCY_ALIAS_TABLE` ("PEN", "USD", "Nuevos soles").
    An unrecognized value is returned unchanged, for Observaciones to flag.
    """
    from db.models import CURRENCY_OPTIONS

    value, _matched = _match_with_aliases(raw, CURRENCY_OPTIONS, CURRENCY_ALIAS_TABLE)
    return value
