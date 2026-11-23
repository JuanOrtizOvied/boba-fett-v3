"""Admin endpoints to read and manage administrators and managers.

Own router, apart from `admin_routes` (whose `GET /admin/administrators` and
`/admin/managers` keep feeding the old catalog modal). Every route requires
`require_admin`. `kind` is `administrators` or `managers`; each one works on its own table.
A row is deleted softly and can be restored; no route removes it for good.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from auth.dependencies import require_admin
from db.entity_scores import (
    KINDS,
    DuplicateNameError,
    EntityScore,
    EntityScoreCreate,
    EntityScoreRepository,
    EntityScoreUpdate,
)

router = APIRouter(
    prefix="/admin/entity-scores", tags=["entity-scores"], dependencies=[Depends(require_admin)]
)


def _entity_score_repo(request: Request) -> EntityScoreRepository:
    return request.app.state.entity_score_repo


def _kind(kind: str) -> str:
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="Not found")
    return kind


def _conflict(exc: DuplicateNameError) -> HTTPException:
    return HTTPException(status_code=409, detail="exists_deleted" if exc.deleted else "exists")


@router.get("/{kind}", response_model=list[EntityScore])
async def list_entity_scores(
    request: Request,
    kind: str = Depends(_kind),
    search: str | None = Query(default=None, max_length=200),
    include_deleted: bool = False,
) -> list[EntityScore]:
    return await _entity_score_repo(request).list_entities(
        kind, search, include_deleted=include_deleted
    )


@router.post("/{kind}", response_model=EntityScore, status_code=201)
async def create_entity_score(
    data: EntityScoreCreate, request: Request, kind: str = Depends(_kind)
) -> EntityScore:
    try:
        return await _entity_score_repo(request).create(kind, data)
    except DuplicateNameError as exc:
        raise _conflict(exc) from None


@router.patch("/{kind}/{entity_id}", response_model=EntityScore)
async def update_entity_score(
    entity_id: int, data: EntityScoreUpdate, request: Request, kind: str = Depends(_kind)
) -> EntityScore:
    try:
        entity = await _entity_score_repo(request).update(kind, entity_id, data)
    except DuplicateNameError as exc:
        raise _conflict(exc) from None
    if entity is None:
        raise HTTPException(status_code=404, detail="Not found")
    return entity


@router.delete("/{kind}/{entity_id}", status_code=204)
async def delete_entity_score(
    entity_id: int, request: Request, kind: str = Depends(_kind)
) -> Response:
    if not await _entity_score_repo(request).delete(kind, entity_id):
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)


@router.post("/{kind}/{entity_id}/restore", response_model=EntityScore)
async def restore_entity_score(
    entity_id: int, request: Request, kind: str = Depends(_kind)
) -> EntityScore:
    entity = await _entity_score_repo(request).restore(kind, entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail="Not found")
    return entity
