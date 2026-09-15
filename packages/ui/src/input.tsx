import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "./utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: ReactNode;
}

export function Input({ className, leadingIcon, ...props }: InputProps) {
  return (
    <label className="relative block">
      {leadingIcon ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-dusk-400">
          {leadingIcon}
        </span>
      ) : null}
      <input
        className={cn(
          "h-9 w-full rounded-lg border border-dusk-200 bg-white px-3 text-sm text-dusk-900 shadow-sm outline-none transition placeholder:text-dusk-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 disabled:cursor-not-allowed disabled:bg-dusk-50 disabled:text-dusk-500",
          Boolean(leadingIcon) && "pl-9",
          className,
        )}
        {...props}
      />
    </label>
  );
}
