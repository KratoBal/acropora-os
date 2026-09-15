import type { SelectHTMLAttributes } from "react";

import { cn } from "./utils";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-dusk-200 bg-white px-3 text-sm text-dusk-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 disabled:cursor-not-allowed disabled:bg-dusk-50 disabled:text-dusk-500",
        className,
      )}
      {...props}
    />
  );
}
