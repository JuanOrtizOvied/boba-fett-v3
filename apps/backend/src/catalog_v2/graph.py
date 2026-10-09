"""Microsoft Graph client of the v2 catalog sync
(`openspec/changes/catalog-v2-sharepoint-sync`, design.md ADR-7).

`msal` obtains the app-only token (it is blocking, so it runs in a worker
thread) and `httpx` makes every Graph call. This module only talks to Graph: it
never touches the database and never decides what to sync. It is a small copy of
what the current sync uses, kept in its own folder so v2 can be removed without
touching the current sync.

Errors expose the HTTP status and the Graph error code only. The response
message, the token and the client secret are never put in an exception or a log
line.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from types import TracebackType
from urllib.parse import quote

import httpx

from catalog_v2.config import Settings

GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"
GRAPH_SCOPES = ["https://graph.microsoft.com/.default"]
AUTHORITY_TEMPLATE = "https://login.microsoftonline.com/{tenant_id}"

TokenProvider = Callable[[], Awaitable[str]]


class GraphConfigError(ValueError):
    """A required setting is missing. Names the variables, never the values."""


class GraphError(Exception):
    """A failed Graph or token request. Carries the HTTP status (None for a token
    failure), the Graph error code and the name of the client call that failed
    (`operation`, e.g. "download_file"), nothing else."""

    def __init__(self, status: int | None, code: str | None, operation: str | None = None):
        self.status = status
        self.code = code
        self.operation = operation
        where = f"operation={operation}, " if operation else ""
        super().__init__(f"Microsoft Graph request failed ({where}status={status}, code={code})")


def _require_credentials(settings: Settings) -> tuple[str, str, str]:
    missing = [
        name
        for name, value in (
            ("AZURE_CLIENT_ID", settings.azure_client_id),
            ("AZURE_TENANT_ID", settings.azure_tenant_id),
            ("AZURE_CLIENT_SECRET", settings.azure_client_secret),
        )
        if not value
    ]
    if missing:
        raise GraphConfigError(f"Missing Azure settings: {', '.join(missing)}")
    assert settings.azure_client_id and settings.azure_tenant_id and settings.azure_client_secret
    return settings.azure_client_id, settings.azure_tenant_id, settings.azure_client_secret


class MsalTokenProvider:
    """App-only access token via `msal`. The `ConfidentialClientApplication` keeps
    its own token cache and refreshes on expiry. `app_factory` exists so tests can
    run without the network."""

    def __init__(self, settings: Settings, *, app_factory: Callable[..., object] | None = None):
        self._client_id, self._tenant_id, self._secret = _require_credentials(settings)
        self._app_factory = app_factory
        self._app: object | None = None

    def _get_app(self):
        if self._app is None:
            factory = self._app_factory
            if factory is None:
                import msal

                factory = msal.ConfidentialClientApplication
            self._app = factory(
                self._client_id,
                authority=AUTHORITY_TEMPLATE.format(tenant_id=self._tenant_id),
                client_credential=self._secret,
            )
        return self._app

    def _acquire(self) -> str:
        result = self._get_app().acquire_token_for_client(scopes=GRAPH_SCOPES)  # type: ignore[attr-defined]
        token = result.get("access_token")
        if not token:
            # Only the short error code, never `error_description`: it can echo
            # parts of the request.
            raise GraphError(None, result.get("error") or "TokenError")
        return token

    async def __call__(self) -> str:
        return await asyncio.to_thread(self._acquire)


def _iso_utc(moment: datetime) -> str:
    if moment.tzinfo is None:
        raise ValueError("expiration must be timezone-aware")
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _error_code(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    error = body.get("error") if isinstance(body, dict) else None
    code = error.get("code") if isinstance(error, dict) else None
    return code if isinstance(code, str) else None


class GraphClient:
    """Thin async client over the Graph calls the v2 sync needs: the default
    drive of the site, the download of the workbook and the change notification
    subscriptions."""

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        http_client: httpx.AsyncClient | None = None,
        token_provider: TokenProvider | None = None,
        base_url: str = GRAPH_BASE_URL,
    ):
        settings = settings or Settings.from_env()
        self._token_provider = token_provider or MsalTokenProvider(settings)
        self._owns_http = http_client is None
        # Follows the redirect `/content` answers with; httpx drops the
        # Authorization header when that redirect leaves the Graph origin.
        self._http = http_client or httpx.AsyncClient(timeout=30, follow_redirects=True)
        self._base_url = base_url.rstrip("/")

    async def __aenter__(self) -> GraphClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def _request(
        self, method: str, path: str, *, operation: str, json: dict | None = None
    ) -> httpx.Response:
        if path.startswith("https://"):
            if not path.startswith(self._base_url):
                raise ValueError("refusing to send the Graph token to another host")
            url = path
        else:
            url = f"{self._base_url}{path}"
        token = await self._token_provider()
        response = await self._http.request(
            method,
            url,
            json=json,
            headers={"Authorization": f"Bearer {token}"},
        )
        if response.status_code >= 400:
            raise GraphError(response.status_code, _error_code(response), operation)
        return response

    # -- the drive and the workbook ------------------------------------------

    async def get_default_drive(self, site_id: str) -> dict:
        response = await self._request(
            "GET", f"/sites/{quote(site_id, safe=',')}/drive", operation="get_default_drive"
        )
        return response.json()

    async def download_file(self, site_id: str, path: str) -> bytes:
        """The bytes of the file at `path`, counted from the root of the site's
        default drive."""
        file_url = (
            f"/sites/{quote(site_id, safe=',')}/drive/root:/{quote(path.strip('/'), safe='/')}"
        )
        response = await self._request("GET", f"{file_url}:/content", operation="download_file")
        return response.content

    # -- change notification subscriptions -----------------------------------

    async def create_subscription(
        self,
        *,
        resource: str,
        notification_url: str,
        client_state: str,
        expiration: datetime,
        lifecycle_url: str | None = None,
        change_type: str = "updated",
    ) -> dict:
        payload: dict = {
            "changeType": change_type,
            "notificationUrl": notification_url,
            "resource": resource,
            "expirationDateTime": _iso_utc(expiration),
            "clientState": client_state,
        }
        if lifecycle_url:
            payload["lifecycleNotificationUrl"] = lifecycle_url
        response = await self._request(
            "POST", "/subscriptions", json=payload, operation="create_subscription"
        )
        return response.json()

    async def renew_subscription(self, subscription_id: str, expiration: datetime) -> dict:
        response = await self._request(
            "PATCH",
            f"/subscriptions/{quote(subscription_id, safe='')}",
            json={"expirationDateTime": _iso_utc(expiration)},
            operation="renew_subscription",
        )
        return response.json()

    async def delete_subscription(self, subscription_id: str) -> bool:
        """True if it was deleted, False if it no longer existed."""
        try:
            await self._request(
                "DELETE",
                f"/subscriptions/{quote(subscription_id, safe='')}",
                operation="delete_subscription",
            )
        except GraphError as exc:
            if exc.status == 404:
                return False
            raise
        return True
