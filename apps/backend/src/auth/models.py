"""Pydantic request/response models for SABBI auth endpoints.

`design.md` — "Interfaces / Contracts": `POST /auth/login`, `GET /auth/me`,
`POST /admin/users`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

Role = str  # "user" | "admin" — validated via Field pattern below


class LoginRequest(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    role: str
    active_thread_id: str | None = None


class ThreadUpdate(BaseModel):
    thread_id: str


class UserCreate(BaseModel):
    email: str
    password: str = Field(min_length=8)
    role: str = Field(default="user", pattern="^(user|admin)$")
