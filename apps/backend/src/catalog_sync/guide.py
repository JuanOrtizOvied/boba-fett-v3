"""Guide, in Spanish, for the people who edit the catalog workbook in SharePoint
(`openspec/changes/catalog-sharepoint-sync`, Phase 8.4).

It is generated, never written by hand, so it cannot drift: the sheet name,
the headers, the delete-flag values, the aliases and the official lists all
come from the same constants the sync uses, and the managers come from the
database. A column added to `FIELD_MAPPING` appears in the guide with no
other change.

    python -m catalog_sync.guide [--output guia.md] [--without-db]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Sequence
from pathlib import Path

from catalog_sync.config import (
    ALIAS_TABLE,
    CONTROL_FIELD_TYPE,
    CURRENCY_ALIAS_TABLE,
    DELETE_FLAG_HEADER,
    DELETE_FLAG_TRUE_VALUES,
    FIELD_MAPPING,
    KEY_FIELD_TYPE,
    SHEET_NAME,
    excel_managed_fields,
)
from db.models import (
    ASSET_CLASS_OPTIONS,
    CURRENCY_OPTIONS,
    GEOGRAPHIC_FOCUS_OPTIONS,
    UNDERLYING_OPTIONS,
)

# Code shown as an example only: the format is a convention, not a constant.
EXAMPLE_CODE = "BD-00001"


def _delete_values() -> str:
    ordered = ["TRUE", *sorted(v for v in DELETE_FLAG_TRUE_VALUES if v != "TRUE")]
    return ", ".join(f"`{v}`" for v in ordered if v in DELETE_FLAG_TRUE_VALUES)


def _join_es(items: Sequence[str]) -> str:
    """"a", "a y b", "a, b y c"."""
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} y {items[-1]}"


def _bullets(values: Sequence[str]) -> str:
    return "\n".join(f"- {value}" for value in values)


def _column_description(header: str, field_type: str) -> str:
    if field_type == KEY_FIELD_TYPE:
        return (
            f"Código único del producto, por ejemplo `{EXAMPLE_CODE}`. Es lo que une la "
            "fila con el catálogo. Una fila sin código se ignora."
        )
    if field_type == CONTROL_FIELD_TYPE:
        return "Escribe `TRUE` para eliminar el producto. En los demás casos déjala vacía."
    if field_type == "composite":
        return "Uno o más valores de la lista oficial, cada uno con su porcentaje. Debe sumar 100%."
    if field_type == "finite_set":
        return "Un valor de la lista oficial."
    if field_type == "normalized":
        accepted = ", ".join(f"`{a}`" for a in CURRENCY_ALIAS_TABLE)
        return f"{' o '.join(CURRENCY_OPTIONS)}. También se aceptan {accepted}."
    return "Texto libre."


def _columns_table() -> str:
    rows = [
        f"| `{header}` | {_column_description(header, spec['type'])} |"
        for header, spec in FIELD_MAPPING.items()
    ]
    return "\n".join(["| Encabezado | Qué escribir |", "|---|---|", *rows])


def _lists_section(managers: Sequence[str] | None) -> str:
    sources: dict[str, Sequence[str] | None] = {
        "asset_class": ASSET_CLASS_OPTIONS,
        "geographic_focus": GEOGRAPHIC_FOCUS_OPTIONS,
        "underlying": UNDERLYING_OPTIONS,
        "currency": CURRENCY_OPTIONS,
        "manager": managers,
    }
    parts: list[str] = []
    for header, spec in FIELD_MAPPING.items():
        if spec["db_field"] not in sources:
            continue
        values = sources[spec["db_field"]]
        parts.append(f"### {header}")
        if values is None:
            parts.append("_La lista de gestores no se pudo incluir al generar esta guía._")
        else:
            parts.append(_bullets(values))
        parts.append("")
    return "\n".join(parts).rstrip()


def _aliases_section() -> str:
    pairs = [*ALIAS_TABLE.items(), *CURRENCY_ALIAS_TABLE.items()]
    return "\n".join(f"- `{alias}` se guarda como **{official}**" for alias, official in pairs)


def build_admin_guide(*, managers: Sequence[str] | None = None) -> str:
    """The guide as Markdown. `managers` is the current list of official
    managers; `None` leaves a note in its place instead of a list."""
    headers = list(FIELD_MAPPING)
    composite = [h for h, s in FIELD_MAPPING.items() if s["type"] == "composite"]
    asset = list(ASSET_CLASS_OPTIONS)
    example_ok = f"{asset[0]} 85%, {asset[1]} 15%"
    example_decimal = f"{asset[0]} 33.3%, {asset[1]} 66.7%"
    example_bad = f"{asset[0]} 85% y {asset[1]} 15%"
    protected = [h for h, s in FIELD_MAPPING.items() if s["db_field"] in excel_managed_fields()]
    protected_list = ", ".join(f"`{h}`" for h in protected)

    return f"""# Guía para editar el Excel del catálogo

Este archivo en SharePoint es la fuente del catálogo de productos. Cuando alguien guarda
cambios, el sistema los lee y actualiza el catálogo solo, sin que nadie tenga que hacer
nada más. Esta guía explica las reglas para que esa lectura funcione.

## Reglas que no se deben romper

- **No cambies el nombre de la hoja.** Debe llamarse exactamente `{SHEET_NAME}`. Si la
  renombras, el sistema no encuentra los datos y no actualiza nada.
- **No cambies los encabezados** de la primera fila. Se leen por su nombre exacto, no por
  su posición. Son: {", ".join(f"`{h}`" for h in headers)}.
- **No vacíes ni borres filas.** Una fila que falta no elimina el producto: para eliminar
  uno, usa la columna `{DELETE_FLAG_HEADER}` (ver más abajo).
- **Cada fila necesita un `Codigo` único**, por ejemplo `{EXAMPLE_CODE}`. Las filas sin código
  se ignoran. Si un código aparece dos veces, solo se usa la primera.
- **Una celda vacía no borra un dato.** Si dejas una celda en blanco, el valor que ya tiene el
  producto se mantiene.

## Qué escribir en cada columna

{_columns_table()}

## Campos con varios valores y porcentajes

Las columnas {_join_es([f"`{h}`" for h in composite])} aceptan varios valores, cada uno con
su porcentaje. Las reglas son:

- **Separa los valores con una coma.** Correcto: `{example_ok}`.
- **Nunca uses la letra "y" para separar.** Incorrecto: `{example_bad}`. El sistema no
  puede interpretarlo y lo marca para revisión.
- **Escribe cada valor con su porcentaje y el signo %**, en el formato `Nombre 85%`.
- **Los decimales llevan punto**, no coma, porque la coma separa los valores. Correcto:
  `{example_decimal}`.
- **Los porcentajes deben sumar 100%.**

## Listas de valores válidos

Usa exactamente estos nombres. Da igual si escribes mayúsculas o minúsculas, con tilde o sin
ella, o con espacios de más: el sistema los reconoce igual. Un valor que no esté en la lista se
guarda tal como lo escribiste y aparece en **Observaciones** en la web, para que se corrija.

{_lists_section(managers)}

### Variantes que también se reconocen

{_aliases_section()}

## Cómo eliminar un producto

1. Busca la fila del producto.
2. En la columna `{DELETE_FLAG_HEADER}` escribe {_delete_values()}.
3. Guarda. El producto deja de verse en el catálogo, pero **no se borra**: queda guardado y se
   puede recuperar.

Cualquier otro valor, o la celda vacía, no elimina nada. Si marcas `{DELETE_FLAG_HEADER}` en un
código que no existe en el catálogo, la fila se ignora.

## Cómo recuperar un producto eliminado

El Excel nunca recupera productos. Se hace desde la web:

1. En `/admin/catalog`, activa **Ver eliminados**.
2. Pulsa **Restaurar** en el producto.
3. **Vuelve al Excel y deja vacía la celda `{DELETE_FLAG_HEADER}` de esa fila.** Si la dejas en
   `TRUE`, el siguiente guardado lo elimina otra vez.

## Productos nuevos y productos que ya existen

- **Un producto nuevo:** agrega una fila con un código nuevo y completa sus columnas.
- **Un producto que ya existe en el catálogo pero no tiene código:** agrega una fila con un
  código nuevo y **el mismo nombre** que tiene en el catálogo. El sistema le asigna ese código en
  vez de crear un duplicado. Si dos productos sin código se llaman igual, no adopta ninguno y lo
  reporta.

## Qué se edita en la web y qué en el Excel

En la web, un producto con código muestra en solo lectura los campos que se editan desde el
Excel: {protected_list}. Los campos que no tienen columna en el Excel, como comisión,
administrador y sus scores, se siguen editando en la web.

## Después de guardar

Revisa el resumen **Observaciones** al inicio de `/admin/catalog`. Muestra los productos
incompletos o con valores fuera de las listas, y cada uno indica el código, el campo y el
valor para que lo encuentres en el Excel. Si algo no se actualiza, avisa al equipo técnico.
"""


async def _load_managers() -> list[str]:
    from db.catalog_repository import CatalogRepository
    from db.connection import close_pool, get_pool

    pool = await get_pool()
    try:
        return [m.name for m in await CatalogRepository(pool).list_managers()]
    finally:
        await close_pool()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m catalog_sync.guide")
    parser.add_argument("--output", help="write the guide to this file instead of printing it")
    parser.add_argument(
        "--without-db",
        action="store_true",
        help="do not read the managers from the database (leaves a note in their place)",
    )
    args = parser.parse_args(argv)

    managers: list[str] | None = None
    if not args.without_db:
        from dotenv import load_dotenv

        load_dotenv()
        managers = asyncio.run(_load_managers())

    guide = build_admin_guide(managers=managers)
    if args.output:
        Path(args.output).write_text(guide, encoding="utf-8")
        print(f"Guide written to {args.output}")
    else:
        # The guide has accents; a Windows console may not default to UTF-8.
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        print(guide)
    return 0


if __name__ == "__main__":
    sys.exit(main())
