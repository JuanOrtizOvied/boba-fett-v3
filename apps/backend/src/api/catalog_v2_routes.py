"""Admin API of the v2 catalog (`openspec/changes/catalog-v2-sharepoint-sync`).

Everything lives under `/admin/catalog-v2` and is admin only. The workbook is the
source of truth, so there is no route that edits a product, a series or an
administrator link: the web shows them read-only. What can be changed here is
the soft delete and restore of a product and the score of a manager or an
administrator, which have no workbook column.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from auth.dependencies import require_admin
from catalog_v2.config import (
    ADMINISTRATORS_SHEET,
    ASSET_CLASS_OPTIONS,
    CONTROL,
    CURRENCY_OPTIONS,
    GEOGRAPHIC_FOCUS_OPTIONS,
    HORIZON_OPTIONS,
    PRODUCTS_SHEET,
    SERIES_SHEET,
    UNDERLYING_OPTIONS,
    Settings,
)
from catalog_v2.lock import LockTimeoutError
from catalog_v2.models import (
    AdministratorV2,
    CatalogV2Product,
    CatalogV2ProductDetail,
    ManagerV2,
)
from catalog_v2.parser import MissingColumnError, MissingSheetError
from catalog_v2.repository import CatalogV2Repository
from catalog_v2.service import RunReport, run_sync_from_bytes

router = APIRouter(
    prefix="/admin/catalog-v2",
    tags=["admin-catalog-v2"],
    dependencies=[Depends(require_admin)],
)

# Where the sync reads the workbook from: a function that returns its bytes.
WorkbookSource = Callable[[], Awaitable[bytes]]


class SourceUnavailableError(RuntimeError):
    """The workbook cannot be fetched from SharePoint in this deployment."""


def _repo(request: Request) -> CatalogV2Repository:
    return request.app.state.catalog_v2_repo


def get_workbook_source() -> WorkbookSource:
    """Dependency that provides the workbook source. The download from SharePoint
    arrives with the Graph part of the sync; until then it reports that it is
    not available, and tests replace it with a fake source."""

    async def unavailable() -> bytes:
        raise SourceUnavailableError

    return unavailable


# --- Products ---------------------------------------------------------------


@router.get("/entries", response_model=list[CatalogV2Product])
async def list_entries(
    repo: Annotated[CatalogV2Repository, Depends(_repo)],
    search: str | None = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_deleted: bool = False,
    manager_id: Annotated[list[int] | None, Query()] = None,
    administrator_id: Annotated[list[int] | None, Query()] = None,
) -> list[CatalogV2Product]:
    """The v2 products, ranked when `search` is given (accent and case
    insensitive, on the name and the code). Deleted ones are left out unless
    `include_deleted=true`, and each item carries its `is_deleted` flag.
    `manager_id` and `administrator_id` narrow the list and can be repeated
    (`?manager_id=1&manager_id=2`): values of one filter combine with OR, and
    the filters and the search combine with AND."""
    return await repo.list_products(
        search,
        limit,
        offset,
        include_deleted=include_deleted,
        manager_ids=manager_id,
        administrator_ids=administrator_id,
    )


@router.get("/entries/{entry_id}", response_model=CatalogV2ProductDetail)
async def get_entry(
    entry_id: int,
    repo: Annotated[CatalogV2Repository, Depends(_repo)],
    include_deleted: bool = False,
) -> CatalogV2ProductDetail:
    """A product with its series and, for each series, its administrators."""
    detail = await repo.get_product(entry_id, include_deleted=include_deleted)
    if detail is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return detail


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: int, repo: Annotated[CatalogV2Repository, Depends(_repo)]
) -> Response:
    """Soft delete: the row stays with `is_deleted = true`. Deleting a product
    that is already deleted succeeds; an unknown id is a 404."""
    if not await repo.delete_product(entry_id):
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return Response(status_code=204)


@router.post("/entries/{entry_id}/restore", response_model=CatalogV2Product)
async def restore_entry(
    entry_id: int, repo: Annotated[CatalogV2Repository, Depends(_repo)]
) -> CatalogV2Product:
    """Bring a deleted product back. 404 when it does not exist or is not deleted.
    The workbook sync never does this."""
    restored = await repo.restore_product(entry_id)
    if restored is None:
        raise HTTPException(status_code=404, detail="Producto eliminado no encontrado")
    return restored


@router.get("/options")
async def get_options() -> dict[str, list[str]]:
    """The official values of the finite-set fields, as the workbook spells them,
    so the web checks membership without keeping its own copy of the lists."""
    return {
        "asset_class": list(ASSET_CLASS_OPTIONS),
        "geographic_focus": list(GEOGRAPHIC_FOCUS_OPTIONS),
        "underlying": list(UNDERLYING_OPTIONS),
        "currency": list(CURRENCY_OPTIONS),
        "investment_horizon": list(HORIZON_OPTIONS),
    }


@router.get("/excel-managed-fields")
async def get_excel_managed_fields() -> dict[str, list[str]]:
    """The fields that come from the workbook and are therefore read-only in the
    web, by level. Derived from the column mapping, so it cannot drift."""

    def fields(sheet) -> list[str]:
        return [c.field for c in sheet.columns if c.kind != CONTROL]

    return {
        "product": fields(PRODUCTS_SHEET),
        "series": fields(SERIES_SHEET),
        "administrator_link": fields(ADMINISTRATORS_SHEET),
    }


# --- Managers and administrators --------------------------------------------


class ScoreUpdate(BaseModel):
    score: int | None = Field(default=None, ge=1, le=10)


@router.get("/administrators", response_model=list[AdministratorV2])
async def list_administrators(
    repo: Annotated[CatalogV2Repository, Depends(_repo)],
) -> list[AdministratorV2]:
    return await repo.list_administrators()


@router.get("/managers", response_model=list[ManagerV2])
async def list_managers(repo: Annotated[CatalogV2Repository, Depends(_repo)]) -> list[ManagerV2]:
    return await repo.list_managers()


@router.patch("/administrators/{administrator_id}", response_model=AdministratorV2)
async def set_administrator_score(
    administrator_id: int,
    body: ScoreUpdate,
    repo: Annotated[CatalogV2Repository, Depends(_repo)],
) -> AdministratorV2:
    """Set the score of an administrator (1 to 10), or clear it with `null`. It
    is the only thing of an administrator that can be edited in the web."""
    updated = await repo.set_administrator_score(administrator_id, body.score)
    if updated is None:
        raise HTTPException(status_code=404, detail="Administrador no encontrado")
    return updated


@router.patch("/managers/{manager_id}", response_model=ManagerV2)
async def set_manager_score(
    manager_id: int,
    body: ScoreUpdate,
    repo: Annotated[CatalogV2Repository, Depends(_repo)],
) -> ManagerV2:
    """Set the score of a manager (1 to 10), or clear it with `null`."""
    updated = await repo.set_manager_score(manager_id, body.score)
    if updated is None:
        raise HTTPException(status_code=404, detail="Gestor no encontrado")
    return updated


# --- Sync on demand ---------------------------------------------------------


def _summary(report: RunReport) -> dict:
    if report.skipped or report.changeset is None:
        return {"skipped": True}
    changes = report.changeset
    counts = {
        label: {
            "inserts": len(changes.of(level, "insert")),
            "updates": len(changes.of(level, "update")),
            "deletes": len(changes.of(level, "delete")),
            "unchanged": changes.unchanged[level],
        }
        for level, label in (
            ("product", "products"),
            ("series", "series"),
            ("link", "administrator_links"),
        )
    }
    return {
        "skipped": False,
        **counts,
        "new_entities": {
            "managers": sum(e.role == "manager" for e in changes.new_entities),
            "administrators": sum(e.role == "administrator" for e in changes.new_entities),
        },
        "ignored": len(changes.ignored),
        "possible_duplicates": [
            {"role": role, "name": d.name, "similar_to": d.similar_to, "reason": d.reason}
            for role, found in changes.possible_duplicates.items()
            for d in found
        ],
        "pending_cells": len(report.parse_report.pending) if report.parse_report else 0,
    }


@router.post("/sync/run")
async def run_sync_now(
    repo: Annotated[CatalogV2Repository, Depends(_repo)],
    source: Annotated[WorkbookSource, Depends(get_workbook_source)],
    force: bool = False,
) -> dict:
    """Sync the workbook now, as a fallback to the automatic one, and answer what
    changed. An unchanged workbook is skipped unless `force=true`."""
    settings = Settings.from_env()
    if not settings.sync_enabled:
        raise HTTPException(
            status_code=409, detail="La sincronización de Catálogo v2 está desactivada"
        )
    missing = [
        name
        for name, value in (
            ("SHAREPOINT_SITE_ID", settings.sharepoint_site_id),
            ("SHAREPOINT_V2_FILE_PATH", settings.sharepoint_file_path),
        )
        if not value
    ]
    if missing:
        raise HTTPException(status_code=503, detail=f"Falta configurar: {', '.join(missing)}")
    try:
        data = await source()
    except SourceUnavailableError:
        raise HTTPException(
            status_code=503, detail="La descarga desde SharePoint todavía no está disponible"
        ) from None
    try:
        report = await run_sync_from_bytes(repo.pool, data, force=force)
    except LockTimeoutError:
        raise HTTPException(status_code=409, detail="Ya hay una sincronización en curso") from None
    except (MissingSheetError, MissingColumnError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return _summary(report)
