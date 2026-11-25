"""Admin endpoints for the Markowitz correlation matrix of asset classes.

Own router. Every route requires `require_admin`. There is no route that deletes an asset
or a cell. The risk lambda does not read these tables yet.

A conflict (409) or an incomplete set of values (422) answers with an object that has a
`code` (`exists`, `slug_taken`, `incomplete`) and the data the screen needs to say what
happened.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from auth.dependencies import require_admin
from db.markowitz import (
    MarkowitzAsset,
    MarkowitzAssetCreate,
    MarkowitzAssetUpdate,
    MarkowitzCell,
    MarkowitzCellUpdate,
    MarkowitzIncompleteError,
    MarkowitzMatrix,
    MarkowitzNameExistsError,
    MarkowitzNotFoundError,
    MarkowitzRepository,
    MarkowitzSlugTakenError,
)

router = APIRouter(
    prefix="/admin/markowitz", tags=["markowitz"], dependencies=[Depends(require_admin)]
)


def _markowitz_repo(request: Request) -> MarkowitzRepository:
    return request.app.state.markowitz_repo


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Not found")


def _conflict(exc: Exception) -> HTTPException:
    if isinstance(exc, MarkowitzSlugTakenError):
        return HTTPException(
            status_code=409,
            detail={"code": "slug_taken", "slug": exc.slug, "asset": exc.holder},
        )
    return HTTPException(status_code=409, detail={"code": "exists"})


@router.get("", response_model=MarkowitzMatrix)
async def get_markowitz_matrix(request: Request) -> MarkowitzMatrix:
    return await _markowitz_repo(request).get_matrix()


@router.patch("/cells", response_model=list[MarkowitzCell])
async def set_markowitz_cell(data: MarkowitzCellUpdate, request: Request) -> list[MarkowitzCell]:
    try:
        return await _markowitz_repo(request).set_cell(data)
    except MarkowitzNotFoundError:
        raise _not_found() from None


@router.post("/assets", response_model=MarkowitzAsset, status_code=201)
async def create_markowitz_asset(data: MarkowitzAssetCreate, request: Request) -> MarkowitzAsset:
    try:
        return await _markowitz_repo(request).create_asset(data)
    except (MarkowitzNameExistsError, MarkowitzSlugTakenError) as exc:
        raise _conflict(exc) from None
    except MarkowitzIncompleteError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "incomplete",
                "missing": exc.missing,
                "unknown": exc.unknown,
                "repeated": exc.repeated,
            },
        ) from None


@router.patch("/assets/{asset_id}", response_model=MarkowitzAsset)
async def update_markowitz_asset(
    asset_id: int, data: MarkowitzAssetUpdate, request: Request
) -> MarkowitzAsset:
    try:
        return await _markowitz_repo(request).update_asset(asset_id, data)
    except MarkowitzNotFoundError:
        raise _not_found() from None
    except (MarkowitzNameExistsError, MarkowitzSlugTakenError) as exc:
        raise _conflict(exc) from None
