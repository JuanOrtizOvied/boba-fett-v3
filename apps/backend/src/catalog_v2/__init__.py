"""Catalog v2 (`openspec/changes/catalog-v2-sharepoint-sync`).

A parallel implementation of the product catalog, backed by the `_v2` tables
and fed from the new SharePoint workbook. It imports nothing from the v1
catalog modules (`catalog_sync`, `db.catalog_repository`, `db.catalog_excel`),
so it can be removed on its own when v1 is retired.
"""
