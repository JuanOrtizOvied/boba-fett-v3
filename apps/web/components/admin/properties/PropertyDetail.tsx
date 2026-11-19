"use client";

import {
  formatAllocations,
  formatFractionPercent,
  formatRange,
  formatUsd,
  textOrNoData,
  type PropertyDetail as PropertyDetailData,
  type PropertyOwner,
} from "@/lib/properties";

function Attr({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-sabbi-neutral-500">{label}</dt>
      <dd className="text-sm text-sabbi-neutral-900">{value}</dd>
    </div>
  );
}

function OwnerCard({ owner }: { owner: PropertyOwner }) {
  return (
    <div className="rounded-xl border border-sabbi-neutral-200 bg-white p-4">
      <h4 className="mb-3 text-sm font-semibold text-sabbi-neutral-900">
        {textOrNoData(owner.client)}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Attr label="% de pertenencia" value={formatFractionPercent(owner.ownership_pct)} />
        <Attr label="Alquiler mensual" value={formatUsd(owner.monthly_rent_usd)} />
        <Attr label="Flujos (renta anual)" value={formatRange(owner.flows_min, owner.flows_max)} />
        <Attr label="Rentabilidad" value={formatRange(owner.return_min, owner.return_max)} />
      </dl>
    </div>
  );
}

/** One property, read only: its own fields and one card per owner. */
export function PropertyDetail({ property }: { property: PropertyDetailData }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-sabbi-neutral-200 bg-white p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-sabbi-neutral-900">
            {textOrNoData(property.name)}
          </h2>
          <p className="text-xs text-sabbi-neutral-500">Código: {property.code}</p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Attr label="Gestor" value={textOrNoData(property.manager)} />
          <Attr label="Administrador" value={textOrNoData(property.administrator)} />
          <Attr label="Moneda" value={textOrNoData(property.currency)} />
          <Attr
            label="Horizonte de inversión"
            value={textOrNoData(property.investment_horizon)}
          />
          <Attr label="Clase de activo" value={formatAllocations(property.asset_class)} />
          <Attr label="Foco geográfico" value={formatAllocations(property.geographic_focus)} />
          <Attr label="Subyacente" value={formatAllocations(property.underlying)} />
          <Attr label="Uso" value={textOrNoData(property.usage)} />
          <Attr label="Valor estimado" value={formatUsd(property.estimated_value_usd)} />
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-sabbi-neutral-900">Propietarios</h3>
        {property.owners.length === 0 ? (
          <p className="text-sm text-sabbi-neutral-600">Esta propiedad no tiene propietarios.</p>
        ) : (
          property.owners.map((owner) => <OwnerCard key={owner.client} owner={owner} />)
        )}
      </div>
    </div>
  );
}
