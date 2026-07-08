"""FastAPI dependencies for authenticating and authorizing requests.

`design.md` — "Interfaces / Contracts": the access token travels exclusively
via the `sabbi_access` httpOnly cookie (never a header/localStorage), so
`get_current_user` reads it with FastAPI's `Cookie()` and validates it via
`auth.tokens.decode_access_token` (`user-auth/spec.md` — "Access Token
Validation"). `require_admin` builds on `get_current_user` and additionally
enforces the `admin` role (`access-control/spec.md` — "Role-Based Route
Protection").
"""

from __future__ import annotations

from typing import Any

import jwt
from fastapi import Cookie, Depends, HTTPException

from auth.tokens import decode_access_token

ACCESS_COOKIE_NAME = "sabbi_access"


async def get_current_user(
    sabbi_access: str | None = Cookie(default=None),
) -> dict[str, Any]:
    """Resolve the authenticated user from the `sabbi_access` cookie.

    Raises 401 when the cookie is missing, the token is expired, or the
    token is otherwise invalid (bad signature, wrong `type` claim, malformed).
    """
    if not sabbi_access:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = decode_access_token(sabbi_access)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Access token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid access token") from exc

    return {"id": payload["sub"], "email": payload["email"], "role": payload["role"]}


async def require_admin(
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Wrap `get_current_user`, additionally requiring role == 'admin'."""
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user
