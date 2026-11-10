export interface AllocationOptionGroup {
  label: string;
  options: string[];
}

// Option strings must stay byte-exact: they match values already stored in the DB.
export const GEOGRAPHIC_FOCUS_GROUPS: AllocationOptionGroup[] = [
  { label: "Perú", options: ["Perú"] },
  { label: "Desarrollados", options: ["EEUU", "Desarrollados ex-US"] },
  { label: "Emergentes", options: ["Latam ex-Perú", "Emergentes ex-Perú"] },
];

export const UNDERLYING_GROUPS: AllocationOptionGroup[] = [
  { label: "Renta Variable", options: ["US Large Cap", "US Mid & Small Cap", "Acciones Peru", "Mercados Emergentes ex Perú", "Desarrollados ex US", "REITs Públicos"] },
  { label: "Renta Fija", options: ["Bonos Corporativos Investment Grade (AAA–BBB)", "Bonos Perú", "Bonos High Yield", "Bonos Latinoamérica", "Bonos Mercados Emergentes (Global)", "US Treasuries Corto Plazo", "US Treasuries – Largo Plazo"] },
  { label: "Liquidez", options: ["Cash"] },
  { label: "Mercados Privados / Club Deals", options: ["Club Deals Otros Peru", "Club Deals Real Estate Peru", "Club Deals Deuda Privada Peru", "Club Deals Real Estate USA y Otros", "Club Deals Deuda Privada Usa y otros", "Private Credit Senior", "Private Equity", "Venture Capital", "Real Estate Privado (Fondos)"] },
  { label: "Alternativos", options: ["Hedge Funds", "Commodities", "Cripto", "Oro"] },
  { label: "Otros", options: ["por confirmar"] },
];

export function allocationOptionExists(
  groups: AllocationOptionGroup[],
  name: string,
): boolean {
  return groups.some((g) => g.options.includes(name));
}
