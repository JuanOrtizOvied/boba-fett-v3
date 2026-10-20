"""Composite field parser: `"Name XX%, Name YY%"` -> `[AssetAllocation(...)]`
for the `asset_class`, `geographic_focus`, and `underlying` Excel columns
(`openspec/changes/catalog-sharepoint-sync` — design.md ADR-6; spec
scenarios SYNC-19 to SYNC-22).

Pure module: no I/O, no database, no official-list matching. Matching each
parsed name against the official vocabulary (design.md ADR-7) is the
caller's job (`normalize.match_official_value`), applied per element after
parsing — this module only turns text into `(name, percentage)` pairs.
"""

from __future__ import annotations

import re

from db.models import AssetAllocation

# A valid segment is "<name> <percentage>%", with the percentage as the very
# last thing in the segment (only trailing whitespace allowed after `%`).
# Decimal percentages use a dot — the comma is always the pair separator,
# never a decimal separator (design.md ADR-6).
_SEGMENT_RE = re.compile(r"^(?P<name>.+?)\s+(?P<percentage>\d+(?:\.\d+)?)\s*%\s*$")


def parse_composite(raw: str) -> list[AssetAllocation]:
    """Parse a composite Excel cell into allocation pairs.

    Splits on commas (SYNC-19); each resulting segment must be exactly
    "<name> XX%" with no other `%` inside the name. A bare "y" inside a name
    is never treated as a separator (SYNC-20: `"Cash y Otros 100%"` is one
    element named "Cash y Otros").

    If any segment fails that check — including the single-segment case
    when there is no comma at all, so an apparent "y"-separated pair like
    `"Cash 85% y Bonos Perú 15%"` still contains an embedded `%` in what
    would be the name — the whole raw value is kept as a single element
    holding the raw text at 0% (SYNC-21, design.md ADR-6), so downstream
    readers that iterate elements (`CatalogRepository._parse_json_allocations`)
    keep working and Observaciones can flag it with the offending text
    visible to the admin.
    """
    text = raw.strip()
    if not text:
        return []

    segments = [s.strip() for s in text.split(",")]
    parsed: list[AssetAllocation] = []
    for segment in segments:
        match = _SEGMENT_RE.match(segment)
        if match is None:
            return [AssetAllocation(name=text, percentage=0)]
        name = match.group("name").strip()
        if "%" in name:
            # A second "%" inside the name means a pair got merged into one
            # segment (missing comma between two "name XX%" pairs) — the
            # whole value is unparseable, not just this segment.
            return [AssetAllocation(name=text, percentage=0)]
        parsed.append(AssetAllocation(name=name, percentage=float(match.group("percentage"))))

    return parsed
