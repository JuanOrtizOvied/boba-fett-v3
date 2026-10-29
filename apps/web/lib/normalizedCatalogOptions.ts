/**
 * Closed vocabularies of the normalized catalog, taken from the values the
 * source Excel uses. They are NOT the lists of the older catalog
 * (`catalogOptions.ts`). Keep in sync with
 * `apps/backend/src/db/catalog_normalized_observations.py`, which flags any
 * value outside them.
 */
export const GEOGRAPHIC_FOCUS_OPTIONS = [
  "EEUU",
  "Desarrollados ex-US",
  "Emergentes ex-Perú",
  "Latam ex-Perú",
  "Perú",
] as const;

// "por confirmar" is the placeholder the owners use until the real currency
// is known, so it is a valid value.
export const CURRENCY_OPTIONS = ["dólares", "soles", "por confirmar"] as const;

export const ASSET_CLASS_OPTIONS = [
  "Mercados Públicos – Fijo",
  "Mercados Públicos – Variable",
  "Mercados Privados",
  "Club Deals",
  "Cash y Otros",
  "Criptos y Commodities",
  "Inmobiliario Directo",
] as const;

export const UNDERLYING_OPTIONS = [
  "Acciones Peru",
  "Bonos Corporativos Investment Grade (AAA–BBB)",
  "Bonos High Yield",
  "Bonos Latinoamérica",
  "Bonos Mercados Emergentes (Global)",
  "Bonos Perú",
  "Cash",
  "Club Deals Deuda Privada Peru",
  "Club Deals Deuda Privada Usa y otros",
  "Club Deals Otros Peru",
  "Club Deals Otros USA",
  "Club Deals Real Estate Peru",
  "Club Deals Real Estate USA y Otros",
  "Commodities",
  "Cripto",
  "Desarrollados ex US",
  "Hedge Funds",
  "Infrastructure Privada",
  "Mercados Emergentes ex Perú",
  "Oro",
  "Private Credit  Subordinated",
  "Private Credit Senior",
  "Private Equity",
  "Propiedades Directas Exterior",
  "Propiedades Directas Perú",
  "Real Estate Privado (Fondos)",
  "REITs Públicos",
  "US Large Cap",
  "US Mid & Small Cap",
  "US Treasuries – Largo Plazo",
  "US Treasuries Corto Plazo",
  "Venture Capital",
] as const;
