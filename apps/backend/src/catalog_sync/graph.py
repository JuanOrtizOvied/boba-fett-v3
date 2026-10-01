"""Microsoft Graph client for the SharePoint catalog sync
(`openspec/changes/catalog-sharepoint-sync`, Phase 7.2; design.md ADR-12).

`msal` obtains the app-only token (it is blocking, so it runs in a worker
thread) and `httpx` makes every Graph call. This module only talks to Graph:
it never touches the database and never decides what to sync.

Errors expose the HTTP status and the Graph error code only. The response
message, the token and the client secret are never put in an exception, a
log line or the CLI output.

It also holds a small helper CLI to find the values the sync needs:

    python -m catalog_sync.graph discover --host <tenant>.sharepoint.com --site TECH \\
        --file BD_Productos_ejemplo.xlsx

That is an explicit manual action, so it works whatever `SHAREPOINT_SYNC_ENABLED`
says: the flag only gates the automatic, webhook-driven behavior.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from types import TracebackType
from urllib.parse import quote

import httpx

from catalog_sync.config import Settings

GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"
GRAPH_SCOPES = ["https://graph.microsoft.com/.default"]
AUTHORITY_TEMPLATE = "https://login.microsoftonline.com/{tenant_id}"

TokenProvider = Callable[[], Awaitable[str]]


class GraphConfigError(ValueError):
    """A required Azure setting is missing. Names the variables, never values."""


class GraphError(Exception):
    """A failed Graph or token request. Carries the HTTP status (None for a
    token failure), the Graph error code and the name of the client call that
    failed (`operation`, e.g. "get_site_by_path"), nothing else."""

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
    """App-only access token via `msal`. The `ConfidentialClientApplication`
    keeps its own token cache and refreshes on expiry. `app_factory` exists so
    tests can run without the network."""

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
            # Only the short error code, never `error_description`: it can
            # echo parts of the request.
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
    """Thin async client over the Graph calls the sync needs."""

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

    # -- sites and files ---------------------------------------------------

    async def get_site_by_path(self, hostname: str, site_path: str) -> dict:
        """`site_path` is the part after the host, e.g. "sites/TECH"."""
        response = await self._request(
            "GET",
            f"/sites/{hostname}:/{quote(site_path.strip('/'), safe='/')}",
            operation="get_site_by_path",
        )
        return response.json()

    async def get_default_drive(self, site_id: str) -> dict:
        response = await self._request(
            "GET", f"/sites/{quote(site_id, safe=',')}/drive", operation="get_default_drive"
        )
        return response.json()

    async def list_children(self, site_id: str, folder_path: str = "") -> list[dict]:
        """Items directly inside a folder of the default drive (`""` is the
        root), following Graph's paging."""
        base = f"/sites/{quote(site_id, safe=',')}/drive/root"
        folder = folder_path.strip("/")
        next_url: str | None = (
            f"{base}:/{quote(folder, safe='/')}:/children" if folder else f"{base}/children"
        )
        items: list[dict] = []
        while next_url:
            response = await self._request("GET", next_url, operation="list_children")
            data = response.json()
            items.extend(data.get("value", []))
            next_url = data.get("@odata.nextLink")
        return items

    async def find_files(
        self,
        site_id: str,
        name: str,
        *,
        start_folder: str = "",
        max_depth: int = 3,
        max_folders: int = 100,
        on_folder: Callable[[str], None] | None = None,
    ) -> list[tuple[str, dict]]:
        """Files whose name contains `name` (case-insensitive), as
        `(path from the drive root, item)`. Walks the folders breadth-first
        instead of using Graph search: search goes through the SharePoint
        index, which an app limited to `Sites.Selected` often cannot use.
        `start_folder` begins the walk there instead of at the drive root (one
        request when the folder is known), and `on_folder` is told each
        folder just before it is listed."""
        wanted = name.casefold()
        found: list[tuple[str, dict]] = []
        queue: deque[tuple[str, int]] = deque([(start_folder.strip("/"), 0)])
        visited = 0
        while queue and visited < max_folders:
            folder, depth = queue.popleft()
            visited += 1
            if on_folder:
                on_folder(folder)
            for item in await self.list_children(site_id, folder):
                item_name = item.get("name", "")
                path = f"{folder}/{item_name}" if folder else item_name
                if "folder" in item:
                    if depth < max_depth:
                        queue.append((path, depth + 1))
                elif "file" in item and wanted in item_name.casefold():
                    found.append((path, item))
        return found

    @staticmethod
    def _file_url(site_id: str, path: str) -> str:
        return f"/sites/{quote(site_id, safe=',')}/drive/root:/{quote(path.strip('/'), safe='/')}"

    async def get_file_by_path(self, site_id: str, path: str) -> dict:
        response = await self._request(
            "GET", self._file_url(site_id, path), operation="get_file_by_path"
        )
        return response.json()

    async def download_file(self, site_id: str, path: str) -> bytes:
        response = await self._request(
            "GET", f"{self._file_url(site_id, path)}:/content", operation="download_file"
        )
        return response.content

    # -- change notification subscriptions ---------------------------------

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


# -- discovery helper ------------------------------------------------------


@dataclass(frozen=True)
class FileMatch:
    name: str
    path: str
    web_url: str | None
    exact: bool


@dataclass(frozen=True)
class Discovery:
    site_id: str
    site_name: str | None
    drive_id: str | None
    files: list[FileMatch]


async def discover(
    client: GraphClient,
    *,
    host: str | None = None,
    site: str | None = None,
    site_id: str | None = None,
    file_name: str | None = None,
    folder: str = "",
    on_folder: Callable[[str], None] | None = None,
) -> Discovery:
    """Resolve the site (by `host` + `site` name, or take `site_id` as given),
    its default drive, and, when `file_name` is given, the files whose name
    contains it, with their path relative to the drive root."""
    site_name: str | None = None
    if not site_id:
        if not host or not site:
            raise GraphConfigError("Pass --host and --site, or --site-id")
        found = await client.get_site_by_path(host, f"sites/{site}")
        site_id = found["id"]
        site_name = found.get("displayName")

    drive = await client.get_default_drive(site_id)

    files: list[FileMatch] = []
    if file_name:
        wanted = file_name.casefold()
        for path, item in await client.find_files(
            site_id, file_name, start_folder=folder, on_folder=on_folder
        ):
            files.append(
                FileMatch(
                    name=item.get("name", ""),
                    path=path,
                    web_url=item.get("webUrl"),
                    exact=item.get("name", "").casefold() == wanted,
                )
            )
        files.sort(key=lambda f: (not f.exact, f.path))

    return Discovery(site_id=site_id, site_name=site_name, drive_id=drive.get("id"), files=files)


def _print_discovery(result: Discovery, file_name: str | None) -> None:
    print(f"Site: {result.site_name or '(by id)'}")
    print(f"Drive id: {result.drive_id}")
    if file_name:
        if not result.files:
            print(f"No file found matching {file_name!r}.")
        for match in result.files[:10]:
            tag = "exact" if match.exact else "similar"
            print(f"  [{tag}] {match.path}")
            if match.web_url:
                print(f"          {match.web_url}")
    print()
    print("Add to apps/backend/.env (not secret, but do not commit real values):")
    print(f"SHAREPOINT_SITE_ID={result.site_id}")
    exact = [f for f in result.files if f.exact]
    if len(exact) == 1:
        print(f"SHAREPOINT_FILE_PATH={exact[0].path}")
    elif exact:
        print("SHAREPOINT_FILE_PATH=  # several exact matches, pick the right one above")
    elif file_name:
        print("SHAREPOINT_FILE_PATH=  # no exact match, check the name")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m catalog_sync.graph")
    sub = parser.add_subparsers(dest="command", required=True)
    find = sub.add_parser(
        "discover", help="find SHAREPOINT_SITE_ID and SHAREPOINT_FILE_PATH for the sync"
    )
    find.add_argument("--host", help="SharePoint host, e.g. contoso.sharepoint.com")
    find.add_argument("--site", help="site name from its URL, e.g. TECH")
    find.add_argument("--site-id", help="skip the site lookup and use this id")
    find.add_argument("--file", dest="file_name", help="workbook file name to look for")
    find.add_argument(
        "--folder",
        default="",
        help="start looking in this folder of the library (much faster when you know it)",
    )
    return parser


async def _run_discover(args: argparse.Namespace) -> int:
    settings = Settings.from_env()
    site_id = args.site_id or settings.sharepoint_site_id
    async with GraphClient(settings) as client:
        result = await discover(
            client,
            host=args.host,
            site=args.site,
            site_id=site_id if not (args.host and args.site) else None,
            file_name=args.file_name,
            folder=args.folder,
            on_folder=lambda folder: print(f"  looking in /{folder}", file=sys.stderr, flush=True),
        )
    _print_discovery(result, args.file_name)
    return 0


def main(argv: list[str] | None = None) -> int:
    from dotenv import load_dotenv

    load_dotenv()
    args = _build_parser().parse_args(argv)
    try:
        return asyncio.run(_run_discover(args))
    except GraphConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    except GraphError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        if exc.operation == "get_site_by_path" and exc.status in (403, 404, 500):
            print(
                "Hint: looking a site up by name can fail for an app limited to "
                "Sites.Selected. Get the site id from the browser "
                "(<site url>/_api/site/id and <site url>/_api/web/id, joined as "
                "host,site-id,web-id) and run again with --site-id instead of "
                "--host and --site.",
                file=sys.stderr,
            )
        elif exc.status == 403:
            print(
                "Hint: the app has no access to that site (Sites.Selected must be "
                "granted on it).",
                file=sys.stderr,
            )
        elif exc.status == 404:
            print("Hint: check the host, the site name and the file name.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
