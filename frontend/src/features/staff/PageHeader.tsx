import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-linea pb-5">
      <div className="min-w-0">
        <div className="mb-2.5 flex items-center gap-2" aria-hidden>
          <span className="h-1.5 w-10 rounded-full bg-casma" />
          <span className="h-1.5 w-4 rounded-full bg-sol" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-tinta sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm font-medium leading-6 text-tenue sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
