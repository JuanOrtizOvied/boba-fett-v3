"""Integration tests for `FichaRepository` (Slice 3a persistence) against real
Postgres. Covers create-with-lines, get, per-line status updates, confirm, the
derived status lifecycle, and list-by-status."""

from __future__ import annotations

from db.ficha_patrimonial import FichaClientInfo, FichaEnrichedRow
from db.ficha_repository import FichaRepository
from db.models import SearchResult


def _row(excel_row: int, name: str, enriched: SearchResult | None = None) -> FichaEnrichedRow:
    return FichaEnrichedRow(
        excel_row=excel_row,
        raw_name=name,
        raw_tipo_activo="Fondos mutuos",
        raw_amount=1000.0,
        raw_currency="USD",
        raw_return_rate="5%",
        raw_pertenencia="Titular",
        mapped_asset_class=None,
        normalized_return_rate="",
        enriched=enriched,
        enrichment_failed=enriched is None,
    )


async def test_create_get_and_status_lifecycle(test_pool, test_user_id):
    repo = FichaRepository(test_pool)
    client = FichaClientInfo(name="Ana", email="ana@x.com", phone="123", user_id=test_user_id)

    fid = await repo.create(
        client,
        [
            _row(8, "Fondo A", SearchResult(name="Fondo A", catalog_matched=True)),
            _row(9, "Fondo B"),
        ],
    )

    ficha = await repo.get(fid)
    assert ficha is not None
    assert ficha.client_name == "Ana"
    assert ficha.client_email == "ana@x.com"
    assert len(ficha.lines) == 2
    # Enrichment round-trips through JSONB.
    assert ficha.lines[0].enriched is not None
    assert ficha.lines[0].enriched.name == "Fondo A"
    assert ficha.lines[1].enriched is None
    # Nothing decided yet.
    assert ficha.status == "por_validar"

    await repo.update_line_status(ficha.lines[0].id, "approved")
    assert (await repo.get(fid)).status == "en_proceso"

    await repo.update_line_status(ficha.lines[1].id, "discarded")
    await repo.mark_confirmed(fid)
    assert (await repo.get(fid)).status == "validada"


async def test_create_stores_and_get_file_roundtrips_the_upload(test_pool, test_user_id):
    repo = FichaRepository(test_pool)
    client = FichaClientInfo(name="Ana", email="ana@x.com", phone="", user_id=test_user_id)
    content = b"PK\x03\x04 fake xlsx bytes \x00\x01\x02"

    fid = await repo.create(
        client,
        [_row(8, "Fondo A")],
        file_data=content,
        file_name="ficha-ana.xlsx",
    )

    stored = await repo.get_file(fid)
    assert stored == ("ficha-ana.xlsx", content)


async def test_get_file_returns_none_when_no_file_stored(test_pool, test_user_id):
    repo = FichaRepository(test_pool)
    client = FichaClientInfo(name="Ana", email="a@x.com", phone="", user_id=test_user_id)

    fid = await repo.create(client, [_row(8, "Fondo A")])

    assert await repo.get_file(fid) is None
    # Unknown ficha id -> None, never raises.
    assert await repo.get_file(999_999) is None


async def test_create_sets_line_ids_on_the_input_rows(test_pool, test_user_id):
    repo = FichaRepository(test_pool)
    client = FichaClientInfo(name="Ana", email="a@x.com", phone="", user_id=test_user_id)
    rows = [_row(8, "Fondo A"), _row(9, "Fondo B")]

    await repo.create(client, rows)

    assert all(r.line_id is not None for r in rows)
    assert rows[0].line_id != rows[1].line_id


async def test_parse_failure_persists_as_con_error(test_pool, test_user_id):
    repo = FichaRepository(test_pool)
    client = FichaClientInfo(name="X", email="x@x.com", phone="", user_id=test_user_id)
    fid = await repo.create(client, [], parse_failed=True)
    assert (await repo.get(fid)).status == "con_error"


async def test_delete_removes_the_ficha_and_its_lines(test_pool, test_user_id):
    repo = FichaRepository(test_pool)
    client = FichaClientInfo(name="Ana", email="a@x.com", phone="", user_id=test_user_id)
    fid = await repo.create(client, [_row(8, "Fondo A"), _row(9, "Fondo B")])

    assert await repo.delete(fid) is True
    assert await repo.get(fid) is None
    # Idempotent: deleting a missing ficha reports False.
    assert await repo.delete(fid) is False


async def test_list_filters_by_status(test_pool, test_user_id):
    repo = FichaRepository(test_pool)
    client = FichaClientInfo(name="Ana", email="ana@x.com", phone="", user_id=test_user_id)
    fid = await repo.create(client, [_row(8, "Fondo A")])

    assert any(i.id == fid for i in await repo.list())
    assert any(i.id == fid for i in await repo.list(status="por_validar"))
    assert all(i.id != fid for i in await repo.list(status="validada"))
