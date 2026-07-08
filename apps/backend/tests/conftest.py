"""Shared pytest fixtures for the SABBI backend test suite.

Sets deterministic auth secrets/admin credentials for the whole session so
`auth.tokens` and `auth.seed` behave predictably regardless of what a local
`.env` file (loaded via `python-dotenv` in `db.connection`) contains.
"""

from __future__ import annotations

import os

os.environ["JWT_SECRET"] = "test-access-secret-at-least-32-bytes-long"
os.environ["JWT_REFRESH_SECRET"] = "test-refresh-secret-at-least-32-bytes-long"
os.environ["ADMIN_EMAIL"] = "admin@sabbi.test"
os.environ["ADMIN_PASSWORD"] = "test-admin-password-123"
