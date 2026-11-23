"""Admin endpoints for the Markowitz correlation matrix of asset classes.

Own router. Every route requires `require_admin`. For now it only reads; the writes come
in a later phase. The risk lambda does not read these tables yet.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from auth.dependencies import require_admin
from db.markowitz import MarkowitzMatrix, MarkowitzRepository

router = APIRouter(
    prefix="/admin/markowitz", tags=["markowitz"], dependencies=[Depends(require_admin)]
)


def _markowitz_repo(request: Request) -> MarkowitzRepository:
    return request.app.state.markowitz_repo


@router.get("", response_model=MarkowitzMatrix)
async def get_markowitz_matrix(request: Request) -> MarkowitzMatrix:
    return await _markowitz_repo(request).get_matrix()
