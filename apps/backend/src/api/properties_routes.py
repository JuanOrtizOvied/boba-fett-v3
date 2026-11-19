"""Read-only admin endpoints of the properties section.

Own router, apart from `admin_routes`. Every route requires `require_admin`, like
the rest of the admin area. There is no route that writes: the table is filled by
the sync from the SharePoint workbook.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from auth.dependencies import require_admin
from db.properties import PropertyDetail, PropertyRepository, PropertySummary

router = APIRouter(
    prefix="/admin/properties", tags=["properties"], dependencies=[Depends(require_admin)]
)


def _property_repo(request: Request) -> PropertyRepository:
    return request.app.state.property_repo


@router.get("", response_model=list[PropertySummary])
async def list_properties(
    request: Request,
    search: str | None = Query(default=None, max_length=200),
) -> list[PropertySummary]:
    return await _property_repo(request).list_properties(search)


@router.get("/{code}", response_model=PropertyDetail)
async def get_property(code: str, request: Request) -> PropertyDetail:
    detail = await _property_repo(request).get_property(code)
    if detail is None:
        raise HTTPException(status_code=404, detail="Property not found")
    return detail
