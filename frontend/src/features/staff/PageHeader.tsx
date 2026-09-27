import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-linea pb-4">
      <div className="min-w-0">
        <div className="mb-2 h-1 w-12 rounded-full bg-sol" aria-hidden />
        <h1 className="text-2xl font-bold tracking-tight text-tinta sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-tenue sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
