"""FastAPI routes for authentication: login, logout, refresh, me.

Cookie details (`design.md` — "Cookie Details"):
  - `sabbi_access`: httpOnly, Secure (prod only), SameSite=Lax, Path=/, 15 min TTL.
  - `sabbi_refresh`: httpOnly, Secure (prod only), SameSite=Lax, Path=/, 7 day TTL.
  - Refresh rotates on use: the old token row is deleted and a new pair is
    issued (`user-auth/spec.md` — "Refresh Token Lifecycle").

`app.state.user_repo` (an `auth.repository.UserRepository`) must be set by
the parent app's lifespan before this router is exercised — see
`api/routes.py`.
"""

from __future__ import annotations

import os

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi import Cookie as CookieParam

from auth.dependencies import get_current_user
from auth.models import LoginRequest, UserResponse
from auth.passwords import verify_password
from auth.repository import UserRepository
from auth.tokens import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_refresh_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])

ACCESS_COOKIE = "sabbi_access"
REFRESH_COOKIE = "sabbi_refresh"
ACCESS_MAX_AGE = 15 * 60
REFRESH_MAX_AGE = 7 * 24 * 60 * 60
INVALID_CREDENTIALS_MESSAGE = "Invalid email or password"


def _is_production() -> bool:
    return os.environ.get("NODE_ENV") == "production" or os.environ.get("ENV") == "production"


def _user_repo(request: Request) -> UserRepository:
    return request.app.state.user_repo


def _set_auth_cookies(response: Response, *, access_token: str, refresh_token: str) -> None:
    secure = _is_production()
    response.set_cookie(
        ACCESS_COOKIE,
        access_token,
        max_age=ACCESS_MAX_AGE,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=REFRESH_MAX_AGE,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/")


async def _issue_token_pair(response: Response, repo: UserRepository, *, user: dict) -> None:
    access_token = create_access_token(user_id=user["id"], email=user["email"], role=user["role"])
    refresh_token = create_refresh_token(user_id=user["id"])
    await repo.store_refresh_token(user_id=user["id"], token_hash=hash_refresh_token(refresh_token))
    _set_auth_cookies(response, access_token=access_token, refresh_token=refresh_token)


@router.post("/login")
async def login(
    data: LoginRequest,
    response: Response,
    repo: UserRepository = Depends(_user_repo),
) -> dict:
    """Validate credentials and set `sabbi_access`/`sabbi_refresh` cookies.

    Responds 401 for both "unknown email" and "wrong password" with the
    same generic message — never reveal whether the email exists
    (`user-auth/spec.md` — "Invalid credentials").
    """
    row = await repo.get_by_email(data.email)
    if row is None or not verify_password(data.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS_MESSAGE)

    user = {"id": row["id"], "email": row["email"], "role": row["role"]}
    await _issue_token_pair(response, repo, user=user)
    return {"user": user}


@router.post("/logout")
async def logout(
    response: Response,
    repo: UserRepository = Depends(_user_repo),
    sabbi_refresh: str | None = CookieParam(default=None),
) -> dict:
    """Clear auth cookies and delete the refresh token row so the session
    cannot be resurrected via `/auth/refresh` (`user-auth/spec.md` —
    "Logout clears session")."""
    if sabbi_refresh:
        await repo.delete_refresh_token(hash_refresh_token(sabbi_refresh))
    _clear_auth_cookies(response)
    return {"status": "logged_out"}


@router.post("/refresh")
async def refresh(
    response: Response,
    repo: UserRepository = Depends(_user_repo),
    sabbi_refresh: str | None = CookieParam(default=None),
) -> dict:
    """Rotate the refresh token: validate it server-side (signature AND DB
    lookup — a valid signature alone is not enough), delete the old row,
    then issue a new access/refresh pair (`user-auth/spec.md` — "Refresh
    issues new access token", "Invalid or expired refresh token forces
    re-login")."""
    if not sabbi_refresh:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = decode_refresh_token(sabbi_refresh)
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid refresh token") from exc

    token_hash = hash_refresh_token(sabbi_refresh)
    stored = await repo.get_refresh_token(token_hash)
    if stored is None:
        raise HTTPException(status_code=401, detail="Refresh token revoked or unknown")

    row = await repo.get_by_id(payload["sub"])
    if row is None:
        raise HTTPException(status_code=401, detail="User no longer exists")

    await repo.delete_refresh_token(token_hash)
    user = {"id": row["id"], "email": row["email"], "role": row["role"]}
    await _issue_token_pair(response, repo, user=user)
    return {"user": user}


@router.get("/me", response_model=UserResponse)
async def me(user: dict = Depends(get_current_user)) -> dict:
    """Return the authenticated user's identity for frontend session
    bootstrap (`user-auth/spec.md` — "Fetch current user")."""
    return user
