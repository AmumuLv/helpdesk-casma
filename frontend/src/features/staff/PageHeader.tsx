import type { ReactNode } from "react";

/**
 * Encabezado de página. Una sola línea de título + descripción corta,
 * y las acciones a la derecha. Sin adornos: la jerarquía la dan el peso
 * tipográfico y el espacio en blanco.
 */
export function PageHeader({ title, description, actions, meta }: {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-sub max-w-3xl">{description}</p>}
        {meta && <div className="mt-2">{meta}</div>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:w-auto">{actions}</div>
      )}
    </header>
  );
}
