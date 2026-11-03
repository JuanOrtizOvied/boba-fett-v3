import { describe, expect, test } from "vitest";
import {
  applySeriesAdminSelection,
  buildConfirmProducts,
  deriveConfidence,
  formatDeclaredSummary,
  formatFractionAsPercent,
  formatFractionValue,
  formatPlainNumber,
  formatSimilarityPercent,
  resolveConfidence,
  hasUnmappedRow,
  resolveRowSource,
  selectApprovedRows,
  toEditableAdminRows,
  toEditableRow,
  toEditableSeriesRows,
} from "@/components/admin/ficha-patrimonial/reviewTableShared";
import type { FichaEnrichedRow } from "@/lib/portfolio-types";

/** A V2-enriched row: product-level fields filled, commercial fields blank,
 * series/admin options attached for the review-table picker. */
function v2Enriched(): NonNullable<FichaEnrichedRow["enriched"]> {
  return {
    name: "Latam Credit Opportunities Fund",
    asset_class: [{ name: "Mercados Privados", percentage: 100 }],
    geographic_focus: [],
    commission: "",
    currency: "USD",
    administrator: "",
    manager: "Acme Manager",
    liquidity: "",
    return_rate: "",
    underlying: [],
    catalog_product_id: null,
    catalog_product_code: "BD-00001",
    series_options: [
      {
        series: "A",
        management_fee_ter: 0.0384,
        flows_min: null,
        flows_max: null,
        return_min: 0.05,
        return_max: 0.08,
        administrators: [
          {
            administrator: "Admin Co",
            custody_fee: 0.001,
            buy_commission: null,
            sell_commission: null,
            billing_currency: "USD",
            minimum_usd: null,
            min_commission_usd: null,
          },
        ],
      },
    ],
    primary_source: "catalog",
    provenance: {},
  };
}

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
    expect(editable.manager).toBe("Gestor Y");
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

describe("formatFractionAsPercent", () => {
  test("formats a catalog fraction as a percent, trimming trailing zeros", () => {
    expect(formatFractionAsPercent(0.0384)).toBe("3.84%");
    expect(formatFractionAsPercent(0.05)).toBe("5%");
    expect(formatFractionAsPercent(0)).toBe("0%");
  });

  test("returns an empty string for null/undefined", () => {
    expect(formatFractionAsPercent(null)).toBe("");
    expect(formatFractionAsPercent(undefined)).toBe("");
  });
});

describe("formatFractionValue", () => {
  test("renders a catalog fraction as a plain percent value (no % sign)", () => {
    expect(formatFractionValue(0.0384)).toBe("3.84");
    expect(formatFractionValue(0.05)).toBe("5");
    expect(formatFractionValue(0)).toBe("0");
  });

  test("returns an empty string for a null/undefined value", () => {
    expect(formatFractionValue(null)).toBe("");
    expect(formatFractionValue(undefined)).toBe("");
  });
});

describe("toEditableSeriesRows", () => {
  test("maps catalog series options to editable rows (fractions as plain percents)", () => {
    const rows = toEditableSeriesRows(v2Enriched().series_options ?? []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      series: "A",
      ter: "3.84",
      flowsMin: "",
      flowsMax: "",
      returnMin: "5",
      returnMax: "8",
      minimumUsd: "",
      howCalculated: "",
    });
  });

  test("returns an empty array when there are no series options", () => {
    expect(toEditableSeriesRows([])).toEqual([]);
  });
});

describe("formatPlainNumber", () => {
  test("renders an absolute number as-is (not scaled like a fraction)", () => {
    expect(formatPlainNumber(29.41)).toBe("29.41");
    expect(formatPlainNumber(100)).toBe("100");
    expect(formatPlainNumber(0)).toBe("0");
  });

  test("returns an empty string for a null/undefined value", () => {
    expect(formatPlainNumber(null)).toBe("");
    expect(formatPlainNumber(undefined)).toBe("");
  });
});

describe("toEditableAdminRows", () => {
  test("flattens every series' administrators into editable rows", () => {
    const rows = toEditableAdminRows(v2Enriched().series_options ?? []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      administrator: "Admin Co",
      series: "A",
      custody: "0.1", // custody_fee 0.001 -> 0.1%
      buy: "",
      sell: "",
      minimumUsd: "",
    });
  });

  test("returns an empty array when there are no series options", () => {
    expect(toEditableAdminRows([])).toEqual([]);
  });
});

describe("toEditableRow with V2 series options", () => {
  test("carries series options, starts unselected, commercial fields blank", () => {
    const editable = toEditableRow(
      baseRow({ normalized_return_rate: "", enriched: v2Enriched() }),
    );
    expect(editable.name).toBe("Latam Credit Opportunities Fund");
    expect(editable.seriesOptions.map((s) => s.series)).toEqual(["A"]);
    expect(editable.editableSeries.map((s) => s.series)).toEqual(["A"]);
    expect(editable.editableSeries[0].ter).toBe("3.84");
    expect(editable.editableAdmins.map((a) => a.administrator)).toEqual([
      "Admin Co",
    ]);
    expect(editable.selectedSeries).toBe("");
    expect(editable.selectedAdministrator).toBe("");
    // Commercial fields are not auto-filled — the admin picks a series/admin.
    expect(editable.commission).toBe("");
    expect(editable.administrator).toBe("");
    expect(editable.returnRateMin).toBe("");
  });

  test("defaults seriesOptions to an empty array when enrichment has none", () => {
    const editable = toEditableRow(baseRow({ enriched: null }));
    expect(editable.seriesOptions).toEqual([]);
  });
});

describe("applySeriesAdminSelection", () => {
  test("selecting a series fills commission and return range; admin blank until picked", () => {
    const row = toEditableRow(baseRow({ normalized_return_rate: "", enriched: v2Enriched() }));
    const patch = applySeriesAdminSelection(row, "A", "");
    expect(patch.selectedSeries).toBe("A");
    expect(patch.commission).toBe("3.84%");
    expect(patch.returnRateMin).toBe("5%");
    expect(patch.returnRateMax).toBe("8%");
    expect(patch.administrator).toBe("");
    expect(patch.selectedAdministrator).toBe("");
  });

  test("selecting an administrator fills its name", () => {
    const row = toEditableRow(baseRow({ normalized_return_rate: "", enriched: v2Enriched() }));
    const patch = applySeriesAdminSelection(row, "A", "Admin Co");
    expect(patch.selectedAdministrator).toBe("Admin Co");
    expect(patch.administrator).toBe("Admin Co");
  });

  test("an unknown series yields only the selection, no commercial field changes", () => {
    const row = toEditableRow(baseRow({ normalized_return_rate: "", enriched: v2Enriched() }));
    const patch = applySeriesAdminSelection(row, "ZZ", "");
    expect(patch.selectedSeries).toBe("ZZ");
    expect(patch.commission).toBeUndefined();
    expect(patch.returnRateMin).toBeUndefined();
  });
});

describe("deriveConfidence", () => {
  test("maps the match source to a confidence level", () => {
    expect(deriveConfidence("catalog").level).toBe("alta");
    expect(deriveConfidence("catalog").label).toBe("Confianza alta");
    expect(deriveConfidence("claude_knowledge").level).toBe("media");
    expect(deriveConfidence("claude_knowledge").label).toBe("Confianza media");
    expect(deriveConfidence("web_search").level).toBe("baja");
    expect(deriveConfidence("web_search").label).toBe("Confianza baja");
  });

  test("reports no data when the cascade found nothing", () => {
    expect(deriveConfidence("not_found").level).toBe("sin_datos");
    expect(deriveConfidence("not_found").label).toBe("Sin datos");
  });
});

describe("resolveConfidence", () => {
  test("prefers the backend confidence level when present", () => {
    const row = baseRow({
      enriched: { ...v2Enriched(), confidence: "media", primary_source: "catalog" },
    });
    expect(resolveConfidence(row).level).toBe("media");
    expect(resolveConfidence(row).label).toBe("Confianza media");
  });

  test("falls back to the source-derived confidence when the backend omits it", () => {
    const row = baseRow({ enriched: { ...v2Enriched(), primary_source: "catalog" } });
    expect(resolveConfidence(row).level).toBe("alta"); // catalog -> alta (Slice-1 fallback)
  });

  test("reports sin_datos when there is no enrichment", () => {
    expect(
      resolveConfidence(baseRow({ enriched: null, enrichment_failed: true })).level,
    ).toBe("sin_datos");
  });
});

describe("formatSimilarityPercent", () => {
  test("formats a 0..1 similarity as a rounded percent", () => {
    expect(formatSimilarityPercent(0.1827)).toBe("18%");
    expect(formatSimilarityPercent(0.73)).toBe("73%");
  });

  test("returns empty for a non-positive or missing similarity", () => {
    expect(formatSimilarityPercent(0)).toBe("");
    expect(formatSimilarityPercent(undefined)).toBe("");
  });
});

describe("formatDeclaredSummary", () => {
  test("joins declared currency, amount, and rate as the mockup shows", () => {
    const row = baseRow({
      raw_currency: "Soles",
      raw_amount: 10_294,
      raw_return_rate: "4.13%",
    });
    expect(formatDeclaredSummary(row)).toBe("Soles · 10,294 · declara 4.13%");
  });

  test("omits parts that are blank or a zero amount", () => {
    expect(
      formatDeclaredSummary(
        baseRow({ raw_currency: "", raw_amount: 0, raw_return_rate: "" }),
      ),
    ).toBe("");
    expect(
      formatDeclaredSummary(
        baseRow({ raw_currency: "USD", raw_amount: 0, raw_return_rate: "" }),
      ),
    ).toBe("USD");
  });
});

describe("line status", () => {
  test("toEditableRow starts a row as pending", () => {
    expect(toEditableRow(baseRow({})).lineStatus).toBe("pending");
  });

  test("selectApprovedRows keeps only approved rows (pending/discarded excluded)", () => {
    const a = toEditableRow(baseRow({ excel_row: 8 }));
    const b = toEditableRow(baseRow({ excel_row: 9 }));
    const c = toEditableRow(baseRow({ excel_row: 10 }));
    a.lineStatus = "approved";
    b.lineStatus = "discarded";
    // c stays pending
    expect(selectApprovedRows([a, b, c]).map((r) => r.excelRow)).toEqual([8]);
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
    editable.manager = "Gestor Editado"; // Gestor is now an editable field.
    const [product] = buildConfirmProducts([editable]);

    expect(product.name).toBe("Fondo Renta Fija");
    expect(product.amount).toBe(5000);
    expect(product.currency).toBe("USD");
    expect(product.manager).toBe("Gestor Editado");
    expect(product.asset_class).toEqual([
      { name: "mercados_publicos_fijo", percentage: 100 },
    ]);
    expect(product.underlying).toEqual([{ name: "Bonos", percentage: 100 }]);
    expect(product.geographic_focus).toEqual([{ name: "Perú", percentage: 100 }]);
    expect(product.administrator).toBe("Administradora X");
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
