import { describe, expect, test } from "vitest";
import {
  buildConfirmProducts,
  hasUnmappedRow,
  resolveRowSource,
  toEditableRow,
} from "@/components/admin/ficha-patrimonial/reviewTableShared";
import type { FichaEnrichedRow } from "@/lib/portfolio-types";

function baseRow(overrides: Partial<FichaEnrichedRow> = {}): FichaEnrichedRow {
  return {
    excel_row: 8,
    raw_name: "Fondo Renta Fija",
    raw_tipo_activo: "Fondos mutuos",
    raw_amount: 5000,
    raw_currency: "USD",
    raw_return_rate: "5%",
    raw_pertenencia: "Titular",
    mapped_asset_class: "Mercados Publicos - Fijo",
    normalized_return_rate: "5.0",
    enriched: null,
    enrichment_failed: false,
    ...overrides,
  };
}

describe("resolveRowSource", () => {
  test("returns the enrichment's primary_source when enrichment succeeded", () => {
    const row = baseRow({
      enriched: {
        name: "Fondo Renta Fija",
        asset_class: [{ name: "mercados_publicos", percentage: 100 }],
        geographic_focus: [],
        commission: "",
        currency: "USD",
        administrator: "",
        manager: "",
        liquidity: "",
        return_rate: "5.0",
        underlying: [],
        catalog_product_id: 42,
        primary_source: "catalog",
        provenance: {},
      },
    });
    expect(resolveRowSource(row)).toBe("catalog");
  });

  test("returns web_search when the cascade resolved via web search", () => {
    const row = baseRow({
      enriched: {
        name: "Fondo X",
        asset_class: [],
        geographic_focus: [],
        commission: "",
        currency: "",
        administrator: "",
        manager: "",
        liquidity: "",
        return_rate: "",
        underlying: [],
        catalog_product_id: null,
        primary_source: "web_search",
        provenance: {},
      },
    });
    expect(resolveRowSource(row)).toBe("web_search");
  });

  test("returns not_found when enrichment_failed is true, even with a stale enriched value", () => {
    const row = baseRow({ enrichment_failed: true, enriched: null });
    expect(resolveRowSource(row)).toBe("not_found");
  });

  test("returns not_found when enriched is null and enrichment_failed is false", () => {
    const row = baseRow({ enrichment_failed: false, enriched: null });
    expect(resolveRowSource(row)).toBe("not_found");
  });
});

describe("toEditableRow", () => {
  test("prefers Excel amount/currency and the backend-mapped asset class", () => {
    const row = baseRow({
      enriched: {
        name: "Fondo Renta Fija Enriquecido",
        asset_class: [{ name: "Mercados Publicos - Fijo", percentage: 100 }],
        geographic_focus: [],
        commission: "0.5%",
        currency: "PEN",
        administrator: "Administradora X",
        manager: "Gestor Y",
        liquidity: "Diaria",
        return_rate: "6.0",
        underlying: [{ name: "Bonos", percentage: 100 }],
        catalog_product_id: 7,
        primary_source: "catalog",
        provenance: {},
      },
    });
    const editable = toEditableRow(row);
    expect(editable.excelRow).toBe(8);
    expect(editable.name).toBe("Fondo Renta Fija Enriquecido");
    expect(editable.amount).toBe("5000");
    // Excel currency wins over the enriched suggestion.
    expect(editable.currency).toBe("USD");
    expect(editable.assetClass).toBe("mercados_publicos_fijo");
    expect(editable.returnRateMin).toBe("5.0");
    expect(editable.returnRateMax).toBe("");
    expect(editable.commission).toBe("0.5%");
    expect(editable.administrator).toBe("Administradora X");
    expect(editable.liquidity).toBe("Diaria");
    expect(editable.underlying).toEqual([{ name: "Bonos", percentage: 100 }]);
    expect(editable.geographicFocus).toEqual([]);
    expect(editable.source).toBe("catalog");
  });

  test("falls back to raw fields and flags an unmapped asset class when enrichment is absent", () => {
    const row = baseRow({
      mapped_asset_class: null,
      raw_currency: "",
      normalized_return_rate: "",
      enriched: null,
      enrichment_failed: true,
    });
    const editable = toEditableRow(row);
    expect(editable.name).toBe("Fondo Renta Fija");
    expect(editable.currency).toBe("");
    expect(editable.assetClass).toBe("");
    expect(editable.returnRateMin).toBe("");
    expect(editable.geographicFocus).toEqual([]);
    expect(editable.underlying).toEqual([]);
    expect(editable.source).toBe("not_found");
  });
});

describe("hasUnmappedRow", () => {
  test("returns true when at least one row has no asset class selected", () => {
    const rows = [
      toEditableRow(baseRow({ excel_row: 8, mapped_asset_class: "Mercados Privados" })),
      toEditableRow(baseRow({ excel_row: 9, mapped_asset_class: null })),
    ];
    expect(hasUnmappedRow(rows)).toBe(true);
  });

  test("returns false when every row has an asset class selected", () => {
    const rows = [
      toEditableRow(baseRow({ excel_row: 8, mapped_asset_class: "Mercados Privados" })),
      toEditableRow(baseRow({ excel_row: 9, mapped_asset_class: "Cash y Otros" })),
    ];
    expect(hasUnmappedRow(rows)).toBe(false);
  });
});

describe("buildConfirmProducts", () => {
  test("builds one confirm product per row, carrying through enrichment fields", () => {
    const row = baseRow({
      enriched: {
        name: "Fondo Renta Fija",
        asset_class: [{ name: "Mercados Publicos - Fijo", percentage: 100 }],
        geographic_focus: [{ name: "Perú", percentage: 100 }],
        commission: "0.5%",
        currency: "USD",
        administrator: "Administradora X",
        manager: "Gestor Y",
        liquidity: "Diaria",
        return_rate: "5.0",
        underlying: [{ name: "Bonos", percentage: 100 }],
        catalog_product_id: 7,
        primary_source: "catalog",
        provenance: {},
      },
    });
    const editable = toEditableRow(row);
    const [product] = buildConfirmProducts([editable]);

    expect(product.name).toBe("Fondo Renta Fija");
    expect(product.amount).toBe(5000);
    expect(product.currency).toBe("USD");
    expect(product.asset_class).toEqual([
      { name: "mercados_publicos_fijo", percentage: 100 },
    ]);
    expect(product.underlying).toEqual([{ name: "Bonos", percentage: 100 }]);
    expect(product.geographic_focus).toEqual([{ name: "Perú", percentage: 100 }]);
    expect(product.administrator).toBe("Administradora X");
    expect(product.manager).toBe("Gestor Y");
    expect(product.liquidity).toBe("Diaria");
    expect(product.commission).toBe("0.5%");
    expect(product.catalog_product_id).toBe(7);
    expect(product).not.toHaveProperty("pertenencia");
  });

  test("sends an empty asset_class array and parses an edited amount when the row is still unmapped", () => {
    const editable = toEditableRow(
      baseRow({ mapped_asset_class: null, raw_amount: 1200 }),
    );
    editable.amount = "1500.50";
    const [product] = buildConfirmProducts([editable]);
    expect(product.asset_class).toEqual([]);
    expect(product.amount).toBe(1500.5);
  });
});
