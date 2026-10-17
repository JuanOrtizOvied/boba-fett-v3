/**
 * Strip at the top of the catalog edit modal that says whether the entry is
 * managed from the Excel. Always shown: with a `codigo` the Excel owns the
 * grey fields; without one the entry is outside the sync and fully editable.
 * The `codigo` is shown as information only, never as an editable field.
 */
export function ExcelManagedNotice({ codigo }: { codigo: string | null }) {
  if (codigo) {
    return (
      <div
        role="note"
        className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-sm text-amber-900"
      >
        Este producto se gestiona desde el Excel (
        <span className="font-semibold">{codigo}</span>). Los campos en gris se
        editan allá.
      </div>
    );
  }
  return (
    <div
      role="note"
      className="border-b border-sabbi-neutral-200 bg-sabbi-neutral-50 px-5 py-2.5 text-sm text-sabbi-neutral-600"
    >
      Este producto no tiene código, así que no se sincroniza con el Excel. Todos
      sus campos se editan aquí.
    </div>
  );
}
