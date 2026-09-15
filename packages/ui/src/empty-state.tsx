import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./utils";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  action,
  className,
  description,
  icon,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-dusk-300 bg-white/70 px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-dusk-100 text-dusk-500">
          {icon}
        </span>
      ) : null}
      <h2 className="text-base font-semibold text-dusk-900">{title}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-dusk-500">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
