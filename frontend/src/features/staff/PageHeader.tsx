import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-linea pb-5 sm:mb-7 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="mb-2.5 flex items-center gap-2" aria-hidden>
          <span className="h-1.5 w-10 rounded-full bg-casma" />
          <span className="h-1.5 w-4 rounded-full bg-sol" />
        </div>
        <h1 className="text-2xl font-bold tracking-[-0.03em] text-tinta sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm font-medium leading-6 text-tenue sm:text-base">{description}</p>}
      </div>
      {actions && (
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center lg:justify-end [&>*]:w-full sm:[&>*]:w-auto">
          {actions}
        </div>
      )}
    </div>
  );
}
