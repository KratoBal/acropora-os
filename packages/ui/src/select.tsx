import type { SelectHTMLAttributes } from "react";

import { Icon } from "./icon";
import { cn } from "./utils";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * The form-page select. It draws its own chevron (`appearance-none` hides the
 * browser's), so it looks like `PilotSelect` with the arrow. `className` goes
 * to the wrapper, which is what the caller sizes (`w-48`); the select fills it. `w-full`
 * is the default width only when no `className` is given: `cn` is a plain join, so
 * both width classes on one element would be settled by the stylesheet order.
 */
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <div className={cn("relative", className || "w-full")}>
      <select
        className="h-10 w-full cursor-pointer appearance-none rounded-lg border border-dusk-200 bg-white pl-3 pr-9 text-sm text-dusk-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 disabled:cursor-not-allowed disabled:bg-dusk-50 disabled:text-dusk-500"
        {...props}
      >
        {children}
      </select>
      <Icon
        name="chevron-down"
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-dusk-500"
      />
    </div>
  );
}
